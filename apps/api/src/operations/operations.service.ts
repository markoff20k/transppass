import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ReplacementDemandStatus, UserRole, VehicleStatus, WorkOrderStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import {
  AVAILABLE_STATUSES,
  type AssignReserveInput,
  type CreateDemandInput,
  type DemandQuery,
  type DemandRow,
  type ExpectedReturnRow,
  type OperatorCandidate,
  type OperatorRow,
  type ReserveCandidate,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NotificationsService } from '../common/notifications.service';

/**
 * E6 — Operação e Plantão (RF-29 a RF-31).
 *
 * O Plantão cobre a rua. A demanda de reposição nasce com a janela correndo;
 * a reserva só aceita operador habilitado na tecnologia do carro (RF-30); e
 * a previsão de retorno do titular vem ao vivo da OS (RF-31) — quando o
 * titular volta, a reserva é recolhida.
 */
@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- RF-29: demanda com janela em contagem --------------------------------

  async createDemand(input: CreateDemandInput, actorId: string): Promise<DemandRow> {
    if (input.originVehicleId) {
      const v = await this.prisma.vehicle.findUnique({ where: { id: input.originVehicleId } });
      if (!v) throw new NotFoundException('Carro de origem não encontrado');
    }

    const now = new Date();
    const demand = await this.prisma.$transaction(async (tx) => {
      const created = await tx.replacementDemand.create({
        data: {
          lineCode: input.lineCode,
          originVehicleId: input.originVehicleId,
          requestedById: actorId,
          requestedAt: now,
          windowEndsAt: new Date(now.getTime() + input.windowMinutes * 60_000),
        },
      });
      await this.notifications.notify(tx, {
        role: UserRole.PLANTAO,
        title: `Linha ${input.lineCode} precisa de reposição`,
        body: `Janela de ${input.windowMinutes} min correndo.${input.note ? ` ${input.note}` : ''}`,
        entity: 'ReplacementDemand',
        entityId: created.id,
      });
      return created;
    });

    await this.audit.write({ actorId, action: 'demand.create', entity: 'ReplacementDemand', entityId: demand.id, after: input });
    return this.findDemand(demand.id);
  }

  // --- RF-30: reserva filtrada pela habilitação ------------------------------

  async assignReserve(demandId: string, input: AssignReserveInput, actorId: string): Promise<DemandRow> {
    const demand = await this.prisma.replacementDemand.findUnique({ where: { id: demandId } });
    if (!demand) throw new NotFoundException('Demanda não encontrada');
    if (demand.status !== ReplacementDemandStatus.OPEN) {
      throw new BadRequestException('Só é possível designar reserva a uma demanda aberta');
    }

    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: input.vehicleId } });
    if (!vehicle) throw new NotFoundException('Carro reserva não encontrado');
    if (!AVAILABLE_STATUSES.includes(vehicle.status)) {
      throw new BadRequestException(`O carro ${vehicle.code} não está disponível para reserva`);
    }

    const operator = await this.prisma.operator.findUnique({
      where: { id: input.operatorId },
      include: { qualifications: true },
    });
    if (!operator?.isActive) throw new NotFoundException('Operador não encontrado');

    // A regra do RF-30 é bloqueio, não aviso: sem habilitação na tecnologia,
    // a designação não acontece.
    const now = new Date();
    const qualified = operator.qualifications.some(
      (q) => q.technology === vehicle.technology && (!q.validUntil || q.validUntil >= now),
    );
    if (!qualified) {
      throw new BadRequestException(
        `${operator.name} não tem habilitação vigente para ${vehicle.technology === 'EBUS' ? 'eBUS' : 'diesel'}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.reserveAssignment.create({
        data: { demandId, vehicleId: vehicle.id, operatorId: operator.id, assignedById: actorId, assignedAt: now },
      });
      const met = now <= demand.windowEndsAt;
      await tx.replacementDemand.update({
        where: { id: demandId },
        data: { status: met ? ReplacementDemandStatus.ASSIGNED : ReplacementDemandStatus.MISSED, metAt: now },
      });
      await tx.vehicle.update({ where: { id: vehicle.id }, data: { status: VehicleStatus.IN_LINE } });
      await this.notifications.notify(tx, {
        role: UserRole.CCO,
        title: `Linha ${demand.lineCode} coberta`,
        body: `Carro ${vehicle.code} com ${operator.name}${met ? ' dentro da janela' : ' — janela estourada'}.`,
        entity: 'ReplacementDemand',
        entityId: demandId,
      });
    });

    await this.audit.write({
      actorId,
      action: 'demand.assign',
      entity: 'ReplacementDemand',
      entityId: demandId,
      after: { vehicleId: vehicle.id, operatorId: operator.id, withinWindow: now <= demand.windowEndsAt },
    });

    return this.findDemand(demandId);
  }

  // --- RF-31: devolução do titular recolhe a reserva ------------------------

  async returnReserve(demandId: string, actorId: string): Promise<DemandRow> {
    const assignment = await this.prisma.reserveAssignment.findFirst({
      where: { demandId, returnedAt: null },
      include: { demand: true },
    });
    if (!assignment) throw new BadRequestException('Esta demanda não tem reserva na rua');

    await this.prisma.$transaction(async (tx) => {
      await tx.reserveAssignment.update({ where: { id: assignment.id }, data: { returnedAt: new Date() } });
      await tx.vehicle.update({ where: { id: assignment.vehicleId }, data: { status: VehicleStatus.AVAILABLE } });
      if (assignment.demand.status === ReplacementDemandStatus.ASSIGNED) {
        await tx.replacementDemand.update({ where: { id: demandId }, data: { status: ReplacementDemandStatus.MET } });
      }
    });

    await this.audit.write({ actorId, action: 'demand.returnReserve', entity: 'ReplacementDemand', entityId: demandId });
    return this.findDemand(demandId);
  }

  async cancelDemand(demandId: string, actorId: string): Promise<DemandRow> {
    const demand = await this.prisma.replacementDemand.findUnique({ where: { id: demandId } });
    if (!demand) throw new NotFoundException('Demanda não encontrada');
    if (demand.status !== ReplacementDemandStatus.OPEN) {
      throw new BadRequestException('Só uma demanda aberta pode ser cancelada');
    }
    await this.prisma.replacementDemand.update({ where: { id: demandId }, data: { status: ReplacementDemandStatus.CANCELLED } });
    await this.audit.write({ actorId, action: 'demand.cancel', entity: 'ReplacementDemand', entityId: demandId });
    return this.findDemand(demandId);
  }

  /** Marca como estourada toda demanda aberta cuja janela venceu. Exposto como endpoint (agendador é questão aberta do PRD). */
  async expireWindows(now = new Date()): Promise<{ missed: number }> {
    const r = await this.prisma.replacementDemand.updateMany({
      where: { status: ReplacementDemandStatus.OPEN, windowEndsAt: { lt: now } },
      data: { status: ReplacementDemandStatus.MISSED },
    });
    return { missed: r.count };
  }

  // --- Leitura ---------------------------------------------------------------

  async listDemands(query: DemandQuery): Promise<DemandRow[]> {
    const where: Prisma.ReplacementDemandWhereInput = query.status
      ? { status: query.status }
      : query.active
        ? { OR: [{ status: ReplacementDemandStatus.OPEN }, { status: ReplacementDemandStatus.ASSIGNED }, { assignments: { some: { returnedAt: null } } }] }
        : {};
    const rows = await this.prisma.replacementDemand.findMany({
      where,
      orderBy: [{ status: 'asc' }, { windowEndsAt: 'asc' }],
      include: demandInclude,
    });
    const returns = await this.titularReturns(rows.map((r) => r.originVehicleId).filter((v): v is string => Boolean(v)));
    return rows.map((r) => toDemandRow(r, returns));
  }

  async findDemand(id: string): Promise<DemandRow> {
    const r = await this.prisma.replacementDemand.findUnique({ where: { id }, include: demandInclude });
    if (!r) throw new NotFoundException('Demanda não encontrada');
    const returns = await this.titularReturns(r.originVehicleId ? [r.originVehicleId] : []);
    return toDemandRow(r, returns);
  }

  /** Carros disponíveis para reserva, na tecnologia pedida ou em todas. */
  async reserveCandidates(): Promise<ReserveCandidate[]> {
    const rows = await this.prisma.vehicle.findMany({
      where: { isActive: true, status: VehicleStatus.AVAILABLE },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, plate: true, technology: true, status: true },
    });
    return rows.map((v) => ({ vehicleId: v.id, vehicleCode: v.code, vehiclePlate: v.plate, technology: v.technology, status: v.status }));
  }

  async operators(): Promise<OperatorRow[]> {
    const rows = await this.prisma.operator.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      include: { qualifications: true },
    });
    const now = new Date();
    return rows.map((o) => ({
      id: o.id,
      registration: o.registration,
      name: o.name,
      isActive: o.isActive,
      technologies: o.qualifications.filter((q) => !q.validUntil || q.validUntil >= now).map((q) => q.technology),
    }));
  }

  /** RF-30 — só quem está habilitado na tecnologia do carro escolhido. */
  async operatorCandidates(vehicleId: string): Promise<OperatorCandidate[]> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new NotFoundException('Carro não encontrado');
    const now = new Date();
    const rows = await this.prisma.operator.findMany({
      where: {
        isActive: true,
        qualifications: { some: { technology: vehicle.technology, OR: [{ validUntil: null }, { validUntil: { gte: now } }] } },
      },
      orderBy: { name: 'asc' },
      include: { qualifications: true },
    });
    return rows.map((o) => ({
      operatorId: o.id,
      registration: o.registration,
      name: o.name,
      technologies: o.qualifications.map((q) => q.technology),
    }));
  }

  /** RF-31 — retornos previstos ao vivo, das OS em aberto. */
  async expectedReturns(now = new Date()): Promise<ExpectedReturnRow[]> {
    const [wos, demands] = await Promise.all([
      this.prisma.workOrder.findMany({
        where: { status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] } },
        orderBy: { estimatedCompletionAt: 'asc' },
        include: { vehicle: { select: { code: true, plate: true } } },
      }),
      this.prisma.replacementDemand.findMany({
        where: { status: ReplacementDemandStatus.ASSIGNED },
        select: { id: true, originVehicleId: true },
      }),
    ]);
    const coverage = new Map(demands.filter((d) => d.originVehicleId).map((d) => [d.originVehicleId as string, d.id]));
    return wos.map((wo) => ({
      workOrderId: wo.id,
      workOrderCode: wo.code,
      vehicleId: wo.vehicleId,
      vehicleCode: wo.vehicle.code,
      vehiclePlate: wo.vehicle.plate,
      status: wo.status,
      estimatedCompletionAt: wo.estimatedCompletionAt.toISOString(),
      isOverdue: wo.estimatedCompletionAt < now,
      minutesToReturn: Math.round((wo.estimatedCompletionAt.getTime() - now.getTime()) / 60_000),
      coveredByDemandId: coverage.get(wo.vehicleId) ?? null,
    }));
  }

  private async titularReturns(vehicleIds: string[]) {
    if (vehicleIds.length === 0) return new Map<string, DemandRow['titularReturn']>();
    const now = new Date();
    const wos = await this.prisma.workOrder.findMany({
      where: { vehicleId: { in: vehicleIds }, status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] } },
    });
    return new Map(
      wos.map((wo) => [
        wo.vehicleId,
        {
          workOrderId: wo.id,
          workOrderCode: wo.code,
          estimatedCompletionAt: wo.estimatedCompletionAt.toISOString(),
          status: wo.status,
          isOverdue: wo.estimatedCompletionAt < now,
        },
      ]),
    );
  }
}

const demandInclude = {
  originVehicle: { select: { code: true } },
  assignments: {
    orderBy: { assignedAt: 'desc' as const },
    take: 1,
    include: { vehicle: { select: { code: true } }, operator: { select: { name: true } } },
  },
} satisfies Prisma.ReplacementDemandInclude;

type DemandWithRelations = Prisma.ReplacementDemandGetPayload<{ include: typeof demandInclude }>;

function toDemandRow(r: DemandWithRelations, returns: Map<string, DemandRow['titularReturn']>): DemandRow {
  const a = r.assignments[0];
  return {
    id: r.id,
    status: r.status,
    lineCode: r.lineCode,
    originVehicleId: r.originVehicleId,
    originVehicleCode: r.originVehicle?.code ?? null,
    originReason: null,
    requestedAt: r.requestedAt.toISOString(),
    windowEndsAt: r.windowEndsAt.toISOString(),
    secondsLeft: Math.round((r.windowEndsAt.getTime() - Date.now()) / 1000),
    metAt: r.metAt?.toISOString() ?? null,
    assignment: a
      ? {
          id: a.id,
          vehicleId: a.vehicleId,
          vehicleCode: a.vehicle.code,
          operatorId: a.operatorId,
          operatorName: a.operator.name,
          assignedAt: a.assignedAt.toISOString(),
          returnedAt: a.returnedAt?.toISOString() ?? null,
        }
      : null,
    titularReturn: r.originVehicleId ? (returns.get(r.originVehicleId) ?? null) : null,
  };
}
