import { http, HttpResponse } from 'msw';
import {
  CONSUMPTION_MIN_DAYS,
  consumptionComparisonWindow,
  consumptionDeviation,
  consumptionFlagOf,
  consumptionRatio,
  ConsumptionFlag,
  VehicleTechnology,
  type ConsumptionDayPoint,
  type ConsumptionFleet,
  type ConsumptionMonthPoint,
  type ConsumptionTechGroup,
  type ConsumptionTotals,
  type ConsumptionVehicleDetail,
  type ConsumptionVehicleRow,
} from '@app/shared';

/**
 * Consumo no modo mock: uma frota inventada (180 diesel, 60 elétricos) com km
 * e consumo diários gerados de forma determinística, para as telas de
 * consumo renderizarem com volume parecido com o real. A conta aqui é uma
 * versão reduzida da do servidor (apps/api/src/consumption/consumption.calc.ts).
 */

type Car = { id: string; code: string; plate: string; model: string; vehicleClass: string; tech: string; energy: VehicleTechnology; factor: number };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const TECHS: { tech: string; energy: VehicleTechnology; model: string; vehicleClass: string; n: number; rate: number }[] = [
  { tech: 'Padron AC', energy: VehicleTechnology.DIESEL, model: 'O500 U-AC', vehicleClass: 'PADRON_13M', n: 110, rate: 2.25 },
  { tech: 'Básico', energy: VehicleTechnology.DIESEL, model: 'OF 1721', vehicleClass: 'BASICO_12M', n: 45, rate: 3.1 },
  { tech: 'Articulado 23m AC', energy: VehicleTechnology.DIESEL, model: 'O500 UDA-AC', vehicleClass: 'ARTICULADO_23M', n: 20, rate: 1.35 },
  { tech: 'Articulado AC', energy: VehicleTechnology.DIESEL, model: 'O500 UA-AC', vehicleClass: 'ARTICULADO_18M', n: 5, rate: 1.6 },
  { tech: 'ePadron 15m AC', energy: VehicleTechnology.EBUS, model: 'e-Bus Scania', vehicleClass: 'EPADRON_15M', n: 28, rate: 1.45 },
  { tech: 'ePadron AC', energy: VehicleTechnology.EBUS, model: 'e-Bus Volkswagen', vehicleClass: 'EPADRON_13M', n: 26, rate: 1.25 },
  { tech: 'eArticulado AC', energy: VehicleTechnology.EBUS, model: 'e-Bus BRT BYD', vehicleClass: 'EARTICULADO_23M', n: 6, rate: 1.9 },
];

const rand = rng(20261123);
const cars: Car[] = [];
let n = 0;
for (const t of TECHS) {
  for (let i = 0; i < t.n; i += 1) {
    n += 1;
    const roll = rand();
    const factor = roll < 0.06 ? 1.18 + rand() * 0.16 : roll < 0.09 ? 0.9 + rand() * 0.05 : 1 + (rand() - 0.5) * 0.1;
    const code = String(n).padStart(3, '0');
    cars.push({ id: `c0000000-0000-4000-8000-${code.padStart(12, '0')}`, code, plate: `MOC${code}${String.fromCharCode(65 + (n % 26))}`, model: t.model, vehicleClass: t.vehicleClass, tech: t.tech, energy: t.energy, factor });
  }
}
const rateOf = new Map(TECHS.map((t) => [t.tech, t.rate]));

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s: string, k: number) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + k); return iso(d); };

/** Km e consumo de um carro num dia, determinísticos pela data. */
function carDay(c: Car, date: string): { km: number; amount: number | null } {
  // Semente misturada (e dois sorteios descartados): com sementes vizinhas o
  // gerador linear devolve primeiros valores quase iguais e inventa semanas inteiras sem rodar.
  const r = rng((Math.imul(Number(date.replace(/-/g, '')), 2654435761) ^ Math.imul(Number(c.code) + 1, 0x9e3779b1)) >>> 0);
  r(); r();
  const dow = new Date(`${date}T12:00:00`).getDay();
  if (r() < (dow === 0 ? 0.35 : 0.08)) return { km: 0, amount: null };
  const km = Math.round(160 + r() * 180);
  if (r() < 0.03) return { km, amount: null };
  const month = Number(date.slice(5, 7));
  const season = month <= 3 || month === 12 ? 1.06 : month >= 10 ? 1.03 : 1;
  const f = c.factor * season * (0.93 + r() * 0.14);
  const rate = rateOf.get(c.tech)!;
  const amount = c.energy === VehicleTechnology.DIESEL ? km / (rate / f) : km * rate * f;
  return { km, amount: Math.round(amount * 10) / 10 };
}

const r3 = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000);

function totals(energy: VehicleTechnology, list: { km: number; amount: number | null; date: string; id: string }[]): ConsumptionTotals {
  const withFuel = new Set(list.filter((d) => d.amount).map((d) => d.id));
  let km = 0; let amount = 0; const dates = new Set<string>();
  for (const d of list) { if (!withFuel.has(d.id)) continue; km += d.km; if (d.amount) { amount += d.amount; dates.add(d.date); } }
  return { km, amount: Math.round(amount * 100) / 100, ratio: r3(consumptionRatio(energy, km, amount)), days: dates.size, vehicles: withFuel.size };
}

function daily(energy: VehicleTechnology, list: { km: number; amount: number | null; date: string; id: string }[], from: string, to: string): ConsumptionDayPoint[] {
  const rows: { date: string; km: number; amount: number; vehicles: number }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const day = list.filter((x) => x.date === d);
    rows.push({ date: d, km: day.reduce((s, x) => s + x.km, 0), amount: Math.round(day.reduce((s, x) => s + (x.amount ?? 0), 0) * 10) / 10, vehicles: day.filter((x) => x.amount).length });
  }
  return rows.map((r, i) => {
    const win = rows.slice(Math.max(0, i - 6), i + 1).filter((w) => w.amount > 0);
    return { ...r, ratio: r3(r.amount > 0 && r.km > 0 ? consumptionRatio(energy, r.km, r.amount) : null), rolling7: r3(win.length >= 3 ? consumptionRatio(energy, win.reduce((s, w) => s + w.km, 0), win.reduce((s, w) => s + w.amount, 0)) : null) };
  });
}

function monthly(energy: VehicleTechnology, fleet: Car[], to: string): ConsumptionMonthPoint[] {
  const out: ConsumptionMonthPoint[] = [];
  const [y, m] = to.split('-').map(Number) as [number, number];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(y, m - 1 - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const first = `${key}-01`;
    const last = key === to.slice(0, 7) ? to : iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    // Amostra de 1 em 3 carros, para o mock responder rápido.
    const list = fleet.filter((_, k) => k % 3 === 0).flatMap((c) => { const rows = []; for (let dd = first; dd <= last; dd = addDays(dd, 1)) rows.push({ id: c.id, date: dd, ...carDay(c, dd) }); return rows; });
    const t = totals(energy, list);
    out.push({ month: key, km: t.km * 3, amount: Math.round(t.amount * 3), ratio: t.ratio, vehicles: t.vehicles * 3 });
  }
  return out;
}

function median(v: number[]): number | null { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; }

function fleetOf(energy: VehicleTechnology, from: string, to: string): ConsumptionFleet {
  const fleet = cars.filter((c) => c.energy === energy);
  const { from: prevFrom, to: prevTo } = consumptionComparisonWindow(from, to);
  const build = (a: string, b: string) => fleet.flatMap((c) => { const rows = []; for (let d = a; d <= b; d = addDays(d, 1)) rows.push({ id: c.id, date: d, ...carDay(c, d) }); return rows; });
  const cur = build(from, to);
  const prev = build(prevFrom, prevTo);

  const per = new Map<string, { km: number; amount: number; days: number; noFuel: number }>();
  for (const d of cur) { const p = per.get(d.id) ?? { km: 0, amount: 0, days: 0, noFuel: 0 }; p.km += d.km; if (d.amount) { p.amount += d.amount; p.days += 1; } else if (d.km > 0) p.noFuel += 1; per.set(d.id, p); }
  const drafts = fleet.map((c) => { const p = per.get(c.id)!; return { c, ...p, ratio: p.days > 0 ? r3(consumptionRatio(energy, p.km, p.amount)) : null }; }).filter((d) => d.km > 0 || d.days > 0);
  const byTech: ConsumptionTechGroup[] = [];
  const rows: ConsumptionVehicleRow[] = [];
  for (const t of TECHS.filter((t) => t.energy === energy)) {
    const members = drafts.filter((d) => d.c.tech === t.tech);
    if (!members.length) continue;
    const reference = r3(median(members.filter((m) => m.days >= CONSUMPTION_MIN_DAYS && m.ratio !== null).map((m) => m.ratio as number)));
    let high = 0; let watch = 0; let km = 0; let amount = 0; let withData = 0;
    for (const m of members) {
      const deviation = r3(consumptionDeviation(energy, m.ratio, reference));
      const flag = consumptionFlagOf(deviation, m.days, m.km > 0);
      if (flag === ConsumptionFlag.HIGH) high += 1; if (flag === ConsumptionFlag.WATCH) watch += 1;
      if (m.days > 0) { km += m.km; amount += m.amount; withData += 1; }
      rows.push({ vehicleId: m.c.id, code: m.c.code, plate: m.c.plate, model: m.c.model, vehicleClass: m.c.vehicleClass, tech: m.c.tech, km: m.km, amount: Math.round(m.amount * 100) / 100, ratio: m.ratio, reference, deviation, days: m.days, daysKmWithoutFuel: m.noFuel, flag, stall: null });
    }
    byTech.push({ tech: t.tech, vehicles: withData, km, amount: Math.round(amount), ratio: r3(consumptionRatio(energy, km, amount)), reference, high, watch });
  }
  const tier = (r: ConsumptionVehicleRow) => (r.flag === ConsumptionFlag.NO_DATA ? 2 : r.flag === ConsumptionFlag.FEW_DAYS ? 1 : 0);
  rows.sort((a, b) => tier(a) - tier(b) || ((b.deviation ?? -Infinity) - (a.deviation ?? -Infinity)) || a.code.localeCompare(b.code));
  const kmNoFuel = cur.filter((d) => d.km > 0 && !d.amount).length;
  return {
    energy, from, to, source: 'mock',
    current: totals(energy, cur), previous: totals(energy, prev), previousFrom: prevFrom, previousTo: prevTo, fleetVehicles: fleet.length,
    daily: daily(energy, cur, from, to), monthly: monthly(energy, fleet, to), firstMonth: null, byTech, vehicles: rows,
    quality: { vehiclesWithoutData: rows.filter((r) => r.flag === ConsumptionFlag.NO_DATA).length, daysKmWithoutFuel: kmNoFuel, daysFuelWithoutKm: 0, lastDate: to, lastKmDate: to, missingDates: [], stalledVehicles: [], kmWithoutFuel: [], fuelWithoutKm: [] },
  };
}

function vehicleOf(id: string, from: string, to: string): ConsumptionVehicleDetail | null {
  const c = cars.find((x) => x.id === id);
  if (!c) return null;
  const fleet = fleetOf(c.energy, from, to);
  const row = fleet.vehicles.find((r) => r.vehicleId === id) ?? null;
  const { from: prevFrom, to: prevTo } = consumptionComparisonWindow(from, to);
  const build = (a: string, b: string) => { const rows = []; for (let d = a; d <= b; d = addDays(d, 1)) rows.push({ id: c.id, date: d, ...carDay(c, d) }); return rows; };
  const cur = build(from, to);
  const prev = build(prevFrom, prevTo);
  const comparable = (f: ConsumptionFlag) => f === ConsumptionFlag.OK || f === ConsumptionFlag.WATCH || f === ConsumptionFlag.HIGH;
  const peers = fleet.vehicles.filter((r) => r.tech === c.tech && r.deviation !== null && comparable(r.flag)).sort((a, b) => (a.deviation as number) - (b.deviation as number));
  const pos = row && comparable(row.flag) ? peers.findIndex((r) => r.vehicleId === id) + 1 : 0;
  const months: ConsumptionMonthPoint[] = [];
  const [y, m] = to.split('-').map(Number) as [number, number];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(y, m - 1 - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const t = totals(c.energy, build(`${key}-01`, key === to.slice(0, 7) ? to : iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))));
    months.push({ month: key, km: t.km, amount: t.amount, ratio: t.ratio, vehicles: t.vehicles });
  }
  return {
    vehicle: { id: c.id, code: c.code, plate: c.plate, manufacturer: c.energy === VehicleTechnology.EBUS ? null : 'Mercedes-Benz', model: c.model, vehicleClass: c.vehicleClass, technology: c.energy, lot: 'AR9' },
    energy: c.energy, tech: c.tech, from, to,
    current: totals(c.energy, cur), previous: totals(c.energy, prev), previousFrom: prevFrom, previousTo: prevTo,
    reference: row?.reference ?? null, deviation: row?.deviation ?? null, flag: row?.flag ?? ConsumptionFlag.FEW_DAYS,
    rank: pos > 0 ? { position: pos, of: peers.length } : null,
    daily: daily(c.energy, cur, from, to), monthly: months,
    daysKmWithoutFuel: row?.daysKmWithoutFuel ?? 0,
    stalls: [],
  };
}

const todayIso = () => iso(new Date());
const clampTo = (to: string | null) => (!to || to > todayIso() ? todayIso() : to);

export const consumptionHandlers = [
  http.get('*/api/consumption', ({ request }) => {
    const url = new URL(request.url);
    const energy = url.searchParams.get('energy') === 'EBUS' ? VehicleTechnology.EBUS : VehicleTechnology.DIESEL;
    const to = clampTo(url.searchParams.get('to'));
    const from = url.searchParams.get('from') ?? `${to.slice(0, 7)}-01`;
    return HttpResponse.json(fleetOf(energy, from, to));
  }),
  http.get('*/api/consumption/vehicles/:id', ({ request, params }) => {
    const url = new URL(request.url);
    const to = clampTo(url.searchParams.get('to'));
    const from = url.searchParams.get('from') ?? `${to.slice(0, 7)}-01`;
    const detail = vehicleOf(String(params.id), from, to);
    if (!detail) return HttpResponse.json({ statusCode: 404, code: 'NOT_FOUND', message: 'Carro não encontrado', timestamp: new Date().toISOString(), path: '/api/consumption/vehicles' }, { status: 404 });
    return HttpResponse.json(detail);
  }),
];
