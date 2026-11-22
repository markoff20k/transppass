import { Injectable } from '@nestjs/common';
import { OdometerStatus, VehicleTechnology } from '@prisma/client';
import {
  BOARD_INDICATORS,
  BoardIndicator,
  ConsumptionFlag,
  type BoardConsumption,
  type BoardDay,
  type BoardDayDetail,
  type BoardFleet,
  type BoardHistoryPoint,
  type BoardInsight,
  type BoardTotals,
  type BoardTrips,
  type IndicatorTarget,
  type IndicatorTargetInput,
  type MetricsBoard,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ConsumptionService } from '../consumption/consumption.service';
import { addDays, isoDay } from '../consumption/consumption.calc';
import { holidayName } from './calendar';

/**
 * Quadro de acompanhamento diário dos indicadores — o quadro branco da
 * garagem ("Acompanhamento diário dos indicadores") lido das planilhas do
 * ERP-JB, em vez de escrito à mão:
 *
 *  - Cumprimento de frota (ICF): tabelas (linha × tabela) que tiveram carro no
 *    dia ÷ tabelas programadas. A programação ainda não vem do cliente
 *    (PEDIDOS-ALIS, item 13); até lá o programado do dia é o máximo coberto no
 *    mês no mesmo tipo de dia (útil, sábado, domingo), marcado como estimado.
 *  - Quebras (IQF): fichas A/S/T do dia — o mesmo denominador do MKBF.
 *  - MKBF acumulado no mês até o dia: km da frota ÷ quebras, do dia 1 ao dia.
 *  - Cumprimento de viagens (ICV): (programadas − perdidas) ÷ programadas, da
 *    planilha de viagens (SPTrans), por dia.
 *  - Consumo (km/l, kWh/km): só a leitura mensal, de ConsumptionService.
 *
 * Mês fechado não muda até a próxima carga: fica em cache por 6 h.
 */
const CLOSED_TTL_MS = 6 * 3_600_000;
const OPEN_TTL_MS = 60_000;
const TARGET_PREFIX = 'indicator.target.';

type DayType = 'weekday' | 'saturday' | 'sunday';
const dayTypeOf = (weekday: number): DayType => (weekday === 0 ? 'sunday' : weekday === 6 ? 'saturday' : 'weekday');

interface MonthCore {
  month: string;
  from: string;
  to: string;
  days: BoardDay[];
  totals: BoardTotals;
  lastDataDate: string | null;
}

@Injectable()
export class BoardService {
  private readonly monthCache = new Map<string, { at: number; value: MonthCore }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly consumption: ConsumptionService,
  ) {}

  async board(month?: string): Promise<MetricsBoard> {
    const today = isoDay(new Date());
    const key = month ?? today.slice(0, 7);
    const prevKey = shiftMonth(key, -1);
    const [core, prev, targets, history] = await Promise.all([this.monthCore(key), this.monthCore(prevKey), this.targets(), this.history(key, 12)]);
    const [diesel, ebus, worstLines] = await Promise.all([
      this.consumptionSummary(VehicleTechnology.DIESEL, core.from, core.to),
      this.consumptionSummary(VehicleTechnology.EBUS, core.from, core.to),
      this.worstLines(core.from, core.to),
    ]);
    const insights = buildInsights(core, prev, prevKey, history, { diesel, ebus }, worstLines, today);
    return {
      month: key,
      from: core.from,
      to: core.to,
      lastDataDate: core.lastDataDate,
      days: core.days,
      totals: core.totals,
      previous: prev.totals,
      previousMonth: prevKey,
      history,
      consumption: { diesel, ebus },
      targets,
      insights,
      worstLines,
    };
  }

  /** As cinco linhas com mais viagens perdidas no período. */
  private async worstLines(from: string, to: string): Promise<MetricsBoard['worstLines']> {
    const rows = await this.prisma.lineTripDay.groupBy({ by: ['line'], where: { date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, _sum: { planned: true, lost: true } });
    return rows
      .map((r) => ({ line: r.line, planned: r._sum.planned ?? 0, lost: r._sum.lost ?? 0 }))
      .map((r) => ({ ...r, pct: r.planned > 0 ? round1(((r.planned - r.lost) / r.planned) * 100) : null }))
      .sort((a, b) => b.lost - a.lost || a.line.localeCompare(b.line))
      .slice(0, 5);
  }

  /** O dia aberto: quebras, linhas com viagem perdida e a frota coberta. */
  async day(date: string): Promise<BoardDayDetail> {
    const core = await this.monthCore(date.slice(0, 7));
    const day = core.days.find((d) => d.date === date);
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${addDays(date, 1)}T00:00:00`);
    const [events, trips] = await Promise.all([
      this.prisma.failureEvent.findMany({
        where: { reportedAt: { gte: dayStart, lt: dayEnd }, isUnscheduledReturn: true, vehicle: { application: 'FROTA' } },
        select: { id: true, code: true, vehicleId: true, lineCode: true, fichaKind: true, ccoDefect: true, reportedDescription: true, reportedAt: true, vehicle: { select: { code: true } } },
        orderBy: { reportedAt: 'asc' },
      }),
      this.prisma.lineTripDay.groupBy({ by: ['line'], where: { date: new Date(`${date}T00:00:00Z`) }, _sum: { planned: true, lost: true } }),
    ]);
    const lines = trips
      .map((t) => ({ line: t.line, planned: t._sum.planned ?? 0, lost: t._sum.lost ?? 0 }))
      .map((t) => ({ ...t, pct: t.planned > 0 ? round1(((t.planned - t.lost) / t.planned) * 100) : null }))
      .sort((a, b) => b.lost - a.lost || a.line.localeCompare(b.line));
    const planned = lines.reduce((s, l) => s + l.planned, 0);
    const lost = lines.reduce((s, l) => s + l.lost, 0);
    return {
      date,
      holiday: holidayName(date),
      fleet: day?.fleet ?? { covered: 0, programmed: null, estimated: true, vehicles: 0, scheduled: 0, pct: null, note: null },
      failures: events.map((e) => ({ id: e.id, code: e.code, vehicleId: e.vehicleId, vehicleCode: e.vehicle.code, line: e.lineCode, fichaKind: e.fichaKind, defect: e.ccoDefect ?? e.reportedDescription?.slice(0, 80) ?? null, reportedAt: e.reportedAt.toISOString() })),
      trips: lines,
      tripsTotal: { planned, lost, pct: planned > 0 ? round1(((planned - lost) / planned) * 100) : null },
    };
  }

  async targets(): Promise<Record<BoardIndicator, IndicatorTarget>> {
    const rows = await this.prisma.appSetting.findMany({ where: { key: { startsWith: TARGET_PREFIX } } }).catch(() => []);
    const out = {} as Record<BoardIndicator, IndicatorTarget>;
    for (const k of Object.keys(BOARD_INDICATORS) as BoardIndicator[]) {
      const row = rows.find((r) => r.key === `${TARGET_PREFIX}${k}`);
      let parsed: Partial<IndicatorTarget> = {};
      if (row) {
        try {
          parsed = JSON.parse(row.value) as Partial<IndicatorTarget>;
        } catch {
          parsed = {};
        }
      }
      out[k] = { key: k, target: typeof parsed.target === 'number' ? parsed.target : null, responsible: typeof parsed.responsible === 'string' && parsed.responsible ? parsed.responsible : null };
    }
    return out;
  }

  async setTarget(key: BoardIndicator, input: IndicatorTargetInput, userId: string): Promise<IndicatorTarget> {
    const value = JSON.stringify({ target: input.target, responsible: input.responsible?.trim() || null });
    await this.prisma.appSetting.upsert({ where: { key: `${TARGET_PREFIX}${key}` }, update: { value, updatedBy: userId }, create: { key: `${TARGET_PREFIX}${key}`, value, updatedBy: userId } });
    return { key, target: input.target, responsible: input.responsible?.trim() || null };
  }

  // --- um mês ------------------------------------------------------------------------

  /**
   * `withPrevious`: o mês anterior entra como referência da frota programada
   * (um domingo só no mês não tem com quem se comparar). O anterior é
   * calculado sem o dele, para a recursão parar em um nível.
   */
  private async monthCore(month: string, withPrevious = true): Promise<MonthCore> {
    const today = isoDay(new Date());
    const from = `${month}-01`;
    const last = lastDayOf(month);
    const to = last > today ? today : last;
    const cacheKey = `${month}|${withPrevious ? 'p' : '-'}`;
    const hit = this.monthCache.get(cacheKey);
    const ttl = last < today ? CLOSED_TTL_MS : OPEN_TTL_MS;
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    if (from > today) {
      const empty: MonthCore = { month, from, to: from, days: [], totals: emptyTotals(), lastDataDate: null };
      return empty;
    }
    const previous = withPrevious ? await this.monthCore(shiftMonth(month, -1), false) : null;

    const dayStart = new Date(`${from}T00:00:00`);
    const dayEnd = new Date(`${addDays(to, 1)}T00:00:00`);
    const [events, readings, lineDays, trips] = await Promise.all([
      this.prisma.failureEvent.findMany({ where: { reportedAt: { gte: dayStart, lt: dayEnd }, isUnscheduledReturn: true, vehicle: { application: 'FROTA' } }, select: { reportedAt: true } }),
      this.prisma.odometerReading.findMany({ where: { readAt: { gte: dayStart, lt: dayEnd }, status: { not: OdometerStatus.REJECTED }, deltaKm: { gt: 0 }, vehicle: { application: 'FROTA' } }, select: { readAt: true, deltaKm: true } }),
      this.prisma.vehicleLineDay.groupBy({ by: ['date', 'line', 'table'], where: { date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }, OR: [{ kmInLine: { gt: 0 } }, { trips: { gt: 0 } }] }, _count: { vehicleId: true } }),
      this.prisma.lineTripDay.groupBy({ by: ['date'], where: { date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, _sum: { planned: true, lost: true } }),
    ]);
    const [vehiclesByDay, scheduledByDay] = await Promise.all([
      this.prisma.vehicleLineDay.groupBy({ by: ['date', 'vehicleId'], where: { date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }, OR: [{ kmInLine: { gt: 0 } }, { trips: { gt: 0 } }] } }),
      this.prisma.vehicleLineDay.groupBy({ by: ['date', 'vehicleId'], where: { date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } } }),
    ]);

    const failures = new Map<string, number>();
    for (const e of events) bump(failures, isoDay(e.reportedAt), 1);
    const km = new Map<string, number>();
    for (const r of readings) bump(km, isoDay(r.readAt), r.deltaKm ?? 0);
    // Tabelas cobertas: linha × tabela com carro; sem tabela na planilha, conta o carro.
    const covered = new Map<string, number>();
    for (const r of lineDays) bump(covered, r.date.toISOString().slice(0, 10), r.table ? 1 : r._count.vehicleId);
    const vehicles = new Map<string, number>();
    for (const r of vehiclesByDay) bump(vehicles, r.date.toISOString().slice(0, 10), 1);
    const scheduled = new Map<string, number>();
    for (const r of scheduledByDay) bump(scheduled, r.date.toISOString().slice(0, 10), 1);
    const planned = new Map<string, number>();
    const lost = new Map<string, number>();
    for (const t of trips) {
      const d = t.date.toISOString().slice(0, 10);
      planned.set(d, t._sum.planned ?? 0);
      lost.set(d, t._sum.lost ?? 0);
    }

    // Programado estimado: o máximo coberto entre os dias comparáveis — mesmo tipo de dia (útil, sábado, domingo)
    // e viagens programadas parecidas (±10%), neste mês e no anterior. As viagens programadas identificam a tabela
    // do dia: feriado, eleição e domingo com tabela de dia útil não se comparam com um domingo comum. Dia sem
    // nenhum comparável fica sem programado (e sem percentual) em vez de ganhar um número falso.
    type Ref = { type: DayType; planned: number; covered: number };
    const refs: Ref[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const c = covered.get(d) ?? 0;
      if (c > 0) refs.push({ type: dayTypeOf(weekdayOf(d)), planned: planned.get(d) ?? 0, covered: c });
    }
    for (const pd of previous?.days ?? []) if (pd.fleet.covered > 0) refs.push({ type: dayTypeOf(pd.weekday), planned: pd.trips.planned, covered: pd.fleet.covered });
    const programmedFor = (type: DayType, dayPlanned: number, dayCovered: number): number | null => {
      const peers = refs.filter((r) => r.type === type && (dayPlanned === 0 || r.planned === 0 || Math.abs(r.planned - dayPlanned) <= dayPlanned * 0.1));
      // Só o próprio dia não é referência: precisa de ao menos um outro dia comparável.
      if (peers.length < 2) return null;
      return Math.max(dayCovered, ...peers.map((r) => r.covered));
    };

    const days: BoardDay[] = [];
    let failuresToDate = 0;
    let kmToDate = 0;
    let lastDataDate: string | null = null;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const weekday = weekdayOf(d);
      const dayKm = Math.round(km.get(d) ?? 0);
      const dayCovered = covered.get(d) ?? 0;
      const dayPlanned = planned.get(d) ?? 0;
      const dayLost = lost.get(d) ?? 0;
      const empty = dayKm === 0 && dayCovered === 0 && dayPlanned === 0 && (scheduled.get(d) ?? 0) === 0;
      if (!empty) lastDataDate = d;
      const f = failures.get(d) ?? 0;
      failuresToDate += f;
      kmToDate += dayKm;
      const programmed = empty || dayCovered === 0 ? null : programmedFor(dayTypeOf(weekday), dayPlanned, dayCovered);
      days.push({
        date: d,
        weekday,
        holiday: holidayName(d),
        empty,
        fleet: { covered: dayCovered, programmed, estimated: true, vehicles: vehicles.get(d) ?? 0, scheduled: scheduled.get(d) ?? 0, pct: programmed ? round1(Math.min(100, (dayCovered / programmed) * 100)) : null, note: !empty && dayCovered > 0 && programmed === null ? 'no-reference' : null },
        failures: f,
        km: dayKm,
        failuresToDate,
        kmToDate,
        mkbfToDate: failuresToDate > 0 ? Math.round(kmToDate / failuresToDate) : null,
        trips: { planned: dayPlanned, lost: dayLost, pct: dayPlanned > 0 ? round1(((dayPlanned - dayLost) / dayPlanned) * 100) : null },
      });
    }

    const withData = days.filter((d) => !d.empty);
    // Planilha carro-linha-dia incompleta: carros escalados mas poucos com km em linha, enquanto as viagens
    // perdidas ficaram normais. Não é frota que faltou, é dado que faltou: o dia fica sem percentual.
    const tripPcts = withData.map((d) => d.trips.pct).filter((p): p is number => p !== null);
    const tripsTypical = tripPcts.length ? tripPcts.reduce((s, p) => s + p, 0) / tripPcts.length : null;
    for (const d of withData) {
      const f = d.fleet;
      const lowCoverage = f.scheduled > 0 && f.vehicles < f.scheduled * 0.5;
      const tripsNormal = d.trips.pct !== null && tripsTypical !== null && d.trips.pct >= tripsTypical - 3;
      if (lowCoverage && tripsNormal) {
        f.note = 'incomplete-sheet';
        f.pct = null;
        f.programmed = null;
      }
    }
    // O total só soma os dias que têm programado: dia sem comparável não entra nem no numerador.
    const withProgrammed = withData.filter((d) => d.fleet.programmed !== null);
    const coveredSum = withProgrammed.reduce((s, d) => s + d.fleet.covered, 0);
    const programmedSum = withProgrammed.reduce((s, d) => s + (d.fleet.programmed ?? 0), 0);
    const plannedSum = days.reduce((s, d) => s + d.trips.planned, 0);
    const lostSum = days.reduce((s, d) => s + d.trips.lost, 0);
    const totals: BoardTotals = {
      fleet: { covered: coveredSum, programmed: programmedSum || null, estimated: true, vehicles: Math.max(0, ...withData.map((d) => d.fleet.vehicles)), scheduled: Math.max(0, ...withData.map((d) => d.fleet.scheduled)), pct: programmedSum ? round1(Math.min(100, (coveredSum / programmedSum) * 100)) : null, note: null },
      failures: failuresToDate,
      km: kmToDate,
      mkbf: failuresToDate > 0 ? Math.round(kmToDate / failuresToDate) : null,
      trips: { planned: plannedSum, lost: lostSum, pct: plannedSum > 0 ? round1(((plannedSum - lostSum) / plannedSum) * 100) : null },
    };
    const value: MonthCore = { month, from, to, days, totals, lastDataDate };
    this.monthCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  /** Os últimos `n` meses até `month`, pelos totais de cada mês (cache por mês). */
  private async history(month: string, n: number): Promise<BoardHistoryPoint[]> {
    const months: string[] = [];
    for (let i = n - 1; i >= 0; i -= 1) months.push(shiftMonth(month, -i));
    const cores = await Promise.all(months.map((m) => this.monthCore(m)));
    return cores.map((c) => ({ month: c.month, fleetPct: c.totals.fleet.pct, failures: c.totals.failures, mkbf: c.totals.mkbf, tripsPct: c.totals.trips.pct }));
  }

  async consumptionSummary(energy: VehicleTechnology, from: string, to: string): Promise<BoardConsumption | null> {
    try {
      const f = await this.consumption.fleet({ energy, from, to, months: 12 });
      if (f.current.vehicles === 0) return null;
      return {
        ratio: f.current.ratio,
        previousRatio: f.previous.ratio,
        vehicles: f.current.vehicles,
        high: f.vehicles.filter((v) => v.flag === ConsumptionFlag.HIGH).length,
        watch: f.vehicles.filter((v) => v.flag === ConsumptionFlag.WATCH).length,
        from: f.from,
        to: f.to,
      };
    } catch {
      // Sem a tabela de consumo (base ainda sem carga) o painel segue sem o cartão.
      return null;
    }
  }
}

// --- leitura automática do mês ---------------------------------------------------------

const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS_PT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fmtMonth = (key: string) => MONTHS_PT[Number(key.slice(5, 7)) - 1]!;
const fmtInt = (n: number) => Math.round(n).toLocaleString('pt-BR');
const fmtPct = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const fmtRatio = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "+3,2%" / "−1,0%" entre dois valores; null quando não dá. */
function changePct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function buildInsights(
  core: MonthCore,
  prev: MonthCore,
  prevKey: string,
  history: BoardHistoryPoint[],
  consumption: { diesel: BoardConsumption | null; ebus: BoardConsumption | null },
  worstLines: MetricsBoard['worstLines'],
  today: string,
): BoardInsight[] {
  const out: BoardInsight[] = [];
  const days = core.days.filter((d) => !d.empty);
  if (days.length === 0) return out;
  const prevName = fmtMonth(prevKey);

  // Dados até quando.
  if (core.lastDataDate && core.lastDataDate < core.to) {
    out.push({ kind: 'data', tone: 'info', date: core.lastDataDate, title: `Dados até ${fmtDay(core.lastDataDate)}`, text: `As planilhas do ERP-JB cobrem o mês até ${fmtDay(core.lastDataDate)}; os dias seguintes ficam em branco até a próxima remessa.` });
  }

  // Dias atípicos: planilha incompleta, sem comparável, feriados.
  for (const d of days) {
    const f = d.fleet;
    const label = `${fmtDay(d.date)} (${WEEKDAYS_PT[d.weekday]}${d.holiday ? `, ${d.holiday}` : ''})`;
    if (f.note === 'incomplete-sheet') {
      out.push({ kind: 'day', tone: 'warn', date: d.date, title: `${label}: planilha carro-linha-dia incompleta`, text: `A planilha escala ${fmtInt(f.scheduled)} carros, mas só ${fmtInt(f.vehicles)} aparecem com km em linha, enquanto as viagens perdidas ficaram em ${d.trips.pct === null ? '—' : fmtPct(100 - d.trips.pct)} e o km da frota foi de ${fmtInt(d.km)} km. É dado que faltou, não frota: o cumprimento de frota do dia fica em branco.` });
    } else if (f.note === 'no-reference') {
      out.push({ kind: 'day', tone: 'info', date: d.date, title: `${label}: tabela especial`, text: `${fmtInt(f.covered)} tabelas cobertas por ${fmtInt(f.vehicles)} carros e ${fmtInt(d.trips.planned)} viagens programadas. Sem outro dia comparável neste mês ou no anterior, o cumprimento de frota fica em branco em vez de um número falso.` });
    } else if (d.holiday && f.pct !== null) {
      out.push({ kind: 'day', tone: 'info', date: d.date, title: `${label}: tabela de feriado`, text: `${fmtInt(d.trips.planned)} viagens programadas (${d.trips.pct === null ? '—' : fmtPct(d.trips.pct)} cumpridas), ${fmtInt(f.covered)} tabelas cobertas, cumprimento de frota ${fmtPct(f.pct)}.` });
    }
  }

  // Frota: pior dia real.
  const rated = days.filter((d) => d.fleet.pct !== null && d.fleet.note === null);
  if (rated.length >= 3 && core.totals.fleet.pct !== null) {
    const worst = rated.reduce((a, b) => ((b.fleet.pct as number) < (a.fleet.pct as number) ? b : a));
    if ((worst.fleet.pct as number) < core.totals.fleet.pct - 3) {
      const lastOfShipment = worst.date === core.lastDataDate && core.lastDataDate < lastDayOf(core.month);
      out.push({ kind: 'fleet', tone: 'warn', date: worst.date, title: `${fmtDay(worst.date)}: pior dia da frota, ${fmtPct(worst.fleet.pct as number)}`, text: `${fmtInt(worst.fleet.covered)} de ${fmtInt(worst.fleet.programmed ?? 0)} tabelas cobertas, contra ${fmtPct(core.totals.fleet.pct)} no mês.${lastOfShipment ? ' É o último dia da remessa e pode ter vindo incompleto.' : ''} A programação é estimada pelos dias comparáveis até o ERP-JB enviar a escala.` });
    }
  }

  // Quebras e MKBF.
  const f = core.totals.failures;
  const worstF = days.reduce((a, b) => (b.failures > a.failures ? b : a));
  const avgF = f / days.length;
  const prevDays = prev.days.filter((d) => !d.empty).length;
  const prevAvgF = prevDays > 0 ? prev.totals.failures / prevDays : null;
  // Mês parcial se compara por dia, não pelo total (18 dias contra 31 não dizem nada).
  const partial = core.lastDataDate !== null && core.lastDataDate < lastDayOf(core.month);
  const dF = partial ? changePct(avgF, prevAvgF) : changePct(f, prev.totals.failures || null);
  if (f > 0) {
    out.push({ kind: 'failures', tone: dF !== null && dF > 5 ? 'bad' : dF !== null && dF < -5 ? 'good' : 'info', date: worstF.date, title: `${fmtInt(f)} quebras${partial ? ` até ${fmtDay(core.lastDataDate as string)}` : ' no mês'}${dF !== null ? `, ${fmtPct(Math.abs(dF))} ${dF > 0 ? 'mais' : 'menos'}${partial ? ' por dia' : ''} que em ${prevName}` : ''}`, text: `Média de ${avgF.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} por dia${prevAvgF !== null ? ` (${prevAvgF.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} em ${prevName})` : ''}; o pior dia foi ${fmtDay(worstF.date)} (${WEEKDAYS_PT[worstF.weekday]}), com ${worstF.failures}.` });
  }
  const mk = core.totals.mkbf;
  const dM = changePct(mk, prev.totals.mkbf);
  const hist = history.map((h) => h.mkbf).filter((v): v is number => v !== null);
  const avgM = hist.length ? hist.reduce((s, v) => s + v, 0) / hist.length : null;
  if (mk !== null) {
    out.push({ kind: 'mkbf', tone: dM !== null && dM > 2 ? 'good' : dM !== null && dM < -2 ? 'bad' : 'info', date: null, title: `MKBF ${fmtInt(mk)} km${dM !== null ? `, ${dM > 0 ? 'melhorou' : 'piorou'} ${fmtPct(Math.abs(dM))} vs ${prevName}` : ''}`, text: `${fmtInt(core.totals.km)} km rodados ÷ ${fmtInt(f)} quebras.${avgM !== null ? ` Média dos últimos ${hist.length} meses: ${fmtInt(avgM)} km, o mês está ${mk >= avgM ? 'acima' : 'abaixo'}.` : ''}` });
  }

  // Viagens.
  const t = core.totals.trips;
  if (t.planned > 0 && t.pct !== null) {
    const worstT = days.filter((d) => d.trips.pct !== null).reduce((a, b) => ((b.trips.pct as number) < (a.trips.pct as number) ? b : a));
    const dT = t.pct - (prev.totals.trips.pct ?? t.pct);
    const top = worstLines[0];
    out.push({ kind: 'trips', tone: dT < -0.5 ? 'bad' : dT > 0.5 ? 'good' : 'info', date: worstT.date, title: `${fmtPct(t.pct)} das viagens cumpridas${prev.totals.trips.pct !== null ? ` (${fmtPct(prev.totals.trips.pct)} em ${prevName})` : ''}`, text: `${fmtInt(t.lost)} viagens perdidas de ${fmtInt(t.planned)}. Pior dia: ${fmtDay(worstT.date)}, ${fmtInt(worstT.trips.lost)} perdidas (${fmtPct(worstT.trips.pct as number)}).${top ? ` Linha que mais perdeu: ${top.line}, ${fmtInt(top.lost)} viagens (${fmtPct(100 - (top.pct ?? 100))} das programadas dela).` : ''}` });
  }

  // Consumo.
  const dsl = consumption.diesel;
  if (dsl && dsl.ratio !== null) {
    const ch = changePct(dsl.ratio, dsl.previousRatio);
    out.push({ kind: 'consumption', tone: ch !== null && ch > 1 ? 'good' : ch !== null && ch < -1 ? 'bad' : 'info', date: null, title: `Diesel ${fmtRatio(dsl.ratio)} km/l${ch !== null ? `, ${ch > 0 ? 'melhorou' : 'piorou'} ${fmtPct(Math.abs(ch))} vs ${prevName}` : ''}`, text: `${fmtInt(dsl.vehicles)} carros com registro; ${fmtInt(dsl.high)} acima do grupo e ${fmtInt(dsl.watch)} em atenção.` });
  }
  const eb = consumption.ebus;
  if (eb && eb.ratio !== null) {
    const ch = changePct(eb.ratio, eb.previousRatio);
    // kWh/km: menor é melhor.
    out.push({ kind: 'consumption', tone: ch !== null && ch < -1 ? 'good' : ch !== null && ch > 1 ? 'bad' : 'info', date: null, title: `Elétricos ${fmtRatio(eb.ratio)} kWh/km${ch !== null ? `, ${ch < 0 ? 'melhorou' : 'piorou'} ${fmtPct(Math.abs(ch))} vs ${prevName}` : ''}`, text: `${fmtInt(eb.vehicles)} carros com registro; ${fmtInt(eb.high)} acima do grupo e ${fmtInt(eb.watch)} em atenção.` });
  }

  void today;
  return out;
}

// --- utilidades ----------------------------------------------------------------------

function bump(map: Map<string, number>, key: string, by: number): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function weekdayOf(iso: string): number {
  return new Date(`${iso}T12:00:00`).getDay();
}

function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return isoDay(new Date(y, m, 0));
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function emptyTotals(): BoardTotals {
  const fleet: BoardFleet = { covered: 0, programmed: null, estimated: true, vehicles: 0, scheduled: 0, pct: null, note: null };
  const trips: BoardTrips = { planned: 0, lost: 0, pct: null };
  return { fleet, failures: 0, km: 0, mkbf: null, trips };
}
