import { Injectable } from '@nestjs/common';
import { WorkOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  type AvailabilityModel,
  type DayEstimate,
  type FichaRow,
  type RunRow,
  WINDOW_END_MIN,
  WINDOW_MIN,
  WINDOW_START_MIN,
  buildAvailabilityModel,
  dayNumber,
  isoOfDay,
} from './availability-model';

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
/** De quanto em quanto tempo se confere se chegou dado novo de operação ou de fichas. */
const RECHECK_MS = 60_000;
/**
 * O sistema só é a fonte de um dia quando a oficina de fato trabalhou nele por OS: abaixo desta
 * parte da frota com OS no dia, são OS soltas (teste, treinamento) e não entram na conta.
 */
const SYSTEM_DAY_MIN_SHARE = 0.01;
/** Até onde se procura, para trás, o último dia com dado do sistema. */
const LOOKBACK_DAYS = 400;

type Interval = [number, number];

export interface AvailabilityDay {
  date: string;
  /** Carros da frota em operação no dia (1 quando o escopo é um carro). */
  fleet: number;
  /** Minutos de janela do dia, somados os carros: 21 h por carro, menos no dia em andamento. */
  windowMinutes: number;
  /** Minutos indisponíveis dentro da janela, somados os carros. */
  downMinutes: number;
  /** Carros que não estavam aptos na saída, às 4h. */
  notReady: number;
}

export interface AvailabilitySummary {
  /** Disponibilidade operacional: horas disponíveis ÷ horas da janela. Nulo sem dado. */
  operational: number | null;
  /** Frota apta na saída: carros aptos às 4h ÷ frota, na média dos dias. Nulo sem dado. */
  ready: number | null;
  days: number;
  /** Frota média do período. */
  fleet: number;
  windowMinutes: number;
  downMinutes: number;
  /** Carros retidos na saída, somados os dias. */
  notReady: number;
}

export interface AvailabilityHourSlot {
  /** Hora do relógio em que a faixa começa: 4, 5 … 23, 0. */
  hour: number;
  rate: number | null;
}

export type AvailabilityCarKind = 'RETAINED' | 'PARTIAL' | 'IDLE' | 'IMMOBILIZED';

export interface AvailabilityCarRow {
  vehicleId: string;
  kind: AvailabilityCarKind;
  /** Último dia em que rodou (ou teve atividade, no imobilizado). */
  lastRun: string | null;
  /** Minuto do dia da ficha de quebra, quando a parada é parcial. */
  fichaMinute: number | null;
  /** Minutos indisponíveis na janela do dia. */
  minutes: number;
  /** Os trechos indisponíveis, em minutos desde a 0h do dia (a janela vai de 240 a 1500). */
  intervals: [number, number][];
  /** A parada veio (também) de OS do sistema. */
  byWorkOrder: boolean;
}

export interface AvailabilityDayCars {
  date: string;
  /** Dia útil de operação cheia. */
  full: boolean;
  /** O dia é estimado pela operação (verdadeiro) ou medido só pelas OS do sistema. */
  estimated: boolean;
  fleet: number;
  /** Minutos de janela do dia por carro: 21 h, menos no dia em andamento. */
  windowMinutes: number;
  operational: number | null;
  ready: number | null;
  cars: AvailabilityCarRow[];
}

interface Loaded {
  signature: string;
  model: AvailabilityModel | null;
  /** Frota ativa: só vale como frota quando não há nenhum dado de operação. */
  activeFleet: Set<string>;
}

interface Span {
  vehicleId: string;
  from: number;
  to: number | null;
}

interface CarDown {
  intervals: Interval[];
  notReady: boolean;
  byWorkOrder: boolean;
}

interface DayCalc {
  day: number;
  estimate: DayEstimate | null;
  fleet: number;
  /** Minutos da janela já decorridos (a janela inteira em dia fechado). */
  elapsed: number;
  cars: Map<string, CarDown>;
}

/**
 * Disponibilidade da frota na janela de operação (4h à 1h), do jeito que o mercado mede:
 * horas disponíveis ÷ horas da janela, só com os carros da frota em operação.
 *
 * Duas fontes, unidas por carro sem contar a mesma hora duas vezes:
 *  - a operação e as fichas (availability-model), até o último dia de operação que chegou;
 *  - as OS do sistema, da abertura à liberação, nos dias em que a oficina trabalhou por elas.
 *
 * O retrato da operação é montado uma vez e fica na memória; a cada minuto uma consulta barata
 * confere se chegou dado novo.
 */
@Injectable()
export class AvailabilityService {
  private loaded: Loaded | null = null;
  private checkedAt = 0;
  private pending: Promise<Loaded> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Um ponto por dia com dado, de `fromIso` a `toIso`. Dia sem dado fica de fora. */
  async days(fromIso: string, toIso: string, vehicleId?: string): Promise<AvailabilityDay[]> {
    return (await this.range(dayNumber(fromIso), dayNumber(toIso), vehicleId)).map(toDay);
  }

  async summary(fromIso: string, toIso: string, vehicleId?: string): Promise<AvailabilitySummary> {
    return summarizeAvailability(await this.days(fromIso, toIso, vehicleId));
  }

  /** A curva de um dia, hora a hora dentro da janela. Nulo quando o dia não tem dado. */
  async hours(dayIso: string): Promise<AvailabilityHourSlot[] | null> {
    const day = dayNumber(dayIso);
    const [calc] = await this.range(day, day);
    return calc ? slotsOf(calc) : null;
  }

  /** A curva média dos dias com dado do período: a referência do gráfico por hora. */
  async hoursAverage(fromIso: string, toIso: string): Promise<{ slots: AvailabilityHourSlot[]; days: number }> {
    const calcs = await this.range(dayNumber(fromIso), dayNumber(toIso));
    const curves = calcs.map(slotsOf);
    const slots: AvailabilityHourSlot[] = [];
    for (let s = 0; s < WINDOW_MIN / 60; s += 1) {
      const rates = curves.map((c) => c[s]?.rate ?? null).filter((r): r is number => r !== null);
      slots.push({
        hour: (WINDOW_START_MIN / 60 + s) % 24,
        rate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
      });
    }
    return { slots, days: calcs.length };
  }

  /** Os carros por trás do número de um dia: retidos, parciais, reserva e imobilizados. */
  async cars(dayIso: string): Promise<AvailabilityDayCars | null> {
    const day = dayNumber(dayIso);
    const [calc] = await this.range(day, day);
    if (!calc) return null;
    const est = calc.estimate;
    const cars: AvailabilityCarRow[] = [];
    for (const [vehicleId, car] of calc.cars) {
      const lastRun = est?.retained.get(vehicleId);
      cars.push({
        vehicleId,
        kind: car.notReady ? 'RETAINED' : 'PARTIAL',
        lastRun: lastRun === undefined ? null : isoOfDay(lastRun),
        fichaMinute: est?.partial.get(vehicleId)?.fichaMinute ?? null,
        minutes: totalOf(car.intervals),
        intervals: car.intervals.map(([a, b]) => [Math.round(a), Math.round(b)]),
        byWorkOrder: car.byWorkOrder,
      });
    }
    for (const [vehicleId, lastRun] of est?.idle ?? []) {
      if (calc.cars.has(vehicleId)) continue;
      cars.push({ vehicleId, kind: 'IDLE', lastRun: isoOfDay(lastRun), fichaMinute: null, minutes: 0, intervals: [], byWorkOrder: false });
    }
    for (const [vehicleId, lastActivity] of est?.immobilized ?? []) {
      cars.push({
        vehicleId,
        kind: 'IMMOBILIZED',
        lastRun: isoOfDay(lastActivity),
        fichaMinute: null,
        minutes: 0,
        intervals: [],
        byWorkOrder: false,
      });
    }
    const s = summarizeAvailability([toDay(calc)]);
    return {
      date: dayIso,
      full: est?.full ?? false,
      estimated: est !== null,
      fleet: calc.fleet,
      windowMinutes: calc.elapsed,
      operational: s.operational,
      ready: s.ready,
      cars,
    };
  }

  /** O dia mais recente com dado antes de `beforeIso`; com carro, o dia mais recente dele na frota. */
  async lastDay(beforeIso: string, vehicleId?: string): Promise<string | null> {
    const { model } = await this.load();
    const hi = Math.min(dayNumber(beforeIso) - 1, localDay(new Date()));
    // Primeiro os dias medidos pelo sistema, que vêm depois do último dia de operação.
    const systemFrom = Math.max(model ? model.lastDay + 1 : -Infinity, hi - LOOKBACK_DAYS);
    if (hi >= systemFrom) {
      const calcs = await this.range(systemFrom, hi, vehicleId);
      const last = calcs[calcs.length - 1];
      if (last) return isoOfDay(last.day);
    }
    if (!model) return null;
    for (let day = Math.min(hi, model.lastDay); day >= model.firstDay; day -= 1) {
      if (!vehicleId) return isoOfDay(day);
      const est = model.days[day - model.firstDay] as DayEstimate;
      if ((model.firstRun.get(vehicleId) ?? Infinity) <= day && !est.immobilized.has(vehicleId)) return isoOfDay(day);
    }
    return null;
  }

  /** Primeiro e último dia com dado: os limites de quem escolhe um dia. */
  async bounds(): Promise<{ first: string | null; last: string | null }> {
    const { model } = await this.load();
    const last = await this.lastDay(isoOfDay(localDay(new Date()) + 1));
    return { first: model ? isoOfDay(model.firstDay) : last, last };
  }

  private async range(from: number, to: number, vehicleId?: string): Promise<DayCalc[]> {
    const { model, activeFleet } = await this.load();
    const now = Date.now();
    const first = model ? Math.max(from, model.firstDay) : from;
    const last = Math.min(to, localDay(new Date(now)));
    if (last < first) return [];
    const rows = await this.prisma.workOrder.findMany({
      where: {
        status: { not: WorkOrderStatus.CANCELLED },
        openedAt: { lt: new Date(localMidnight(last) + WINDOW_END_MIN * MIN_MS) },
        OR: [{ releasedAt: null }, { releasedAt: { gt: new Date(localMidnight(first) + WINDOW_START_MIN * MIN_MS) } }],
      },
      select: { vehicleId: true, openedAt: true, releasedAt: true },
    });
    // Cada OS vai para os dias que ela pode tocar; a janela de um dia entra 1 h no dia seguinte.
    const byDay = new Map<number, Span[]>();
    for (const w of rows) {
      const span: Span = { vehicleId: w.vehicleId, from: w.openedAt.getTime(), to: w.releasedAt?.getTime() ?? null };
      const a = Math.max(localDay(w.openedAt) - 1, first);
      const b = Math.min(localDay(new Date(span.to ?? now)), last);
      for (let day = a; day <= b; day += 1) {
        const list = byDay.get(day);
        if (list) list.push(span);
        else byDay.set(day, [span]);
      }
    }
    const out: DayCalc[] = [];
    for (let day = first; day <= last; day += 1) {
      const calc = calcDay(day, model, activeFleet, byDay.get(day) ?? [], now, vehicleId);
      if (calc) out.push(calc);
    }
    return out;
  }

  private async load(): Promise<Loaded> {
    if (this.loaded && Date.now() - this.checkedAt < RECHECK_MS) return this.loaded;
    this.pending ??= this.refresh().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async refresh(): Promise<Loaded> {
    const [row] = await this.prisma.$queryRaw<{ signature: string }[]>`
      SELECT concat_ws('|',
        (SELECT count(*) FROM vehicle_line_days),
        (SELECT max(date) FROM vehicle_line_days),
        (SELECT sum("kmInLine" + "kmIdle") FROM vehicle_line_days),
        (SELECT count(*) FROM maintenance_records),
        (SELECT max("openedAt") FROM maintenance_records),
        (SELECT count(*) FROM vehicles WHERE application = 'FROTA' AND "isActive")) AS signature`;
    const signature = row?.signature ?? '';
    if (this.loaded?.signature !== signature) {
      const [runs, fichas, active] = await Promise.all([
        this.prisma.$queryRaw<{ vehicleId: string; day: string; km: number }[]>`
          SELECT d."vehicleId" AS "vehicleId", to_char(d.date, 'YYYY-MM-DD') AS day,
                 sum(d."kmInLine" + d."kmIdle")::float8 AS km
          FROM vehicle_line_days d JOIN vehicles v ON v.id = d."vehicleId"
          WHERE v.application = 'FROTA'
          GROUP BY d."vehicleId", d.date
          HAVING sum(d."kmInLine" + d."kmIdle") > 0`,
        this.prisma.$queryRaw<{ vehicleId: string; openedAt: Date; kind: string }[]>`
          SELECT r."vehicleId" AS "vehicleId", r."openedAt" AS "openedAt", r.kind AS kind
          FROM maintenance_records r JOIN vehicles v ON v.id = r."vehicleId"
          WHERE v.application = 'FROTA'`,
        this.prisma.vehicle.findMany({ where: { isActive: true, application: 'FROTA' }, select: { id: true } }),
      ]);
      const runRows: RunRow[] = runs.map((r) => ({ vehicleId: r.vehicleId, day: dayNumber(r.day), km: r.km }));
      const fichaRows: FichaRow[] = fichas.map((f) => ({
        vehicleId: f.vehicleId,
        day: localDay(f.openedAt),
        minute: f.openedAt.getHours() * 60 + f.openedAt.getMinutes(),
        kind: f.kind,
      }));
      this.loaded = {
        signature,
        model: buildAvailabilityModel(runRows, fichaRows),
        activeFleet: new Set(active.map((v) => v.id)),
      };
    }
    this.checkedAt = Date.now();
    return this.loaded as Loaded;
  }
}

/** Junta os dias num número só: as horas pesam pela janela, a saída pesa pela frota. */
export function summarizeAvailability(days: AvailabilityDay[]): AvailabilitySummary {
  let fleet = 0;
  let windowMinutes = 0;
  let downMinutes = 0;
  let notReady = 0;
  for (const d of days) {
    fleet += d.fleet;
    windowMinutes += d.windowMinutes;
    downMinutes += d.downMinutes;
    notReady += d.notReady;
  }
  return {
    operational: windowMinutes > 0 ? 1 - downMinutes / windowMinutes : null,
    ready: fleet > 0 ? 1 - notReady / fleet : null,
    days: days.length,
    fleet: days.length ? fleet / days.length : 0,
    windowMinutes,
    downMinutes,
    notReady,
  };
}

/** Dia local do servidor, em dias desde 1970 (a mesma régua do modelo). */
function localDay(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** O instante da 0h local do dia. */
function localMidnight(day: number): number {
  const d = new Date(day * DAY_MS);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime();
}

function totalOf(intervals: Interval[]): number {
  return intervals.reduce((sum, [a, b]) => sum + (b - a), 0);
}

/** Une intervalos que se tocam: a mesma hora não conta duas vezes para o mesmo carro. */
function merge(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function toDay(calc: DayCalc): AvailabilityDay {
  let downMinutes = 0;
  let notReady = 0;
  for (const car of calc.cars.values()) {
    downMinutes += totalOf(car.intervals);
    if (car.notReady) notReady += 1;
  }
  return { date: isoOfDay(calc.day), fleet: calc.fleet, windowMinutes: calc.fleet * calc.elapsed, downMinutes, notReady };
}

/** As 21 faixas de uma hora da janela, na ordem em que o dia acontece: 4h, 5h … 23h, 0h. */
function slotsOf(calc: DayCalc): AvailabilityHourSlot[] {
  const end = WINDOW_START_MIN + calc.elapsed;
  const slots: AvailabilityHourSlot[] = [];
  for (let a = WINDOW_START_MIN; a < WINDOW_END_MIN; a += 60) {
    const b = Math.min(a + 60, end);
    const hour = (a / 60) % 24;
    if (b <= a || calc.fleet <= 0) {
      slots.push({ hour, rate: null });
      continue;
    }
    let down = 0;
    for (const car of calc.cars.values()) {
      for (const [x, y] of car.intervals) down += Math.max(0, Math.min(y, b) - Math.max(x, a));
    }
    slots.push({ hour, rate: 1 - down / (calc.fleet * (b - a)) });
  }
  return slots;
}

/**
 * O dia de um carro (ou da frota): a estimativa da operação e as OS do sistema, unidas.
 * Devolve nulo quando o dia não tem dado: janela que ainda não abriu, carro fora da frota,
 * ou dia depois da operação sem a oficina trabalhando por OS.
 */
function calcDay(
  day: number,
  model: AvailabilityModel | null,
  activeFleet: Set<string>,
  spans: Span[],
  now: number,
  vehicleId?: string,
): DayCalc | null {
  const midnight = localMidnight(day);
  const winStart = midnight + WINDOW_START_MIN * MIN_MS;
  const winEnd = midnight + WINDOW_END_MIN * MIN_MS;
  const until = Math.min(now, winEnd);
  const elapsed = Math.floor((until - winStart) / MIN_MS);
  if (elapsed <= 0) return null;

  // Depois do último dia de operação, a frota fica como estava nele.
  const refDay = model ? Math.min(day, model.lastDay) : day;
  const ref = model ? (model.days[refDay - model.firstDay] as DayEstimate) : null;
  const estimate = model && day <= model.lastDay ? ref : null;
  const inFleet = (v: string): boolean =>
    model && ref ? (model.firstRun.get(v) ?? Infinity) <= refDay && !ref.immobilized.has(v) : activeFleet.has(v);
  const fleet = ref ? ref.fleet : activeFleet.size;
  if (fleet <= 0) return null;
  if (vehicleId && !inFleet(vehicleId)) return null;

  const end = WINDOW_START_MIN + elapsed;
  const cars = new Map<string, CarDown>();
  const carOf = (v: string): CarDown => {
    let car = cars.get(v);
    if (!car) {
      car = { intervals: [], notReady: false, byWorkOrder: false };
      cars.set(v, car);
    }
    return car;
  };

  for (const [v] of estimate?.retained ?? []) {
    const car = carOf(v);
    car.intervals.push([WINDOW_START_MIN, end]);
    car.notReady = true;
  }
  for (const [v, loss] of estimate?.partial ?? []) {
    const to = Math.min(loss.start + loss.minutes, end);
    if (to > loss.start) carOf(v).intervals.push([loss.start, to]);
  }

  // As OS só contam no dia em que a oficina trabalhou por elas (parte mínima da frota com OS).
  const system = new Map<string, { intervals: Interval[]; notReady: boolean }>();
  for (const s of spans) {
    if (!inFleet(s.vehicleId)) continue;
    const a = Math.max(s.from, winStart);
    const b = Math.min(s.to ?? until, until);
    if (b <= a) continue;
    let car = system.get(s.vehicleId);
    if (!car) {
      car = { intervals: [], notReady: false };
      system.set(s.vehicleId, car);
    }
    car.intervals.push([(a - midnight) / MIN_MS, (b - midnight) / MIN_MS]);
    if (s.from <= winStart) car.notReady = true;
  }
  const covered = system.size >= Math.max(1, Math.ceil(fleet * SYSTEM_DAY_MIN_SHARE));
  if (!estimate && !covered) return null;
  if (covered) {
    for (const [v, sys] of system) {
      const car = carOf(v);
      car.intervals.push(...sys.intervals);
      car.notReady ||= sys.notReady;
      car.byWorkOrder = true;
    }
  }

  for (const car of cars.values()) car.intervals = merge(car.intervals);
  if (!vehicleId) return { day, estimate, fleet, elapsed, cars };
  const own = cars.get(vehicleId);
  return { day, estimate, fleet: 1, elapsed, cars: new Map(own ? [[vehicleId, own]] : []) };
}
