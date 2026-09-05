import { z } from 'zod';

/**
 * RF-32 — catálogo de falhas com flags, versões e realimentação pelas
 * constatações. RF-33 — as cinco listas de códigos de motivo.
 *
 * As flags aqui dirigem o processo inteiro: fast-track abre OS sozinho (RF-06)
 * e segurança bloqueia retorno à linha e deferimento (RF-05). Quais falhas
 * recebem cada flag é questão aberta do PRD (seção 12), a ser fechada por
 * Manutenção + PCM antes do R1 — a estrutura já aceita a carga.
 */

export const failureCatalogItemSchema = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
  code: z.string(),
  description: z.string(),
  system: z.string().nullable(),
  subsystem: z.string().nullable(),
  isFastTrack: z.boolean(),
  isSafety: z.boolean(),
  isDeferrable: z.boolean(),
  probableCause: z.string().nullable(),
  estimatedRepairMinutes: z.number().int().nullable(),
  fieldResolutionRate: z.number().nullable(),
  fieldResolutionSamples: z.number().int(),
  isActive: z.boolean(),
});

export const createFailureCatalogItemSchema = z
  .object({
    code: z.string().trim().toUpperCase().min(1).max(24),
    description: z.string().trim().min(3, 'Descreva a falha').max(255),
    system: z.string().trim().max(80).optional(),
    subsystem: z.string().trim().max(80).optional(),
    isFastTrack: z.boolean().default(false),
    isSafety: z.boolean().default(false),
    isDeferrable: z.boolean().default(true),
    probableCause: z.string().trim().max(255).optional(),
    estimatedRepairMinutes: z.coerce.number().int().min(1).max(10_000).optional(),
  })
  .refine((v) => !(v.isSafety && v.isDeferrable), {
    // RF-05: falha de segurança não pode ser deferida para a parada programada.
    message: 'Falha de segurança não pode ser marcada como deferível',
    path: ['isDeferrable'],
  });

export const updateFailureCatalogItemSchema = z.object({
  description: z.string().trim().min(3).max(255).optional(),
  system: z.string().trim().max(80).optional(),
  subsystem: z.string().trim().max(80).optional(),
  isFastTrack: z.boolean().optional(),
  isSafety: z.boolean().optional(),
  isDeferrable: z.boolean().optional(),
  probableCause: z.string().trim().max(255).optional(),
  estimatedRepairMinutes: z.coerce.number().int().min(1).max(10_000).optional(),
  isActive: z.boolean().optional(),
});

export const catalogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(60).optional(),
  versionId: z.string().uuid().optional(),
  isFastTrack: z.coerce.boolean().optional(),
  isSafety: z.coerce.boolean().optional(),
  onlyActive: z.coerce.boolean().default(true),
});

export type FailureCatalogItem = z.infer<typeof failureCatalogItemSchema>;
export type CreateFailureCatalogItemInput = z.infer<typeof createFailureCatalogItemSchema>;
export type UpdateFailureCatalogItemInput = z.infer<typeof updateFailureCatalogItemSchema>;
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

// --- Códigos de motivo (RF-33) ---------------------------------------------

export const ReasonCodeList = {
  /** Mudança de posição na fila de manutenção (RN-08). */
  QUEUE_PRIORITY: 'QUEUE_PRIORITY',
  /** Reprogramação de janela preventiva (RF-13). */
  SCHEDULE_RESCHEDULE: 'SCHEDULE_RESCHEDULE',
  /** Reprovação de inspeção, que reabre a sub-OS (RN-05). */
  INSPECTION_REJECTION: 'INSPECTION_REJECTION',
  /** Estado aguardando peça (RN-09). */
  PART_WAITING: 'PART_WAITING',
  /** Deferimento do evento para a parada programada (RF-03). */
  EVENT_DEFERRAL: 'EVENT_DEFERRAL',
} as const;
export type ReasonCodeList = (typeof ReasonCodeList)[keyof typeof ReasonCodeList];

export const REASON_CODE_LIST_LABELS: Record<ReasonCodeList, string> = {
  QUEUE_PRIORITY: 'Priorização de fila',
  SCHEDULE_RESCHEDULE: 'Reprogramação de janela',
  INSPECTION_REJECTION: 'Reprovação de inspeção',
  PART_WAITING: 'Aguardando peça',
  EVENT_DEFERRAL: 'Deferimento de evento',
};

export const createReasonCodeSchema = z.object({
  list: z.nativeEnum(ReasonCodeList),
  code: z.string().trim().toUpperCase().min(1).max(24),
  description: z.string().trim().min(3, 'Descreva o motivo').max(255),
});

/** RF-33 — códigos são desativados, nunca excluídos. */
export const updateReasonCodeSchema = z.object({
  description: z.string().trim().min(3).max(255).optional(),
  isActive: z.boolean().optional(),
});

export const reasonCodeSchema = z.object({
  id: z.string().uuid(),
  list: z.nativeEnum(ReasonCodeList),
  code: z.string(),
  description: z.string(),
  isActive: z.boolean(),
});

export type ReasonCode = z.infer<typeof reasonCodeSchema>;
export type CreateReasonCodeInput = z.infer<typeof createReasonCodeSchema>;
export type UpdateReasonCodeInput = z.infer<typeof updateReasonCodeSchema>;
