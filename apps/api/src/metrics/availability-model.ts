/**
 * Disponibilidade estimada pela operação.
 *
 * A hora em que o carro voltou a ficar pronto só existe quando a oficina libera a OS pelo sistema.
 * Para o período em que isso não aconteceu, o que existe e é confiável é a operação (os dias em
 * que cada carro rodou e os km que fez) e as fichas de manutenção, com dia e hora. Este modelo
 * reconstrói a indisponibilidade a partir das duas, dentro da janela de operação (4h à 1h):
 *
 *  - Carro que ficou sem rodar e tem ficha de manutenção no trecho (ou quebrou no último dia em que
 *    rodou) esteve retido: perde a janela inteira de cada dia parado.
 *  - Carro que quebrou e rodou no mesmo dia perde a parte do dia que deixou de rodar frente ao seu
 *    dia típico: no mínimo 1 h, no máximo o que restava da janela depois da ficha.
 *  - Carro parado sem nenhuma ficha é reserva: não conta como indisponível, mas fica listado.
 *  - Carro há mais de 30 dias sem rodar e sem ficha saiu da frota em operação (imobilizado).
 *
 * Função pura: recebe as linhas, devolve o retrato de cada dia. Quem consulta o banco e junta as
 * OS do sistema é o AvailabilityService.
 */

const DAY_MS = 86_400_000;

/** Janela de operação, em minutos a partir de 0h do dia: das 4h à 1h do dia seguinte (21 h). */
export const WINDOW_START_MIN = 240;
export const WINDOW_END_MIN = 1500;
export const WINDOW_MIN = WINDOW_END_MIN - WINDOW_START_MIN;

/** Fichas de quebra: recolhida anormal, socorro e troca. */
const BREAKDOWN_KINDS = new Set(['A', 'S', 'T']);
/** Sem rodar e sem ficha por mais que isto: o carro saiu da frota em operação. */
const IMMOBILIZED_AFTER_DAYS = 30;
/** Dia útil de operação cheia: rodou ao menos esta parte da mediana dos dias úteis vizinhos. */
const FULL_DAY_SHARE = 0.9;
const FULL_DAY_SPAN = 21;
/** Dias rodados que um carro precisa ter para o km típico ser o dele, e não o da frota. */
const TYPICAL_MIN_SAMPLES = 8;
/** Toda quebra com o carro rodando custa ao menos isto da janela. */
const MIN_LOSS_MIN = 60;

export interface RunRow {
  vehicleId: string;
  /** Dia civil, em dias desde 1970 (ver dayNumber). */
  day: number;
  km: number;
}

export interface FichaRow {
  vehicleId: string;
  day: number;
  /** Minuto do dia em que a ficha foi aberta. */
  minute: number;
  kind: string;
}

export interface PartialLoss {
  /** Minuto do dia em que a ficha de quebra foi aberta. */
  fichaMinute: number;
  /** Início e duração da parada dentro da janela, em minutos a partir de 0h. */
  start: number;
  minutes: number;
}

export interface DayEstimate {
  day: number;
  /** Dia útil de operação cheia (nem fim de semana, nem feriado ou operação reduzida). */
  full: boolean;
  /** Carros da frota em operação no dia. */
  fleet: number;
  /** Retidos o dia inteiro: carro -> último dia em que rodou. */
  retained: Map<string, number>;
  /** Quebraram e rodaram no dia. */
  partial: Map<string, PartialLoss>;
  /** Parados sem ficha em dia de operação cheia (reserva): carro -> último dia em que rodou. */
  idle: Map<string, number>;
  /** Fora da frota em operação: carro -> último dia com atividade (rodou ou teve ficha). */
  immobilized: Map<string, number>;
}

export interface AvailabilityModel {
  firstDay: number;
  lastDay: number;
  /** Um retrato por dia, de firstDay a lastDay. */
  days: DayEstimate[];
  /** Primeiro dia em que cada carro rodou: é quando ele entra na frota. */
  firstRun: Map<string, number>;
}

export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function isoOfDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function weekday(day: number): number {
  return new Date(day * DAY_MS).getUTCDay();
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** O último dia de `sorted` que não passa de `day`; nulo quando não há. */
function lastAtOrBefore(sorted: number[], day: number): number | null {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? (sorted[lo - 1] as number) : null;
}

export function buildAvailabilityModel(runs: RunRow[], fichas: FichaRow[]): AvailabilityModel | null {
  // Dias rodados (km > 0) de cada carro.
  const ran = new Map<string, Map<number, number>>();
  let firstDay = Infinity;
  let lastDay = -Infinity;
  for (const r of runs) {
    if (!(r.km > 0)) continue;
    let kmByDay = ran.get(r.vehicleId);
    if (!kmByDay) ran.set(r.vehicleId, (kmByDay = new Map()));
    kmByDay.set(r.day, (kmByDay.get(r.day) ?? 0) + r.km);
    if (r.day < firstDay) firstDay = r.day;
    if (r.day > lastDay) lastDay = r.day;
  }
  if (ran.size === 0) return null;
  const size = lastDay - firstDay + 1;

  // Fichas de cada carro: os dias com ficha e, nos dias de quebra, o minuto da primeira.
  const fichaSet = new Map<string, Set<number>>();
  const breakdownAt = new Map<string, Map<number, number>>();
  for (const f of fichas) {
    if (!ran.has(f.vehicleId)) continue;
    let set = fichaSet.get(f.vehicleId);
    if (!set) fichaSet.set(f.vehicleId, (set = new Set()));
    set.add(f.day);
    if (!BREAKDOWN_KINDS.has(f.kind.trim())) continue;
    let broke = breakdownAt.get(f.vehicleId);
    if (!broke) breakdownAt.set(f.vehicleId, (broke = new Map()));
    broke.set(f.day, Math.min(broke.get(f.day) ?? Infinity, f.minute));
  }

  // Dia de operação cheia sai do próprio dado: feriado e operação reduzida aparecem como dia útil
  // em que rodou bem menos carro que nos dias úteis vizinhos.
  const running = new Array<number>(size).fill(0);
  for (const kmByDay of ran.values()) for (const d of kmByDay.keys()) running[d - firstDay] = (running[d - firstDay] as number) + 1;
  const isWeekend = (day: number) => weekday(day) === 0 || weekday(day) === 6;
  const full: boolean[] = [];
  for (let i = 0; i < size; i += 1) {
    if (isWeekend(firstDay + i)) {
      full.push(false);
      continue;
    }
    const near: number[] = [];
    for (let j = Math.max(0, i - FULL_DAY_SPAN); j <= Math.min(size - 1, i + FULL_DAY_SPAN); j += 1) {
      if ((running[j] as number) > 0 && !isWeekend(firstDay + j)) near.push(running[j] as number);
    }
    full.push(near.length === 0 || (running[i] as number) >= FULL_DAY_SHARE * median(near));
  }
  // Tipo do dia para o km típico: 0 operação cheia, 1 sábado, 2 domingo ou operação reduzida.
  const dayType = (day: number): 0 | 1 | 2 => (full[day - firstDay] ? 0 : weekday(day) === 6 ? 1 : 2);

  // Km típico por carro e tipo de dia: mediana dos dias rodados sem quebra.
  const typical = new Map<string, (number | null)[]>();
  const all: number[][] = [[], [], []];
  for (const [v, kmByDay] of ran) {
    const own: number[][] = [[], [], []];
    const broke = breakdownAt.get(v);
    for (const [day, km] of kmByDay) {
      if (broke?.has(day)) continue;
      (own[dayType(day)] as number[]).push(km);
      (all[dayType(day)] as number[]).push(km);
    }
    typical.set(v, own.map((l) => (l.length >= TYPICAL_MIN_SAMPLES ? median(l) : null)));
  }
  const fleetTypical = all.map((l) => (l.length ? median(l) : null));
  const typicalKm = (v: string, day: number) => typical.get(v)?.[dayType(day)] ?? fleetTypical[dayType(day)] ?? null;

  const days: DayEstimate[] = [];
  for (let i = 0; i < size; i += 1) {
    days.push({ day: firstDay + i, full: full[i] as boolean, fleet: 0, retained: new Map(), partial: new Map(), idle: new Map(), immobilized: new Map() });
  }
  const at = (day: number) => days[day - firstDay] as DayEstimate;
  const firstRun = new Map<string, number>();

  for (const [v, kmByDay] of ran) {
    const ds = [...kmByDay.keys()].sort((a, b) => a - b);
    const first = ds[0] as number;
    firstRun.set(v, first);
    // O carro entra na frota no primeiro dia em que rodou e fica até o fim do dado.
    for (let d = first; d <= lastDay; d += 1) at(d).fleet += 1;
    const fichaDays = [...(fichaSet.get(v) ?? [])].sort((a, b) => a - b);
    const broke = breakdownAt.get(v);

    // Trechos sem rodar: entre dois dias rodados, ou do último dia rodado até o fim do dado.
    for (let i = 0; i < ds.length; i += 1) {
      const p = ds[i] as number;
      const next = i + 1 < ds.length ? (ds[i + 1] as number) : null;
      if (next !== null ? next - p <= 1 : p >= lastDay) continue;
      const start = p + 1;
      const end = next !== null ? next - 1 : lastDay;
      let firstFull: number | null = null;
      let lastFull: number | null = null;
      let firstFicha: number | null = null;
      let lastFicha: number | null = null;
      for (let x = start; x <= end; x += 1) {
        const est = at(x);
        // Mais de 30 dias sem rodar e sem ficha: fora da frota até voltar a rodar ou ganhar ficha.
        const activity = Math.max(p, lastAtOrBefore(fichaDays, x) ?? p);
        if (x - activity > IMMOBILIZED_AFTER_DAYS) {
          est.immobilized.set(v, activity);
          est.fleet -= 1;
        }
        if (est.full) {
          firstFull ??= x;
          lastFull = x;
        }
        if (fichaDays.length && lastAtOrBefore(fichaDays, x) === x) {
          firstFicha ??= x;
          lastFicha = x;
        }
      }
      // Trecho só de fim de semana ou feriado: o carro não era esperado na rua.
      if (firstFull === null || lastFull === null) continue;
      const brokeBefore = broke?.has(p) ?? false;
      if (firstFicha === null && !brokeBefore) {
        for (let x = start; x <= end; x += 1) if (at(x).full && !at(x).immobilized.has(v)) at(x).idle.set(v, p);
        continue;
      }
      // Conta do primeiro sinal (quebra na véspera, ficha ou dia cheio perdido) ao último.
      const from = brokeBefore ? start : Math.min(firstFull, firstFicha ?? Infinity);
      const to = next === null ? end : Math.max(lastFull, lastFicha ?? -Infinity);
      for (let x = from; x <= to; x += 1) if (!at(x).immobilized.has(v)) at(x).retained.set(v, p);
    }

    // Quebrou e rodou no mesmo dia: perde a parte do dia que deixou de rodar frente ao dia típico.
    for (const [day, minute] of broke ?? []) {
      const km = kmByDay.get(day);
      if (km === undefined) continue;
      const typ = typicalKm(v, day);
      const ratio = typ && typ > 0 ? Math.min(km / typ, 2) : 1;
      // Ficha entre 0h e 1h cai no fim da janela, que só fecha à 1h.
      const opened = minute < 60 ? minute + 1440 : minute;
      const start = Math.max(opened, WINDOW_START_MIN);
      const left = WINDOW_END_MIN - start;
      const minutes = Math.max(Math.min(MIN_LOSS_MIN, left), Math.min((1 - ratio) * WINDOW_MIN, left));
      at(day).partial.set(v, { fichaMinute: minute, start, minutes });
    }
  }

  return { firstDay, lastDay, days, firstRun };
}
