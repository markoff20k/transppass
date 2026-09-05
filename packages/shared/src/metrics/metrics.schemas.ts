import { z } from 'zod';
import type { DowntimeCause } from '../work-orders/work-order.schemas.js';

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
}
