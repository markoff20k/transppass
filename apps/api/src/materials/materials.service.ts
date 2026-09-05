import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DowntimeCause,
  MaterialRequestStatus,
  PoolComponentStatus,
  ReasonCodeList,
  TaskStatus,
  UserRole,
  WorkOrderStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import {
  MATERIAL_STATUSES_BLOCKING,
  type CreatePoolComponentInput,
  type DeliverMaterialInput,
  type LoanToolInput,
  type MaterialQuery,
  type MaterialRequestRow,
  type PoolComponentRow,
  type PoolMovementInput,
  type RequestMaterialInput,
  type SeparateMaterialInput,
  type ToolRow,
  type WaitForPartInput,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { DowntimeService } from '../common/downtime.service';
import { NotificationsService } from '../common/notifications.service';

/**
 * E5 — materiais, pool e ferramentas (RF-23 a RF-28).
 *
 * O PRD lista "indisponibilidade sem causa medida" entre as cinco dores e quer
 * reduzir a fatia de material a cada trimestre. Por isso material em aberto não
 * é só um aviso: bloqueia a sub-OS e muda a causa do relógio da OS-mãe, para
 * que o tempo perdido com peça apareça separado na decomposição.
 */
@Injectable()
export class MaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly downtime: DowntimeService,
    private readonly notifications: NotificationsService,
  ) {}

  /** RF-23 — início da cadeia solicitado → separado → entregue. */
  async request(input: RequestMaterialInput, actorId: string): Promise<MaterialRequestRow> {
    const task = await this.prisma.workOrderTask.findUnique({
      where: { id: input.workOrderTaskId },
      include: { workOrder: { include: { vehicle: { select: { code: true } } } } },
    });
    if (!task) throw new NotFoundException('Sub-OS não encontrada');
    if (task.workOrder.status === WorkOrderStatus.RELEASED) {
      throw new BadRequestException('A OS já foi liberada');
    }

    const material = await this.prisma.material.findUnique({ where: { id: input.materialId } });
    if (!material?.isActive) throw new BadRequestException('Material inválido ou desativado');

    const created = await this.prisma.$transaction(async (tx) => {
      const request = await tx.materialRequest.create({
        data: {
          workOrderId: task.workOrderId,
          workOrderTaskId: task.id,
          materialId: input.materialId,
          quantity: input.quantity,
          requestedById: actorId,
        },
      });

      if (input.blocksTask) {
        await tx.workOrderTask.update({
          where: { id: task.id },
          data: { status: TaskStatus.BLOCKED_BY_MATERIAL },
        });
      }

      await this.notifications.notify(tx, {
        role: UserRole.ESTOQUE,
        title: `Material solicitado — carro ${task.workOrder.vehicle.code}`,
        body: `${material.code} — ${material.description} (${input.quantity} ${material.unit}) para a sub-OS ${task.code}.`,
        entity: 'MaterialRequest',
        entityId: request.id,
      });

      return request;
    });

    await this.audit.write({
      actorId,
      action: 'material.request',
      entity: 'MaterialRequest',
      entityId: created.id,
      after: { materialId: input.materialId, quantity: input.quantity },
    });

    return this.findOne(created.id);
  }

  async separate(
    id: string,
    input: SeparateMaterialInput,
    actorId: string,
  ): Promise<MaterialRequestRow> {
    const request = await this.requirePending(id);
    if (request.status !== MaterialRequestStatus.REQUESTED &&
        request.status !== MaterialRequestStatus.WAITING_PART) {
      throw new BadRequestException('Só é possível separar uma solicitação em aberto');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.materialRequest.update({
        where: { id },
        data: {
          status: MaterialRequestStatus.SEPARATED,
          separatedById: actorId,
          separatedAt: new Date(),
          serialNumber: input.serialNumber,
        },
      });

      // A chegada da peça encerra a espera e devolve o relógio para execução.
      if (request.partWaiting && !request.partWaiting.resolvedAt) {
        await tx.partWaiting.update({
          where: { id: request.partWaiting.id },
          data: { resolvedAt: new Date(), arrivalNotifiedAt: new Date() },
        });
        await this.restoreExecutionClock(tx, request.workOrderId);
      }
    });

    return this.findOne(id);
  }

  /** RF-23 — a entrega registra quem recebeu na valeta. */
  async deliver(
    id: string,
    input: DeliverMaterialInput,
    actorId: string,
  ): Promise<MaterialRequestRow> {
    const request = await this.requirePending(id);
    if (request.status !== MaterialRequestStatus.SEPARATED) {
      throw new BadRequestException('Separe a solicitação antes de entregar');
    }
    if (request.material.isSerialized && !(input.serialNumber ?? request.serialNumber)) {
      throw new BadRequestException(
        'Este material é controlado por número de série — informe o número entregue',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.materialRequest.update({
        where: { id },
        data: {
          status: MaterialRequestStatus.DELIVERED,
          deliveredById: actorId,
          deliveredAt: new Date(),
          receivedByName: input.receivedByName,
          serialNumber: input.serialNumber ?? request.serialNumber,
        },
      });

      await this.unblockTaskIfClear(tx, request.workOrderTaskId);
      await this.restoreExecutionClock(tx, request.workOrderId);
    });

    await this.audit.write({
      actorId,
      action: 'material.deliver',
      entity: 'MaterialRequest',
      entityId: id,
      after: { receivedByName: input.receivedByName },
    });

    return this.findOne(id);
  }

  /**
   * RF-24 — estado aguardando peça, com motivo e prazo. A partir daqui o tempo
   * parado passa a ser contado como material na decomposição do RF-39.
   */
  async waitForPart(
    id: string,
    input: WaitForPartInput,
    actorId: string,
  ): Promise<MaterialRequestRow> {
    const request = await this.requirePending(id);

    const reason = await this.prisma.reasonCode.findUnique({ where: { id: input.reasonCodeId } });
    if (!reason || reason.list !== ReasonCodeList.PART_WAITING) {
      throw new BadRequestException('Código de motivo inválido para aguardando peça');
    }
    if (!reason.isActive) throw new BadRequestException('Este código de motivo está desativado');

    await this.prisma.$transaction(async (tx) => {
      await tx.materialRequest.update({
        where: { id },
        data: { status: MaterialRequestStatus.WAITING_PART },
      });

      await tx.partWaiting.upsert({
        where: { materialRequestId: id },
        create: {
          materialRequestId: id,
          reasonCodeId: input.reasonCodeId,
          expectedAt: input.expectedAt,
        },
        update: { reasonCodeId: input.reasonCodeId, expectedAt: input.expectedAt, resolvedAt: null },
      });

      if (request.workOrderId) {
        await tx.workOrder.update({
          where: { id: request.workOrderId },
          data: { status: WorkOrderStatus.WAITING_PART },
        });
        await this.downtime.switchCause(tx, request.workOrderId, DowntimeCause.MATERIAL);
      }

      if (request.workOrderTaskId) {
        await tx.workOrderTask.update({
          where: { id: request.workOrderTaskId },
          data: { status: TaskStatus.BLOCKED_BY_MATERIAL },
        });
      }

      await this.notifications.notify(tx, {
        role: UserRole.PCM,
        title: `Carro ${request.workOrder?.vehicle.code ?? '—'} aguardando peça`,
        body: `${reason.description}. Prazo previsto: ${input.expectedAt.toLocaleDateString('pt-BR')}.`,
        entity: 'MaterialRequest',
        entityId: id,
      });
    });

    await this.audit.write({
      actorId,
      action: 'material.waitForPart',
      entity: 'MaterialRequest',
      entityId: id,
      after: { reasonCode: reason.code, expectedAt: input.expectedAt },
    });

    return this.findOne(id);
  }

  /**
   * RF-24 — escalonamento por prazo vencido. Exposto como endpoint porque a
   * infraestrutura de agendamento é questão aberta do PRD (seção 12); quando
   * ela existir, o mesmo método vira o corpo de um job.
   */
  async escalateOverdue(now = new Date()): Promise<{ escalated: number }> {
    const overdue = await this.prisma.partWaiting.findMany({
      where: { resolvedAt: null, escalatedAt: null, expectedAt: { lt: now } },
      include: {
        reasonCode: true,
        materialRequest: {
          include: {
            material: true,
            workOrder: { include: { vehicle: { select: { code: true } } } },
          },
        },
      },
    });

    for (const waiting of overdue) {
      await this.prisma.$transaction(async (tx) => {
        await tx.partWaiting.update({
          where: { id: waiting.id },
          data: { escalatedAt: now },
        });

        const vehicleCode = waiting.materialRequest.workOrder?.vehicle.code ?? '—';
        const body =
          `${waiting.materialRequest.material.code} — ${waiting.materialRequest.material.description}. ` +
          `Prazo era ${waiting.expectedAt.toLocaleDateString('pt-BR')} (${waiting.reasonCode.description}).`;

        await this.notifications.notifyMany(tx, [
          {
            role: UserRole.PCM,
            title: `Prazo de peça vencido — carro ${vehicleCode}`,
            body,
            entity: 'PartWaiting',
            entityId: waiting.id,
          },
          {
            role: UserRole.ESTOQUE,
            title: `Prazo de peça vencido — carro ${vehicleCode}`,
            body,
            entity: 'PartWaiting',
            entityId: waiting.id,
          },
        ]);
      });
    }

    return { escalated: overdue.length };
  }

  // --- Pool rotativo (RF-26) ------------------------------------------------

  async createPoolComponent(
    input: CreatePoolComponentInput,
    actorId: string,
  ): Promise<PoolComponentRow> {
    const material = await this.prisma.material.findUnique({ where: { id: input.materialId } });
    if (!material) throw new NotFoundException('Material não encontrado');
    if (!material.isSerialized) {
      throw new BadRequestException('Só materiais controlados por número de série entram no pool');
    }

    const component = await this.prisma.poolComponent.create({
      data: { materialId: input.materialId, serialNumber: input.serialNumber },
    });

    await this.audit.write({
      actorId,
      action: 'pool.create',
      entity: 'PoolComponent',
      entityId: component.id,
      after: { serialNumber: input.serialNumber },
    });

    return this.findPoolComponent(component.id);
  }

  /** Cada movimento do pool fica registrado: saldo → carro → Oficina → saldo. */
  async movePoolComponent(
    id: string,
    input: PoolMovementInput,
    actorId: string,
  ): Promise<PoolComponentRow> {
    const component = await this.prisma.poolComponent.findUnique({ where: { id } });
    if (!component) throw new NotFoundException('Componente do pool não encontrado');
    if (component.status === input.toStatus) {
      throw new BadRequestException('O componente já está neste estado');
    }
    if (component.status === PoolComponentStatus.SCRAPPED) {
      throw new BadRequestException('Componente sucateado não volta ao pool');
    }

    let currentVehicleId: string | null = component.currentVehicleId;
    if (input.toStatus === PoolComponentStatus.IN_USE) {
      if (!input.workOrderTaskId) {
        throw new BadRequestException('Informe a sub-OS em que o componente foi aplicado');
      }
      const task = await this.prisma.workOrderTask.findUnique({
        where: { id: input.workOrderTaskId },
        include: { workOrder: { select: { vehicleId: true } } },
      });
      if (!task) throw new NotFoundException('Sub-OS não encontrada');
      currentVehicleId = task.workOrder.vehicleId;
    } else {
      currentVehicleId = null;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.poolMovement.create({
        data: {
          componentId: id,
          fromStatus: component.status,
          toStatus: input.toStatus,
          workOrderTaskId: input.workOrderTaskId,
          actorId,
          note: input.note,
        },
      });
      await tx.poolComponent.update({
        where: { id },
        data: { status: input.toStatus, currentVehicleId },
      });
    });

    return this.findPoolComponent(id);
  }

  async listPool(): Promise<PoolComponentRow[]> {
    const rows = await this.prisma.poolComponent.findMany({
      orderBy: [{ status: 'asc' }, { serialNumber: 'asc' }],
      include: { material: true, currentVehicle: { select: { code: true } } },
    });
    return rows.map(toPoolRow);
  }

  private async findPoolComponent(id: string): Promise<PoolComponentRow> {
    const row = await this.prisma.poolComponent.findUniqueOrThrow({
      where: { id },
      include: { material: true, currentVehicle: { select: { code: true } } },
    });
    return toPoolRow(row);
  }

  // --- Ferramentas (RF-28) --------------------------------------------------

  /** Calibração vencida bloqueia o empréstimo: medição sem fé não vale nada. */
  async loanTool(input: LoanToolInput, actorId: string): Promise<ToolRow[]> {
    const tool = await this.prisma.tool.findUnique({ where: { id: input.toolId } });
    if (!tool?.isActive) throw new NotFoundException('Ferramenta não encontrada');

    if (tool.calibrationDueAt && tool.calibrationDueAt < new Date()) {
      throw new BadRequestException(
        `Calibração da ferramenta ${tool.code} venceu em ${tool.calibrationDueAt.toLocaleDateString('pt-BR')} — empréstimo bloqueado`,
      );
    }

    const open = await this.prisma.toolLoan.findFirst({
      where: { toolId: input.toolId, returnedAt: null },
    });
    if (open) throw new BadRequestException('Esta ferramenta já está emprestada');

    await this.prisma.toolLoan.create({
      data: {
        toolId: input.toolId,
        borrowerId: actorId,
        workOrderTaskId: input.workOrderTaskId,
      },
    });

    return this.listTools();
  }

  async returnTool(toolId: string): Promise<ToolRow[]> {
    const open = await this.prisma.toolLoan.findFirst({
      where: { toolId, returnedAt: null },
    });
    if (!open) throw new BadRequestException('Esta ferramenta não está emprestada');

    await this.prisma.toolLoan.update({
      where: { id: open.id },
      data: { returnedAt: new Date() },
    });

    return this.listTools();
  }

  async listTools(): Promise<ToolRow[]> {
    const tools = await this.prisma.tool.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      include: { loans: { where: { returnedAt: null }, take: 1 } },
    });

    const borrowerIds = tools.flatMap((t) => t.loans.map((l) => l.borrowerId));
    const users = borrowerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: borrowerIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    const now = new Date();

    return tools.map((t) => ({
      id: t.id,
      code: t.code,
      description: t.description,
      calibrationDueAt: t.calibrationDueAt?.toISOString() ?? null,
      isCalibrationExpired: Boolean(t.calibrationDueAt && t.calibrationDueAt < now),
      loanedToName: t.loans[0] ? (nameById.get(t.loans[0].borrowerId) ?? null) : null,
      loanedAt: t.loans[0]?.loanedAt.toISOString() ?? null,
    }));
  }

  // --- Consultas ------------------------------------------------------------

  async list(query: MaterialQuery): Promise<MaterialRequestRow[]> {
    const where: Prisma.MaterialRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.workOrderId ? { workOrderId: query.workOrderId } : {}),
      ...(query.onlyPending ? { status: { in: [...MATERIAL_STATUSES_BLOCKING] } } : {}),
    };

    const rows = await this.prisma.materialRequest.findMany({
      where,
      // Fila única do Estoque: o mais antigo primeiro, é o que segura carro.
      orderBy: { requestedAt: 'asc' },
      include: materialInclude,
    });

    return rows.map(toRequestRow);
  }

  async findOne(id: string): Promise<MaterialRequestRow> {
    const row = await this.prisma.materialRequest.findUnique({
      where: { id },
      include: materialInclude,
    });
    if (!row) throw new NotFoundException('Solicitação não encontrada');
    return toRequestRow(row);
  }

  private async requirePending(id: string) {
    const request = await this.prisma.materialRequest.findUnique({
      where: { id },
      include: {
        material: true,
        partWaiting: true,
        workOrder: { include: { vehicle: { select: { code: true } } } },
      },
    });
    if (!request) throw new NotFoundException('Solicitação não encontrada');
    if (request.status === MaterialRequestStatus.DELIVERED) {
      throw new BadRequestException('Esta solicitação já foi entregue');
    }
    if (request.status === MaterialRequestStatus.CANCELLED) {
      throw new BadRequestException('Esta solicitação foi cancelada');
    }
    return request;
  }

  /** A sub-OS só sai do bloqueio quando nada mais está pendente para ela. */
  private async unblockTaskIfClear(
    tx: Prisma.TransactionClient,
    taskId: string | null,
  ): Promise<void> {
    if (!taskId) return;

    const stillBlocking = await tx.materialRequest.count({
      where: { workOrderTaskId: taskId, status: { in: [...MATERIAL_STATUSES_BLOCKING] } },
    });
    if (stillBlocking > 0) return;

    const task = await tx.workOrderTask.findUnique({ where: { id: taskId } });
    if (task?.status === TaskStatus.BLOCKED_BY_MATERIAL) {
      await tx.workOrderTask.update({
        where: { id: taskId },
        data: { status: task.startedAt ? TaskStatus.IN_PROGRESS : TaskStatus.PENDING },
      });
    }
  }

  /** Volta o relógio da OS para execução quando nenhuma peça mais a segura. */
  private async restoreExecutionClock(
    tx: Prisma.TransactionClient,
    workOrderId: string | null,
  ): Promise<void> {
    if (!workOrderId) return;

    const stillWaiting = await tx.materialRequest.count({
      where: { workOrderId, status: MaterialRequestStatus.WAITING_PART },
    });
    if (stillWaiting > 0) return;

    const workOrder = await tx.workOrder.findUnique({ where: { id: workOrderId } });
    if (workOrder?.status === WorkOrderStatus.WAITING_PART) {
      await tx.workOrder.update({
        where: { id: workOrderId },
        data: { status: WorkOrderStatus.IN_PROGRESS },
      });
      await this.downtime.switchCause(tx, workOrderId, DowntimeCause.EXECUTION);
    }
  }
}

const materialInclude = {
  material: true,
  partWaiting: { include: { reasonCode: true } },
  workOrder: { include: { vehicle: { select: { code: true } } } },
  workOrderTask: { select: { description: true } },
} satisfies Prisma.MaterialRequestInclude;

type RequestWithRelations = Prisma.MaterialRequestGetPayload<{ include: typeof materialInclude }>;

function toRequestRow(r: RequestWithRelations): MaterialRequestRow {
  const now = new Date();
  return {
    id: r.id,
    status: r.status,
    materialId: r.materialId,
    materialCode: r.material.code,
    materialDescription: r.material.description,
    isSerialized: r.material.isSerialized,
    quantity: Number(r.quantity),
    serialNumber: r.serialNumber,
    workOrderId: r.workOrderId,
    workOrderCode: r.workOrder?.code ?? null,
    workOrderTaskId: r.workOrderTaskId,
    taskDescription: r.workOrderTask?.description ?? null,
    vehicleCode: r.workOrder?.vehicle.code ?? null,
    requestedAt: r.requestedAt.toISOString(),
    requestedByName: null,
    separatedAt: r.separatedAt?.toISOString() ?? null,
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    receivedByName: r.receivedByName,
    partWaiting: r.partWaiting
      ? {
          reasonDescription: r.partWaiting.reasonCode.description,
          expectedAt: r.partWaiting.expectedAt.toISOString(),
          isOverdue: !r.partWaiting.resolvedAt && r.partWaiting.expectedAt < now,
          escalatedAt: r.partWaiting.escalatedAt?.toISOString() ?? null,
        }
      : null,
  };
}

function toPoolRow(r: {
  id: string;
  serialNumber: string;
  status: PoolComponentStatus;
  material: { code: string; description: string };
  currentVehicle: { code: string } | null;
}): PoolComponentRow {
  return {
    id: r.id,
    serialNumber: r.serialNumber,
    status: r.status,
    materialCode: r.material.code,
    materialDescription: r.material.description,
    currentVehicleCode: r.currentVehicle?.code ?? null,
  };
}
