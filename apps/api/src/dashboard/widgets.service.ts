import { Injectable } from '@nestjs/common';
import { EventStatus, FieldOutcome, InspectionResult, OdometerStatus, type Prisma, VehicleTechnology, WorkOrderStatus } from '@prisma/client';
import type { DashboardWidget, WidgetBucket, WidgetKind, WidgetQuery, WidgetSeries, WidgetSeriesPoint } from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { BoardService } from '../metrics/board.service';
import { ConsumptionService } from '../consumption/consumption.service';
import { DashboardService } from './dashboard.service';

const DAY_MS = 86_400_000;
const fmtInt = (n: number) => Math.round(n).toLocaleString('pt-BR');
const fmtPct = (n: number) =>
  `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** Quanto maior, melhor? Decide a cor da variação contra o período anterior. */
const HIGHER_IS_BETTER: Record<WidgetKind, boolean> = {
  mkbf: true,
  breakdowns: false,
  km: true,
  availability: true,
  lostTrips: false,
  tripsDone: true,
  downtime: false,
  woReleased: true,
  woOpened: false,
  rescues: false,
  fieldResolution: true,
  triageSla: false,
  rework: false,
  consumptionDiesel: true,
  consumptionEbus: true,
  topFailures: false,
};

const UNIT: Record<WidgetKind, DashboardWidget['unit']> = {
  mkbf: 'km',
  breakdowns: 'count',
  km: 'km',
  availability: 'pct',
  lostTrips: 'count',
  tripsDone: 'pct',
  downtime: 'minutes',
  woReleased: 'count',
  woOpened: 'count',
  rescues: 'count',
  fieldResolution: 'pct',
  triageSla: 'minutes',
  rework: 'pct',
  consumptionDiesel: 'kml',
  consumptionEbus: 'kmkwh',
  topFailures: 'count',
};

interface Computed {
  value: number | null;
  detail: string | null;
}

/** Um ponto do eixo: a chave do gráfico e a janela de tempo que ele cobre (recortada no período). */
interface Bucket {
  key: string;
  start: Date;
  end: Date;
  fromIso: string;
  toIso: string;
}

/**
 * Widgets do Dashboard: um indicador, um período, um escopo, um número e o
 * gráfico desse número ao longo do período.
 *
 * Cada cartão da seção de indicadores pede `kind` + `from`/`to` (dias civis,
 * fuso de São Paulo) e, se quiser, `vehicleId` para olhar um carro só. Recebe
 * o valor do período, o do período igual logo antes (para a variação), uma
 * linha de detalhe com a conta por trás e a série por hora, dia ou mês. Tudo
 * sai das mesmas funções que alimentam o R1 e o quadro mensal: o número que a
 * pessoa monta aqui é o mesmo que ela vê nas telas de indicador.
 */
@Injectable()
export class WidgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly board: BoardService,
    private readonly consumption: ConsumptionService,
    private readonly dashboard: DashboardService,
  ) {}

  async build(q: WidgetQuery): Promise<DashboardWidget> {
    const v = q.vehicleId;
    const spanDays = (a: string, b: string) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS) + 1;
    const days = spanDays(q.from, q.to);
    const window = (fromIso: string, toIso: string) => {
      const n = spanDays(fromIso, toIso);
      const from = startOfDay(fromIso);
      const to = endOfDay(toIso);
      const prevTo = new Date(from.getTime() - 1);
      const prevFrom = new Date(from.getTime() - n * DAY_MS);
      return Promise.all([
        this.compute(q.kind, from, to, fromIso, toIso, v),
        this.compute(q.kind, prevFrom, prevTo, isoDay(prevFrom), isoDay(prevTo), v),
      ]);
    };
    let used = { from: q.from, to: q.to };
    let fellBack = false;
    // O período só vale até o último dia com dado deste indicador (a mesma regra para todo
    // tipo de cartão). Sem dado nenhum no período (remessa que ainda não chegou), a janela
    // inteira recua para terminar nesse dia, com o mesmo tamanho; com dado só em parte, a
    // janela termina nele. Dia sem remessa nunca vira zero no número nem no gráfico.
    const last = await this.lastDataDay(q.kind, addDaysIso(q.to, 1), v);
    if (last && last < q.from) {
      used = { from: addDaysIso(last, -(days - 1)), to: last };
      fellBack = true;
    } else if (last && last < q.to) {
      used = { from: q.from, to: last };
      fellBack = true;
    }
    let [current, previous] = await window(used.from, used.to);
    // Ainda sem valor (ex.: MKBF num dia com km mas sem quebra): recua para o dia mais
    // recente com dado antes do pedido, mantendo o tamanho da janela.
    if (current.value === null && !fellBack) {
      const prior = await this.lastDataDay(q.kind, q.from, v);
      if (prior) {
        used = { from: addDaysIso(prior, -(days - 1)), to: prior };
        [current, previous] = await window(used.from, used.to);
        fellBack = true;
      }
    }
    const [vehicle, series] = await Promise.all([
      v ? this.prisma.vehicle.findUnique({ where: { id: v }, select: { code: true } }) : null,
      this.series(q.kind, used.from, used.to, v).catch(() => null),
    ]);
    return {
      kind: q.kind,
      from: q.from,
      to: q.to,
      value: current.value,
      previous: previous.value,
      unit: UNIT[q.kind],
      detail: current.detail,
      higherIsBetter: HIGHER_IS_BETTER[q.kind],
      vehicleCode: vehicle?.code ?? null,
      used,
      fellBack,
      neverHadData: current.value === null && !last,
      series,
    };
  }

  /**
   * Último dia, antes de `before`, em que este indicador tem dado. Só para os
   * indicadores que dependem de remessa ou planilha; contagens (OS, socorro,
   * triagem) valem zero e não recuam.
   */
  private async lastDataDay(kind: WidgetKind, before: string, v?: string): Promise<string | null> {
    const lt = new Date(`${before}T00:00:00`);
    switch (kind) {
      case 'mkbf':
      case 'km':
      case 'breakdowns': {
        const r = await this.prisma.odometerReading.findFirst({
          where: {
            readAt: { lt },
            deltaKm: { gt: 0 },
            vehicle: { application: 'FROTA' },
            ...(v ? { vehicleId: v } : {}),
          },
          orderBy: { readAt: 'desc' },
          select: { readAt: true },
        });
        return r ? isoDay(r.readAt) : null;
      }
      case 'topFailures': {
        const e = await this.prisma.failureEvent.findFirst({
          where: { isUnscheduledReturn: true, reportedAt: { lt }, ...(v ? { vehicleId: v } : {}) },
          orderBy: { reportedAt: 'desc' },
          select: { reportedAt: true },
        });
        return e ? isoDay(e.reportedAt) : null;
      }
      case 'lostTrips':
      case 'tripsDone': {
        if (v) {
          const e = await this.prisma.failureEvent.findFirst({
            where: { vehicleId: v, reportedAt: { lt } },
            orderBy: { reportedAt: 'desc' },
            select: { reportedAt: true },
          });
          return e ? isoDay(e.reportedAt) : null;
        }
        const r = await this.prisma.lineTripDay.findFirst({
          where: { date: { lt: new Date(`${before}T00:00:00Z`) }, planned: { gt: 0 } },
          orderBy: { date: 'desc' },
          select: { date: true },
        });
        return r ? r.date.toISOString().slice(0, 10) : null;
      }
      case 'consumptionDiesel':
      case 'consumptionEbus': {
        const r = await this.prisma.consumptionReading.findFirst({
          where: { date: { lt: new Date(`${before}T00:00:00Z`) }, ...(v ? { vehicleId: v } : {}) },
          orderBy: { date: 'desc' },
          select: { date: true },
        });
        return r ? r.date.toISOString().slice(0, 10) : null;
      }
      case 'rescues': {
        const [f, e] = await Promise.all([
          this.prisma.fieldService.findFirst({ where: { dispatchedAt: { lt }, ...(v ? { event: { vehicleId: v } } : {}) }, orderBy: { dispatchedAt: 'desc' }, select: { dispatchedAt: true } }),
          this.prisma.failureEvent.findFirst({ where: importedRescueWhere(new Date(0), lt, v), orderBy: { reportedAt: 'desc' }, select: { reportedAt: true } }),
        ]);
        const d = [f?.dispatchedAt, e?.reportedAt].filter((x): x is Date => !!x).sort((a, b) => b.getTime() - a.getTime())[0];
        return d ? isoDay(d) : null;
      }
      case 'downtime':
      case 'woReleased': {
        const r = await this.prisma.workOrder.findFirst({ where: { status: WorkOrderStatus.RELEASED, releasedAt: { lt }, ...(v ? { vehicleId: v } : {}) }, orderBy: { releasedAt: 'desc' }, select: { releasedAt: true } });
        return r?.releasedAt ? isoDay(r.releasedAt) : null;
      }
      case 'woOpened': {
        const [w, m] = await Promise.all([
          this.prisma.workOrder.findFirst({ where: { openedAt: { lt }, status: { not: WorkOrderStatus.CANCELLED }, ...(v ? { vehicleId: v } : {}) }, orderBy: { openedAt: 'desc' }, select: { openedAt: true } }),
          this.prisma.maintenanceRecord.findFirst({ where: { openedAt: { lt }, ...(v ? { vehicleId: v } : {}) }, orderBy: { openedAt: 'desc' }, select: { openedAt: true } }),
        ]);
        const d = [w?.openedAt, m?.openedAt].filter((x): x is Date => !!x).sort((a, b) => b.getTime() - a.getTime())[0];
        return d ? isoDay(d) : null;
      }
      case 'fieldResolution': {
        const r = await this.prisma.fieldService.findFirst({ where: { dispatchedAt: { lt }, ...(v ? { event: { vehicleId: v } } : {}) }, orderBy: { dispatchedAt: 'desc' }, select: { dispatchedAt: true } });
        return r ? isoDay(r.dispatchedAt) : null;
      }
      case 'triageSla': {
        const r = await this.prisma.triage.findFirst({ where: { decidedAt: { lt }, ...(v ? { event: { vehicleId: v } } : {}) }, orderBy: { decidedAt: 'desc' }, select: { decidedAt: true } });
        return r?.decidedAt ? isoDay(r.decidedAt) : null;
      }
      case 'rework': {
        const r = await this.prisma.inspection.findFirst({ where: { inspectedAt: { lt }, ...(v ? { task: { workOrder: { vehicleId: v } } } : {}) }, orderBy: { inspectedAt: 'desc' }, select: { inspectedAt: true } });
        return r ? isoDay(r.inspectedAt) : null;
      }
      default:
        return null;
    }
  }

  private async compute(
    kind: WidgetKind,
    from: Date,
    to: Date,
    fromIso: string,
    toIso: string,
    v?: string,
  ): Promise<Computed> {
    const byVehicle = v ? { vehicleId: v } : {};
    switch (kind) {
      case 'mkbf': {
        const r = await this.metrics.mkbf(from, to, v);
        return {
          value: r.mkbf,
          detail: `${fmtInt(r.kmTraveled)} km ÷ ${fmtInt(r.unscheduledReturns)} quebras`,
        };
      }
      case 'breakdowns': {
        const r = await this.metrics.mkbf(from, to, v);
        return { value: r.unscheduledReturns, detail: `${fmtInt(r.kmTraveled)} km rodados` };
      }
      case 'km': {
        const r = await this.metrics.mkbf(from, to, v);
        return { value: r.kmTraveled, detail: `${fmtInt(r.unscheduledReturns)} quebras` };
      }
      case 'availability': {
        const r = await this.metrics.availability(from, to, v);
        return {
          value: r === null ? null : r * 100,
          detail: v
            ? 'horas sem OS aberta ÷ horas do período'
            : 'carros prontos ÷ frota, amostrado a cada 6 h',
        };
      }
      case 'lostTrips':
      case 'tripsDone': {
        if (v) {
          // Por carro, as viagens perdidas vêm das fichas; o cumprimento é da linha, não do carro.
          if (kind === 'tripsDone') return { value: null, detail: 'disponível só para a frota' };
          const agg = await this.prisma.failureEvent.aggregate({
            where: { vehicleId: v, reportedAt: { gte: from, lte: to } },
            _sum: { lostTrips: true },
          });
          return { value: agg._sum.lostTrips ?? 0, detail: 'somadas das fichas do carro' };
        }
        const agg = await this.prisma.lineTripDay.aggregate({
          where: {
            date: { gte: new Date(`${fromIso}T00:00:00Z`), lte: new Date(`${toIso}T00:00:00Z`) },
          },
          _sum: { planned: true, lost: true },
        });
        const planned = agg._sum.planned ?? 0;
        const lost = agg._sum.lost ?? 0;
        if (planned === 0) return { value: null, detail: null };
        const pct = ((planned - lost) / planned) * 100;
        return kind === 'lostTrips'
          ? {
              value: lost,
              detail: `${fmtInt(planned)} programadas · ${fmtPct(100 - pct)} perdidas`,
            }
          : { value: pct, detail: `${fmtInt(planned - lost)} de ${fmtInt(planned)} viagens` };
      }
      case 'downtime': {
        const r = await this.metrics.releasedWorkOrders(from, to, v);
        return { value: r.averageMinutes, detail: `${fmtInt(r.count)} OS liberadas` };
      }
      case 'woReleased': {
        const r = await this.metrics.releasedWorkOrders(from, to, v);
        return {
          value: r.count,
          detail:
            r.averageMinutes === null
              ? null
              : `média de ${Math.round(r.averageMinutes / 60)} h parado por OS`,
        };
      }
      case 'woOpened': {
        // OS abertas no sistema + fichas/OS do histórico importado (que não passam pelo fluxo do app).
        const [n, imported] = await Promise.all([
          this.prisma.workOrder.count({
            where: {
              openedAt: { gte: from, lte: to },
              status: { not: WorkOrderStatus.CANCELLED },
              ...byVehicle,
            },
          }),
          this.prisma.maintenanceRecord.count({ where: { openedAt: { gte: from, lte: to }, ...byVehicle } }),
        ]);
        return { value: n + imported, detail: imported > 0 && n === 0 ? 'fichas e OS do histórico' : null };
      }
      case 'rescues': {
        // Atendimentos despachados pelo sistema + socorros do histórico importado (ficha de
        // socorro ou chamado SOS do CCO), que não passam pelo fluxo de despacho.
        const [dispatched, imported, field] = await Promise.all([
          this.prisma.fieldService.count({
            where: {
              dispatchedAt: { gte: from, lte: to },
              ...(v ? { event: { vehicleId: v } } : {}),
            },
          }),
          this.prisma.failureEvent.count({ where: importedRescueWhere(from, to, v) }),
          this.metrics.fieldResolution(from, to, v),
        ]);
        return {
          value: dispatched + imported,
          detail:
            field.rate !== null
              ? `${fmtPct(field.rate * 100)} resolvidos na rua`
              : imported > 0
                ? 'fichas de socorro e chamados SOS'
                : null,
        };
      }
      case 'fieldResolution': {
        const r = await this.metrics.fieldResolution(from, to, v);
        return {
          value: r.rate === null ? null : r.rate * 100,
          detail: `${fmtInt(r.resolvedInField)} de ${fmtInt(r.total)} socorros`,
        };
      }
      case 'triageSla': {
        const r = await this.metrics.triageSla(from, to, v);
        return {
          value: r.medianSeconds === null ? null : r.medianSeconds / 60,
          detail: r.count
            ? `${fmtInt(r.count)} triagens${r.p90Seconds === null ? '' : ` · p90 ${fmtInt(r.p90Seconds / 60)} min`}`
            : null,
        };
      }
      case 'rework': {
        const r = await this.metrics.internalRework(from, to, v);
        return {
          value: r.rate === null ? null : r.rate * 100,
          detail: `${fmtInt(r.rejections)} reprovações em ${fmtInt(r.inspections)} inspeções`,
        };
      }
      case 'consumptionDiesel':
      case 'consumptionEbus': {
        const energy =
          kind === 'consumptionDiesel' ? VehicleTechnology.DIESEL : VehicleTechnology.EBUS;
        if (v) {
          try {
            const d = await this.consumption.vehicle(v, { from: fromIso, to: toIso });
            return {
              value: d.current.ratio,
              detail: `${fmtInt(d.current.days)} dias com abastecimento`,
            };
          } catch {
            return { value: null, detail: null };
          }
        }
        const r = await this.board.consumptionSummary(energy, fromIso, toIso);
        return {
          value: r?.ratio ?? null,
          detail: r ? `${fmtInt(r.vehicles)} carros · ${fmtInt(r.high)} acima da faixa` : null,
        };
      }
      case 'topFailures': {
        // O número da frente é a falha que mais derrubou carro; o ranking inteiro vem da rota top-failures.
        const rows = await this.prisma.failureEvent.findMany({
          where: {
            isUnscheduledReturn: true,
            status: { not: EventStatus.CANCELLED },
            reportedAt: { gte: from, lte: to },
            ...byVehicle,
          },
          select: { ccoDefect: true, catalogItem: { select: { description: true } } },
        });
        if (rows.length === 0) return { value: null, detail: null };
        const counts = new Map<string, number>();
        for (const r of rows) {
          const name = (r.ccoDefect ?? r.catalogItem?.description ?? '').trim();
          if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
        if (!top) return { value: null, detail: `${fmtInt(rows.length)} quebras sem classificação` };
        return {
          value: top[1],
          detail: `${top[0]} · ${fmtPct((top[1] / rows.length) * 100)} de ${fmtInt(rows.length)} quebras`,
        };
      }
    }
  }

  // --- A série do período -----------------------------------------------------

  /**
   * O gráfico do widget. O eixo segue o tamanho do período (hora, dia, mês) e
   * cada indicador tem o jeito mais barato de ser somado por ponto: as
   * contagens vêm de uma consulta só e são repartidas aqui; o MKBF por dia vem
   * do quadro mensal; o que não tem como ser quebrado em pontos fica sem série.
   */
  /** A série do período; um dia só num indicador sem leitura por hora mostra os 7 dias até ele, por dia. */
  private async series(kind: WidgetKind, fromIso: string, toIso: string, v?: string): Promise<WidgetSeries | null> {
    const s = await this.seriesFor(kind, fromIso, toIso, v);
    if (!s && fromIso === toIso) return this.seriesFor(kind, addDaysIso(toIso, -6), toIso, v);
    return s;
  }

  private async seriesFor(kind: WidgetKind, fromIso: string, toIso: string, v?: string): Promise<WidgetSeries | null> {
    if (kind === 'topFailures') return null;
    const now = new Date();
    const days = Math.round((startOfDay(toIso).getTime() - startOfDay(fromIso).getTime()) / DAY_MS) + 1;
    let bucket: WidgetBucket = days === 1 ? 'hour' : days <= 92 ? 'day' : 'month';
    // Consumo por dia é uma conta pesada (frota inteira, dia a dia): acima de um mês, vai por mês.
    if ((kind === 'consumptionDiesel' || kind === 'consumptionEbus') && bucket === 'day' && days > 31) bucket = 'month';
    const buckets = makeBuckets(bucket, fromIso, toIso, now);
    // Ponto que ainda não chegou (hora futura de hoje) fica em branco, não em zero.
    const blankFuture = (points: WidgetSeriesPoint[]) =>
      points.map((p, i) => ((buckets[i]?.start ?? now) > now ? { ...p, value: null } : p));
    const pack = (points: WidgetSeriesPoint[]): WidgetSeries => ({ bucket, points: blankFuture(points) });
    const from = startOfDay(fromIso);
    const to = endOfDay(toIso);
    const byVehicle = v ? { vehicleId: v } : {};
    const keyOf = (d: Date) => bucketKey(bucket, d);

    switch (kind) {
      case 'mkbf':
      case 'km':
      case 'breakdowns': {
        if (bucket === 'hour') {
          if (kind !== 'breakdowns') return null;
          const rows = await this.prisma.failureEvent.findMany({
            where: { isUnscheduledReturn: true, reportedAt: { gte: from, lte: to }, ...byVehicle },
            select: { reportedAt: true },
          });
          return pack(countBy(buckets, rows.map((r) => keyOf(r.reportedAt))));
        }
        if (bucket === 'month') {
          const points = await Promise.all(
            buckets.map(async (b) => {
              const r = await this.metrics.mkbf(b.start, b.end, v);
              return pointOf(kind, b.key, r.kmTraveled, r.unscheduledReturns);
            }),
          );
          return pack(points);
        }
        // Por dia: a frota vem do quadro mensal (km e quebras já somados por dia); um carro, das leituras dele.
        const daysMap = new Map<string, { km: number; failures: number }>();
        if (v) {
          const [readings, events] = await Promise.all([
            this.prisma.odometerReading.findMany({
              where: { vehicleId: v, readAt: { gte: from, lte: to }, status: { not: OdometerStatus.REJECTED }, deltaKm: { gt: 0 } },
              select: { readAt: true, deltaKm: true },
            }),
            this.prisma.failureEvent.findMany({
              where: { vehicleId: v, isUnscheduledReturn: true, reportedAt: { gte: from, lte: to } },
              select: { reportedAt: true },
            }),
          ]);
          for (const r of readings) {
            const k = isoDay(r.readAt);
            const cur = daysMap.get(k) ?? { km: 0, failures: 0 };
            daysMap.set(k, { km: cur.km + Number(r.deltaKm), failures: cur.failures });
          }
          for (const e of events) {
            const k = isoDay(e.reportedAt);
            const cur = daysMap.get(k) ?? { km: 0, failures: 0 };
            daysMap.set(k, { km: cur.km, failures: cur.failures + 1 });
          }
        } else {
          for (let m = fromIso.slice(0, 7); m <= toIso.slice(0, 7); m = shiftMonth(m, 1)) {
            const board = await this.board.board(m).catch(() => null);
            for (const d of board?.days ?? []) if (!d.empty) daysMap.set(d.date, { km: d.km, failures: d.failures });
          }
        }
        return pack(
          buckets.map((b) => {
            const row = daysMap.get(b.key);
            return row ? pointOf(kind, b.key, row.km, row.failures) : { key: b.key, value: null };
          }),
        );
      }
      case 'availability': {
        if (bucket === 'hour') {
          if (v) return null;
          const h = await this.dashboard.availabilityHours({ from: addDaysIso(fromIso, -29), to: toIso, day: toIso });
          return pack(buckets.map((b, i) => ({ key: b.key, value: h.hours[i]?.today === null || h.hours[i]?.today === undefined ? null : Math.round((h.hours[i]!.today as number) * 1000) / 10 })));
        }
        if (bucket === 'day') {
          const d = await this.dashboard.availabilityDays({ from: fromIso, to: toIso }, v);
          const byDate = new Map(d.points.map((p) => [p.date, p.rate]));
          return pack(buckets.map((b) => ({ key: b.key, value: byDate.has(b.key) ? Math.round((byDate.get(b.key) as number) * 1000) / 10 : null })));
        }
        const points = await Promise.all(
          buckets.map(async (b) => {
            const r = await this.metrics.availability(b.start, b.end, v);
            return { key: b.key, value: r === null ? null : Math.round(r * 1000) / 10 };
          }),
        );
        return pack(points);
      }
      case 'lostTrips':
      case 'tripsDone': {
        if (bucket === 'hour') return null;
        if (v) {
          if (kind === 'tripsDone') return null;
          const rows = await this.prisma.failureEvent.findMany({
            where: { vehicleId: v, reportedAt: { gte: from, lte: to } },
            select: { reportedAt: true, lostTrips: true },
          });
          return pack(sumBy(buckets, rows.map((r) => [keyOf(r.reportedAt), r.lostTrips ?? 0])));
        }
        const rows = await this.prisma.lineTripDay.findMany({
          where: { date: { gte: new Date(`${fromIso}T00:00:00Z`), lte: new Date(`${toIso}T00:00:00Z`) } },
          select: { date: true, planned: true, lost: true },
        });
        const acc = new Map<string, { planned: number; lost: number }>();
        for (const r of rows) {
          const k = bucketKeyIso(bucket, r.date.toISOString().slice(0, 10));
          const cur = acc.get(k) ?? { planned: 0, lost: 0 };
          acc.set(k, { planned: cur.planned + r.planned, lost: cur.lost + r.lost });
        }
        return pack(
          buckets.map((b): WidgetSeriesPoint => {
            const a = acc.get(b.key);
            if (!a || a.planned === 0) return { key: b.key, value: null };
            const aux = { planned: a.planned, lost: a.lost };
            return kind === 'lostTrips'
              ? { key: b.key, value: a.lost, aux }
              : { key: b.key, value: Math.round(((a.planned - a.lost) / a.planned) * 1000) / 10, aux };
          }),
        );
      }
      case 'downtime':
      case 'woReleased': {
        const rows = await this.prisma.workOrder.findMany({
          where: { status: WorkOrderStatus.RELEASED, releasedAt: { gte: from, lte: to }, ...byVehicle },
          select: { releasedAt: true, downtimeMinutes: true },
        });
        const acc = new Map<string, { n: number; minutes: number }>();
        for (const r of rows) {
          const k = keyOf(r.releasedAt as Date);
          const cur = acc.get(k) ?? { n: 0, minutes: 0 };
          acc.set(k, { n: cur.n + 1, minutes: cur.minutes + (r.downtimeMinutes ?? 0) });
        }
        return pack(
          buckets.map((b) => {
            const a = acc.get(b.key);
            if (kind === 'woReleased') return { key: b.key, value: a?.n ?? 0 };
            return a ? { key: b.key, value: Math.round(a.minutes / a.n), aux: { workOrders: a.n } } : { key: b.key, value: null };
          }),
        );
      }
      case 'woOpened': {
        const [rows, imported] = await Promise.all([
          this.prisma.workOrder.findMany({
            where: { openedAt: { gte: from, lte: to }, status: { not: WorkOrderStatus.CANCELLED }, ...byVehicle },
            select: { openedAt: true },
          }),
          this.prisma.maintenanceRecord.findMany({ where: { openedAt: { gte: from, lte: to }, ...byVehicle }, select: { openedAt: true } }),
        ]);
        return pack(countBy(buckets, [...rows, ...imported].map((r) => keyOf(r.openedAt))));
      }
      case 'rescues':
      case 'fieldResolution': {
        const rows = await this.prisma.fieldService.findMany({
          where: { dispatchedAt: { gte: from, lte: to }, ...(v ? { event: { vehicleId: v } } : {}) },
          select: { dispatchedAt: true, outcome: true },
        });
        if (kind === 'rescues') {
          const imported = await this.prisma.failureEvent.findMany({ where: importedRescueWhere(from, to, v), select: { reportedAt: true } });
          return pack(countBy(buckets, [...rows.map((r) => keyOf(r.dispatchedAt)), ...imported.map((r) => keyOf(r.reportedAt))]));
        }
        const acc = new Map<string, { total: number; field: number }>();
        for (const r of rows) {
          if (!r.outcome) continue;
          const k = keyOf(r.dispatchedAt);
          const cur = acc.get(k) ?? { total: 0, field: 0 };
          acc.set(k, { total: cur.total + 1, field: cur.field + (r.outcome === FieldOutcome.RESOLVED_IN_FIELD ? 1 : 0) });
        }
        return pack(
          buckets.map((b) => {
            const a = acc.get(b.key);
            return a ? { key: b.key, value: Math.round((a.field / a.total) * 1000) / 10, aux: { total: a.total } } : { key: b.key, value: null };
          }),
        );
      }
      case 'triageSla': {
        const rows = await this.prisma.triage.findMany({
          where: { decidedAt: { gte: from, lte: to }, ...(v ? { event: { vehicleId: v } } : {}) },
          select: { decidedAt: true, slaSeconds: true },
        });
        const acc = new Map<string, number[]>();
        for (const r of rows) {
          if (!r.decidedAt) continue;
          const k = keyOf(r.decidedAt);
          acc.set(k, [...(acc.get(k) ?? []), r.slaSeconds]);
        }
        return pack(
          buckets.map((b) => {
            const vals = acc.get(b.key);
            const med = vals ? median(vals) : null;
            return { key: b.key, value: med === null ? null : Math.round((med / 60) * 10) / 10, aux: vals ? { triages: vals.length } : undefined };
          }),
        );
      }
      case 'rework': {
        const rows = await this.prisma.inspection.findMany({
          where: { inspectedAt: { gte: from, lte: to }, ...(v ? { task: { workOrder: { vehicleId: v } } } : {}) },
          select: { inspectedAt: true, result: true },
        });
        const acc = new Map<string, { n: number; rejected: number }>();
        for (const r of rows) {
          const k = keyOf(r.inspectedAt);
          const cur = acc.get(k) ?? { n: 0, rejected: 0 };
          acc.set(k, { n: cur.n + 1, rejected: cur.rejected + (r.result === InspectionResult.REJECTED ? 1 : 0) });
        }
        return pack(
          buckets.map((b) => {
            const a = acc.get(b.key);
            return a ? { key: b.key, value: Math.round((a.rejected / a.n) * 1000) / 10, aux: { inspections: a.n } } : { key: b.key, value: null };
          }),
        );
      }
      case 'consumptionDiesel':
      case 'consumptionEbus': {
        if (bucket === 'hour') return null;
        const energy = kind === 'consumptionDiesel' ? VehicleTechnology.DIESEL : VehicleTechnology.EBUS;
        const points = await Promise.all(
          buckets.map(async (b) => {
            if (v) {
              const d = await this.consumption.vehicle(v, { from: b.fromIso, to: b.toIso }).catch(() => null);
              return { key: b.key, value: d?.current.ratio ?? null };
            }
            const r = await this.board.consumptionSummary(energy, b.fromIso, b.toIso);
            return { key: b.key, value: r?.ratio ?? null };
          }),
        );
        return pack(points);
      }
    }
  }
}

/** MKBF, km ou quebras de um ponto a partir de km e quebras somados nele. */
function pointOf(kind: 'mkbf' | 'km' | 'breakdowns', key: string, km: number, failures: number): WidgetSeriesPoint {
  const aux = { km: Math.round(km), failures };
  if (kind === 'km') return { key, value: Math.round(km), aux };
  if (kind === 'breakdowns') return { key, value: failures, aux };
  return { key, value: failures > 0 && km > 0 ? Math.round(km / failures) : null, aux };
}

/** Socorros do histórico importado: ficha de tipo S (socorro) ou chamado do grupo SOS no CCO. */
function importedRescueWhere(from: Date, to: Date, vehicleId?: string): Prisma.FailureEventWhereInput {
  return {
    isImported: true,
    status: { not: EventStatus.CANCELLED },
    reportedAt: { gte: from, lte: to },
    OR: [{ fichaKind: 'S' }, { ccoGroup: 'SOS' }],
    ...(vehicleId ? { vehicleId } : {}),
  };
}

function countBy(buckets: Bucket[], keys: string[]): WidgetSeriesPoint[] {
  const acc = new Map<string, number>();
  for (const k of keys) acc.set(k, (acc.get(k) ?? 0) + 1);
  return buckets.map((b) => ({ key: b.key, value: acc.get(b.key) ?? 0 }));
}

function sumBy(buckets: Bucket[], pairs: [string, number][]): WidgetSeriesPoint[] {
  const acc = new Map<string, number>();
  for (const [k, n] of pairs) acc.set(k, (acc.get(k) ?? 0) + n);
  return buckets.map((b) => ({ key: b.key, value: acc.get(b.key) ?? 0 }));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Os pontos do eixo, cada um com a janela que cobre, recortada no período pedido. */
function makeBuckets(bucket: WidgetBucket, fromIso: string, toIso: string, now: Date): Bucket[] {
  const out: Bucket[] = [];
  if (bucket === 'hour') {
    for (let h = 0; h < 24; h += 1) {
      const start = startOfDay(fromIso);
      start.setHours(h, 0, 0, 0);
      const end = new Date(start.getTime() + 3_600_000 - 1);
      out.push({ key: String(h).padStart(2, '0'), start, end, fromIso, toIso: fromIso });
    }
    return out;
  }
  if (bucket === 'day') {
    for (let d = fromIso; d <= toIso; d = addDaysIso(d, 1)) out.push({ key: d, start: startOfDay(d), end: endOfDay(d), fromIso: d, toIso: d });
    return out;
  }
  for (let m = fromIso.slice(0, 7); m <= toIso.slice(0, 7); m = shiftMonth(m, 1)) {
    const [y, mm] = m.split('-').map(Number) as [number, number];
    const first = isoDay(new Date(y, mm - 1, 1));
    const last = isoDay(new Date(y, mm, 0));
    const a = first < fromIso ? fromIso : first;
    const b = last > toIso ? toIso : last;
    const end = endOfDay(b);
    out.push({ key: m, start: startOfDay(a), end: end > now ? now : end, fromIso: a, toIso: b });
  }
  return out;
}

function bucketKey(bucket: WidgetBucket, d: Date): string {
  if (bucket === 'hour') return String(d.getHours()).padStart(2, '0');
  return bucketKeyIso(bucket, isoDay(d));
}
function bucketKeyIso(bucket: WidgetBucket, iso: string): string {
  return bucket === 'month' ? iso.slice(0, 7) : iso;
}
function shiftMonth(m: string, n: number): string {
  const [y, mm] = m.split('-').map(Number) as [number, number];
  const d = new Date(y, mm - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function startOfDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}
function endOfDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return isoDay(new Date(y, m - 1, d + n));
}
