import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CleaningStatus,
  DowntimeCause,
  EventStatus,
  InspectionResult,
  ReasonCodeList,
  TaskStatus,
  UserRole,
  VehicleStatus,
  WorkOrderStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import {
  MATERIAL_STATUSES_BLOCKING,
  TASK_STATUSES_SETTLED,
  paginate,
  type ChecklistItemInput,
  type CleaningDamageInput,
  type CreateTaskInput,
  type FinishTaskInput,
  type InspectionInput,
  type OpenWorkOrderInput,
  type Paginated,
  type UpdateEstimateInput,
  type WorkOrderDetail,
  type WorkOrderQuery,
  type WorkOrderSummary,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { DowntimeService } from '../common/downtime.service';
import { NotificationsService } from '../common/notifications.service';
import { QueueService } from '../queue/queue.service';
import { nextSequentialCode } from '../common/sequence';

/** Checklist mínimo de limpeza, conforme o padrão do contrato (RF-21). */
const CLEANING_CHECKLIST = [
  'Varrição e recolhimento de resíduos',
  'Limpeza de piso e corrimãos',
  'Limpeza de bancos e validador',
  'Limpeza de vidros interno e externo',
  'Higienização do posto do operador',
];

/**
 * E4 — execução da manutenção (RF-17 a RF-22).
 *
 * Os três portões que o PRD descreve estão implementados como bloqueio de
 * transição, não como aviso de tela:
 *
 * - Portão 1 (RF-19): não encerra tecnicamente com sub-OS pendente.
 * - Portão 2 (RF-20): inspeção reprovada reabre a sub-OS sozinha.
 * - Liberação (RF-22): exclusiva da Manutenção, exige os portões e a limpeza,
 *   para o relógio e conta o evento no MKBF.
 */
@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly downtime: DowntimeService,
    private readonly notifications: NotificationsService,
    private readonly queue: QueueService,
  ) {}

  /** RF-17 — abertura manual (a triagem abre sozinha no caminho do recolhimento). */
  async open(input: OpenWorkOrderInput, actorId: string): Promise<WorkOrderDetail> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: input.vehicleId } });
    if (!vehicle) throw new NotFoundException('Carro não encontrado');

    const openOne = await this.prisma.workOrder.findFirst({
      where: { vehicleId: input.vehicleId, status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] } },
      select: { code: true },
    });
    if (openOne) {
      // Duas OS-mãe no mesmo carro fariam dois relógios correndo em paralelo,
      // e a indisponibilidade passaria a ser contada em dobro (RN-02).
      throw new BadRequestException(`O carro já tem a OS ${openOne.code} em aberto`);
    }

    const workOrder = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const created = await tx.workOrder.create({
        data: {
          code: await nextSequentialCode(tx, 'workOrder', 'OS'),
          vehicleId: input.vehicleId,
          type: input.type,
          eventId: input.eventId,
          scheduledMaintenanceId: input.scheduledMaintenanceId,
          openedAt: now,
          estimatedCompletionAt: input.estimatedCompletionAt,
          jbWorkOrderNumber: input.jbWorkOrderNumber,
          createdById: actorId,
        },
      });

      await this.downtime.start(tx, created.id, DowntimeCause.QUEUE, now);

      await this.queue.enqueue(tx, {
        vehicleId: input.vehicleId,
        eventId: input.eventId,
        workOrderId: created.id,
        criticality: this.queue.criticalityFor({ type: input.type }),
        isFastTrack: false,
      });

      await tx.vehicle.update({
        where: { id: input.vehicleId },
        data: { status: VehicleStatus.AWAITING_MAINTENANCE },
      });

      return created;
    });

    await this.audit.write({
      actorId,
      action: 'workOrder.open',
      entity: 'WorkOrder',
      entityId: workOrder.id,
      after: { code: workOrder.code, type: input.type },
    });

    return this.findOne(workOrder.id);
  }

  /** RN-03 — a previsão pode mudar, mas nunca some, e o Plantão fica sabendo. */
  async updateEstimate(
    id: string,
    input: UpdateEstimateInput,
    actorId: string,
  ): Promise<WorkOrderDetail> {
    const before = await this.requireOpen(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id },
        data: { estimatedCompletionAt: input.estimatedCompletionAt },
      });
      await this.notifications.notifyForecastChange(
        tx,
        before.vehicle.code,
        id,
        input.estimatedCompletionAt,
      );
    });

    await this.audit.write({
      actorId,
      action: 'workOrder.updateEstimate',
      entity: 'WorkOrder',
      entityId: id,
      before: { estimatedCompletionAt: before.estimatedCompletionAt },
      after: { estimatedCompletionAt: input.estimatedCompletionAt },
    });

    return this.findOne(id);
  }

  // --- Sub-OS (RF-18) -------------------------------------------------------

  async addTask(
    workOrderId: string,
    input: CreateTaskInput,
    actorId: string,
  ): Promise<WorkOrderDetail> {
    const workOrder = await this.requireOpen(workOrderId);
    if (workOrder.status === WorkOrderStatus.TECH_CLOSED) {
      throw new BadRequestException(
        'A OS já foi encerrada tecnicamente — reabra antes de acrescentar serviço',
      );
    }

    const count = await this.prisma.workOrderTask.count({ where: { workOrderId } });

    await this.prisma.$transaction(async (tx) => {
      await tx.workOrderTask.create({
        data: {
          workOrderId,
          code: `S${String(count + 1).padStart(2, '0')}`,
          specialtyId: input.specialtyId,
          description: input.description,
          assignedToId: input.assignedToId,
          checklistItems: {
            create: input.checklist.map((c, index) => ({
              sequence: index + 1,
              description: c.description,
            })),
          },
        },
      });

      // A primeira sub-OS marca o começo da execução de verdade: o carro sai
      // da espera em fila e o relógio passa a contar como execução.
      if (count === 0 && workOrder.status === WorkOrderStatus.OPEN) {
        await tx.workOrder.update({
          where: { id: workOrderId },
          data: { status: WorkOrderStatus.IN_PROGRESS },
        });
        await this.downtime.switchCause(tx, workOrderId, DowntimeCause.EXECUTION);
        await tx.vehicle.update({
          where: { id: workOrder.vehicleId },
          data: { status: VehicleStatus.IN_MAINTENANCE },
        });

        const entry = await tx.queueEntry.findFirst({ where: { workOrderId } });
        if (entry) await this.queue.startService(tx, entry.id);
      }
    });

    await this.audit.write({
      actorId,
      action: 'task.create',
      entity: 'WorkOrder',
      entityId: workOrderId,
      after: { description: input.description },
    });

    return this.findOne(workOrderId);
  }

  async startTask(taskId: string, actorId: string): Promise<WorkOrderDetail> {
    const task = await this.requireTask(taskId);
    if (task.status === TaskStatus.BLOCKED_BY_MATERIAL) {
      throw new BadRequestException('Sub-OS bloqueada por material — aguarde a entrega');
    }

    await this.prisma.workOrderTask.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.IN_PROGRESS,
        startedAt: task.startedAt ?? new Date(),
        assignedToId: task.assignedToId ?? actorId,
      },
    });

    return this.findOne(task.workOrderId);
  }

  async toggleChecklistItem(
    itemId: string,
    input: ChecklistItemInput,
  ): Promise<WorkOrderDetail> {
    const item = await this.prisma.taskChecklistItem.findUnique({
      where: { id: itemId },
      include: { task: { select: { workOrderId: true } } },
    });
    if (!item) throw new NotFoundException('Item de checklist não encontrado');

    await this.prisma.taskChecklistItem.update({
      where: { id: itemId },
      data: {
        isChecked: input.isChecked,
        checkedAt: input.isChecked ? new Date() : null,
        measurement: input.measurement,
        unit: input.unit,
      },
    });

    return this.findOne(item.task.workOrderId);
  }

  /** Conclusão da sub-OS: exige checklist completo e causa constatada de lista. */
  async finishTask(
    taskId: string,
    input: FinishTaskInput,
    actorId: string,
  ): Promise<WorkOrderDetail> {
    const task = await this.requireTask(taskId);

    const pendingChecklist = await this.prisma.taskChecklistItem.count({
      where: { taskId, isChecked: false },
    });
    if (pendingChecklist > 0) {
      throw new BadRequestException(`Faltam ${pendingChecklist} item(ns) do checklist`);
    }

    const blocking = await this.prisma.materialRequest.count({
      where: { workOrderTaskId: taskId, status: { in: [...MATERIAL_STATUSES_BLOCKING] } },
    });
    if (blocking > 0) {
      throw new BadRequestException(`Há ${blocking} solicitação(ões) de material em aberto`);
    }

    const catalogItem = await this.prisma.failureCatalogItem.findUnique({
      where: { id: input.confirmedCatalogItemId },
    });
    if (!catalogItem) throw new BadRequestException('Causa constatada inválida');

    await this.prisma.workOrderTask.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.DONE,
        finishedAt: new Date(),
        confirmedCatalogItemId: input.confirmedCatalogItemId,
      },
    });

    await this.audit.write({
      actorId,
      action: 'task.finish',
      entity: 'WorkOrderTask',
      entityId: taskId,
      after: { confirmedCause: catalogItem.code },
    });

    return this.findOne(task.workOrderId);
  }

  // --- Portão 1: encerramento técnico (RF-19) -------------------------------

  async techClose(id: string, actorId: string): Promise<WorkOrderDetail> {
    const workOrder = await this.requireOpen(id);
    const gates = await this.evaluateGates(id);

    if (!gates.canTechClose) {
      throw new BadRequestException(gates.blockingReasons.join('; '));
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id },
        data: { status: WorkOrderStatus.TECH_CLOSED, techClosedAt: new Date() },
      });
      await this.downtime.switchCause(tx, id, DowntimeCause.RELEASE_WAIT);

      // A limpeza é pré-requisito da liberação, então nasce junto com o
      // encerramento técnico em vez de depender de alguém lembrar de criá-la.
      const existing = await tx.cleaning.findUnique({ where: { workOrderId: id } });
      if (!existing) {
        await tx.cleaning.create({
          data: {
            workOrderId: id,
            checklistItems: {
              create: CLEANING_CHECKLIST.map((description, index) => ({
                sequence: index + 1,
                description,
              })),
            },
          },
        });
      }

      await this.notifications.notify(tx, {
        role: UserRole.LIMPEZA,
        title: `Carro ${workOrder.vehicle.code} pronto para limpeza`,
        body: `A OS ${workOrder.code} foi encerrada tecnicamente e aguarda o padrão do contrato.`,
        entity: 'WorkOrder',
        entityId: id,
      });
    });

    await this.audit.write({
      actorId,
      action: 'workOrder.techClose',
      entity: 'WorkOrder',
      entityId: id,
    });

    return this.findOne(id);
  }

  // --- Portão 2: inspeção por sub-OS (RF-20) --------------------------------

  async inspect(taskId: string, input: InspectionInput, actorId: string): Promise<WorkOrderDetail> {
    const task = await this.requireTask(taskId);
    if (!TASK_STATUSES_SETTLED.includes(task.status)) {
      throw new BadRequestException('Só é possível inspecionar sub-OS concluída');
    }

    if (input.result === InspectionResult.REJECTED) {
      const reason = await this.prisma.reasonCode.findUnique({
        where: { id: input.reasonCodeId! },
      });
      if (!reason || reason.list !== ReasonCodeList.INSPECTION_REJECTION) {
        throw new BadRequestException('Código de motivo inválido para reprovação de inspeção');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const inspection = await tx.inspection.create({
        data: {
          taskId,
          inspectorId: actorId,
          result: input.result,
          reasonCodeId: input.reasonCodeId,
          note: input.note,
        },
      });

      if (input.measurements.length) {
        await tx.inspectionMeasurement.createMany({
          data: input.measurements.map((m) => ({
            inspectionId: inspection.id,
            description: m.description,
            value: m.value,
            unit: m.unit,
            minValue: m.minValue,
            maxValue: m.maxValue,
            isWithinSpec:
              (m.minValue === undefined || m.value >= m.minValue) &&
              (m.maxValue === undefined || m.value <= m.maxValue),
          })),
        });
      }

      if (input.result === InspectionResult.REJECTED) {
        // RN-05 — a reprovação reabre a sub-OS sozinha. Ninguém precisa lembrar
        // de reabrir, e o contador de reincidência alimenta o retrabalho interno.
        await tx.workOrderTask.update({
          where: { id: taskId },
          data: {
            status: TaskStatus.PENDING,
            finishedAt: null,
            reopenedCount: { increment: 1 },
          },
        });

        // Reprovar puxa a OS de volta para execução, inclusive se já estava
        // encerrada tecnicamente — o portão 1 volta a ficar fechado.
        await tx.workOrder.update({
          where: { id: task.workOrderId },
          data: { status: WorkOrderStatus.IN_PROGRESS, techClosedAt: null },
        });
        await this.downtime.switchCause(tx, task.workOrderId, DowntimeCause.EXECUTION);

        await this.notifications.notify(tx, {
          role: UserRole.MANUTENCAO,
          title: `Sub-OS ${task.code} reprovada na inspeção`,
          body: input.note ?? 'A sub-OS foi reaberta automaticamente.',
          entity: 'WorkOrderTask',
          entityId: taskId,
        });
      } else {
        await tx.workOrderTask.update({
          where: { id: taskId },
          data: { status: TaskStatus.APPROVED },
        });
      }
    });

    await this.audit.write({
      actorId,
      action: `inspection.${input.result.toLowerCase()}`,
      entity: 'WorkOrderTask',
      entityId: taskId,
      after: { result: input.result, reasonCodeId: input.reasonCodeId },
    });

    return this.findOne(task.workOrderId);
  }

  // --- Limpeza (RF-21) ------------------------------------------------------

  async startCleaning(workOrderId: string, actorId: string): Promise<WorkOrderDetail> {
    const cleaning = await this.requireCleaning(workOrderId);

    await this.prisma.$transaction(async (tx) => {
      await tx.cleaning.update({
        where: { id: cleaning.id },
        data: {
          status: CleaningStatus.IN_PROGRESS,
          startedAt: cleaning.startedAt ?? new Date(),
          performedById: actorId,
        },
      });
      await tx.workOrder.update({
        where: { id: workOrderId },
        data: { status: WorkOrderStatus.IN_CLEANING },
      });
      await this.downtime.switchCause(tx, workOrderId, DowntimeCause.CLEANING);
    });

    return this.findOne(workOrderId);
  }

  async toggleCleaningItem(itemId: string, isChecked: boolean): Promise<WorkOrderDetail> {
    const item = await this.prisma.cleaningChecklistItem.findUnique({
      where: { id: itemId },
      include: { cleaning: { select: { workOrderId: true } } },
    });
    if (!item) throw new NotFoundException('Item de checklist não encontrado');

    await this.prisma.cleaningChecklistItem.update({
      where: { id: itemId },
      data: { isChecked, checkedAt: isChecked ? new Date() : null },
    });

    return this.findOne(item.cleaning.workOrderId);
  }

  async finishCleaning(workOrderId: string, actorId: string): Promise<WorkOrderDetail> {
    const cleaning = await this.requireCleaning(workOrderId);

    const pending = await this.prisma.cleaningChecklistItem.count({
      where: { cleaningId: cleaning.id, isChecked: false },
    });
    if (pending > 0) {
      throw new BadRequestException(`Faltam ${pending} item(ns) do checklist de limpeza`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.cleaning.update({
        where: { id: cleaning.id },
        data: { status: CleaningStatus.DONE, finishedAt: new Date() },
      });
      await tx.workOrder.update({
        where: { id: workOrderId },
        data: { status: WorkOrderStatus.TECH_CLOSED },
      });
      await this.downtime.switchCause(tx, workOrderId, DowntimeCause.RELEASE_WAIT);
    });

    await this.audit.write({
      actorId,
      action: 'cleaning.finish',
      entity: 'Cleaning',
      entityId: cleaning.id,
    });

    return this.findOne(workOrderId);
  }

  /** Avaria vista na limpeza vira backlog do carro, não recado solto (RN-07). */
  async reportCleaningDamage(
    workOrderId: string,
    input: CleaningDamageInput,
    actorId: string,
  ): Promise<WorkOrderDetail> {
    const cleaning = await this.requireCleaning(workOrderId);
    const workOrder = await this.requireOpen(workOrderId);

    await this.prisma.$transaction(async (tx) => {
      const report = await tx.cleaningDamageReport.create({
        data: {
          cleaningId: cleaning.id,
          description: input.description,
          photoUrl: input.photoUrl,
        },
      });

      await tx.vehicleBacklogItem.create({
        data: {
          vehicleId: workOrder.vehicleId,
          description: input.description,
          source: 'CLEANING',
          cleaningDamageReportId: report.id,
        },
      });
    });

    await this.audit.write({
      actorId,
      action: 'cleaning.damage',
      entity: 'Cleaning',
      entityId: cleaning.id,
      after: { description: input.description },
    });

    return this.findOne(workOrderId);
  }

  // --- Liberação (RF-22) ----------------------------------------------------

  /**
   * Exclusiva da Manutenção (RN-04). Para o relógio, fecha o evento e devolve
   * o carro à operação — é este ato que conta a falha no MKBF.
   */
  async release(id: string, actorId: string, actorRole: UserRole): Promise<WorkOrderDetail> {
    if (actorRole !== UserRole.MANUTENCAO && actorRole !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'A liberação é exclusiva da Manutenção (RN-04): nenhuma outra área pode devolver o carro à operação',
      );
    }

    const workOrder = await this.requireOpen(id);
    const gates = await this.evaluateGates(id);
    if (!gates.canRelease) {
      throw new BadRequestException(gates.blockingReasons.join('; '));
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const totalMinutes = await this.downtime.stop(tx, id, now);

      await tx.workOrder.update({
        where: { id },
        data: {
          status: WorkOrderStatus.RELEASED,
          releasedAt: now,
          releasedById: actorId,
          downtimeMinutes: totalMinutes,
        },
      });

      await tx.vehicle.update({
        where: { id: workOrder.vehicleId },
        data: { status: VehicleStatus.AVAILABLE },
      });

      if (workOrder.eventId) {
        await tx.failureEvent.update({
          where: { id: workOrder.eventId },
          data: { status: EventStatus.CLOSED, closedAt: now },
        });
      }

      await this.queue.finish(tx, id);

      await this.notifications.notifyMany(tx, [
        {
          role: UserRole.PLANTAO,
          title: `Carro ${workOrder.vehicle.code} liberado`,
          body: `OS ${workOrder.code} concluída. Indisponibilidade total: ${formatMinutes(totalMinutes)}.`,
          entity: 'WorkOrder',
          entityId: id,
        },
        {
          role: UserRole.PCM,
          title: `Carro ${workOrder.vehicle.code} liberado`,
          body: `OS ${workOrder.code} concluída. Indisponibilidade total: ${formatMinutes(totalMinutes)}.`,
          entity: 'WorkOrder',
          entityId: id,
        },
      ]);
    });

    await this.audit.write({
      actorId,
      action: 'workOrder.release',
      entity: 'WorkOrder',
      entityId: id,
      after: { releasedAt: now },
    });

    return this.findOne(id);
  }

  // --- Portões, consulta ----------------------------------------------------

  private async evaluateGates(workOrderId: string) {
    const workOrder = await this.prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        tasks: { include: { inspections: { orderBy: { inspectedAt: 'desc' }, take: 1 } } },
        cleaning: true,
      },
    });
    if (!workOrder) throw new NotFoundException('OS não encontrada');

    const blockingReasons: string[] = [];

    const active = workOrder.tasks.filter((t) => t.status !== TaskStatus.CANCELLED);
    const unsettled = active.filter((t) => !TASK_STATUSES_SETTLED.includes(t.status));
    const allTasksSettled = active.length > 0 && unsettled.length === 0;

    if (active.length === 0) {
      blockingReasons.push('A OS não tem nenhuma sub-OS');
    } else if (unsettled.length > 0) {
      blockingReasons.push(
        `${unsettled.length} sub-OS ainda não concluída(s): ${unsettled.map((t) => t.code).join(', ')}`,
      );
    }

    const rejected = active.filter((t) => t.inspections[0]?.result === InspectionResult.REJECTED);
    const notInspected = active.filter((t) => t.inspections.length === 0);
    const allInspectionsApproved = active.length > 0 && rejected.length === 0 && notInspected.length === 0;

    const cleaningDone = workOrder.cleaning?.status === CleaningStatus.DONE;

    const canTechClose = allTasksSettled && workOrder.status !== WorkOrderStatus.RELEASED;

    const releaseBlocking: string[] = [];
    if (!workOrder.techClosedAt) releaseBlocking.push('A OS ainda não foi encerrada tecnicamente');
    if (notInspected.length > 0) {
      releaseBlocking.push(
        `${notInspected.length} sub-OS sem inspeção: ${notInspected.map((t) => t.code).join(', ')}`,
      );
    }
    if (rejected.length > 0) {
      releaseBlocking.push(
        `${rejected.length} sub-OS reprovada(s) na inspeção: ${rejected.map((t) => t.code).join(', ')}`,
      );
    }
    if (!cleaningDone) releaseBlocking.push('A limpeza ainda não foi concluída');

    const canRelease =
      releaseBlocking.length === 0 && workOrder.status !== WorkOrderStatus.RELEASED;

    return {
      allTasksSettled,
      allInspectionsApproved,
      cleaningDone,
      canTechClose,
      canRelease,
      blockingReasons: canRelease ? [] : [...new Set([...blockingReasons, ...releaseBlocking])],
    };
  }

  async findOne(id: string): Promise<WorkOrderDetail> {
    const workOrder = await this.prisma.workOrder.findUnique({
      where: { id },
      include: {
        vehicle: { select: { code: true, plate: true } },
        event: { select: { id: true, code: true } },
        tasks: {
          orderBy: { code: 'asc' },
          include: {
            specialty: true,
            confirmedCatalogItem: true,
            checklistItems: { orderBy: { sequence: 'asc' } },
            inspections: {
              orderBy: { inspectedAt: 'desc' },
              take: 1,
              include: { reasonCode: true },
            },
            materialRequests: { where: { status: { in: [...MATERIAL_STATUSES_BLOCKING] } } },
          },
        },
        cleaning: {
          include: {
            checklistItems: { orderBy: { sequence: 'asc' } },
            damageReports: { orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });
    if (!workOrder) throw new NotFoundException('OS não encontrada');

    const now = new Date();
    const assigneeIds = workOrder.tasks
      .map((t) => t.assignedToId)
      .filter((v): v is string => Boolean(v));
    const users = assigneeIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: [...assigneeIds, workOrder.releasedById ?? ''] } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    const [breakdown, gates, minutes] = await Promise.all([
      this.downtime.breakdown(id, now),
      this.evaluateGates(id),
      workOrder.downtimeMinutes !== null
        ? Promise.resolve(workOrder.downtimeMinutes)
        : this.downtime.currentMinutes(id, now),
    ]);

    return {
      id: workOrder.id,
      code: workOrder.code,
      type: workOrder.type,
      status: workOrder.status,
      vehicleId: workOrder.vehicleId,
      vehicleCode: workOrder.vehicle.code,
      vehiclePlate: workOrder.vehicle.plate,
      eventId: workOrder.event?.id ?? null,
      eventCode: workOrder.event?.code ?? null,
      openedAt: workOrder.openedAt.toISOString(),
      estimatedCompletionAt: workOrder.estimatedCompletionAt.toISOString(),
      techClosedAt: workOrder.techClosedAt?.toISOString() ?? null,
      releasedAt: workOrder.releasedAt?.toISOString() ?? null,
      releasedByName: workOrder.releasedById
        ? (nameById.get(workOrder.releasedById) ?? null)
        : null,
      jbWorkOrderNumber: workOrder.jbWorkOrderNumber,
      downtimeMinutes: minutes,
      isOverdue: !workOrder.releasedAt && workOrder.estimatedCompletionAt < now,
      breakdown,
      gates,
      tasks: workOrder.tasks.map((t) => ({
        id: t.id,
        code: t.code,
        description: t.description,
        specialtyId: t.specialtyId,
        specialtyName: t.specialty.name,
        status: t.status,
        assignedToId: t.assignedToId,
        assignedToName: t.assignedToId ? (nameById.get(t.assignedToId) ?? null) : null,
        startedAt: t.startedAt?.toISOString() ?? null,
        finishedAt: t.finishedAt?.toISOString() ?? null,
        confirmedCatalogItemId: t.confirmedCatalogItemId,
        confirmedCause: t.confirmedCatalogItem
          ? `${t.confirmedCatalogItem.code} — ${t.confirmedCatalogItem.description}`
          : null,
        reopenedCount: t.reopenedCount,
        openMaterialRequests: t.materialRequests.length,
        checklist: t.checklistItems.map((c) => ({
          id: c.id,
          sequence: c.sequence,
          description: c.description,
          isChecked: c.isChecked,
          checkedAt: c.checkedAt?.toISOString() ?? null,
          measurement: c.measurement ? Number(c.measurement) : null,
          unit: c.unit,
        })),
        lastInspection: t.inspections[0]
          ? {
              result: t.inspections[0].result,
              inspectedAt: t.inspections[0].inspectedAt.toISOString(),
              note: t.inspections[0].note,
              reasonDescription: t.inspections[0].reasonCode?.description ?? null,
            }
          : null,
      })),
      cleaning: workOrder.cleaning
        ? {
            id: workOrder.cleaning.id,
            status: workOrder.cleaning.status,
            startedAt: workOrder.cleaning.startedAt?.toISOString() ?? null,
            finishedAt: workOrder.cleaning.finishedAt?.toISOString() ?? null,
            checklist: workOrder.cleaning.checklistItems.map((c) => ({
              id: c.id,
              sequence: c.sequence,
              description: c.description,
              isChecked: c.isChecked,
            })),
            damageReports: workOrder.cleaning.damageReports.map((d) => ({
              id: d.id,
              description: d.description,
              createdAt: d.createdAt.toISOString(),
            })),
          }
        : null,
    };
  }

  async list(query: WorkOrderQuery): Promise<Paginated<WorkOrderSummary>> {
    const where: Prisma.WorkOrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.onlyOpen
        ? { status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] } }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.workOrder.findMany({
        where,
        orderBy: { openedAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
        include: {
          vehicle: { select: { code: true, plate: true } },
          tasks: { select: { status: true } },
        },
      }),
      this.prisma.workOrder.count({ where }),
    ]);

    const now = new Date();

    const data = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        code: r.code,
        type: r.type,
        status: r.status,
        vehicleCode: r.vehicle.code,
        vehiclePlate: r.vehicle.plate,
        openedAt: r.openedAt.toISOString(),
        estimatedCompletionAt: r.estimatedCompletionAt.toISOString(),
        downtimeMinutes: r.downtimeMinutes ?? (await this.downtime.currentMinutes(r.id, now)),
        isOverdue: !r.releasedAt && r.estimatedCompletionAt < now,
        taskCount: r.tasks.length,
        tasksDone: r.tasks.filter((t) => TASK_STATUSES_SETTLED.includes(t.status)).length,
      })),
    );

    return paginate(data, total, { page: query.page, perPage: query.perPage });
  }

  private async requireOpen(id: string) {
    const workOrder = await this.prisma.workOrder.findUnique({
      where: { id },
      include: { vehicle: { select: { code: true } } },
    });
    if (!workOrder) throw new NotFoundException('OS não encontrada');
    if (workOrder.status === WorkOrderStatus.RELEASED) {
      throw new BadRequestException('Esta OS já foi liberada');
    }
    if (workOrder.status === WorkOrderStatus.CANCELLED) {
      throw new BadRequestException('Esta OS foi cancelada');
    }
    return workOrder;
  }

  private async requireTask(id: string) {
    const task = await this.prisma.workOrderTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Sub-OS não encontrada');
    return task;
  }

  private async requireCleaning(workOrderId: string) {
    const cleaning = await this.prisma.cleaning.findUnique({ where: { workOrderId } });
    if (!cleaning) {
      throw new BadRequestException(
        'A limpeza só é criada no encerramento técnico da OS (portão 1)',
      );
    }
    return cleaning;
  }
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
}
