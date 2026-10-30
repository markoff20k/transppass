import { Injectable } from '@nestjs/common';
import {
  EventStatus,
  MaterialRequestStatus,
  QueueStatus,
  WorkOrderStatus,
} from '@prisma/client';
import {
  AVAILABLE_STATUSES,
  VehicleStatus,
  type DashboardData,
  type DashboardQuery,
  type DashboardVehicle,
  type DayCount,
  type HourAvailability,
  type MkbfPoint,
} from '@app/shared';
import { IN_SHOP_STATUSES } from '../common/vehicle-status';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { EventsService } from '../events/events.service';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Dashboard — a foto da garagem numa chamada só.
 *
 * Nada aqui tem tabela própria: tudo é derivado dos estados que o processo já
 * produz (OS, fila, eventos, leituras). A série de disponibilidade por hora é
 * reconstruída a partir dos relógios das OS — se o carro tinha OS aberta às
 * 14h, estava indisponível às 14h. É o princípio do PRD: o indicador emerge
 * do processo, ninguém digita.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly events: EventsService,
  ) {}

  async build(query: DashboardQuery): Promise<DashboardData> {
    const now = new Date();

    // A janela do histórico: do início do dia de (days - 1) dias atrás até agora.
    // O "agora" da garagem (anel, fluxo, fila, alertas) não depende dela.
    const days = query.days;
    const from = new Date(now.getTime() - (days - 1) * DAY_MS);
    from.setHours(0, 0, 0, 0);
    const months = query.months ?? Math.max(6, Math.ceil(days / 30) + 1);

    const [
      vehicles,
      mkbfSeries,
      periodMkbf,
      availabilityByHour,
      availabilityDelta,
      r1,
      perDay,
      queue,
      workOrders,
      materials,
      alerts,
      recent,
    ] = await Promise.all([
      this.vehicles(now),
      this.mkbfSeries(now, months),
      this.metrics.mkbf(from, now),
      this.availabilityByHour(now, from),
      this.availabilityDelta(now),
      this.metrics.r1({ from, to: now }),
      this.eventsPerDay(now, from, days),
      this.queue(now),
      this.workOrders(now, from),
      this.materials(now),
      this.alerts(),
      this.events.list({ page: 1, perPage: 6, from }),
    ]);

    const byStatus = Object.fromEntries(
      Object.values(VehicleStatus).map((s) => [s, 0]),
    ) as Record<VehicleStatus, number>;
    for (const v of vehicles) byStatus[v.status] += 1;

    const available = vehicles.filter((v) => AVAILABLE_STATUSES.includes(v.status)).length;
    const current = mkbfSeries[mkbfSeries.length - 1]?.mkbf ?? null;

    return {
      generatedAt: now.toISOString(),
      period: { days, from: from.toISOString(), to: now.toISOString() },
      fleet: {
        total: vehicles.length,
        available,
        availabilityRate: vehicles.length ? available / vehicles.length : 0,
        byStatus,
        availabilityDelta,
      },
      mkbf: {
        current,
        series: mkbfSeries,
        period: {
          kmTraveled: periodMkbf.kmTraveled,
          unscheduledReturns: periodMkbf.unscheduledReturns,
          mkbf: periodMkbf.mkbf,
        },
      },
      availabilityByHour,
      downtimeByCause: r1.downtimeByCause,
      totalDowntimeMinutes: r1.totalDowntimeMinutes,
      eventsPerDay: perDay.points,
      eventsBucket: perDay.bucket,
      queue,
      workOrders,
      materials,
      alerts,
      recentEvents: recent.data,
      vehicles,
    };
  }

  private async vehicles(now: Date): Promise<DashboardVehicle[]> {
    const rows = await this.prisma.vehicle.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      include: {
        failureEvents: {
          where: { status: { notIn: [EventStatus.CLOSED, EventStatus.CANCELLED] } },
          orderBy: { reportedAt: 'desc' },
          take: 1,
          include: { catalogItem: { select: { description: true } } },
        },
        workOrders: {
          where: { status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] } },
          orderBy: { openedAt: 'desc' },
          take: 1,
          select: { code: true, openedAt: true },
        },
      },
    });

    return rows.map((v) => {
      const event = v.failureEvents[0];
      const wo = v.workOrders[0];
      const since = wo?.openedAt ?? event?.reportedAt ?? null;

      return {
        id: v.id,
        code: v.code,
        plate: v.plate,
        technology: v.technology,
        vehicleClass: (v.vehicleClass as DashboardVehicle['vehicleClass']) ?? null,
        status: v.status,
        reason:
          event?.catalogItem?.description ??
          event?.reportedDescription ??
          (wo ? `OS ${wo.code}` : null),
        hoursInState: since ? Math.round(((now.getTime() - since.getTime()) / HOUR_MS) * 10) / 10 : null,
      };
    });
  }

  private async mkbfSeries(now: Date, months: number): Promise<MkbfPoint[]> {
    const points: MkbfPoint[] = [];

    for (let i = months - 1; i >= 0; i -= 1) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = i === 0 ? now : new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const r = await this.metrics.mkbf(start, end);
      points.push({
        month: start.toISOString(),
        kmTraveled: r.kmTraveled,
        unscheduledReturns: r.unscheduledReturns,
        mkbf: r.mkbf,
      });
    }

    return points;
  }

  /**
   * Para cada hora do dia, a fração de carros disponíveis naquele instante,
   * na média do período escolhido (amostra em hh:30; janelas longas amostram
   * um dia a cada poucos, até ~60 dias). Carro parado é o mesmo
   * do anel de disponibilidade: da quebra (retorno não programado em aberto,
   * ainda na fila ou no socorro) até a liberação da OS — não só enquanto a
   * OS existe. Um carro com evento e OS ao mesmo tempo conta uma vez.
   */
  private async availabilityByHour(now: Date, windowStart: Date): Promise<HourAvailability[]> {
    const totalDays = Math.max(1, Math.round((now.getTime() - windowStart.getTime()) / DAY_MS));
    const step = Math.max(1, Math.ceil(totalDays / 60));

    const [fleetSize, workOrders, returns] = await Promise.all([
      this.prisma.vehicle.count({ where: { isActive: true } }),
      this.prisma.workOrder.findMany({
        where: {
          openedAt: { lte: now },
          OR: [{ releasedAt: null }, { releasedAt: { gte: windowStart } }],
          status: { not: WorkOrderStatus.CANCELLED },
        },
        select: { vehicleId: true, openedAt: true, releasedAt: true },
      }),
      this.prisma.failureEvent.findMany({
        where: {
          isUnscheduledReturn: true,
          reportedAt: { lte: now },
          OR: [{ closedAt: null }, { closedAt: { gte: windowStart } }],
          status: { not: EventStatus.CANCELLED },
        },
        select: { vehicleId: true, reportedAt: true, closedAt: true },
      }),
    ]);

    if (fleetSize === 0) {
      return Array.from({ length: 24 }, (_, hour) => ({ hour, rate: 0, today: null }));
    }

    const spans = [
      ...workOrders.map((wo) => ({ vehicleId: wo.vehicleId, from: wo.openedAt, to: wo.releasedAt })),
      ...returns.map((ev) => ({ vehicleId: ev.vehicleId, from: ev.reportedAt, to: ev.closedAt })),
    ];

    const rateAt = (t: Date): number => {
      const downVehicles = new Set<string>();
      for (const sp of spans) {
        if (sp.from <= t && (!sp.to || sp.to >= t)) downVehicles.add(sp.vehicleId);
      }
      return (fleetSize - Math.min(downVehicles.size, fleetSize)) / fleetSize;
    };

    const result: HourAvailability[] = [];

    for (let hour = 0; hour < 24; hour += 1) {
      let sum = 0;
      let samples = 0;

      for (let day = 1; day <= totalDays; day += step) {
        const t = new Date(now);
        t.setDate(t.getDate() - day);
        t.setHours(hour, 30, 0, 0);
        if (t > now) continue;
        sum += rateAt(t);
        samples += 1;
      }

      // Hoje, na mesma faixa: a hora corrente usa o instante atual, para o
      // último ponto bater com o anel de disponibilidade.
      const todayAt = new Date(now);
      todayAt.setHours(hour, 30, 0, 0);
      const todaySample = todayAt <= now ? todayAt : todayAt.getHours() === now.getHours() ? now : null;

      result.push({ hour, rate: samples ? sum / samples : 0, today: todaySample ? rateAt(todaySample) : null });
    }

    return result;
  }

  private async availabilityDelta(now: Date): Promise<number | null> {
    const then = new Date(now.getTime() - 7 * DAY_MS);

    const [fleetSize, downThen, downNow] = await Promise.all([
      this.prisma.vehicle.count({ where: { isActive: true } }),
      this.prisma.workOrder.count({
        where: {
          openedAt: { lte: then },
          OR: [{ releasedAt: null }, { releasedAt: { gte: then } }],
          status: { not: WorkOrderStatus.CANCELLED },
        },
      }),
      this.prisma.vehicle.count({
        where: { isActive: true, status: { notIn: [...AVAILABLE_STATUSES] } },
      }),
    ]);

    if (fleetSize === 0) return null;
    const rateThen = (fleetSize - downThen) / fleetSize;
    const rateNow = (fleetSize - downNow) / fleetSize;
    return Math.round((rateNow - rateThen) * 1000) / 10;
  }

  /**
   * Quebras por dia no período; acima de 120 dias, por semana (senão são
   * centenas de barras num cartão). Só o que tirou carro da rua: é a série
   * que explica o MKBF, não o volume de registros.
   */
  private async eventsPerDay(
    now: Date,
    from: Date,
    days: number,
  ): Promise<{ points: DayCount[]; bucket: 'day' | 'week' }> {
    const bucket: 'day' | 'week' = days > 120 ? 'week' : 'day';
    const size = bucket === 'week' ? 7 : 1;

    const rows = await this.prisma.failureEvent.findMany({
      where: { reportedAt: { gte: from, lte: now }, isUnscheduledReturn: true },
      select: { reportedAt: true },
    });

    const n = Math.ceil(days / size);
    const counts = Array.from({ length: n }, () => 0);
    for (const r of rows) {
      const idx = Math.floor((r.reportedAt.getTime() - from.getTime()) / (DAY_MS * size));
      if (idx >= 0 && idx < n) counts[idx] = (counts[idx] ?? 0) + 1;
    }

    const points = counts.map((count, i) => {
      const d = new Date(from.getTime() + i * size * DAY_MS);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { date, count };
    });

    return { points, bucket };
  }

  /**
   * Fila e oficina contados pelo status do carro — a mesma fonte do fluxo da
   * garagem e da frota. Uma entrada de fila que ficou para trás nunca faz o
   * cartão discordar do trilho.
   */
  private async queue(now: Date) {
    const [waiting, inService, oldest] = await Promise.all([
      this.prisma.vehicle.count({ where: { isActive: true, status: VehicleStatus.AWAITING_MAINTENANCE } }),
      this.prisma.vehicle.count({ where: { isActive: true, status: { in: IN_SHOP_STATUSES } } }),
      this.prisma.queueEntry.findFirst({
        where: { status: QueueStatus.WAITING, vehicle: { status: VehicleStatus.AWAITING_MAINTENANCE } },
        orderBy: { enteredAt: 'asc' },
        select: { enteredAt: true },
      }),
    ]);

    return {
      waiting,
      inService,
      oldestWaitingHours: oldest
        ? Math.round(((now.getTime() - oldest.enteredAt.getTime()) / HOUR_MS) * 10) / 10
        : null,
    };
  }

  private async workOrders(now: Date, from: Date) {
    const [open, overdue, released] = await Promise.all([
      this.prisma.workOrder.count({
        where: { status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] } },
      }),
      this.prisma.workOrder.count({
        where: {
          status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] },
          estimatedCompletionAt: { lt: now },
        },
      }),
      this.prisma.workOrder.findMany({
        where: {
          status: WorkOrderStatus.RELEASED,
          releasedAt: { gte: from },
        },
        select: { downtimeMinutes: true },
      }),
    ]);

    const minutes = released.map((r) => r.downtimeMinutes ?? 0);

    return {
      open,
      overdue,
      releasedInPeriod: released.length,
      averageDowntimeMinutes: minutes.length
        ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length)
        : null,
    };
  }

  private async materials(now: Date) {
    const [pending, overdueParts] = await Promise.all([
      this.prisma.materialRequest.count({
        where: {
          status: {
            in: [
              MaterialRequestStatus.REQUESTED,
              MaterialRequestStatus.SEPARATED,
              MaterialRequestStatus.WAITING_PART,
            ],
          },
        },
      }),
      this.prisma.partWaiting.count({ where: { resolvedAt: null, expectedAt: { lt: now } } }),
    ]);

    return { pending, overdueParts };
  }

  private async alerts() {
    const [degradedKm, pendingTriage, safetyEventsOpen] = await Promise.all([
      this.prisma.kmProjection.count({ where: { isDegraded: true } }),
      this.prisma.failureEvent.count({
        where: { status: EventStatus.REGISTERED, triage: null },
      }),
      this.prisma.failureEvent.count({
        where: {
          status: { notIn: [EventStatus.CLOSED, EventStatus.CANCELLED] },
          isSafety: true,
        },
      }),
    ]);

    return { degradedKm, pendingTriage, safetyEventsOpen };
  }
}
