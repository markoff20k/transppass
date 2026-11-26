import { Injectable } from '@nestjs/common';
import {
  EventStatus,
  OdometerStatus,
  MaterialRequestStatus,
  QueueStatus,
  WorkOrderStatus,
} from '@prisma/client';
import {
  type DowntimeCar,
  AVAILABLE_STATUSES,
  VehicleStatus,
  type AvailabilityDays,
  type DashboardDowntime,
  type DashboardEventsSeries,
  type DashboardRecentEvents,
  type TopFailures,
  type TopFailuresQuery,
  failureModeByCode,
  subsystemByCode,
  type AvailabilityDaysQuery,
  type AvailabilityHours,
  type AvailabilityHoursQuery,
  type DashboardBacks,
  type DashboardData,
  type MkbfSeries,
  type MkbfSeriesPoint,
  type MkbfSeriesQuery,
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
import { BoardService } from '../metrics/board.service';
import { addDays, daysBetween, isoDay } from '../consumption/consumption.calc';

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
    private readonly board: BoardService,
  ) {}

  async build(query: DashboardQuery): Promise<DashboardData> {
    const now = new Date();

    // A janela do histórico: do início do dia de (days - 1) dias atrás até agora.
    // O "agora" da garagem (anel, fluxo, fila, alertas) não depende dela.
    // Com `back`, a janela fecha no fim de D-1 ou D-2 em vez de agora; com
    // from/to, é o intervalo livre que a pessoa escolheu (fim de `to`, ou agora se for hoje).
    let periodEnd = new Date(now);
    let from: Date;
    let days = query.days;
    if (query.from && query.to && query.from <= query.to) {
      from = startOfDay(query.from);
      const end = startOfDay(query.to);
      end.setHours(23, 59, 59, 999);
      periodEnd = end > now ? now : end;
      days = Math.round((startOfDay(query.to).getTime() - from.getTime()) / DAY_MS) + 1;
    } else {
      if (query.back > 0) {
        periodEnd.setDate(periodEnd.getDate() - query.back);
        periodEnd.setHours(23, 59, 59, 999);
      }
      from = new Date(periodEnd.getTime() - (days - 1) * DAY_MS);
      from.setHours(0, 0, 0, 0);
    }
    const months = query.months ?? Math.max(6, Math.ceil(days / 30) + 1);
    // Os cartões "de agora" não seguem o período: MKBF dos últimos 30 dias e OS liberadas hoje.
    const last30From = new Date(now.getTime() - 29 * DAY_MS);
    last30From.setHours(0, 0, 0, 0);
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    // A seção "Agora" fecha o MKBF por mês, como o cliente: o mês corrente até agora e o anterior inteiro.
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    // Só o que o centro de comando mostra: disponibilidade por hora, tempo parado, quebras por dia e
    // últimos eventos têm rotas próprias (cada card busca o seu período) e saíram daqui — a página
    // principal chega mais rápido e os cards de baixo não esperam por ela.
    const [
      vehicles,
      mkbfSeries,
      periodMkbf,
      last30Mkbf,
      releasedToday,
      availabilityDelta,
      queue,
      workOrders,
      materials,
      alerts,
      backs,
      monthMkbf,
      prevMonthMkbf,
      dataThrough,
    ] = await Promise.all([
      this.vehicles(now),
      this.mkbfSeries(now, months),
      this.metrics.mkbf(from, periodEnd),
      this.metrics.mkbf(last30From, now),
      this.prisma.workOrder.count({ where: { releasedAt: { gte: todayStart, lte: now } } }),
      this.availabilityDelta(now),
      this.queue(now),
      this.workOrders(now, from, periodEnd),
      this.materials(now),
      this.alerts(),
      this.backs(now, monthStart, Math.round((now.getTime() - monthStart.getTime()) / DAY_MS) + 1),
      this.metrics.mkbf(monthStart, now),
      this.metrics.mkbf(prevMonthStart, prevMonthEnd),
      this.dataThrough(),
    ]);

    const byStatus = Object.fromEntries(Object.values(VehicleStatus).map((s) => [s, 0])) as Record<
      VehicleStatus,
      number
    >;
    for (const v of vehicles) byStatus[v.status] += 1;

    const available = vehicles.filter((v) => AVAILABLE_STATUSES.includes(v.status)).length;
    const current = mkbfSeries[mkbfSeries.length - 1]?.mkbf ?? null;

    return {
      generatedAt: now.toISOString(),
      period: { days, from: from.toISOString(), to: periodEnd.toISOString() },
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
        last30: {
          kmTraveled: last30Mkbf.kmTraveled,
          unscheduledReturns: last30Mkbf.unscheduledReturns,
          mkbf: last30Mkbf.mkbf,
        },
        month: {
          month: monthKey(monthStart),
          from: monthStart.toISOString(),
          // Até onde a remessa chegou: o número é "do mês até 17/11", não "até hoje".
          to: dataThrough.km && dataThrough.km >= isoDay(monthStart) ? dataThrough.km : isoDay(now),
          kmTraveled: monthMkbf.kmTraveled,
          unscheduledReturns: monthMkbf.unscheduledReturns,
          mkbf: monthMkbf.mkbf,
        },
        previousMonth: {
          month: monthKey(prevMonthStart),
          kmTraveled: prevMonthMkbf.kmTraveled,
          unscheduledReturns: prevMonthMkbf.unscheduledReturns,
          mkbf: prevMonthMkbf.mkbf,
        },
      },
      dataThrough,
      queue,
      workOrders: { ...workOrders, releasedToday },
      materials,
      alerts,
      backs,
      vehicles,
    };
  }

  /** Até quando a remessa do ERP-JB chegou: o último dia com km e com ficha de quebra. */
  private async dataThrough(): Promise<DashboardData['dataThrough']> {
    const [km, failures] = await Promise.all([
      this.prisma.odometerReading.aggregate({ where: { status: { not: OdometerStatus.REJECTED }, deltaKm: { gt: 0 }, vehicle: { application: 'FROTA' } }, _max: { readAt: true } }),
      this.prisma.failureEvent.aggregate({ where: { isUnscheduledReturn: true }, _max: { reportedAt: true } }),
    ]);
    return {
      km: km._max.readAt ? isoDay(km._max.readAt) : null,
      failures: failures._max.reportedAt ? isoDay(failures._max.reportedAt) : null,
    };
  }

  // --- Verso dos três cartões: o porquê do número da frente ------------------

  private async backs(now: Date, from: Date, days: number): Promise<DashboardBacks> {
    const [mkbf, queue, workOrders] = await Promise.all([
      this.mkbfBack(now, from, days),
      this.queueBack(now, from),
      this.workOrdersBack(now),
    ]);
    return { mkbf, queue, workOrders };
  }

  /**
   * MKBF: o mesmo período logo antes (para a variação), os sistemas que mais
   * quebraram e o carro que mais quebrou. O sistema vem do catálogo quando a
   * ficha foi classificada; nas fichas importadas do ERP-JB vale o defeito do
   * CCO, que é o que a Transppass já usa.
   */
  private async mkbfBack(now: Date, from: Date, days: number): Promise<DashboardBacks['mkbf']> {
    const prevFrom = new Date(from.getTime() - days * DAY_MS);
    const where = {
      isUnscheduledReturn: true,
      reportedAt: { gte: from, lte: now },
      vehicle: { application: 'FROTA' },
    };
    const [previous, rows, byVehicle] = await Promise.all([
      this.metrics.mkbf(prevFrom, from),
      this.prisma.failureEvent.findMany({
        where,
        select: { ccoDefect: true, catalogItem: { select: { system: true, description: true } } },
      }),
      this.prisma.failureEvent.groupBy({
        by: ['vehicleId'],
        where,
        _count: { _all: true },
        orderBy: { _count: { vehicleId: 'desc' } },
        take: 1,
      }),
    ]);
    const counts = new Map<string, number>();
    for (const r of rows) {
      const name =
        r.catalogItem?.system ?? r.catalogItem?.description ?? r.ccoDefect ?? 'Sem classificação';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const topSystems = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));
    const worst = byVehicle[0];
    const worstVehicle = worst
      ? await this.prisma.vehicle
          .findUnique({ where: { id: worst.vehicleId }, select: { code: true } })
          .then((v) => (v ? { code: v.code, count: worst._count._all } : null))
      : null;
    return {
      previous: {
        kmTraveled: previous.kmTraveled,
        unscheduledReturns: previous.unscheduledReturns,
        mkbf: previous.mkbf,
      },
      topSystems,
      worstVehicle,
    };
  }

  /**
   * Fila: quem são os mais antigos (os mesmos carros que a frente conta),
   * quanto se espera em média e o movimento de hoje. O movimento vem dos
   * registros da fila; sem eles, dos próprios carros (quem está esperando
   * desde hoje; quem entrou na oficina com OS aberta hoje).
   */
  private async queueBack(now: Date, from: Date): Promise<DashboardBacks['queue']> {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const [waiting, served, enteredEntries, startedEntries, startedVehicles] = await Promise.all([
      this.waitingVehicles(now),
      this.prisma.queueEntry.findMany({
        where: { startedAt: { gte: from } },
        select: { enteredAt: true, startedAt: true },
      }),
      this.prisma.queueEntry.count({ where: { enteredAt: { gte: today } } }),
      this.prisma.queueEntry.count({ where: { startedAt: { gte: today } } }),
      this.prisma.vehicle.count({
        where: {
          isActive: true,
          status: { in: IN_SHOP_STATUSES },
          workOrders: { some: { status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] }, openedAt: { gte: today } } },
        },
      }),
    ]);
    const waits = served.flatMap((q) =>
      q.startedAt ? [(q.startedAt.getTime() - q.enteredAt.getTime()) / HOUR_MS] : [],
    );
    const enteredVehicles = waiting.filter((v) => v.since && v.since >= today).length;
    return {
      oldest: waiting
        .filter((v): v is { code: string; since: Date; hours: number } => v.hours !== null)
        .slice(0, 3)
        .map((v) => ({ code: v.code, hours: v.hours })),
      averageWaitHours: waits.length
        ? Math.round((waits.reduce((a, b) => a + b, 0) / waits.length) * 10) / 10
        : null,
      enteredToday: Math.max(enteredEntries, enteredVehicles),
      startedToday: Math.max(startedEntries, startedVehicles),
    };
  }

  /** OS: quantas em cada etapa e a mais atrasada. */
  private async workOrdersBack(now: Date): Promise<DashboardBacks['workOrders']> {
    const openWhere = { status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] } };
    const [stages, overdue] = await Promise.all([
      this.prisma.workOrder.groupBy({ by: ['status'], where: openWhere, _count: { _all: true } }),
      this.prisma.workOrder.findFirst({
        where: { ...openWhere, estimatedCompletionAt: { lt: now } },
        orderBy: { estimatedCompletionAt: 'asc' },
        select: {
          id: true,
          code: true,
          estimatedCompletionAt: true,
          vehicle: { select: { code: true } },
        },
      }),
    ]);
    const count = (st: WorkOrderStatus) => stages.find((s) => s.status === st)?._count._all ?? 0;
    return {
      byStage: {
        open: count(WorkOrderStatus.OPEN),
        inProgress: count(WorkOrderStatus.IN_PROGRESS),
        waitingPart: count(WorkOrderStatus.WAITING_PART),
        techClosed: count(WorkOrderStatus.TECH_CLOSED),
        inInspection: count(WorkOrderStatus.IN_INSPECTION),
        inCleaning: count(WorkOrderStatus.IN_CLEANING),
      },
      mostOverdue: overdue
        ? {
            id: overdue.id,
            code: overdue.code,
            vehicleCode: overdue.vehicle.code,
            lateHours:
              Math.round(
                ((now.getTime() - overdue.estimatedCompletionAt.getTime()) / HOUR_MS) * 10,
              ) / 10,
          }
        : null,
    };
  }

  // --- Período dos gráficos: MKBF por dia/mês e disponibilidade por hora ---------

  /**
   * Série do MKBF para um período escolhido. Por dia, os pontos saem do quadro
   * mensal (mesmo km e mesmas quebras das telas de indicador); por mês, da
   * mesma conta do R1. Se nenhum dia do período tem dado (km nem quebra), a
   * janela recua até o último dia com dado e `fellBack` avisa a tela.
   */
  async mkbfSeriesRange(q: MkbfSeriesQuery): Promise<MkbfSeries> {
    const today = isoDay(new Date());
    const to = q.to > today ? today : q.to;
    const from = q.from > to ? to : q.from;
    if (q.bucket === 'month') {
      const points: MkbfSeriesPoint[] = [];
      const now = new Date();
      let km = 0;
      let returns = 0;
      for (let m = monthOf(from); m <= monthOf(to); m = shiftMonth(m, 1)) {
        const [y, mm] = m.split('-').map(Number) as [number, number];
        const start = new Date(y, mm - 1, 1);
        const endOfMonth = new Date(y, mm, 0, 23, 59, 59, 999);
        const end = endOfMonth > now ? now : endOfMonth;
        const r = await this.metrics.mkbf(start, end);
        km += r.kmTraveled;
        returns += r.unscheduledReturns;
        points.push({
          key: m,
          kmTraveled: r.kmTraveled,
          unscheduledReturns: r.unscheduledReturns,
          mkbf: r.mkbf,
          mkbfToDate: returns > 0 ? Math.round(km / returns) : null,
        });
      }
      return {
        bucket: 'month',
        points,
        dayTotal: null,
        requested: { from: q.from, to: q.to },
        used: { from, to },
        fellBack: false,
      };
    }

    // Dias com dado, do quadro mensal, cobrindo o período e até três meses antes (para o recuo).
    const days = new Map<string, { km: number; failures: number }>();
    for (let m = shiftMonth(monthOf(from), -3); m <= monthOf(to); m = shiftMonth(m, 1)) {
      const board = await this.board.board(m).catch(() => null);
      for (const d of board?.days ?? []) {
        // Sem km não há MKBF: dia só com ficha (remessa de km ainda não chegou) fica de fora.
        if (!d.empty && d.km > 0) days.set(d.date, { km: d.km, failures: d.failures });
      }
    }
    const hasData = (a: string, b: string) => [...days.keys()].some((k) => k >= a && k <= b);
    let usedFrom = from;
    let usedTo = to;
    let fellBack = false;
    if (!hasData(from, to)) {
      const last = [...days.keys()]
        .filter((k) => k < from)
        .sort()
        .pop();
      if (last) {
        const span = Math.max(0, daysBetween(from, to) - 1); // daysBetween conta inclusivo
        usedTo = last;
        usedFrom = addDays(last, -span);
        fellBack = true;
      }
    }
    const points: MkbfSeriesPoint[] = [];
    let km = 0;
    let returns = 0;
    for (let d = usedFrom; d <= usedTo; d = addDays(d, 1)) {
      const row = days.get(d);
      if (!row) continue;
      km += row.km;
      returns += row.failures;
      points.push({
        key: d,
        kmTraveled: row.km,
        unscheduledReturns: row.failures,
        mkbf: row.failures > 0 ? Math.round(row.km / row.failures) : null,
        mkbfToDate: returns > 0 ? Math.round(km / returns) : null,
      });
    }
    if (q.bucket === 'hour') {
      // Um dia só, hora a hora: quebras por hora (reportedAt) e o km que houver por hora;
      // o MKBF do dia inteiro vai à parte, porque km por hora só existe com telemetria.
      const day = usedTo;
      const dayStart = startOfDay(day);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      const [events, readings] = await Promise.all([
        this.prisma.failureEvent.findMany({
          where: {
            isUnscheduledReturn: true,
            reportedAt: { gte: dayStart, lte: dayEnd },
            vehicle: { application: 'FROTA' },
          },
          select: { reportedAt: true },
        }),
        this.prisma.odometerReading.findMany({
          where: {
            readAt: { gte: dayStart, lte: dayEnd },
            status: { not: OdometerStatus.REJECTED },
            deltaKm: { gt: 0 },
            vehicle: { application: 'FROTA' },
          },
          select: { readAt: true, deltaKm: true },
        }),
      ]);
      const perHour = Array.from({ length: 24 }, () => ({ km: 0, failures: 0 }));
      for (const e of events) perHour[e.reportedAt.getHours()]!.failures += 1;
      for (const r of readings) perHour[r.readAt.getHours()]!.km += r.deltaKm ?? 0;
      const hourPoints: MkbfSeriesPoint[] = perHour.map((h, hour) => ({
        key: String(hour).padStart(2, '0'),
        kmTraveled: h.km,
        unscheduledReturns: h.failures,
        mkbf: h.failures > 0 && h.km > 0 ? Math.round(h.km / h.failures) : null,
        mkbfToDate: null,
      }));
      const total = days.get(day) ?? { km: 0, failures: events.length };
      return {
        bucket: 'hour',
        points: hourPoints,
        dayTotal: {
          kmTraveled: total.km,
          unscheduledReturns: total.failures,
          mkbf: total.failures > 0 ? Math.round(total.km / total.failures) : null,
        },
        requested: { from: q.from, to: q.to },
        used: { from: day, to: day },
        fellBack,
      };
    }
    return {
      bucket: 'day',
      points,
      dayTotal: null,
      requested: { from: q.from, to: q.to },
      used: { from: usedFrom, to: usedTo },
      fellBack,
    };
  }

  /**
   * Disponibilidade por hora: a média de uma janela de dias e, se pedido, a
   * curva de um dia. Carro parado é o mesmo do anel: da quebra à liberação.
   * Dia pedido no futuro (ou hoje antes da primeira amostra) recua para o dia
   * anterior e `fellBack` avisa a tela.
   */
  /**
   * Disponibilidade média de cada dia do intervalo (24 amostras por dia, em
   * hh:30; intervalos longos amostram a cada 2 h). Mesmo critério de carro
   * parado do anel e da curva por hora.
   */
  /** Quebras (retornos não programados) num intervalo: por hora num dia só, por dia até 120 dias, por semana acima. */
  async eventsSeries(q: AvailabilityDaysQuery): Promise<DashboardEventsSeries> {
    const now = new Date();
    const today = isoDay(now);
    const reqTo = q.to > today ? today : q.to;
    const reqFrom = q.from > reqTo ? reqTo : q.from;
    // Sem quebra no período (remessa que ainda não chegou): recua até o último dia com quebra, mesmo tamanho de janela.
    const { from, to, fellBack } = await this.fallbackWindow(reqFrom, reqTo);
    const start = startOfDay(from);
    const end = startOfDay(to);
    end.setHours(23, 59, 59, 999);
    const rows = await this.prisma.failureEvent.findMany({
      where: { reportedAt: { gte: start, lte: end > now ? now : end }, isUnscheduledReturn: true },
      select: { reportedAt: true },
    });
    if (from === to) {
      const counts = Array.from({ length: 24 }, () => 0);
      for (const r of rows) counts[r.reportedAt.getHours()] = (counts[r.reportedAt.getHours()] ?? 0) + 1;
      return { points: counts.map((count, h) => ({ date: `${from}T${String(h).padStart(2, '0')}`, count })), bucket: 'hour', from, to, requested: { from: reqFrom, to: reqTo }, used: { from, to }, fellBack };
    }
    const days = daysBetween(from, to);
    const bucket: 'day' | 'week' = days > 120 ? 'week' : 'day';
    const size = bucket === 'week' ? 7 : 1;
    const n = Math.ceil(days / size);
    const counts = Array.from({ length: n }, () => 0);
    for (const r of rows) {
      const idx = Math.floor((startOfDay(isoDay(r.reportedAt)).getTime() - start.getTime()) / (DAY_MS * size));
      if (idx >= 0 && idx < n) counts[idx] = (counts[idx] ?? 0) + 1;
    }
    return { points: counts.map((count, i) => ({ date: addDays(from, i * size), count })), bucket, from, to, requested: { from: reqFrom, to: reqTo }, used: { from, to }, fellBack };
  }

  /** Os 6 eventos mais recentes de um período; sem nenhum, os do último dia com evento antes dele. */
  async recentEvents(q: AvailabilityDaysQuery): Promise<DashboardRecentEvents> {
    const today = isoDay(new Date());
    const reqTo = q.to > today ? today : q.to;
    const reqFrom = q.from > reqTo ? reqTo : q.from;
    const window = async (from: string, to: string) => {
      const end = startOfDay(to);
      end.setHours(23, 59, 59, 999);
      return (await this.events.list({ page: 1, perPage: 6, from: startOfDay(from), to: end })).data;
    };
    let events = await window(reqFrom, reqTo);
    if (events.length > 0) return { events, requested: { from: reqFrom, to: reqTo }, used: { from: reqFrom, to: reqTo }, fellBack: false };
    const last = await this.prisma.failureEvent.findFirst({ where: { reportedAt: { lt: startOfDay(reqFrom) } }, orderBy: { reportedAt: 'desc' }, select: { reportedAt: true } });
    if (!last) return { events, requested: { from: reqFrom, to: reqTo }, used: { from: reqFrom, to: reqTo }, fellBack: false };
    const usedTo = isoDay(last.reportedAt);
    const usedFrom = addDays(usedTo, -(daysBetween(reqFrom, reqTo) - 1));
    events = await window(usedFrom, usedTo);
    return { events, requested: { from: reqFrom, to: reqTo }, used: { from: usedFrom, to: usedTo }, fellBack: true };
  }

  /**
   * As 10 falhas que mais derrubaram carro no período (retornos não
   * programados), pelo defeito do CCO ou pelo código composto, com o período
   * anterior de mesmo tamanho para a variação e os carros distintos. Quebra sem
   * defeito/código fica fora do ranking e é contada à parte.
   */
  async topFailures(q: TopFailuresQuery): Promise<TopFailures> {
    const today = isoDay(new Date());
    const reqTo = q.to > today ? today : q.to;
    const reqFrom = q.from > reqTo ? reqTo : q.from;
    const { from, to, fellBack } = await this.fallbackWindow(reqFrom, reqTo);
    const span = daysBetween(from, to);
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(span - 1));
    const load = (a: string, b: string) => {
      const end = startOfDay(b);
      end.setHours(23, 59, 59, 999);
      return this.prisma.failureEvent.findMany({
        where: { isUnscheduledReturn: true, status: { not: EventStatus.CANCELLED }, reportedAt: { gte: startOfDay(a), lte: end } },
        select: { vehicleId: true, ccoDefect: true, failureModeCode: true, subsystemCode: true, catalogItem: { select: { description: true } } },
      });
    };
    const [cur, prev] = await Promise.all([load(from, to), load(prevFrom, prevTo)]);
    type Row = (typeof cur)[number];
    // Por código, o nome é o subsistema (o que quebrou) e o modo de falha vai como detalhe:
    // quase todo código começa com "Inoperante", e o modo na frente esconderia a diferença.
    const keyOf = (r: Row): { key: string; label: string; code: string | null; detail: string | null } | null => {
      if (q.by === 'code') {
        if (!r.failureModeCode || !r.subsystemCode) return null;
        const code = `${r.failureModeCode}-${r.subsystemCode}`;
        // "Elétrico — subsistema não identificado" vira "Elétrico", e o "subsistema não identificado" vai para o detalhe.
        const sub = subsystemByCode(r.subsystemCode)?.name ?? code;
        const generic = / — subsistema não identificado$/i.test(sub);
        const mode = failureModeByCode(r.failureModeCode)?.name ?? null;
        return { key: code, label: generic ? sub.replace(/ — subsistema não identificado$/i, '') : sub, code, detail: [mode, generic ? 'subsistema não identificado' : null].filter(Boolean).join(' · ') || null };
      }
      const name = (r.ccoDefect ?? r.catalogItem?.description ?? '').trim();
      return name ? { key: name, label: name, code: null, detail: null } : null;
    };
    const groups = new Map<string, { label: string; code: string | null; detail: string | null; count: number; vehicles: Set<string> }>();
    let unclassified = 0;
    for (const r of cur) {
      const k = keyOf(r);
      if (!k) {
        unclassified += 1;
        continue;
      }
      const g = groups.get(k.key) ?? { label: k.label, code: k.code, detail: k.detail, count: 0, vehicles: new Set<string>() };
      g.count += 1;
      g.vehicles.add(r.vehicleId);
      groups.set(k.key, g);
    }
    const prevCount = new Map<string, number>();
    for (const r of prev) {
      const k = keyOf(r);
      if (k) prevCount.set(k.key, (prevCount.get(k.key) ?? 0) + 1);
    }
    const total = cur.length;
    const items = [...groups.entries()]
      .sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label))
      .slice(0, 10)
      .map(([key, g]) => ({ key, label: g.label, code: g.code, detail: g.detail, count: g.count, share: total ? g.count / total : 0, vehicles: g.vehicles.size, previous: prevCount.get(key) ?? 0 }));
    return { by: q.by, items, total, unclassified, previousRange: { from: prevFrom, to: prevTo }, requested: { from: reqFrom, to: reqTo }, used: { from, to }, fellBack };
  }

  /** Janela pedida, ou a mesma janela recuada até o último dia com quebra quando a pedida não tem nenhuma. */
  private async fallbackWindow(from: string, to: string): Promise<{ from: string; to: string; fellBack: boolean }> {
    const end = startOfDay(to);
    end.setHours(23, 59, 59, 999);
    const any = await this.prisma.failureEvent.count({ where: { isUnscheduledReturn: true, reportedAt: { gte: startOfDay(from), lte: end } } });
    if (any > 0) return { from, to, fellBack: false };
    const last = await this.prisma.failureEvent.findFirst({ where: { isUnscheduledReturn: true, reportedAt: { lt: startOfDay(from) } }, orderBy: { reportedAt: 'desc' }, select: { reportedAt: true } });
    if (!last) return { from, to, fellBack: false };
    const usedTo = isoDay(last.reportedAt);
    return { from: addDays(usedTo, -(daysBetween(from, to) - 1)), to: usedTo, fellBack: true };
  }

  /** Tempo parado por causa das OS liberadas num intervalo. */
  async downtime(q: AvailabilityDaysQuery): Promise<DashboardDowntime> {
    const today = isoDay(new Date());
    const to = q.to > today ? today : q.to;
    const from = q.from > to ? to : q.from;
    const end = startOfDay(to);
    end.setHours(23, 59, 59, 999);
    // Item 4: o mesmo recorte do relógio (segmentos que começaram no período, o aberto
    // conta até agora), agora também por carro — a média divide pelos carros distintos.
    const segments = await this.prisma.downtimeSegment.findMany({
      where: { startedAt: { gte: startOfDay(from), lte: end } },
      select: {
        cause: true,
        minutes: true,
        startedAt: true,
        endedAt: true,
        workOrderId: true,
        workOrder: { select: { vehicleId: true, vehicle: { select: { code: true, plate: true } } } },
      },
    });
    const nowMs = Date.now();
    const byCause = new Map<keyof DowntimeCar['byCause'], number>();
    const cars = new Map<string, DowntimeCar & { wos: Set<string> }>();
    const carsByCause = new Map<string, Set<string>>();
    for (const sg of segments) {
      const minutes = sg.endedAt ? (sg.minutes ?? 0) : Math.max(0, Math.round((nowMs - sg.startedAt.getTime()) / 60_000));
      byCause.set(sg.cause, (byCause.get(sg.cause) ?? 0) + minutes);
      const vid = sg.workOrder.vehicleId;
      const car = cars.get(vid) ?? { vehicleId: vid, code: sg.workOrder.vehicle.code, plate: sg.workOrder.vehicle.plate, minutes: 0, workOrders: 0, byCause: {}, wos: new Set<string>() };
      car.minutes += minutes;
      car.byCause[sg.cause] = (car.byCause[sg.cause] ?? 0) + minutes;
      car.wos.add(sg.workOrderId);
      cars.set(vid, car);
      if (minutes > 0) {
        const set = carsByCause.get(sg.cause) ?? new Set<string>();
        set.add(vid);
        carsByCause.set(sg.cause, set);
      }
    }
    const total = [...byCause.values()].reduce((a, b) => a + b, 0);
    const downtimeByCause = [...byCause.entries()]
      .map(([cause, minutes]) => ({ cause, minutes, share: total ? minutes / total : 0 }))
      .sort((a, b) => b.minutes - a.minutes);
    const stopped = [...cars.values()].filter((c) => c.minutes > 0);
    return {
      downtimeByCause,
      totalDowntimeMinutes: total,
      from,
      to,
      vehicleCount: stopped.length,
      avgMinutesPerVehicle: stopped.length ? Math.round(total / stopped.length) : null,
      perCause: downtimeByCause.map((c) => {
        const vehicles = carsByCause.get(c.cause)?.size ?? 0;
        return { cause: c.cause, vehicles, avgMinutesPerVehicle: vehicles ? Math.round(c.minutes / vehicles) : 0 };
      }),
      cars: stopped
        .map(({ wos, ...c }) => ({ ...c, workOrders: wos.size }))
        .sort((a, b) => b.minutes - a.minutes),
    };
  }

  async availabilityDays(q: AvailabilityDaysQuery, vehicleId?: string): Promise<AvailabilityDays> {
    const now = new Date();
    const today = isoDay(now);
    const to = q.to > today ? today : q.to;
    const from = q.from > to ? to : q.from;
    const windowStart = startOfDay(from);
    // Um carro só (widget com escopo): a "frota" é ele, e a taxa do dia é a fração das horas em que estava pronto.
    const byVehicle = vehicleId ? { vehicleId } : {};
    const [fleetSize, workOrders, returns] = await Promise.all([
      vehicleId ? Promise.resolve(1) : this.prisma.vehicle.count({ where: { isActive: true } }),
      this.prisma.workOrder.findMany({
        where: { openedAt: { lte: now }, OR: [{ releasedAt: null }, { releasedAt: { gte: windowStart } }], status: { not: WorkOrderStatus.CANCELLED }, ...byVehicle },
        select: { vehicleId: true, openedAt: true, releasedAt: true },
      }),
      this.prisma.failureEvent.findMany({
        where: { isUnscheduledReturn: true, reportedAt: { lte: now }, OR: [{ closedAt: null }, { closedAt: { gte: windowStart } }], status: { not: EventStatus.CANCELLED }, ...byVehicle },
        select: { vehicleId: true, reportedAt: true, closedAt: true },
      }),
    ]);
    const spans = [
      ...workOrders.map((wo) => ({ vehicleId: wo.vehicleId, from: wo.openedAt, to: wo.releasedAt })),
      ...returns.map((ev) => ({ vehicleId: ev.vehicleId, from: ev.reportedAt, to: ev.closedAt })),
    ];
    const rateAt = (t: Date): number => {
      if (fleetSize === 0) return 0;
      const down = new Set<string>();
      for (const sp of spans) if (sp.from <= t && (!sp.to || sp.to >= t)) down.add(sp.vehicleId);
      return (fleetSize - Math.min(down.size, fleetSize)) / fleetSize;
    };
    const totalDays = daysBetween(from, to);
    const hourStep = totalDays > 90 ? 2 : 1;
    const points: AvailabilityDays['points'] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      let sum = 0;
      let samples = 0;
      for (let hour = 0; hour < 24; hour += hourStep) {
        const t = startOfDay(d);
        t.setHours(hour, 30, 0, 0);
        if (t > now) continue;
        sum += rateAt(t);
        samples += 1;
      }
      if (samples) points.push({ date: d, rate: sum / samples });
    }
    return { points, from, to };
  }

  async availabilityHours(q: AvailabilityHoursQuery): Promise<AvailabilityHours> {
    const now = new Date();
    const today = isoDay(now);
    const to = q.to > today ? today : q.to;
    const from = q.from > to ? to : q.from;
    let day = q.day ? (q.day > today ? today : q.day) : null;
    let fellBack = false;
    // Hoje antes de 00:30 ainda não tem amostra: a curva de hoje seria vazia.
    if (day === today && now.getHours() === 0 && now.getMinutes() < 30) {
      day = addDays(today, -1);
      fellBack = true;
    }
    if (q.day && day !== q.day && q.day <= today) fellBack = true;

    const windowStart = startOfDay(day && day < from ? day : from);
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
    const spans = [
      ...workOrders.map((wo) => ({
        vehicleId: wo.vehicleId,
        from: wo.openedAt,
        to: wo.releasedAt,
      })),
      ...returns.map((ev) => ({ vehicleId: ev.vehicleId, from: ev.reportedAt, to: ev.closedAt })),
    ];
    const rateAt = (t: Date): number => {
      if (fleetSize === 0) return 0;
      const down = new Set<string>();
      for (const sp of spans) if (sp.from <= t && (!sp.to || sp.to >= t)) down.add(sp.vehicleId);
      return (fleetSize - Math.min(down.size, fleetSize)) / fleetSize;
    };

    const totalDays = daysBetween(from, to) + 1;
    const step = Math.max(1, Math.ceil(totalDays / 60));
    const hours: HourAvailability[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      let sum = 0;
      let samples = 0;
      for (let i = 0; i < totalDays; i += step) {
        const t = startOfDay(addDays(from, i));
        t.setHours(hour, 30, 0, 0);
        if (t > now) continue;
        sum += rateAt(t);
        samples += 1;
      }
      let todayRate: number | null = null;
      if (day) {
        const t = startOfDay(day);
        t.setHours(hour, 30, 0, 0);
        const sample = t <= now ? t : day === today && hour === now.getHours() ? now : null;
        todayRate = sample ? rateAt(sample) : null;
      }
      hours.push({ hour, rate: samples ? sum / samples : 0, today: todayRate });
    }
    return { hours, day, requestedDay: q.day ?? null, fellBack, days: Math.ceil(totalDays / step) };
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

    // Última linha de cada carro nos últimos 30 dias (planilha carro-linha-dia), para o cartão.
    const lastLines = await this.prisma.vehicleLineDay.findMany({
      where: { line: { not: null }, date: { gte: new Date(now.getTime() - 30 * DAY_MS) } },
      orderBy: [{ vehicleId: 'asc' }, { date: 'desc' }],
      distinct: ['vehicleId'],
      select: { vehicleId: true, line: true },
    });
    const lineOf = new Map(lastLines.map((l) => [l.vehicleId, l.line]));

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
        hoursInState: since
          ? Math.round(((now.getTime() - since.getTime()) / HOUR_MS) * 10) / 10
          : null,
        model: v.model ?? null,
        modelYear: v.modelYear ?? null,
        lot: v.lot ?? null,
        line: event?.lineCode ?? lineOf.get(v.id) ?? null,
      };
    });
  }

  /** Um mês por vez custava 12 idas ao banco em série; agora vão todas juntas. */
  private async mkbfSeries(now: Date, months: number): Promise<MkbfPoint[]> {
    return Promise.all(
      Array.from({ length: months }, (_, idx) => months - 1 - idx).map(async (i) => {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const end = i === 0 ? now : new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
        const r = await this.metrics.mkbf(start, end);
        return { month: start.toISOString(), kmTraveled: r.kmTraveled, unscheduledReturns: r.unscheduledReturns, mkbf: r.mkbf };
      }),
    );
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
   * Fila e oficina contados pelo status do carro — a mesma fonte do fluxo da
   * garagem e da frota. Uma entrada de fila que ficou para trás nunca faz o
   * cartão discordar do trilho.
   */
  /**
   * Quem está esperando valeta, pela mesma régua da frente do cartão e do
   * fluxo da garagem: o estado do carro. O tempo é o da entrada na fila; sem
   * registro de fila (carro que chegou ao estado por outro caminho), vale a
   * OS ou a quebra que o trouxe. Do mais antigo para o mais novo.
   */
  private async waitingVehicles(now: Date): Promise<{ code: string; since: Date | null; hours: number | null }[]> {
    const rows = await this.prisma.vehicle.findMany({
      where: { isActive: true, status: VehicleStatus.AWAITING_MAINTENANCE },
      select: {
        code: true,
        queueEntries: { where: { status: QueueStatus.WAITING }, orderBy: { enteredAt: 'asc' }, take: 1, select: { enteredAt: true } },
        workOrders: { where: { status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] } }, orderBy: { openedAt: 'desc' }, take: 1, select: { openedAt: true } },
        failureEvents: { where: { status: { notIn: [EventStatus.CLOSED, EventStatus.CANCELLED] } }, orderBy: { reportedAt: 'desc' }, take: 1, select: { reportedAt: true } },
      },
    });
    return rows
      .map((v) => {
        const since = v.queueEntries[0]?.enteredAt ?? v.workOrders[0]?.openedAt ?? v.failureEvents[0]?.reportedAt ?? null;
        return { code: v.code, since, hours: since ? Math.round(((now.getTime() - since.getTime()) / HOUR_MS) * 10) / 10 : null };
      })
      .sort((a, b) => (b.hours ?? -1) - (a.hours ?? -1));
  }

  private async queue(now: Date) {
    const [waiting, inService] = await Promise.all([
      this.waitingVehicles(now),
      this.prisma.vehicle.count({ where: { isActive: true, status: { in: IN_SHOP_STATUSES } } }),
    ]);
    return {
      waiting: waiting.length,
      inService,
      oldestWaitingHours: waiting[0]?.hours ?? null,
    };
  }

  private async workOrders(now: Date, from: Date, to: Date = now) {
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
          releasedAt: { gte: from, lte: to },
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

// --- datas civis -----------------------------------------------------------------
function monthOf(iso: string): string {
  return iso.slice(0, 7);
}
function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function startOfDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}
