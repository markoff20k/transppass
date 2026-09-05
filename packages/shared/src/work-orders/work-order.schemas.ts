import { z } from 'zod';

/**
 * E4 — Execução da manutenção (RF-17 a RF-22).
 *
 * A OS-mãe é o único relógio de indisponibilidade (RN-02). Ela abre quando o
 * carro entra na garagem e só para na liberação, que é exclusiva da Manutenção
 * e conta o evento no MKBF (RN-14).
 */

export const WorkOrderType = {
  CORRECTIVE: 'CORRECTIVE',
  PREVENTIVE: 'PREVENTIVE',
} as const;
export type WorkOrderType = (typeof WorkOrderType)[keyof typeof WorkOrderType];

export const WORK_ORDER_TYPE_LABELS: Record<WorkOrderType, string> = {
  CORRECTIVE: 'Corretiva',
  PREVENTIVE: 'Preventiva',
};

export const WorkOrderStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING_PART: 'WAITING_PART',
  TECH_CLOSED: 'TECH_CLOSED',
  IN_INSPECTION: 'IN_INSPECTION',
  IN_CLEANING: 'IN_CLEANING',
  RELEASED: 'RELEASED',
  CANCELLED: 'CANCELLED',
} as const;
export type WorkOrderStatus = (typeof WorkOrderStatus)[keyof typeof WorkOrderStatus];

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  OPEN: 'Aberta',
  IN_PROGRESS: 'Em execução',
  WAITING_PART: 'Aguardando peça',
  TECH_CLOSED: 'Encerrada tecnicamente',
  IN_INSPECTION: 'Em inspeção',
  IN_CLEANING: 'Em limpeza',
  RELEASED: 'Liberada',
  CANCELLED: 'Cancelada',
};

export const TaskStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  BLOCKED_BY_MATERIAL: 'BLOCKED_BY_MATERIAL',
  DONE: 'DONE',
  IN_INSPECTION: 'IN_INSPECTION',
  REJECTED: 'REJECTED',
  APPROVED: 'APPROVED',
  CANCELLED: 'CANCELLED',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: 'Pendente',
  IN_PROGRESS: 'Em execução',
  BLOCKED_BY_MATERIAL: 'Bloqueada por material',
  DONE: 'Concluída',
  IN_INSPECTION: 'Em inspeção',
  REJECTED: 'Reprovada',
  APPROVED: 'Aprovada',
  CANCELLED: 'Cancelada',
};

/** Estados em que a sub-OS já cumpriu sua parte para o portão 1 (RF-19). */
export const TASK_STATUSES_SETTLED: readonly TaskStatus[] = [
  TaskStatus.DONE,
  TaskStatus.IN_INSPECTION,
  TaskStatus.APPROVED,
  TaskStatus.CANCELLED,
];

export const DowntimeCause = {
  QUEUE: 'QUEUE',
  MATERIAL: 'MATERIAL',
  EXECUTION: 'EXECUTION',
  INSPECTION: 'INSPECTION',
  CLEANING: 'CLEANING',
  RELEASE_WAIT: 'RELEASE_WAIT',
} as const;
export type DowntimeCause = (typeof DowntimeCause)[keyof typeof DowntimeCause];

export const DOWNTIME_CAUSE_LABELS: Record<DowntimeCause, string> = {
  QUEUE: 'Fila',
  MATERIAL: 'Material',
  EXECUTION: 'Execução',
  INSPECTION: 'Inspeção',
  CLEANING: 'Limpeza',
  RELEASE_WAIT: 'Aguardando liberação',
};

export const CleaningStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
} as const;
export type CleaningStatus = (typeof CleaningStatus)[keyof typeof CleaningStatus];

export const InspectionResult = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type InspectionResult = (typeof InspectionResult)[keyof typeof InspectionResult];

// --- Abertura e execução ----------------------------------------------------

export const openWorkOrderSchema = z.object({
  vehicleId: z.string().uuid(),
  type: z.nativeEnum(WorkOrderType).default(WorkOrderType.CORRECTIVE),
  eventId: z.string().uuid().optional(),
  scheduledMaintenanceId: z.string().uuid().optional(),
  /** RN-03 — previsão de conclusão é obrigatória na abertura. */
  estimatedCompletionAt: z.coerce.date({ message: 'Informe a previsão de conclusão' }),
  jbWorkOrderNumber: z.string().trim().max(32).optional(),
});

export const createTaskSchema = z.object({
  specialtyId: z.string().uuid('Selecione a especialidade'),
  description: z.string().trim().min(3, 'Descreva o serviço').max(500),
  assignedToId: z.string().uuid().optional(),
  checklist: z
    .array(z.object({ description: z.string().trim().min(1).max(255) }))
    .default([]),
});

export const finishTaskSchema = z.object({
  /** RN-13 — causa constatada vem de lista, nunca de texto livre. */
  confirmedCatalogItemId: z.string().uuid({ message: 'Informe a causa constatada' }),
});

export const checklistItemSchema = z.object({
  isChecked: z.boolean(),
  measurement: z.coerce.number().optional(),
  unit: z.string().trim().max(16).optional(),
});

export const updateEstimateSchema = z.object({
  estimatedCompletionAt: z.coerce.date(),
});

// --- Inspeção (RF-20) -------------------------------------------------------

export const inspectionSchema = z
  .object({
    result: z.nativeEnum(InspectionResult),
    reasonCodeId: z.string().uuid().optional(),
    note: z.string().trim().max(500).optional(),
    measurements: z
      .array(
        z.object({
          description: z.string().trim().min(1).max(255),
          value: z.coerce.number(),
          unit: z.string().trim().max(16),
          minValue: z.coerce.number().optional(),
          maxValue: z.coerce.number().optional(),
        }),
      )
      .default([]),
  })
  .refine((v) => v.result !== InspectionResult.REJECTED || Boolean(v.reasonCodeId), {
    message: 'Reprovação exige código de motivo',
    path: ['reasonCodeId'],
  });

// --- Limpeza (RF-21) --------------------------------------------------------

export const cleaningChecklistSchema = z.object({ isChecked: z.boolean() });

export const cleaningDamageSchema = z.object({
  description: z.string().trim().min(3, 'Descreva a avaria').max(500),
  photoUrl: z.string().trim().max(500).optional(),
});

export const workOrderQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(WorkOrderStatus).optional(),
  type: z.nativeEnum(WorkOrderType).optional(),
  vehicleId: z.string().uuid().optional(),
  /** Só as que ainda prendem o carro. */
  onlyOpen: z.coerce.boolean().default(false),
});

export type OpenWorkOrderInput = z.infer<typeof openWorkOrderSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type FinishTaskInput = z.infer<typeof finishTaskSchema>;
export type ChecklistItemInput = z.infer<typeof checklistItemSchema>;
export type UpdateEstimateInput = z.infer<typeof updateEstimateSchema>;
export type InspectionInput = z.infer<typeof inspectionSchema>;
export type CleaningChecklistInput = z.infer<typeof cleaningChecklistSchema>;
export type CleaningDamageInput = z.infer<typeof cleaningDamageSchema>;
export type WorkOrderQuery = z.infer<typeof workOrderQuerySchema>;

export interface ChecklistItemRow {
  id: string;
  sequence: number;
  description: string;
  isChecked: boolean;
  checkedAt: string | null;
  measurement: number | null;
  unit: string | null;
}

export interface TaskRow {
  id: string;
  code: string;
  description: string;
  specialtyId: string;
  specialtyName: string;
  status: TaskStatus;
  assignedToId: string | null;
  assignedToName: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  confirmedCatalogItemId: string | null;
  confirmedCause: string | null;
  reopenedCount: number;
  checklist: ChecklistItemRow[];
  openMaterialRequests: number;
  lastInspection: {
    result: InspectionResult;
    inspectedAt: string;
    note: string | null;
    reasonDescription: string | null;
  } | null;
}

export interface DowntimeBreakdown {
  cause: DowntimeCause;
  minutes: number;
  share: number;
}

export interface WorkOrderDetail {
  id: string;
  code: string;
  type: WorkOrderType;
  status: WorkOrderStatus;
  vehicleId: string;
  vehicleCode: string;
  vehiclePlate: string;
  eventId: string | null;
  eventCode: string | null;
  openedAt: string;
  estimatedCompletionAt: string;
  techClosedAt: string | null;
  releasedAt: string | null;
  releasedByName: string | null;
  jbWorkOrderNumber: string | null;
  /** Relógio único: minutos decorridos, ou o total travado após a liberação. */
  downtimeMinutes: number;
  /** Previsão estourada e ainda sem liberação. */
  isOverdue: boolean;
  tasks: TaskRow[];
  breakdown: DowntimeBreakdown[];
  cleaning: {
    id: string;
    status: CleaningStatus;
    startedAt: string | null;
    finishedAt: string | null;
    checklist: { id: string; sequence: number; description: string; isChecked: boolean }[];
    damageReports: { id: string; description: string; createdAt: string }[];
  } | null;
  /** Portões do RF-19/RF-22, para a tela mostrar o que falta antes de liberar. */
  gates: {
    allTasksSettled: boolean;
    allInspectionsApproved: boolean;
    cleaningDone: boolean;
    canTechClose: boolean;
    canRelease: boolean;
    blockingReasons: string[];
  };
}

export interface WorkOrderSummary {
  id: string;
  code: string;
  type: WorkOrderType;
  status: WorkOrderStatus;
  vehicleCode: string;
  vehiclePlate: string;
  openedAt: string;
  estimatedCompletionAt: string;
  downtimeMinutes: number;
  isOverdue: boolean;
  taskCount: number;
  tasksDone: number;
}
