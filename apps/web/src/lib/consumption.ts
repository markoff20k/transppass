import { CONSUMPTION_UNITS, ConsumptionFlag, VehicleTechnology, consumptionRatio, type ConsumptionDayPoint, type ConsumptionTotals } from '@app/shared';

/**
 * Leitura e formatação do consumo no front: a mesma linguagem nas duas telas
 * (frota e carro) e nas duas tecnologias.
 */

export const ENERGY_LABEL: Record<VehicleTechnology, string> = { DIESEL: 'Diesel', EBUS: 'Energia' };
export const ENERGY_FLEET_LABEL: Record<VehicleTechnology, string> = { DIESEL: 'frota diesel', EBUS: 'frota elétrica' };
/** Cor da série por tecnologia: laranja da marca no diesel, verde (o mesmo dos ônibus elétricos no desenho) na energia. */
export const ENERGY_COLOR: Record<VehicleTechnology, string> = { DIESEL: 'var(--chart-1)', EBUS: 'var(--chart-4)' };

export const unitsOf = (energy: VehicleTechnology) => CONSUMPTION_UNITS[energy];

/** "2,31" — rendimento com duas casas (km/l ou kWh/km). */
export function fmtRatio(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Litros ou kWh: inteiro acima de mil, uma casa abaixo. */
export function fmtAmount(value: number): string {
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString('pt-BR');
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** "+12%" / "−3%" / "0%" — desvio com sinal (positivo = gasta mais). */
export function fmtDeviation(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return '—';
  const pct = value * 100;
  const rounded = Number(pct.toFixed(digits));
  const text = Math.abs(rounded).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (rounded === 0) return `${text}%`;
  return `${rounded > 0 ? '+' : '−'}${text}%`;
}

/**
 * Variação do rendimento entre dois períodos, já no sentido "melhor/pior":
 * positivo é melhora nas duas tecnologias (mais km/l; menos kWh/km).
 */
export function improvement(energy: VehicleTechnology, current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || current <= 0 || previous <= 0) return null;
  const change = current / previous - 1;
  return energy === VehicleTechnology.DIESEL ? change : -change;
}

export type Tone = 'good' | 'warn' | 'danger' | 'neutral';

export function flagTone(flag: ConsumptionFlag): Tone {
  if (flag === ConsumptionFlag.HIGH) return 'danger';
  if (flag === ConsumptionFlag.WATCH) return 'warn';
  if (flag === ConsumptionFlag.OK) return 'good';
  return 'neutral';
}

export function kpiToneClass(tone: Tone): string {
  return tone === 'good' ? 'tp-kpi--good' : tone === 'warn' ? 'tp-kpi--warn' : tone === 'danger' ? 'tp-kpi--danger' : '';
}

/**
 * Classe do número do desvio: cor só quando ela diz algo — vermelho acima do
 * limite crítico, âmbar em atenção, verde quando o carro gasta claramente
 * menos que o grupo. Um +3% dentro do padrão fica neutro.
 */
export function deviationClass(flag: ConsumptionFlag, deviation: number | null): string {
  if (flag === ConsumptionFlag.HIGH) return 'cons-dev--bad';
  if (flag === ConsumptionFlag.WATCH) return 'cons-dev--warn';
  if (flag === ConsumptionFlag.OK && deviation !== null && deviation <= -0.07) return 'cons-dev--good';
  return '';
}

export function badgeToneClass(tone: Tone): string {
  return tone === 'good' ? 'tp-badge--success' : tone === 'warn' ? 'tp-badge--warning' : tone === 'danger' ? 'tp-badge--danger' : '';
}

/** "1.940.049 km ÷ 868.358 L" — a conta por extenso, para ninguém ter de confiar no número. */
export function ratioFormula(energy: VehicleTechnology, t: ConsumptionTotals): string {
  const u = unitsOf(energy);
  if (energy === VehicleTechnology.DIESEL) return `${Math.round(t.km).toLocaleString('pt-BR')} km ÷ ${fmtAmount(t.amount)} ${u.amount}`;
  return `${fmtAmount(t.amount)} ${u.amount} ÷ ${Math.round(t.km).toLocaleString('pt-BR')} km`;
}

/** "AAAA-MM-DD" → "DD/MM". */
export function dayLabel(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export type Granularity = 'day' | 'week';

/** Acima disto o dia a dia vira ruído na largura de um gráfico; os pontos passam a ser semanas. */
export const WEEKLY_FROM_DAYS = 70;

/** Ponto de uma série de rendimento: um dia, ou uma semana (de `date` a `end`). */
export interface TrendPoint extends ConsumptionDayPoint {
  end?: string;
}

const shiftIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Agrupa os dias em semanas de segunda a domingo (a primeira e a última podem
 * ser parciais, presas às bordas do período). O rendimento da semana é a soma
 * do km pela soma do consumo — não a média dos dias —, e a linha passa a ser
 * a própria sequência semanal (não há média móvel).
 */
export function bucketWeekly(energy: VehicleTechnology, daily: ConsumptionDayPoint[]): TrendPoint[] {
  const weeks = new Map<string, TrendPoint>();
  for (const d of daily) {
    const dow = (new Date(`${d.date}T12:00:00`).getDay() + 6) % 7; // 0 = segunda
    const monday = shiftIso(d.date, -dow);
    const w = weeks.get(monday);
    if (!w) {
      weeks.set(monday, { date: d.date, end: d.date, km: d.km, amount: d.amount, ratio: null, rolling7: null, vehicles: d.vehicles });
    } else {
      w.end = d.date;
      w.km += d.km;
      w.amount += d.amount;
      w.vehicles = Math.max(w.vehicles, d.vehicles);
    }
  }
  return [...weeks.values()].map((w) => {
    const ratio = w.km > 0 && w.amount > 0 ? Math.round((consumptionRatio(energy, w.km, w.amount) ?? 0) * 1000) / 1000 : null;
    return { ...w, ratio, rolling7: ratio };
  });
}

/** "05/10" para um dia; "05/10 a 11/10" para uma semana. */
export function pointLabel(p: TrendPoint, granularity: Granularity): string {
  if (granularity === 'week' && p.end && p.end !== p.date) return `${dayLabel(p.date)} a ${dayLabel(p.end)}`;
  return dayLabel(p.date);
}

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** "2026-09" → "set/26". */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return `${MONTHS_PT[m - 1]}/${String(y).slice(2)}`;
}

/**
 * Título da série mensal: "Últimos 12 meses" quando ela termina no mês
 * corrente; "12 meses até setembro 2026" quando o período escolhido é outro.
 * No horizonte "Tudo", o primeiro mês com registro.
 */
export function horizonTitle(months: number, series: { month: string }[], firstMonth: string | null): string {
  const last = series[series.length - 1]?.month;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const toCurrent = !last || last === currentMonth;
  if (months >= 60) return firstMonth ? `Desde ${monthLabel(firstMonth)}` : 'Todo o histórico';
  if (toCurrent) return `Últimos ${months} meses`;
  const [y, m] = last.split('-').map(Number) as [number, number];
  return `${months} meses até ${new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`;
}
