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

    const [
      vehicles,
      mkbfSeries,
      availabilityByHour,
      availabilityDelta,
      r1,
      eventsPerDay,
      queue,
      workOrders,
      materials,
      alerts,
      recent,
    ] = await Promise.all([
      this.vehicles(now),
      this.mkbfSeries(now, query.months),
      this.availabilityByHour(now),
      this.availabilityDelta(now),
      this.metrics.r1({}),
      this.eventsPerDay(now),
      this.queue(now),
      this.workOrders(now),
      this.materials(now),
      this.alerts(),
      this.events.list({ page: 1, perPage: 6 }),
    ]);

    const byStatus = Object.fromEntries(
      Object.values(VehicleStatus).map((s) => [s, 0]),
    ) as Record<VehicleStatus, number>;
    for (const v of vehicles) byStatus[v.status] += 1;

    const available = vehicles.filter((v) => AVAILABLE_STATUSES.includes(v.status)).length;
    const current = mkbfSeries[mkbfSeries.length - 1]?.mkbf ?? null;

    return {
      generatedAt: now.toISOString(),
      fleet: {
        total: vehicles.length,
        available,
        availabilityRate: vehicles.length ? available / vehicles.length : 0,
        byStatus,
        availabilityDelta,
      },
      mkbf: { current, series: mkbfSeries },
      availabilityByHour,
      downtimeByCause: r1.downtimeByCause,
      totalDowntimeMinutes: r1.totalDowntimeMinutes,
      eventsPerDay,
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
   * Para cada hora do dia, a fração de carros que NÃO tinham OS aberta
   * naquele instante, na média dos últimos 7 dias. Amostra em hh:30.
   */
  private async availabilityByHour(now: Date): Promise<HourAvailability[]> {
    const windowStart = new Date(now.getTime() - 7 * DAY_MS);

    const [fleetSize, workOrders] = await Promise.all([
      this.prisma.vehicle.count({ where: { isActive: true } }),
      this.prisma.workOrder.findMany({
        where: {
          openedAt: { lte: now },
          OR: [{ releasedAt: null }, { releasedAt: { gte: windowStart } }],
          status: { not: WorkOrderStatus.CANCELLED },
        },
        select: { openedAt: true, releasedAt: true },
      }),
    ]);

    if (fleetSize === 0) {
      return Array.from({ length: 24 }, (_, hour) => ({ hour, rate: 0 }));
    }

    const result: HourAvailability[] = [];

    for (let hour = 0; hour < 24; hour += 1) {
      let sum = 0;
      let samples = 0;

      for (let day = 1; day <= 7; day += 1) {
        const t = new Date(now);
        t.setDate(t.getDate() - day);
        t.setHours(hour, 30, 0, 0);
        if (t > now) continue;

        const down = workOrders.filter(
          (wo) => wo.openedAt <= t && (!wo.releasedAt || wo.releasedAt >= t),
        ).length;

        sum += (fleetSize - down) / fleetSize;
        samples += 1;
      }

      result.push({ hour, rate: samples ? sum / samples : 0 });
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

  private async eventsPerDay(now: Date): Promise<DayCount[]> {
    const start = new Date(now.getTime() - 29 * DAY_MS);
    start.setHours(0, 0, 0, 0);

    const rows = await this.prisma.failureEvent.findMany({
      where: { reportedAt: { gte: start } },
      select: { reportedAt: true },
    });

    const counts = new Map<string, number>();
    for (let i = 0; i < 30; i += 1) {
      const d = new Date(start.getTime() + i * DAY_MS);
      counts.set(d.toISOString().slice(0, 10), 0);
    }
    for (const r of rows) {
      const key = r.reportedAt.toISOString().slice(0, 10);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return [...counts.entries()].map(([date, count]) => ({ date, count }));
  }

  private async queue(now: Date) {
    const [waiting, inService, oldest] = await Promise.all([
      this.prisma.queueEntry.count({ where: { status: QueueStatus.WAITING } }),
      this.prisma.queueEntry.count({ where: { status: QueueStatus.IN_SERVICE } }),
      this.prisma.queueEntry.findFirst({
        where: { status: QueueStatus.WAITING },
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

  private async workOrders(now: Date) {
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
          releasedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) },
        },
        select: { downtimeMinutes: true },
      }),
    ]);

    const minutes = released.map((r) => r.downtimeMinutes ?? 0);

    return {
      open,
      overdue,
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
          catalogItem: { isSafety: true },
        },
      }),
    ]);

    return { degradedKm, pendingTriage, safetyEventsOpen };
  }
}
