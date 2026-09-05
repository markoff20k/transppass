import { z } from 'zod';
import { type KmSource } from './vehicle.schemas.js';

/**
 * RF-14 — entrada diária de km diesel com validação de delta, offset de
 * hodômetro e degradação/alerta após 2 dias.
 *
 * O PRD trata a disciplina do lançamento como risco (seção 10): a validação
 * acontece na origem, no momento da digitação, e não num relatório posterior.
 */

/** Sem leitura por mais que isso, a projeção entra em modo degradado. */
export const KM_DEGRADATION_DAYS = 2;

/** Limites de sanidade do delta diário de um ônibus urbano. */
export const KM_DELTA_LIMITS = {
  /** Abaixo disso, provável erro de digitação ou carro parado sem registro. */
  suspectBelow: 0,
  /** Acima disso, provável digitação errada — aceita com marcação de suspeita. */
  suspectAbove: 600,
  /** Acima disso, recusa: hodômetro trocado sem atualizar o offset. */
  rejectAbove: 2000,
} as const;

export const OdometerStatus = {
  VALID: 'VALID',
  SUSPECT: 'SUSPECT',
  REJECTED: 'REJECTED',
} as const;
export type OdometerStatus = (typeof OdometerStatus)[keyof typeof OdometerStatus];

export const ODOMETER_STATUS_LABELS: Record<OdometerStatus, string> = {
  VALID: 'Válida',
  SUSPECT: 'Suspeita',
  REJECTED: 'Recusada',
};

export const odometerEntrySchema = z.object({
  vehicleId: z.string().uuid(),
  /** Leitura crua do hodômetro, como está no painel do carro. */
  rawKm: z.coerce.number().int().min(0, 'Km não pode ser negativo').max(9_999_999),
  readAt: z.coerce.date(),
  note: z.string().trim().max(255).optional(),
});

/** Lançamento em lote: a tela de km diesel recebe a garagem inteira de uma vez. */
export const odometerBatchSchema = z.object({
  entries: z.array(odometerEntrySchema).min(1, 'Informe ao menos uma leitura').max(500),
});

export const odometerQuerySchema = z.object({
  vehicleId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});

export type OdometerEntryInput = z.infer<typeof odometerEntrySchema>;
export type OdometerBatchInput = z.infer<typeof odometerBatchSchema>;
export type OdometerQuery = z.infer<typeof odometerQuerySchema>;

export interface OdometerReading {
  id: string;
  vehicleId: string;
  vehicleCode: string;
  rawKm: number;
  adjustedKm: number;
  deltaKm: number | null;
  readAt: string;
  source: KmSource;
  status: OdometerStatus;
  note: string | null;
  createdAt: string;
}

/** Resultado por linha do lote, para a tela mostrar o que passou e o que não. */
export interface OdometerBatchResultItem {
  vehicleId: string;
  vehicleCode: string;
  accepted: boolean;
  status: OdometerStatus;
  deltaKm: number | null;
  message: string | null;
}

export interface OdometerBatchResult {
  accepted: number;
  suspect: number;
  rejected: number;
  items: OdometerBatchResultItem[];
}

export interface KmProjection {
  vehicleId: string;
  avgDailyKm: number;
  projectedKm: number;
  projectedAt: string;
  lastReadingAt: string | null;
  isDegraded: boolean;
  degradedSince: string | null;
  sampleDays: number;
}

/**
 * Classifica um delta de leitura. Vive no pacote compartilhado porque a tela
 * precisa avisar o digitador antes do envio, com exatamente o mesmo critério
 * que a API vai aplicar depois.
 */
export function classifyOdometerDelta(deltaKm: number | null): {
  status: OdometerStatus;
  message: string | null;
} {
  if (deltaKm === null) {
    return { status: OdometerStatus.VALID, message: null };
  }
  if (deltaKm < KM_DELTA_LIMITS.suspectBelow) {
    return {
      status: OdometerStatus.REJECTED,
      message: 'Leitura menor que a anterior — verifique troca de hodômetro e o offset do carro',
    };
  }
  if (deltaKm > KM_DELTA_LIMITS.rejectAbove) {
    return {
      status: OdometerStatus.REJECTED,
      message: `Delta de ${deltaKm.toLocaleString('pt-BR')} km é inviável para um dia de operação`,
    };
  }
  if (deltaKm > KM_DELTA_LIMITS.suspectAbove) {
    return {
      status: OdometerStatus.SUSPECT,
      message: `Delta de ${deltaKm.toLocaleString('pt-BR')} km acima do esperado — confirme a leitura`,
    };
  }
  if (deltaKm === 0) {
    return {
      status: OdometerStatus.SUSPECT,
      message: 'Sem rodagem no período — confirme se o carro ficou parado',
    };
  }
  return { status: OdometerStatus.VALID, message: null };
}
