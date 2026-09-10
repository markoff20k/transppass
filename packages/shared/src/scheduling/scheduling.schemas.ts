import { z } from 'zod';
import type { VehicleTechnology } from '../fleet/vehicle.schemas.js';

/**
 * E3 — Preventiva e quilometragem (RF-10 a RF-13, RF-25).
 *
 * A jornada do PRD (6.2): o sistema projeta o km diariamente, antecipa a
 * janela quando o carro roda acima do previsto, o PCM monta o escopo somando
 * o pacote vigente ao backlog do carro, o Estoque separa o kit em D-1 e a
 * Manutenção reserva a equipe. O carro só sai da escala com tudo confirmado
 * (RN-10); pendência dispara reprogramação com motivo (RF-13).
 */

export const ScheduleStatus = {
  PLANNED: 'PLANNED',
  CONFIRMED: 'CONFIRMED',
  IN_EXECUTION: 'IN_EXECUTION',
  DONE: 'DONE',
  RESCHEDULED: 'RESCHEDULED',
  CANCELLED: 'CANCELLED',
} as const;
export type ScheduleStatus = (typeof ScheduleStatus)[keyof typeof ScheduleStatus];

export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = {
  PLANNED: 'Planejada',
  CONFIRMED: 'Confirmada',
  IN_EXECUTION: 'Em execução',
  DONE: 'Concluída',
  RESCHEDULED: 'Reprogramada',
  CANCELLED: 'Cancelada',
};

export const KitSeparationStatus = {
  PENDING: 'PENDING',
  SEPARATED: 'SEPARATED',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
} as const;
export type KitSeparationStatus = (typeof KitSeparationStatus)[keyof typeof KitSeparationStatus];

export const KIT_STATUS_LABELS: Record<KitSeparationStatus, string> = {
  PENDING: 'Kit pendente',
  SEPARATED: 'Kit separado',
  CONFIRMED: 'Kit confirmado',
  CANCELLED: 'Kit cancelado',
};

/**
 * Quantos km antes da janela o sistema começa a avisar. O PRD fala em
 * "antecipar a janela quando o carro roda acima do previsto" (RF-10).
 * ARBITRADO: 1.000 km, a validar com o PCM.
 */
export const WINDOW_ALERT_KM = 1_000;

/** Dias de antecedência para o kit (RF-25: D-1). */
export const KIT_LEAD_DAYS = 1;

// --- Entrada -----------------------------------------------------------------

export const createScheduleSchema = z.object({
  vehicleId: z.string().uuid('Selecione o carro'),
  packageId: z.string().uuid('Selecione o pacote'),
  /** Km em que a janela vence. Sugerido pela linha do tempo; o PCM pode ajustar. */
  targetKm: z.coerce.number().int().positive(),
  plannedDate: z.coerce.date().optional(),
  /** Itens do backlog do carro que entram no escopo desta parada (RF-11). */
  backlogItemIds: z.array(z.string().uuid()).default([]),
  kitId: z.string().uuid().optional(),
});

export const rescheduleSchema = z.object({
  toDate: z.coerce.date({ message: 'Informe a nova data' }),
  /** RF-13 — reprogramação sempre com código de motivo. */
  reasonCodeId: z.string().uuid({ message: 'Selecione o motivo' }),
  note: z.string().trim().max(255).optional(),
});

export const reserveTeamSchema = z.object({
  specialtyId: z.string().uuid('Selecione a especialidade'),
  headcount: z.coerce.number().int().min(1).max(20).default(1),
});

export const scheduleQuerySchema = z.object({
  status: z.nativeEnum(ScheduleStatus).optional(),
  vehicleId: z.string().uuid().optional(),
  /** Só o que ainda não aconteceu. */
  upcoming: z.coerce.boolean().default(true),
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type RescheduleInput = z.infer<typeof rescheduleSchema>;
export type ReserveTeamInput = z.infer<typeof reserveTeamSchema>;
export type ScheduleQuery = z.infer<typeof scheduleQuerySchema>;

// --- Saída -------------------------------------------------------------------

/** RF-10 — uma linha da linha do tempo por km projetado. */
export interface KmTimelineRow {
  vehicleId: string;
  vehicleCode: string;
  vehiclePlate: string;
  technology: VehicleTechnology;
  currentKm: number;
  projectedKm: number | null;
  avgDailyKm: number | null;
  isKmDegraded: boolean;
  /** Próxima janela pelo plano vigente. */
  nextPackageId: string | null;
  nextPackageName: string | null;
  nextWindowKm: number | null;
  /** Km que faltam até a janela — negativo se já estourou. */
  kmToWindow: number | null;
  /** Dias até a janela, pela média diária. */
  daysToWindow: number | null;
  /** Data estimada em que o carro chega à janela. */
  projectedWindowDate: string | null;
  /** Já existe parada agendada para essa janela? */
  scheduleId: string | null;
  scheduleStatus: ScheduleStatus | null;
  /** Itens de backlog aguardando a próxima parada. */
  backlogCount: number;
  alert: 'overdue' | 'due-soon' | 'ok' | 'unknown';
}

export interface ScheduleScopeRow {
  id: string;
  kind: 'task' | 'backlog';
  description: string;
  specialtyName: string | null;
  estimatedMinutes: number | null;
}

export interface ScheduleReservationRow {
  id: string;
  specialtyName: string;
  headcount: number;
  reservedAt: string;
}

export interface ScheduleRescheduleRow {
  id: string;
  fromDate: string | null;
  toDate: string;
  reasonCode: string;
  reasonDescription: string;
  actorName: string | null;
  note: string | null;
  createdAt: string;
}

export interface ScheduleDetail {
  id: string;
  status: ScheduleStatus;
  vehicleId: string;
  vehicleCode: string;
  vehiclePlate: string;
  technology: VehicleTechnology;
  packageId: string;
  packageName: string;
  planName: string;
  targetKm: number;
  currentKm: number;
  projectedDate: string;
  plannedDate: string | null;
  createdAt: string;
  /** RF-12 — as duas travas da saída da escala. */
  kitReady: boolean;
  teamReserved: boolean;
  canLeaveSchedule: boolean;
  blockingReasons: string[];
  kit: {
    id: string;
    kitId: string;
    kitName: string;
    status: KitSeparationStatus;
    separatedAt: string | null;
    confirmedAt: string | null;
    dueDate: string | null;
  } | null;
  scope: ScheduleScopeRow[];
  reservations: ScheduleReservationRow[];
  reschedules: ScheduleRescheduleRow[];
  workOrderId: string | null;
  workOrderCode: string | null;
}

export interface ScheduleSummary {
  id: string;
  status: ScheduleStatus;
  vehicleCode: string;
  vehiclePlate: string;
  packageName: string;
  targetKm: number;
  currentKm: number;
  projectedDate: string;
  plannedDate: string | null;
  kitReady: boolean;
  teamReserved: boolean;
  scopeCount: number;
  rescheduleCount: number;
}

export interface PlanPackageRow {
  id: string;
  planId: string;
  planName: string;
  planCode: string;
  planVersion: number;
  controlledDocument: string | null;
  technology: VehicleTechnology;
  code: string;
  name: string;
  intervalKm: number;
  toleranceKm: number;
  taskCount: number;
  kitId: string | null;
  kitName: string | null;
}

export interface BacklogItemRow {
  id: string;
  description: string;
  source: string;
  createdAt: string;
  catalogCode: string | null;
}

/** RF-25 — o que o Estoque separa em D-1, visível ao PCM. */
export interface KitSeparationRow {
  id: string;
  scheduleId: string;
  vehicleCode: string;
  packageName: string;
  kitName: string;
  status: KitSeparationStatus;
  plannedDate: string | null;
  dueDate: string | null;
  isDueToday: boolean;
  isLate: boolean;
  items: { materialCode: string; materialDescription: string; quantity: number; unit: string }[];
}
