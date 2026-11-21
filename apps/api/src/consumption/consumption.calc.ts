import {
  CONSUMPTION_MIN_DAYS,
  CONSUMPTION_STALL_MAX_GAP_DAYS,
  CONSUMPTION_STALL_MAX_KM,
  CONSUMPTION_STALL_MIN_AMOUNT,
  CONSUMPTION_STALL_MIN_RECORDS,
  consumptionDeviation,
  consumptionFlagOf,
  consumptionRatio,
  ConsumptionFlag,
  type ConsumptionDayPoint,
  type ConsumptionMonthPoint,
  type ConsumptionQuality,
  type ConsumptionStall,
  type ConsumptionTechGroup,
  type ConsumptionTotals,
  type ConsumptionVehicleRow,
  type VehicleTechnology,
} from '@app/shared';

/**
 * A conta do consumo, sem banco: recebe carro-dias de km e de consumo e
 * devolve totais, séries e a comparação carro a carro. Fica separada do
 * serviço para ser testável com os JSON reais (tools/dados-reais).
 */

export interface VehicleInfo {
  id: string;
  code: string;
  plate: string;
  model: string | null;
  vehicleClass: string | null;
}

/** Um carro-dia: km rodado (do odômetro) e consumo (da planilha), qualquer um dos dois pode faltar. */
export interface CarDay {
  vehicleId: string;
  date: string;
  km: number;
  amount: number | null;
  tech: string | null;
}

export const DAY_MS = 86_400_000;

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / DAY_MS) + 1;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000);

/** Junta leituras de km e de consumo num mapa carro-dia. */
export function mergeCarDays(
  km: { vehicleId: string; date: string; km: number }[],
  fuel: { vehicleId: string; date: string; amount: number; tech: string | null }[],
): Map<string, CarDay> {
  const out = new Map<string, CarDay>();
  for (const k of km) {
    if (k.km <= 0) continue;
    const key = `${k.vehicleId}|${k.date}`;
    const cur = out.get(key);
    if (cur) cur.km += k.km;
    else out.set(key, { vehicleId: k.vehicleId, date: k.date, km: k.km, amount: null, tech: null });
  }
  for (const f of fuel) {
    const key = `${f.vehicleId}|${f.date}`;
    const cur = out.get(key);
    if (cur) {
      cur.amount = (cur.amount ?? 0) + f.amount;
      cur.tech = cur.tech ?? f.tech;
    } else out.set(key, { vehicleId: f.vehicleId, date: f.date, km: 0, amount: f.amount, tech: f.tech });
  }
  return out;
}

/**
 * Dias em que a frota rodou e a planilha não tem registro de carro nenhum.
 * É lacuna da planilha (um dia pulado, ou os dias depois da última remessa),
 * não "ninguém abasteceu": o km desses dias precisa sair da conta, senão um
 * dia faltante numa semana derruba o rendimento em mais de 10%.
 */
export function sheetGapDates(days: Iterable<CarDay>): string[] {
  const withKm = new Set<string>();
  const withFuel = new Set<string>();
  for (const d of days) {
    if (d.km > 0) withKm.add(d.date);
    if (d.amount !== null && d.amount > 0) withFuel.add(d.date);
  }
  return [...withKm].filter((d) => !withFuel.has(d)).sort();
}

/** Tira os carro-dias das datas dadas (as lacunas da planilha). */
export function dropDates(days: Iterable<CarDay>, dates: string[]): CarDay[] {
  const gone = new Set(dates);
  return [...days].filter((d) => !gone.has(d.date));
}

/**
 * Odômetro parado, por carro: trechos de CONSUMPTION_STALL_MIN_RECORDS ou
 * mais abastecimentos seguidos (no máximo CONSUMPTION_STALL_MAX_GAP_DAYS de
 * intervalo entre eles) com volume normal e km quase zero. Carro que abastece
 * 150 L não rodou 1 km: é o odômetro que não contou, não o consumo.
 */
export function odometerStalls(energy: VehicleTechnology, days: Iterable<CarDay>): Map<string, ConsumptionStall[]> {
  const minAmount = CONSUMPTION_STALL_MIN_AMOUNT[energy];
  const byVehicle = new Map<string, CarDay[]>();
  for (const d of days) {
    if (d.amount === null || d.amount <= 0) continue;
    const list = byVehicle.get(d.vehicleId) ?? [];
    list.push(d);
    byVehicle.set(d.vehicleId, list);
  }
  const out = new Map<string, ConsumptionStall[]>();
  for (const [vehicleId, list] of byVehicle) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const stalls: ConsumptionStall[] = [];
    let run: CarDay[] = [];
    const close = () => {
      if (run.length >= CONSUMPTION_STALL_MIN_RECORDS) {
        stalls.push({ from: run[0]!.date, to: run[run.length - 1]!.date, days: run.length, amount: r2(run.reduce((s, d) => s + (d.amount ?? 0), 0)), km: Math.round(run.reduce((s, d) => s + d.km, 0)) });
      }
      run = [];
    };
    for (const d of list) {
      const suspect = (d.amount ?? 0) >= minAmount && d.km < CONSUMPTION_STALL_MAX_KM;
      const continues = run.length > 0 && daysBetween(run[run.length - 1]!.date, d.date) - 1 <= CONSUMPTION_STALL_MAX_GAP_DAYS;
      if (!suspect || !continues) close();
      if (suspect) run.push(d);
    }
    close();
    if (stalls.length > 0) out.set(vehicleId, stalls);
  }
  return out;
}

/** Tira os carro-dias dentro dos trechos de odômetro parado (km e consumo: nenhum dos dois é confiável ali). */
export function dropStalls(days: Iterable<CarDay>, stalls: Map<string, ConsumptionStall[]>): CarDay[] {
  if (stalls.size === 0) return [...days];
  return [...days].filter((d) => !(stalls.get(d.vehicleId) ?? []).some((s) => d.date >= s.from && d.date <= s.to));
}

/**
 * Totais do período. Só entra o km dos carros que têm algum registro de
 * consumo no período — senão um carro sem planilha inflaria o km/l da frota.
 */
export function totalsOf(energy: VehicleTechnology, days: Iterable<CarDay>): ConsumptionTotals {
  const withFuel = new Set<string>();
  const list = [...days];
  for (const d of list) if (d.amount !== null && d.amount > 0) withFuel.add(d.vehicleId);
  let km = 0;
  let amount = 0;
  const dates = new Set<string>();
  for (const d of list) {
    if (!withFuel.has(d.vehicleId)) continue;
    km += d.km;
    if (d.amount !== null && d.amount > 0) {
      amount += d.amount;
      dates.add(d.date);
    }
  }
  return { km: Math.round(km), amount: r2(amount), ratio: r3(consumptionRatio(energy, km, amount)), days: dates.size, vehicles: withFuel.size };
}

/** Série diária do período, com os dias sem dado em zero (para o eixo não pular). */
export function dailySeries(energy: VehicleTechnology, days: Iterable<CarDay>, from: string, to: string, onlyWithFuel = true): ConsumptionDayPoint[] {
  const list = [...days];
  const withFuel = new Set<string>();
  for (const d of list) if (d.amount !== null && d.amount > 0) withFuel.add(d.vehicleId);
  const byDate = new Map<string, { km: number; amount: number; vehicles: Set<string> }>();
  for (let d = from; d <= to; d = addDays(d, 1)) byDate.set(d, { km: 0, amount: 0, vehicles: new Set() });
  for (const d of list) {
    if (onlyWithFuel && !withFuel.has(d.vehicleId)) continue;
    const slot = byDate.get(d.date);
    if (!slot) continue;
    slot.km += d.km;
    if (d.amount !== null && d.amount > 0) {
      slot.amount += d.amount;
      slot.vehicles.add(d.vehicleId);
    }
  }
  const rows = [...byDate.entries()].map(([date, s]) => ({ date, km: Math.round(s.km), amount: r2(s.amount), vehicles: s.vehicles.size }));
  return rows.map((r, i) => {
    const win = rows.slice(Math.max(0, i - 6), i + 1).filter((w) => w.amount > 0);
    const wk = win.reduce((s, w) => s + w.km, 0);
    const wa = win.reduce((s, w) => s + w.amount, 0);
    return {
      ...r,
      ratio: r3(r.amount > 0 && r.km > 0 ? consumptionRatio(energy, r.km, r.amount) : null),
      rolling7: r3(win.length >= 3 ? consumptionRatio(energy, wk, wa) : null),
    };
  });
}

export function monthPoint(energy: VehicleTechnology, month: string, days: Iterable<CarDay>): ConsumptionMonthPoint {
  const t = totalsOf(energy, days);
  return { month, km: t.km, amount: t.amount, ratio: t.ratio, vehicles: t.vehicles };
}

/** Por carro: km, consumo, rendimento, dias com dado e dias rodados sem registro. */
export function perVehicle(energy: VehicleTechnology, days: Iterable<CarDay>): Map<string, { km: number; amount: number; days: number; kmNoFuel: number; fuelNoKm: number; tech: string | null; ratio: number | null }> {
  const acc = new Map<string, { km: number; amount: number; days: number; kmNoFuel: number; fuelNoKm: number; tech: string | null; ratio: number | null }>();
  for (const d of days) {
    const cur = acc.get(d.vehicleId) ?? { km: 0, amount: 0, days: 0, kmNoFuel: 0, fuelNoKm: 0, tech: null, ratio: null };
    cur.km += d.km;
    if (d.amount !== null && d.amount > 0) {
      cur.amount += d.amount;
      cur.days += 1;
      cur.tech = cur.tech ?? d.tech;
      if (d.km <= 0) cur.fuelNoKm += 1;
    } else if (d.km > 0) cur.kmNoFuel += 1;
    acc.set(d.vehicleId, cur);
  }
  for (const v of acc.values()) {
    v.km = Math.round(v.km);
    v.amount = r2(v.amount);
    v.ratio = v.days > 0 ? r3(consumptionRatio(energy, v.km, v.amount)) : null;
  }
  return acc;
}

export interface VehicleComparison {
  rows: ConsumptionVehicleRow[];
  byTech: ConsumptionTechGroup[];
  quality: ConsumptionQuality;
}

/**
 * Compara cada carro com o grupo (tecnologia da planilha). A referência do
 * grupo é a mediana do rendimento dos carros com amostra suficiente — um
 * carro com defeito não arrasta a régua dos outros.
 */
export function compareVehicles(
  energy: VehicleTechnology,
  vehicles: VehicleInfo[],
  days: Iterable<CarDay>,
  fallbackTech: (v: VehicleInfo) => string,
  stalls: Map<string, ConsumptionStall[]> = new Map(),
): VehicleComparison {
  const list = [...days];
  const per = perVehicle(energy, list);
  const infoById = new Map(vehicles.map((v) => [v.id, v]));

  type Draft = Omit<ConsumptionVehicleRow, 'reference' | 'deviation' | 'flag'>;
  const drafts: Draft[] = [];
  for (const v of vehicles) {
    const p = per.get(v.id);
    const stall = stalls.get(v.id)?.[0] ?? null;
    // Carro cujo período inteiro foi odômetro parado continua na lista (com a etiqueta), sem número.
    if (!p || (p.km <= 0 && p.days === 0)) {
      if (stall) drafts.push({ vehicleId: v.id, code: v.code, plate: v.plate, model: v.model, vehicleClass: v.vehicleClass, tech: fallbackTech(v), km: 0, amount: 0, ratio: null, days: 0, daysKmWithoutFuel: 0, stall });
      continue;
    }
    drafts.push({ vehicleId: v.id, code: v.code, plate: v.plate, model: v.model, vehicleClass: v.vehicleClass, tech: p.tech ?? fallbackTech(v), km: p.km, amount: p.amount, ratio: p.ratio, days: p.days, daysKmWithoutFuel: p.kmNoFuel, stall });
  }

  const groups = new Map<string, Draft[]>();
  for (const d of drafts) {
    const g = groups.get(d.tech) ?? [];
    g.push(d);
    groups.set(d.tech, g);
  }

  const rows: ConsumptionVehicleRow[] = [];
  const byTech: ConsumptionTechGroup[] = [];
  for (const [tech, members] of groups) {
    const sample = members.filter((m) => m.days >= CONSUMPTION_MIN_DAYS && m.ratio !== null).map((m) => m.ratio as number);
    const reference = r3(median(sample));
    let high = 0;
    let watch = 0;
    let km = 0;
    let amount = 0;
    let withData = 0;
    for (const m of members) {
      const deviation = r3(consumptionDeviation(energy, m.ratio, reference));
      const flag = consumptionFlagOf(deviation, m.days, m.km > 0);
      if (flag === ConsumptionFlag.HIGH) high += 1;
      if (flag === ConsumptionFlag.WATCH) watch += 1;
      if (m.days > 0) {
        km += m.km;
        amount += m.amount;
        withData += 1;
      }
      rows.push({ ...m, reference, deviation, flag });
    }
    byTech.push({ tech, vehicles: withData, km: Math.round(km), amount: r2(amount), ratio: r3(consumptionRatio(energy, km, amount)), reference, high, watch });
  }

  // Grupos do maior para o menor (em carros); carros do pior para o melhor rendimento.
  // Quem tem poucos dias não entra na comparação e fica depois dos comparáveis; sem dado por último.
  byTech.sort((a, b) => b.vehicles - a.vehicles || a.tech.localeCompare(b.tech));
  const tier = (r: ConsumptionVehicleRow) => (r.flag === ConsumptionFlag.NO_DATA ? 2 : r.flag === ConsumptionFlag.FEW_DAYS ? 1 : 0);
  rows.sort((a, b) => {
    const da = a.deviation ?? -Infinity;
    const db = b.deviation ?? -Infinity;
    return tier(a) - tier(b) || db - da || a.code.localeCompare(b.code);
  });

  let lastDate: string | null = null;
  let lastKmDate: string | null = null;
  let daysKmWithoutFuel = 0;
  let daysFuelWithoutKm = 0;
  for (const d of list) {
    if (d.amount !== null && d.amount > 0) {
      if (!lastDate || d.date > lastDate) lastDate = d.date;
      if (d.km <= 0) daysFuelWithoutKm += 1;
    } else if (d.km > 0) daysKmWithoutFuel += 1;
    if (d.km > 0 && (!lastKmDate || d.date > lastKmDate)) lastKmDate = d.date;
  }
  const vehiclesWithoutData = rows.filter((r) => r.flag === ConsumptionFlag.NO_DATA && infoById.has(r.vehicleId)).length;
  const stalledVehicles = [...stalls.entries()]
    .filter(([id, s]) => infoById.has(id) && s.length > 0)
    .map(([id, s]) => ({ vehicleId: id, code: infoById.get(id)!.code, from: s[0]!.from, to: s[s.length - 1]!.to }))
    .sort((a, b) => a.code.localeCompare(b.code));

  return { rows, byTech, quality: { vehiclesWithoutData, daysKmWithoutFuel, daysFuelWithoutKm, lastDate, lastKmDate, missingDates: [], stalledVehicles } };
}
