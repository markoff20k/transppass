import { z } from 'zod';
import type { DowntimeCause } from '../work-orders/work-order.schemas.js';
import type { CodeAlignment } from '../catalog/failure-codes.js';

/**
 * E8 — indicadores que emergem dos estados do processo (RF-38/RF-39).
 *
 * O criterio de saida do R1 no PRD e "MKBF publicado automaticamente". Ele nao
 * e digitado em lugar nenhum: sai da quilometragem rodada dividida pelos
 * retornos nao programados, ambos ja registrados pelo proprio fluxo.
 */

export const metricsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type MetricsQuery = z.infer<typeof metricsQuerySchema>;

export interface MkbfResult {
  /** Quilometros rodados no periodo, somados dos deltas de odometro. */
  kmTraveled: number;
  /** Retornos nao programados: eventos corretivos que tiraram o carro da rua. */
  unscheduledReturns: number;
  /** km / retornos. Nulo quando nao houve retorno — divisao sem sentido. */
  mkbf: number | null;
  periodStart: string;
  periodEnd: string;
}

export interface DowntimeByCause {
  cause: DowntimeCause;
  minutes: number;
  share: number;
}

/** Chaves dos snapshots mensais (E8). Espelha o enum do banco. */
export const MetricKey = {
  MKBF: 'MKBF',
  FLEET_AVAILABILITY: 'FLEET_AVAILABILITY',
  DOWNTIME_BY_CAUSE: 'DOWNTIME_BY_CAUSE',
  FIELD_RESOLUTION: 'FIELD_RESOLUTION',
  PREVENTIVE_ADHERENCE: 'PREVENTIVE_ADHERENCE',
  INTERNAL_REWORK: 'INTERNAL_REWORK',
  ADOPTION: 'ADOPTION',
  TRIAGE_SLA: 'TRIAGE_SLA',
} as const;
export type MetricKey = (typeof MetricKey)[keyof typeof MetricKey];

export const METRIC_KEY_LABELS: Record<MetricKey, string> = {
  MKBF: 'MKBF (km)',
  FLEET_AVAILABILITY: 'Disponibilidade da frota',
  DOWNTIME_BY_CAUSE: 'Indisponibilidade (min)',
  FIELD_RESOLUTION: 'Resolução em campo',
  PREVENTIVE_ADHERENCE: 'Aderência à preventiva',
  INTERNAL_REWORK: 'Retrabalho interno',
  ADOPTION: 'Adoção do processo',
  TRIAGE_SLA: 'SLA de triagem (mediana, s)',
};

export const metricsHistoryQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(36).default(12),
});
export type MetricsHistoryQuery = z.infer<typeof metricsHistoryQuerySchema>;

/** Um mês da série histórica: um valor por chave (nulo quando não calculável). */
export interface MetricHistoryPoint {
  month: string;
  values: Partial<Record<MetricKey, number | null>>;
}

/**
 * Aderência à preventiva: paradas que começaram dentro da tolerância da
 * janela ÷ paradas que venciam no período. Adoção: OS liberadas no período
 * em que o processo foi seguido inteiro (sub-OS inspecionada e limpeza
 * concluída) ÷ OS liberadas. Ambas ARBITRADAS até o PCM fixar a definição.
 */
export interface ProcessAdherence {
  preventive: { due: number; onTime: number; rate: number | null };
  adoption: { released: number; complete: number; rate: number | null };
}

export interface R1Metrics {
  mkbf: MkbfResult;
  /** RF-39 — decomposicao do relogio das OS do periodo. */
  downtimeByCause: DowntimeByCause[];
  totalDowntimeMinutes: number;
  /** SLA de triagem: mediana e p90 dos segundos ate a decisao. */
  triageSla: { count: number; medianSeconds: number | null; p90Seconds: number | null };
  /** Desfechos do socorro, base da metrica de resolucao em campo. */
  fieldResolution: { total: number; resolvedInField: number; rate: number | null };
  /** Retrabalho interno: sub-OS reabertas por reprovacao de inspecao. */
  internalRework: { inspections: number; rejections: number; rate: number | null };
  workOrdersReleased: number;
  averageDowntimeMinutes: number | null;
  adherence: ProcessAdherence;
  /** Alinhamento entre o código do registro e o da constatação (seção 8.2 do padrão). */
  codeAlignment: CodeAlignment;
}

/**
 * Quadro da Daily de 15 min (A3 do Kaizen, §9): os cinco KPIs — MKBF,
 * disponibilidade, retrabalho, viagens perdidas, número de OS — lidos ontem,
 * na semana e no mês, mais as listas do que atacar hoje.
 */
export interface DailyBoard {
  date: string;
  mkbf: { last30: number | null; previous30: number | null; kmLast30: number; returnsLast30: number };
  availability: { now: number; last7: number | null; target: number };
  rework: { rateLast30: number | null; inspectionsLast30: number; rejectionsLast30: number };
  /** Até a Operação apurar viagens perdidas, o sistema usa as janelas de reposição estouradas. */
  lostTrips: { yesterday: number; last7: number; last30: number; note: string };
  workOrders: { open: number; overdue: number; openedYesterday: number; releasedYesterday: number; waitingPart: number; inQueue: number };
  events: { yesterday: number; last7: number; avgPerDay7: number };
  dailyChecks: { fleet: number; checked: number; nok: number };
  topFailures7d: { key: string; description: string; count: number }[];
  repeatVehicles30d: { vehicleId: string; vehicleCode: string; count: number; lastAt: string }[];
  staleOdometer: number;
  /** Áreas sem auditoria 5S/conformidade ou com a próxima data vencida. */
  auditsOverdue: number;
  /** Materiais no ponto de pedido ou abaixo (kanban). */
  kanbanBelow: number;
  /** Componentes rodando além da vida esperada. */
  componentsOverLife: number;
  /** Fichas de manutenção reais (Transppass) nos últimos 30 dias, com o custo de peças; null sem base real. */
  maintenanceRecords: { last30: number; partsCostLast30: number; topFound: { code: string; label: string; count: number }[] } | null;
  /** Viagens por linha (SPTrans) nos últimos 30 dias: programadas × monitoradas; null sem base real. */
  trips: { planned30: number; monitored30: number; lost30: number } | null;
}

// ---------------------------------------------------------------------------
// Quadro de acompanhamento diário dos indicadores (o quadro branco da garagem,
// em Indicadores): uma linha por indicador, uma coluna por dia do mês, a cor
// pela meta. Os três primeiros saem das planilhas do ERP-JB; consumo vem da
// planilha de abastecimento e só tem leitura mensal.
// ---------------------------------------------------------------------------

export const metricsBoardQuerySchema = z.object({
  /** "AAAA-MM"; sem ele, o mês corrente. */
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Mês no formato AAAA-MM').optional(),
});
export type MetricsBoardQuery = z.infer<typeof metricsBoardQuerySchema>;

export const metricsBoardDayQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD'),
});
export type MetricsBoardDayQuery = z.infer<typeof metricsBoardDayQuerySchema>;

export const BoardIndicator = {
  /** ICF — tabelas cobertas ÷ tabelas programadas no dia. */
  FLEET_COMPLIANCE: 'FLEET_COMPLIANCE',
  /** IQF — quebras do dia (fichas A/S/T, retornos não programados). */
  FAILURES: 'FAILURES',
  /** MKBF acumulado no mês até o dia. */
  MKBF_MTD: 'MKBF_MTD',
  /** ICV — viagens realizadas ÷ programadas (planilha de viagens). */
  TRIP_COMPLIANCE: 'TRIP_COMPLIANCE',
  /** km/l da frota diesel no mês. */
  CONSUMPTION_DIESEL: 'CONSUMPTION_DIESEL',
  /** kWh/km da frota elétrica no mês. */
  CONSUMPTION_EBUS: 'CONSUMPTION_EBUS',
} as const;
export type BoardIndicator = (typeof BoardIndicator)[keyof typeof BoardIndicator];

export interface BoardIndicatorInfo {
  label: string;
  /** Sigla do quadro branco. */
  short: string;
  unit: '%' | 'un' | 'km' | 'km/l' | 'kWh/km';
  /** Para que lado a meta é boa. */
  better: 'higher' | 'lower';
  /** Tem leitura por dia (as de consumo só têm a mensal). */
  daily: boolean;
}

export const BOARD_INDICATORS: Record<BoardIndicator, BoardIndicatorInfo> = {
  FLEET_COMPLIANCE: { label: 'Cumprimento de frota', short: 'ICF', unit: '%', better: 'higher', daily: true },
  FAILURES: { label: 'Quebras (fichas A/S/T)', short: 'IQF', unit: 'un', better: 'lower', daily: true },
  MKBF_MTD: { label: 'MKBF acumulado no mês', short: 'MKBF', unit: 'km', better: 'higher', daily: true },
  TRIP_COMPLIANCE: { label: 'Cumprimento de viagens', short: 'ICV', unit: '%', better: 'higher', daily: true },
  CONSUMPTION_DIESEL: { label: 'Rendimento diesel', short: 'km/l', unit: 'km/l', better: 'higher', daily: false },
  CONSUMPTION_EBUS: { label: 'Rendimento elétrico', short: 'kWh/km', unit: 'kWh/km', better: 'lower', daily: false },
};

export const indicatorTargetSchema = z.object({
  target: z.number().finite().nullable(),
  responsible: z.string().trim().max(60).nullable(),
});
export type IndicatorTargetInput = z.infer<typeof indicatorTargetSchema>;

export interface IndicatorTarget {
  key: BoardIndicator;
  target: number | null;
  responsible: string | null;
}

/** Como uma leitura se compara com a meta: dentro, abaixo, ou sem meta (acompanhamento). */
export type TargetStatus = 'good' | 'bad' | 'none';
export function targetStatus(key: BoardIndicator, value: number | null, target: number | null): TargetStatus {
  if (value === null || target === null) return 'none';
  const better = BOARD_INDICATORS[key].better;
  return (better === 'higher' ? value >= target : value <= target) ? 'good' : 'bad';
}

/**
 * Por que o cumprimento de frota do dia ficou em branco: sem dia comparável
 * (feriado, eleição, tabela especial) ou planilha carro-linha-dia incompleta
 * (carros escalados sem km em linha enquanto viagens e km da frota foram normais).
 */
export type BoardFleetNote = 'no-reference' | 'incomplete-sheet';

export interface BoardFleet {
  /** Tabelas (linha × tabela) que tiveram carro com km ou viagem no dia. */
  covered: number;
  /** Tabelas programadas; estimada pelos dias comparáveis (mesmo tipo de dia e viagens programadas parecidas) até a programação do ERP-JB chegar. */
  programmed: number | null;
  estimated: boolean;
  /** Carros distintos que operaram (com km em linha ou viagem). */
  vehicles: number;
  /** Carros escalados na planilha carro-linha-dia, com ou sem km. */
  scheduled: number;
  pct: number | null;
  note: BoardFleetNote | null;
}

export interface BoardTrips {
  planned: number;
  lost: number;
  pct: number | null;
}

export interface BoardDay {
  date: string;
  /** 0 = domingo. */
  weekday: number;
  /** Feriado ou data especial (eleição), pelo calendário de São Paulo. */
  holiday: string | null;
  /** Dia ainda sem dado (futuro ou depois da última remessa). */
  empty: boolean;
  fleet: BoardFleet;
  failures: number;
  km: number;
  failuresToDate: number;
  kmToDate: number;
  mkbfToDate: number | null;
  trips: BoardTrips;
}

export interface BoardTotals {
  fleet: BoardFleet;
  failures: number;
  km: number;
  mkbf: number | null;
  trips: BoardTrips;
}

export interface BoardConsumption {
  ratio: number | null;
  previousRatio: number | null;
  vehicles: number;
  /** Carros acima do grupo / em atenção no mês. */
  high: number;
  watch: number;
  from: string;
  to: string;
}

export interface BoardHistoryPoint {
  month: string;
  fleetPct: number | null;
  failures: number;
  mkbf: number | null;
  tripsPct: number | null;
}

/**
 * Leitura automática do mês: o que fugiu do padrão e por quê, em português,
 * por regras sobre o próprio dado (feriados, planilha incompleta, pior dia,
 * tendência contra o mês anterior). Determinística e auditável.
 */
export interface BoardInsight {
  kind: 'day' | 'fleet' | 'failures' | 'mkbf' | 'trips' | 'consumption' | 'data';
  tone: 'info' | 'good' | 'warn' | 'bad';
  /** Dia a que se refere, quando é sobre um dia. */
  date: string | null;
  title: string;
  text: string;
}

export interface MetricsBoard {
  month: string;
  from: string;
  to: string;
  /** Último dia com alguma leitura (km, viagens ou carro-linha-dia). */
  lastDataDate: string | null;
  days: BoardDay[];
  totals: BoardTotals;
  previous: BoardTotals;
  previousMonth: string;
  history: BoardHistoryPoint[];
  consumption: { diesel: BoardConsumption | null; ebus: BoardConsumption | null };
  targets: Record<BoardIndicator, IndicatorTarget>;
  insights: BoardInsight[];
  /** Linhas com mais viagens perdidas no mês. */
  worstLines: { line: string; planned: number; lost: number; pct: number | null }[];
}

/** O que aconteceu num dia do quadro: as quebras, as linhas que perderam viagem e a frota coberta. */
export interface BoardDayDetail {
  date: string;
  holiday: string | null;
  fleet: BoardFleet;
  failures: { id: string; code: string; vehicleId: string; vehicleCode: string; line: string | null; fichaKind: string | null; defect: string | null; reportedAt: string }[];
  trips: { line: string; planned: number; lost: number; pct: number | null }[];
  tripsTotal: BoardTrips;
}
