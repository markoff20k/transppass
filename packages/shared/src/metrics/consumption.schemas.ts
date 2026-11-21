import { z } from 'zod';
import { VehicleTechnology } from '../fleet/vehicle.schemas.js';

/**
 * Consumo de diesel e de energia — frota e carro.
 *
 * A planilha da Transppass traz, por carro e dia, litros (diesel) ou kWh
 * (elétrico). Cruzado com o km diário do mesmo carro, vira o rendimento:
 *
 *   diesel   → km/l   (quanto maior, melhor)
 *   elétrico → kWh/km (quanto menor, melhor)
 *
 * Os dois usam a convenção da operação: o diesel é lido em "quilômetros por
 * litro" e o elétrico em "quilowatt-hora por quilômetro". Para comparar um
 * carro com os iguais a ele, o grupo é a tecnologia da planilha ("Padron AC",
 * "eArticulado AC") e o desvio é sempre "quanto a mais de energia por km",
 * positivo quando o carro gasta mais que o grupo — em qualquer das duas
 * tecnologias.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const consumptionQuerySchema = z.object({
  energy: z.nativeEnum(VehicleTechnology).default(VehicleTechnology.DIESEL),
  from: z.string().regex(ISO_DAY, 'Data no formato AAAA-MM-DD'),
  to: z.string().regex(ISO_DAY, 'Data no formato AAAA-MM-DD'),
  /** Horizonte da série mensal (meses até hoje): 12 por padrão, até 60. */
  months: z.coerce.number().int().min(12).max(60).default(12),
});
export type ConsumptionQuery = z.infer<typeof consumptionQuerySchema>;

export const consumptionVehicleQuerySchema = z.object({
  from: z.string().regex(ISO_DAY, 'Data no formato AAAA-MM-DD'),
  to: z.string().regex(ISO_DAY, 'Data no formato AAAA-MM-DD'),
});
export type ConsumptionVehicleQuery = z.infer<typeof consumptionVehicleQuerySchema>;

/** Maior janela aceita numa consulta (dias): 13 meses cabem, um ano inteiro mais o corrente. */
export const CONSUMPTION_MAX_DAYS = 400;

// --- Datas "AAAA-MM-DD" sem fuso: toda a conta é em UTC puro -------------------
const dayUTC = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoUTC = (d: Date) => d.toISOString().slice(0, 10);
const monthLength = (year: number, month0: number) => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();

/** Dias corridos entre dois dias "AAAA-MM-DD", inclusivo (1 jan a 31 jan = 31). */
export function consumptionSpanDays(from: string, to: string): number {
  return Math.round((dayUTC(to).getTime() - dayUTC(from).getTime()) / 86_400_000) + 1;
}

/**
 * Período de comparação de uma janela.
 *
 * Janela alinhada ao calendário (começa no dia 1) compara com a mesma unidade
 * anterior: outubro com setembro, "novembro até o dia 23" com "outubro até o
 * dia 23", um trimestre com o trimestre anterior, "2026 até hoje" com "2025 até
 * o mesmo dia". Janela móvel (últimos 30 dias, intervalo qualquer) compara com
 * os mesmos N dias imediatamente antes. API, mock e tela usam esta função, para
 * o rótulo "vs setembro" ser sempre exatamente o que foi comparado.
 *
 * `today` distingue "trimestre/ano em curso" (termina hoje) de um mês fechado
 * que por acaso começa um trimestre: outubro inteiro compara com setembro;
 * "1º de outubro até hoje" compara com o trimestre anterior até o mesmo dia.
 */
export function consumptionComparisonWindow(from: string, to: string, today: string = isoUTC(new Date())): { from: string; to: string } {
  const f = dayUTC(from);
  const t = dayUTC(to);
  if (f.getUTCDate() === 1 && t.getTime() >= f.getTime()) {
    const touched = (t.getUTCFullYear() - f.getUTCFullYear()) * 12 + (t.getUTCMonth() - f.getUTCMonth()) + 1;
    const sameYear = t.getUTCFullYear() === f.getUTCFullYear();
    const sameQuarter = sameYear && Math.floor(t.getUTCMonth() / 3) === Math.floor(f.getUTCMonth() / 3);
    const endsOnLastDay = t.getUTCDate() === monthLength(t.getUTCFullYear(), t.getUTCMonth());
    const inProgress = to === today;
    // Unidade: ano (1º de janeiro até 31/12 ou até hoje), trimestre (começa num trimestre e vai até o fim dele ou até hoje), senão os meses tocados.
    let unit = touched;
    if (f.getUTCMonth() === 0 && sameYear && (t.getUTCMonth() === 11 || inProgress)) unit = 12;
    else if (f.getUTCMonth() % 3 === 0 && sameQuarter && ((touched === 3 && endsOnLastDay) || inProgress)) unit = 3;
    const pf = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - unit, 1));
    const ptMonth = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - unit, 1));
    const len = monthLength(ptMonth.getUTCFullYear(), ptMonth.getUTCMonth());
    const day = endsOnLastDay ? len : Math.min(t.getUTCDate(), len);
    return { from: isoUTC(pf), to: isoUTC(new Date(Date.UTC(ptMonth.getUTCFullYear(), ptMonth.getUTCMonth(), day))) };
  }
  const span = consumptionSpanDays(from, to);
  const shift = (iso: string, n: number) => { const d = dayUTC(iso); d.setUTCDate(d.getUTCDate() + n); return isoUTC(d); };
  return { from: shift(from, -span), to: shift(from, -1) };
}

/** Desvio em relação ao grupo a partir do qual o carro pede atenção / é crítico (fração). ARBITRADO até o PCM fixar. */
export const CONSUMPTION_WATCH_DEVIATION = 0.07;
export const CONSUMPTION_HIGH_DEVIATION = 0.15;
/** Dias com dado abaixo disso o carro não é comparado: a amostra é pequena demais. */
export const CONSUMPTION_MIN_DAYS = 5;

/**
 * Odômetro parado: o carro abastece normalmente e o km não anda. Um dia
 * isolado assim é normal (abastece à noite, o km aparece no dia seguinte; na
 * base real metade dos abastecimentos de segunda-feira vem com km zero), por
 * isso só conta um trecho de registros seguidos. Calibrado nos 11 meses de
 * 2026: 5+ registros até 40 km pegam 4 carros no ano (095, 151, 375, 996);
 * 3+ pegariam fins de semana e carros que abastecem dia sim, dia não.
 */
export const CONSUMPTION_STALL_MIN_AMOUNT: Record<VehicleTechnology, number> = { DIESEL: 40, EBUS: 60 };
export const CONSUMPTION_STALL_MAX_KM = 40;
export const CONSUMPTION_STALL_MIN_RECORDS = 5;
export const CONSUMPTION_STALL_MAX_GAP_DAYS = 2;

/** Trecho em que o carro abasteceu e o odômetro não contou; os carro-dias dele ficam fora da conta. */
export interface ConsumptionStall {
  from: string;
  to: string;
  /** Registros de abastecimento no trecho. */
  days: number;
  /** Litros ou kWh abastecidos no trecho. */
  amount: number;
  /** Km registrado no trecho (quase nada, por definição). */
  km: number;
}

export const ConsumptionFlag = {
  OK: 'OK',
  WATCH: 'WATCH',
  HIGH: 'HIGH',
  /** Poucos dias com dado no período: não dá para comparar. */
  FEW_DAYS: 'FEW_DAYS',
  /** O carro tem km no período, mas nenhum registro de consumo. */
  NO_DATA: 'NO_DATA',
} as const;
export type ConsumptionFlag = (typeof ConsumptionFlag)[keyof typeof ConsumptionFlag];

export const CONSUMPTION_FLAG_LABELS: Record<ConsumptionFlag, string> = {
  OK: 'No padrão',
  WATCH: 'Atenção',
  HIGH: 'Acima do grupo',
  FEW_DAYS: 'Poucos dias',
  NO_DATA: 'Sem registro',
};

/** Unidades por tecnologia, para rótulos. */
export const CONSUMPTION_UNITS: Record<VehicleTechnology, { amount: string; ratio: string; amountLong: string; ratioLong: string }> = {
  DIESEL: { amount: 'L', ratio: 'km/l', amountLong: 'litros', ratioLong: 'quilômetros por litro' },
  EBUS: { amount: 'kWh', ratio: 'kWh/km', amountLong: 'quilowatts-hora', ratioLong: 'quilowatts-hora por quilômetro' },
};

/** Rendimento no sentido da tecnologia: km/l para diesel, kWh/km para elétrico. Nulo sem divisão possível. */
export function consumptionRatio(energy: VehicleTechnology, km: number, amount: number): number | null {
  if (energy === VehicleTechnology.DIESEL) return amount > 0 ? km / amount : null;
  return km > 0 ? amount / km : null;
}

/**
 * Quanto a mais de energia por km o carro gasta em relação a uma referência
 * (fração; +0,12 = gasta 12% a mais). Positivo é pior nas duas tecnologias.
 */
export function consumptionDeviation(energy: VehicleTechnology, ratio: number | null, reference: number | null): number | null {
  if (ratio === null || reference === null || ratio <= 0 || reference <= 0) return null;
  return energy === VehicleTechnology.DIESEL ? reference / ratio - 1 : ratio / reference - 1;
}

export function consumptionFlagOf(deviation: number | null, days: number, hasKm: boolean): ConsumptionFlag {
  if (days === 0) return hasKm ? ConsumptionFlag.NO_DATA : ConsumptionFlag.FEW_DAYS;
  if (days < CONSUMPTION_MIN_DAYS || deviation === null) return ConsumptionFlag.FEW_DAYS;
  if (deviation >= CONSUMPTION_HIGH_DEVIATION) return ConsumptionFlag.HIGH;
  if (deviation >= CONSUMPTION_WATCH_DEVIATION) return ConsumptionFlag.WATCH;
  return ConsumptionFlag.OK;
}

export interface ConsumptionTotals {
  km: number;
  /** Litros ou kWh. */
  amount: number;
  /** km/l ou kWh/km; nulo quando não há divisão. */
  ratio: number | null;
  /** Dias (distintos) com registro de consumo. */
  days: number;
  /** Carros com registro de consumo no período. */
  vehicles: number;
}

export interface ConsumptionDayPoint {
  date: string;
  km: number;
  amount: number;
  ratio: number | null;
  /** Média móvel de 7 dias do rendimento (soma de km ÷ soma de consumo da janela). */
  rolling7: number | null;
  vehicles: number;
}

export interface ConsumptionMonthPoint {
  /** "2026-09" */
  month: string;
  km: number;
  amount: number;
  ratio: number | null;
  vehicles: number;
}

export interface ConsumptionTechGroup {
  tech: string;
  vehicles: number;
  km: number;
  amount: number;
  /** Rendimento agregado do grupo (Σkm ÷ Σconsumo). */
  ratio: number | null;
  /** Mediana do rendimento dos carros do grupo com amostra suficiente: a referência de "carro normal". */
  reference: number | null;
  /** Carros do grupo acima do limite crítico. */
  high: number;
  watch: number;
}

export interface ConsumptionVehicleRow {
  vehicleId: string;
  code: string;
  plate: string;
  model: string | null;
  vehicleClass: string | null;
  tech: string;
  km: number;
  amount: number;
  ratio: number | null;
  /** Referência do grupo (mediana) no período. */
  reference: number | null;
  /** Fração; positivo = gasta mais que o grupo. */
  deviation: number | null;
  /** Dias com registro de consumo. */
  days: number;
  /** Dias em que o carro rodou e não há registro de consumo. */
  daysKmWithoutFuel: number;
  flag: ConsumptionFlag;
  /** Trecho de odômetro parado dentro do período, já fora da conta do carro. */
  stall: ConsumptionStall | null;
}

export interface ConsumptionQuality {
  /** Carros da tecnologia que rodaram no período sem nenhum registro de consumo. */
  vehiclesWithoutData: number;
  /** Carro-dias com km e sem consumo. */
  daysKmWithoutFuel: number;
  /** Carro-dias com consumo e sem km. */
  daysFuelWithoutKm: number;
  /** Último dia com registro de consumo. */
  lastDate: string | null;
  /** Último dia com km. */
  lastKmDate: string | null;
  /**
   * Dias do período em que a frota rodou e a planilha não tem registro de
   * ninguém: lacuna da planilha, não "ninguém abasteceu". O km desses dias
   * fica fora da conta do rendimento.
   */
  missingDates: string[];
  /** Carros com odômetro parado em algum trecho do período. */
  stalledVehicles: { vehicleId: string; code: string; from: string; to: string }[];
  /** Por carro, os dias em que rodou sem registro de consumo (lacunas da planilha e odômetro parado já fora). */
  kmWithoutFuel: ConsumptionQualityCar[];
  /** Por carro, os dias com registro de consumo e sem km. */
  fuelWithoutKm: ConsumptionQualityCar[];
}

/** Um carro na lista de qualidade: quantos dias e quais (os mais recentes, até CONSUMPTION_QUALITY_MAX_DATES). */
export interface ConsumptionQualityCar {
  vehicleId: string;
  code: string;
  plate: string;
  days: number;
  dates: string[];
}
export const CONSUMPTION_QUALITY_MAX_DATES = 31;

export interface ConsumptionFleet {
  energy: VehicleTechnology;
  from: string;
  to: string;
  /** Nome do arquivo de origem dos registros (ou "sintético"). */
  source: string | null;
  current: ConsumptionTotals;
  /** Período de comparação (ver `consumptionComparisonWindow`). */
  previous: ConsumptionTotals;
  previousFrom: string;
  previousTo: string;
  /** Carros da tecnologia na frota (com ou sem dado). */
  fleetVehicles: number;
  daily: ConsumptionDayPoint[];
  /** Os últimos `months` meses até hoje, o corrente incluído; não depende do período. */
  monthly: ConsumptionMonthPoint[];
  /** Primeiro mês com registro de consumo da tecnologia ("AAAA-MM"), para a tela saber se há histórico antes da série. */
  firstMonth: string | null;
  byTech: ConsumptionTechGroup[];
  vehicles: ConsumptionVehicleRow[];
  quality: ConsumptionQuality;
}

export interface ConsumptionVehicleDetail {
  vehicle: {
    id: string;
    code: string;
    plate: string;
    manufacturer: string | null;
    model: string | null;
    vehicleClass: string | null;
    technology: VehicleTechnology;
    lot: string | null;
  };
  energy: VehicleTechnology;
  tech: string | null;
  from: string;
  to: string;
  current: ConsumptionTotals;
  previous: ConsumptionTotals;
  previousFrom: string;
  previousTo: string;
  reference: number | null;
  deviation: number | null;
  flag: ConsumptionFlag;
  /** Posição do carro no grupo, do melhor para o pior rendimento. */
  rank: { position: number; of: number } | null;
  daily: ConsumptionDayPoint[];
  monthly: ConsumptionMonthPoint[];
  /** Dias em que rodou sem registro de consumo. */
  daysKmWithoutFuel: number;
  /** Trechos de odômetro parado na janela (período + comparação), fora da conta. */
  stalls: ConsumptionStall[];
}
