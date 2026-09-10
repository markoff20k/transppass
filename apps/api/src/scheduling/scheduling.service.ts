import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DowntimeCause,
  KitSeparationStatus,
  ReasonCodeList,
  ScheduleStatus,
  UserRole,
  VehicleStatus,
  WorkOrderStatus,
  WorkOrderType,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import {
  KIT_LEAD_DAYS,
  WINDOW_ALERT_KM,
  type BacklogItemRow,
  type CreateScheduleInput,
  type KitSeparationRow,
  type KmTimelineRow,
  type PlanPackageRow,
  type RescheduleInput,
  type ReserveTeamInput,
  type ScheduleDetail,
  type ScheduleQuery,
  type ScheduleSummary,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { DowntimeService } from '../common/downtime.service';
import { NotificationsService } from '../common/notifications.service';
import { QueueService } from '../queue/queue.service';
import { nextSequentialCode } from '../common/sequence';

const DAY_MS = 86_400_000;

/**
 * E3 — preventiva por quilometragem projetada (RF-10 a RF-13, RF-25).
 *
 * A jornada do PRD (6.2): o sistema projeta o km diariamente e antecipa a
 * janela; o PCM monta o escopo somando o pacote vigente ao backlog do carro;
 * o Estoque separa o kit em D-1; a Manutenção reserva a equipe. O carro só
 * sai da escala com tudo confirmado (RN-10). Da entrada na garagem em diante
 * o caminho é o mesmo fluxo de execução do corretivo — a OS-mãe.
 */
@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly downtime: DowntimeService,
    private readonly notifications: NotificationsService,
    private readonly queue: QueueService,
  ) {}

  // --- RF-10: linha do tempo por km projetado ------------------------------

  async timeline(now = new Date()): Promise<KmTimelineRow[]> {
    const [vehicles, packages, openSchedules, backlog] = await Promise.all([
      this.prisma.vehicle.findMany({
        where: { isActive: true },
        orderBy: { code: 'asc' },
        include: { kmProjection: true },
      }),
      this.prisma.maintenancePackage.findMany({
        where: { plan: { isActive: true, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] } },
        include: { plan: true },
        orderBy: { intervalKm: 'asc' },
      }),
      this.prisma.scheduledMaintenance.findMany({
        where: { status: { in: [ScheduleStatus.PLANNED, ScheduleStatus.CONFIRMED, ScheduleStatus.IN_EXECUTION] } },
        select: { id: true, vehicleId: true, status: true, targetKm: true },
      }),
      this.prisma.vehicleBacklogItem.groupBy({
        by: ['vehicleId'],
        where: { resolvedAt: null },
        _count: { _all: true },
      }),
    ]);

    const backlogByVehicle = new Map(backlog.map((b) => [b.vehicleId, b._count._all]));
    const scheduleByVehicle = new Map(openSchedules.map((s) => [s.vehicleId, s]));

    return vehicles.map((v) => {
      const plan = packages.filter((p) => p.plan.technology === v.technology);
      const projected = v.kmProjection?.projectedKm ?? v.currentKm;
      const avg = v.kmProjection ? Number(v.kmProjection.avgDailyKm) : null;

      // A próxima janela é o menor múltiplo do intervalo acima do km atual,
      // entre todos os pacotes do plano — o de 7.500 vence antes do de 15.000.
      let next: { pkg: (typeof plan)[number]; windowKm: number } | null = null;
      for (const pkg of plan) {
        const windowKm = (Math.floor(v.currentKm / pkg.intervalKm) + 1) * pkg.intervalKm;
        if (!next || windowKm < next.windowKm) next = { pkg, windowKm };
      }

      const schedule = scheduleByVehicle.get(v.id);
      const windowKm = schedule?.targetKm ?? next?.windowKm ?? null;
      const kmToWindow = windowKm === null ? null : windowKm - projected;
      const daysToWindow = kmToWindow === null || !avg || avg <= 0 ? null : Math.round(kmToWindow / avg);
      const projectedWindowDate =
        daysToWindow === null ? null : new Date(now.getTime() + daysToWindow * DAY_MS).toISOString();

      const alert: KmTimelineRow['alert'] =
        kmToWindow === null
          ? 'unknown'
          : kmToWindow < 0
            ? 'overdue'
            : kmToWindow <= WINDOW_ALERT_KM
              ? 'due-soon'
              : 'ok';

      return {
        vehicleId: v.id,
        vehicleCode: v.code,
        vehiclePlate: v.plate,
        technology: v.technology,
        currentKm: v.currentKm,
        projectedKm: v.kmProjection?.projectedKm ?? null,
        avgDailyKm: avg,
        isKmDegraded: v.kmProjection?.isDegraded ?? false,
        nextPackageId: next?.pkg.id ?? null,
        nextPackageName: next ? `${next.pkg.name}` : null,
        nextWindowKm: windowKm,
        kmToWindow,
        daysToWindow,
        projectedWindowDate,
        scheduleId: schedule?.id ?? null,
        scheduleStatus: schedule?.status ?? null,
        backlogCount: backlogByVehicle.get(v.id) ?? 0,
        alert,
      };
    });
  }

  // --- RF-11: parada = pacote vigente + backlog ---------------------------

  async create(input: CreateScheduleInput, actorId: string): Promise<ScheduleDetail> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: input.vehicleId } });
    if (!vehicle) throw new NotFoundException('Carro não encontrado');

    const pkg = await this.prisma.maintenancePackage.findUnique({
      where: { id: input.packageId },
      include: { plan: true, tasks: true, kits: { where: { isActive: true }, orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!pkg) throw new NotFoundException('Pacote não encontrado');
    if (pkg.plan.technology !== vehicle.technology) {
      throw new BadRequestException(`O pacote ${pkg.name} é do plano ${pkg.plan.technology}, e o carro é ${vehicle.technology}`);
    }

    const open = await this.prisma.scheduledMaintenance.findFirst({
      where: { vehicleId: input.vehicleId, status: { in: [ScheduleStatus.PLANNED, ScheduleStatus.CONFIRMED, ScheduleStatus.IN_EXECUTION] } },
    });
    if (open) throw new BadRequestException('O carro já tem uma parada preventiva em aberto');

    const projection = await this.prisma.kmProjection.findUnique({ where: { vehicleId: input.vehicleId } });
    const avg = projection ? Number(projection.avgDailyKm) : 0;
    const kmToGo = input.targetKm - (projection?.projectedKm ?? vehicle.currentKm);
    const projectedDate = avg > 0 ? new Date(Date.now() + Math.max(0, kmToGo / avg) * DAY_MS) : (input.plannedDate ?? new Date());

    const kitId = input.kitId ?? pkg.kits[0]?.id ?? null;

    const schedule = await this.prisma.$transaction(async (tx) => {
      const created = await tx.scheduledMaintenance.create({
        data: {
          vehicleId: input.vehicleId,
          packageId: input.packageId,
          targetKm: input.targetKm,
          projectedDate,
          plannedDate: input.plannedDate,
        },
      });

      // Escopo = tarefas do pacote vigente + itens do backlog escolhidos.
      await tx.scheduleScopeItem.createMany({
        data: [
          ...pkg.tasks.map((t) => ({ scheduledMaintenanceId: created.id, maintenanceTaskId: t.id })),
          ...input.backlogItemIds.map((b) => ({ scheduledMaintenanceId: created.id, backlogItemId: b })),
        ],
      });

      if (kitId) {
        await tx.kitSeparation.create({ data: { scheduledMaintenanceId: created.id, kitId } });
      }

      return created;
    });

    await this.audit.write({
      actorId,
      action: 'schedule.create',
      entity: 'ScheduledMaintenance',
      entityId: schedule.id,
      after: { vehicleId: input.vehicleId, packageId: input.packageId, targetKm: input.targetKm, backlog: input.backlogItemIds.length },
    });

    return this.findOne(schedule.id);
  }

  // --- RF-13: reprogramação com motivo --------------------------------------

  async reschedule(id: string, input: RescheduleInput, actorId: string): Promise<ScheduleDetail> {
    const schedule = await this.requireOpen(id);
    const reason = await this.prisma.reasonCode.findUnique({ where: { id: input.reasonCodeId } });
    if (!reason || reason.list !== ReasonCodeList.SCHEDULE_RESCHEDULE || !reason.isActive) {
      throw new BadRequestException('Código de motivo inválido para reprogramação');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.scheduleReschedule.create({
        data: {
          scheduledMaintenanceId: id,
          fromDate: schedule.plannedDate,
          toDate: input.toDate,
          reasonCodeId: reason.id,
          actorId,
          note: input.note,
        },
      });
      await tx.scheduledMaintenance.update({
        where: { id },
        data: { plannedDate: input.toDate, status: ScheduleStatus.PLANNED, kitReady: false, teamReserved: false },
      });
      // Kit separado para a data antiga volta a pendente: D-1 é da nova data.
      await tx.kitSeparation.updateMany({
        where: { scheduledMaintenanceId: id, status: { not: KitSeparationStatus.CANCELLED } },
        data: { status: KitSeparationStatus.PENDING, separatedAt: null, confirmedAt: null },
      });
      await this.notifications.notifyMany(tx, [
        { role: UserRole.ESTOQUE, title: `Parada do carro ${schedule.vehicle.code} reprogramada`, body: `Nova data ${input.toDate.toLocaleDateString('pt-BR')} — ${reason.description}. Kit volta a pendente.`, entity: 'ScheduledMaintenance', entityId: id },
        { role: UserRole.MANUTENCAO, title: `Parada do carro ${schedule.vehicle.code} reprogramada`, body: `Nova data ${input.toDate.toLocaleDateString('pt-BR')} — ${reason.description}. Reserve a equipe de novo.`, entity: 'ScheduledMaintenance', entityId: id },
        { role: UserRole.PLANTAO, title: `Parada do carro ${schedule.vehicle.code} reprogramada`, body: `Nova data ${input.toDate.toLocaleDateString('pt-BR')}.`, entity: 'ScheduledMaintenance', entityId: id },
      ]);
    });

    await this.audit.write({
      actorId,
      action: 'schedule.reschedule',
      entity: 'ScheduledMaintenance',
      entityId: id,
      before: { plannedDate: schedule.plannedDate },
      after: { plannedDate: input.toDate },
      reason: `${reason.code} — ${reason.description}`,
    });

    return this.findOne(id);
  }

  // --- RF-25: kit em D-1 ----------------------------------------------------

  async separateKit(id: string, actorId: string): Promise<ScheduleDetail> {
    const sep = await this.prisma.kitSeparation.findUnique({ where: { scheduledMaintenanceId: id } });
    if (!sep) throw new BadRequestException('Esta parada não tem kit associado');

    await this.prisma.$transaction(async (tx) => {
      await tx.kitSeparation.update({
        where: { id: sep.id },
        data: { status: KitSeparationStatus.SEPARATED, separatedById: actorId, separatedAt: new Date() },
      });
      await tx.scheduledMaintenance.update({ where: { id }, data: { kitReady: true } });
      await this.notifications.notify(tx, {
        role: UserRole.PCM,
        title: 'Kit separado',
        body: 'O Estoque separou o kit da parada preventiva. Falta a reserva de equipe para sair da escala.',
        entity: 'ScheduledMaintenance',
        entityId: id,
      });
    });

    await this.audit.write({ actorId, action: 'kit.separate', entity: 'KitSeparation', entityId: sep.id });
    return this.findOne(id);
  }

  // --- RF-12: reserva de equipe ---------------------------------------------

  async reserveTeam(id: string, input: ReserveTeamInput, actorId: string): Promise<ScheduleDetail> {
    await this.requireOpen(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.teamReservation.create({
        data: { scheduledMaintenanceId: id, specialtyId: input.specialtyId, headcount: input.headcount, reservedById: actorId },
      });
      await tx.scheduledMaintenance.update({ where: { id }, data: { teamReserved: true } });
    });

    await this.audit.write({ actorId, action: 'schedule.reserveTeam', entity: 'ScheduledMaintenance', entityId: id, after: input });
    return this.findOne(id);
  }

  // --- RN-10: saída da escala só com kit e equipe -------------------------

  async confirm(id: string, actorId: string): Promise<ScheduleDetail> {
    const schedule = await this.requireOpen(id);
    const gates = this.gates(schedule);
    if (!gates.canLeaveSchedule) throw new BadRequestException(gates.blockingReasons.join('; '));

    await this.prisma.scheduledMaintenance.update({ where: { id }, data: { status: ScheduleStatus.CONFIRMED } });
    await this.audit.write({ actorId, action: 'schedule.confirm', entity: 'ScheduledMaintenance', entityId: id });
    return this.findOne(id);
  }

  /**
   * Entrada na garagem: abre a OS-mãe preventiva e entra no mesmo fluxo de
   * execução do corretivo (PRD 6.2). O escopo vira sub-OS.
   */
  async start(id: string, actorId: string): Promise<ScheduleDetail> {
    const schedule = await this.requireOpen(id);
    if (schedule.status !== ScheduleStatus.CONFIRMED) {
      throw new BadRequestException('Confirme a parada (kit + equipe) antes de dar entrada na garagem');
    }

    const openWo = await this.prisma.workOrder.findFirst({
      where: { vehicleId: schedule.vehicleId, status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] } },
    });
    if (openWo) throw new BadRequestException(`O carro já tem a OS ${openWo.code} em aberto`);

    const scope = await this.prisma.scheduleScopeItem.findMany({
      where: { scheduledMaintenanceId: id },
      include: { maintenanceTask: { include: { specialty: true } }, backlogItem: true },
    });
    const totalMinutes = scope.reduce((sum, s) => sum + (s.maintenanceTask?.estimatedMinutes ?? 60), 0) || 240;
    const defaultSpecialty = await this.prisma.specialty.findFirst({ orderBy: { code: 'asc' } });

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const wo = await tx.workOrder.create({
        data: {
          code: await nextSequentialCode(tx, 'workOrder', 'OS'),
          vehicleId: schedule.vehicleId,
          type: WorkOrderType.PREVENTIVE,
          scheduledMaintenanceId: id,
          openedAt: now,
          estimatedCompletionAt: new Date(now.getTime() + totalMinutes * 60_000),
          createdById: actorId,
        },
      });
      await this.downtime.start(tx, wo.id, DowntimeCause.EXECUTION, now);

      // Escopo vira sub-OS por especialidade.
      let n = 0;
      for (const item of scope) {
        n += 1;
        const specialtyId = item.maintenanceTask?.specialtyId ?? defaultSpecialty?.id;
        if (!specialtyId) continue;
        await tx.workOrderTask.create({
          data: {
            workOrderId: wo.id,
            code: `S${String(n).padStart(2, '0')}`,
            specialtyId,
            description: item.maintenanceTask?.description ?? item.backlogItem?.description ?? 'Item do escopo',
          },
        });
        if (item.backlogItem) {
          await tx.vehicleBacklogItem.update({ where: { id: item.backlogItem.id }, data: { resolvedAt: now } });
        }
      }

      await this.queue.enqueue(tx, {
        vehicleId: schedule.vehicleId,
        workOrderId: wo.id,
        criticality: this.queue.criticalityFor({ type: WorkOrderType.PREVENTIVE }),
        isFastTrack: false,
      });
      const entry = await tx.queueEntry.findFirst({ where: { workOrderId: wo.id } });
      if (entry) await this.queue.startService(tx, entry.id);

      await tx.workOrder.update({ where: { id: wo.id }, data: { status: WorkOrderStatus.IN_PROGRESS } });
      await tx.scheduledMaintenance.update({ where: { id }, data: { status: ScheduleStatus.IN_EXECUTION } });
      await tx.vehicle.update({ where: { id: schedule.vehicleId }, data: { status: VehicleStatus.IN_MAINTENANCE } });
    });

    await this.audit.write({ actorId, action: 'schedule.start', entity: 'ScheduledMaintenance', entityId: id });
    return this.findOne(id);
  }

  // --- Leitura --------------------------------------------------------------

  async list(query: ScheduleQuery): Promise<ScheduleSummary[]> {
    const where: Prisma.ScheduledMaintenanceWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.upcoming && !query.status
        ? { status: { in: [ScheduleStatus.PLANNED, ScheduleStatus.CONFIRMED, ScheduleStatus.IN_EXECUTION] } }
        : {}),
    };
    const rows = await this.prisma.scheduledMaintenance.findMany({
      where,
      orderBy: [{ plannedDate: 'asc' }, { projectedDate: 'asc' }],
      include: {
        vehicle: { select: { code: true, plate: true, currentKm: true } },
        package: { select: { name: true } },
        _count: { select: { scopeItems: true, reschedules: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      vehicleCode: r.vehicle.code,
      vehiclePlate: r.vehicle.plate,
      packageName: r.package.name,
      targetKm: r.targetKm,
      currentKm: r.vehicle.currentKm,
      projectedDate: r.projectedDate.toISOString(),
      plannedDate: r.plannedDate?.toISOString() ?? null,
      kitReady: r.kitReady,
      teamReserved: r.teamReserved,
      scopeCount: r._count.scopeItems,
      rescheduleCount: r._count.reschedules,
    }));
  }

  async findOne(id: string): Promise<ScheduleDetail> {
    const s = await this.prisma.scheduledMaintenance.findUnique({
      where: { id },
      include: {
        vehicle: { select: { code: true, plate: true, technology: true, currentKm: true } },
        package: { include: { plan: true } },
        kitSeparation: { include: { kit: true } },
        scopeItems: { include: { maintenanceTask: { include: { specialty: true } }, backlogItem: true } },
        reservations: { include: { specialty: true }, orderBy: { reservedAt: 'asc' } },
        reschedules: { include: { reasonCode: true }, orderBy: { createdAt: 'desc' } },
        workOrder: { select: { id: true, code: true } },
      },
    });
    if (!s) throw new NotFoundException('Parada não encontrada');

    const actorIds = s.reschedules.map((r) => r.actorId);
    const actors = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(actors.map((a) => [a.id, a.name]));
    const gates = this.gates(s);
    const dueDate = s.plannedDate ? new Date(s.plannedDate.getTime() - KIT_LEAD_DAYS * DAY_MS) : null;

    return {
      id: s.id,
      status: s.status,
      vehicleId: s.vehicleId,
      vehicleCode: s.vehicle.code,
      vehiclePlate: s.vehicle.plate,
      technology: s.vehicle.technology,
      packageId: s.packageId,
      packageName: s.package.name,
      planName: `${s.package.plan.name} v${s.package.plan.version}`,
      targetKm: s.targetKm,
      currentKm: s.vehicle.currentKm,
      projectedDate: s.projectedDate.toISOString(),
      plannedDate: s.plannedDate?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
      kitReady: s.kitReady,
      teamReserved: s.teamReserved,
      canLeaveSchedule: gates.canLeaveSchedule,
      blockingReasons: gates.blockingReasons,
      kit: s.kitSeparation
        ? {
            id: s.kitSeparation.id,
            kitId: s.kitSeparation.kitId,
            kitName: s.kitSeparation.kit.name,
            status: s.kitSeparation.status,
            separatedAt: s.kitSeparation.separatedAt?.toISOString() ?? null,
            confirmedAt: s.kitSeparation.confirmedAt?.toISOString() ?? null,
            dueDate: dueDate?.toISOString() ?? null,
          }
        : null,
      scope: s.scopeItems.map((i) => ({
        id: i.id,
        kind: i.maintenanceTask ? 'task' : 'backlog',
        description: i.maintenanceTask?.description ?? i.backlogItem?.description ?? '—',
        specialtyName: i.maintenanceTask?.specialty?.name ?? null,
        estimatedMinutes: i.maintenanceTask?.estimatedMinutes ?? null,
      })),
      reservations: s.reservations.map((r) => ({
        id: r.id,
        specialtyName: r.specialty.name,
        headcount: r.headcount,
        reservedAt: r.reservedAt.toISOString(),
      })),
      reschedules: s.reschedules.map((r) => ({
        id: r.id,
        fromDate: r.fromDate?.toISOString() ?? null,
        toDate: r.toDate.toISOString(),
        reasonCode: r.reasonCode.code,
        reasonDescription: r.reasonCode.description,
        actorName: nameById.get(r.actorId) ?? null,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      })),
      workOrderId: s.workOrder?.id ?? null,
      workOrderCode: s.workOrder?.code ?? null,
    };
  }

  async packages(): Promise<PlanPackageRow[]> {
    const rows = await this.prisma.maintenancePackage.findMany({
      where: { plan: { isActive: true } },
      include: { plan: true, _count: { select: { tasks: true } }, kits: { where: { isActive: true }, orderBy: { version: 'desc' }, take: 1 } },
      orderBy: [{ plan: { technology: 'asc' } }, { intervalKm: 'asc' }],
    });
    return rows.map((p) => ({
      id: p.id,
      planId: p.planId,
      planName: p.plan.name,
      planCode: p.plan.code,
      planVersion: p.plan.version,
      controlledDocument: p.plan.controlledDocument,
      technology: p.plan.technology,
      code: p.code,
      name: p.name,
      intervalKm: p.intervalKm,
      toleranceKm: p.toleranceKm,
      taskCount: p._count.tasks,
      kitId: p.kits[0]?.id ?? null,
      kitName: p.kits[0]?.name ?? null,
    }));
  }

  async backlog(vehicleId: string): Promise<BacklogItemRow[]> {
    const rows = await this.prisma.vehicleBacklogItem.findMany({
      where: { vehicleId, resolvedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { catalogItem: { select: { code: true } } },
    });
    return rows.map((b) => ({
      id: b.id,
      description: b.description,
      source: b.source,
      createdAt: b.createdAt.toISOString(),
      catalogCode: b.catalogItem?.code ?? null,
    }));
  }

  /** RF-25 — a fila de kits do Estoque, com o D-1 calculado. */
  async kits(now = new Date()): Promise<KitSeparationRow[]> {
    const rows = await this.prisma.kitSeparation.findMany({
      where: { status: { not: KitSeparationStatus.CANCELLED }, scheduledMaintenance: { status: { in: [ScheduleStatus.PLANNED, ScheduleStatus.CONFIRMED] } } },
      include: {
        kit: { include: { items: { include: { material: true } } } },
        scheduledMaintenance: { include: { vehicle: { select: { code: true } }, package: { select: { name: true } } } },
      },
    });
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return rows
      .map((r) => {
        const planned = r.scheduledMaintenance.plannedDate;
        const due = planned ? new Date(planned.getTime() - KIT_LEAD_DAYS * DAY_MS) : null;
        const dueDay = due ? new Date(due.getFullYear(), due.getMonth(), due.getDate()) : null;
        return {
          id: r.id,
          scheduleId: r.scheduledMaintenanceId,
          vehicleCode: r.scheduledMaintenance.vehicle.code,
          packageName: r.scheduledMaintenance.package.name,
          kitName: r.kit.name,
          status: r.status,
          plannedDate: planned?.toISOString() ?? null,
          dueDate: due?.toISOString() ?? null,
          isDueToday: dueDay !== null && dueDay.getTime() === today.getTime() && r.status === KitSeparationStatus.PENDING,
          isLate: dueDay !== null && dueDay.getTime() < today.getTime() && r.status === KitSeparationStatus.PENDING,
          items: r.kit.items.map((i) => ({
            materialCode: i.material.code,
            materialDescription: i.material.description,
            quantity: Number(i.quantity),
            unit: i.material.unit,
          })),
        };
      })
      .sort((a, b) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'));
  }

  private gates(s: { kitReady: boolean; teamReserved: boolean; plannedDate: Date | null }) {
    const blockingReasons: string[] = [];
    if (!s.plannedDate) blockingReasons.push('Defina a data da parada');
    if (!s.kitReady) blockingReasons.push('Kit ainda não separado pelo Estoque (RF-25)');
    if (!s.teamReserved) blockingReasons.push('Equipe ainda não reservada pela Manutenção (RF-12)');
    return { canLeaveSchedule: blockingReasons.length === 0, blockingReasons };
  }

  private async requireOpen(id: string) {
    const s = await this.prisma.scheduledMaintenance.findUnique({
      where: { id },
      include: { vehicle: { select: { code: true } } },
    });
    if (!s) throw new NotFoundException('Parada não encontrada');
    if (s.status === ScheduleStatus.DONE || s.status === ScheduleStatus.CANCELLED) {
      throw new BadRequestException('Esta parada já foi encerrada');
    }
    return s;
  }
}
