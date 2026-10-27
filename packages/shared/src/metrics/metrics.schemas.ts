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
}
