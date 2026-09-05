import { z } from 'zod';

/**
 * E2 — Priorização e fila (RF-07 a RF-09).
 *
 * O PRD chama esta a jornada da "autoridade que vira registro": arrastar um
 * carro na fila é uma decisão de gestão, e o sistema exige o motivo antes de
 * confirmar. O registro é imutável e as previsões de todos os afetados são
 * recalculadas.
 */

export const QueueStatus = {
  WAITING: 'WAITING',
  IN_SERVICE: 'IN_SERVICE',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
} as const;
export type QueueStatus = (typeof QueueStatus)[keyof typeof QueueStatus];

export const QUEUE_STATUS_LABELS: Record<QueueStatus, string> = {
  WAITING: 'Aguardando',
  IN_SERVICE: 'Em atendimento',
  DONE: 'Concluído',
  CANCELLED: 'Cancelado',
};

/**
 * Criticidade que define a ordem padrão automática (RF-07).
 *
 * ARBITRADO: o PRD pede "ordem padrão automática por criticidade" sem definir
 * a escala. Esta é a proposta, derivada das flags do catálogo que o próprio
 * PRD usa para dirigir o processo. Deve ser validada com PCM e Manutenção.
 */
export const CRITICALITY = {
  /** Falha de segurança: não pode rodar, não pode ser deferida (RF-05). */
  SAFETY: 100,
  /** Fast-track do catálogo: entra na frente por decisão do próprio catálogo. */
  FAST_TRACK: 80,
  /** Preventiva com janela agendada: tem data para cumprir. */
  PREVENTIVE: 50,
  /** Corretivo comum. */
  STANDARD: 30,
  /** Deferido antes: já esperou uma vez, entra pelo backlog. */
  DEFERRED: 10,
} as const;

/** Minutos assumidos quando o catálogo não estima o reparo. */
export const DEFAULT_REPAIR_MINUTES = 180;

export const reorderQueueSchema = z.object({
  queueEntryId: z.string().uuid(),
  toPosition: z.coerce.number().int().min(1),
  /** RF-08 — sem código de motivo a fila não muda. */
  reasonCodeId: z.string().uuid({ message: 'Selecione o motivo da mudança' }),
  note: z.string().trim().max(255).optional(),
});

export const queueQuerySchema = z.object({
  status: z.nativeEnum(QueueStatus).optional(),
  includeFinished: z.coerce.boolean().default(false),
});

export type ReorderQueueInput = z.infer<typeof reorderQueueSchema>;
export type QueueQuery = z.infer<typeof queueQuerySchema>;

export interface QueueEntryRow {
  id: string;
  position: number;
  criticality: number;
  isFastTrack: boolean;
  status: QueueStatus;
  vehicleId: string;
  vehicleCode: string;
  vehiclePlate: string;
  eventId: string | null;
  eventCode: string | null;
  failureDescription: string | null;
  isSafety: boolean;
  workOrderId: string | null;
  workOrderCode: string | null;
  enteredAt: string;
  startedAt: string | null;
  /** Previsão recalculada a cada mudança de fila (RF-09). */
  estimatedCompletionAt: string | null;
  estimatedRepairMinutes: number;
  /** Horas que o carro já está parado nesta fila. */
  waitingHours: number;
}

export interface QueueChangeRow {
  id: string;
  fromPosition: number | null;
  toPosition: number | null;
  reasonCode: string;
  reasonDescription: string;
  actorName: string | null;
  isSystemGenerated: boolean;
  note: string | null;
  createdAt: string;
}
