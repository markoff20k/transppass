import { z } from 'zod';

/**
 * E5 — Materiais, pool e ferramentas (RF-23 a RF-28).
 *
 * A cadeia solicitado → separado → entregue registra quem recebeu na valeta,
 * e o estado "aguardando peça" tem prazo e escalona sozinho quando vence.
 */

export const MaterialRequestStatus = {
  REQUESTED: 'REQUESTED',
  SEPARATED: 'SEPARATED',
  DELIVERED: 'DELIVERED',
  WAITING_PART: 'WAITING_PART',
  CANCELLED: 'CANCELLED',
} as const;
export type MaterialRequestStatus =
  (typeof MaterialRequestStatus)[keyof typeof MaterialRequestStatus];

export const MATERIAL_REQUEST_STATUS_LABELS: Record<MaterialRequestStatus, string> = {
  REQUESTED: 'Solicitado',
  SEPARATED: 'Separado',
  DELIVERED: 'Entregue',
  WAITING_PART: 'Aguardando peça',
  CANCELLED: 'Cancelado',
};

/** Estados em que a solicitação ainda bloqueia a sub-OS (RF-18). */
export const MATERIAL_STATUSES_BLOCKING: readonly MaterialRequestStatus[] = [
  MaterialRequestStatus.REQUESTED,
  MaterialRequestStatus.SEPARATED,
  MaterialRequestStatus.WAITING_PART,
];

export const PoolComponentStatus = {
  IN_STOCK: 'IN_STOCK',
  IN_USE: 'IN_USE',
  IN_WORKSHOP: 'IN_WORKSHOP',
  SCRAPPED: 'SCRAPPED',
} as const;
export type PoolComponentStatus =
  (typeof PoolComponentStatus)[keyof typeof PoolComponentStatus];

export const POOL_STATUS_LABELS: Record<PoolComponentStatus, string> = {
  IN_STOCK: 'Em saldo',
  IN_USE: 'Aplicado no carro',
  IN_WORKSHOP: 'Na Oficina',
  SCRAPPED: 'Sucateado',
};

export const requestMaterialSchema = z.object({
  workOrderTaskId: z.string().uuid(),
  materialId: z.string().uuid('Selecione o material'),
  quantity: z.coerce.number().positive('Quantidade deve ser maior que zero'),
  /** Bloqueia a sub-OS até a entrega (RF-18). */
  blocksTask: z.boolean().default(true),
});

export const separateMaterialSchema = z.object({
  serialNumber: z.string().trim().max(64).optional(),
});

export const deliverMaterialSchema = z.object({
  /** RF-23 — quem recebeu na valeta fica registrado. */
  receivedByName: z.string().trim().min(2, 'Informe quem recebeu').max(120),
  serialNumber: z.string().trim().max(64).optional(),
});

/** RF-24 — aguardando peça com motivo e prazo. */
export const waitForPartSchema = z.object({
  reasonCodeId: z.string().uuid({ message: 'Selecione o motivo' }),
  expectedAt: z.coerce.date({ message: 'Informe o prazo previsto' }),
});

export const materialQuerySchema = z.object({
  status: z.nativeEnum(MaterialRequestStatus).optional(),
  workOrderId: z.string().uuid().optional(),
  /** Fila única do Estoque: tudo que ainda não foi entregue. */
  onlyPending: z.coerce.boolean().default(false),
});

// --- Pool rotativo (RF-26) --------------------------------------------------

export const poolMovementSchema = z.object({
  toStatus: z.nativeEnum(PoolComponentStatus),
  workOrderTaskId: z.string().uuid().optional(),
  note: z.string().trim().max(255).optional(),
});

export const createPoolComponentSchema = z.object({
  materialId: z.string().uuid(),
  serialNumber: z.string().trim().min(1, 'Informe o número de série').max(64),
});

// --- Ferramentas (RF-28) ----------------------------------------------------

export const loanToolSchema = z.object({
  toolId: z.string().uuid(),
  workOrderTaskId: z.string().uuid().optional(),
});

export type RequestMaterialInput = z.infer<typeof requestMaterialSchema>;
export type SeparateMaterialInput = z.infer<typeof separateMaterialSchema>;
export type DeliverMaterialInput = z.infer<typeof deliverMaterialSchema>;
export type WaitForPartInput = z.infer<typeof waitForPartSchema>;
export type MaterialQuery = z.infer<typeof materialQuerySchema>;
export type PoolMovementInput = z.infer<typeof poolMovementSchema>;
export type CreatePoolComponentInput = z.infer<typeof createPoolComponentSchema>;
export type LoanToolInput = z.infer<typeof loanToolSchema>;

export interface MaterialRequestRow {
  id: string;
  status: MaterialRequestStatus;
  materialId: string;
  materialCode: string;
  materialDescription: string;
  isSerialized: boolean;
  quantity: number;
  serialNumber: string | null;
  workOrderId: string | null;
  workOrderCode: string | null;
  workOrderTaskId: string | null;
  taskDescription: string | null;
  vehicleCode: string | null;
  requestedAt: string;
  requestedByName: string | null;
  separatedAt: string | null;
  deliveredAt: string | null;
  receivedByName: string | null;
  partWaiting: {
    reasonDescription: string;
    expectedAt: string;
    isOverdue: boolean;
    escalatedAt: string | null;
  } | null;
}

export interface PoolComponentRow {
  id: string;
  serialNumber: string;
  status: PoolComponentStatus;
  materialCode: string;
  materialDescription: string;
  currentVehicleCode: string | null;
}

export interface ToolRow {
  id: string;
  code: string;
  description: string;
  calibrationDueAt: string | null;
  /** RF-28 — calibração vencida bloqueia o empréstimo. */
  isCalibrationExpired: boolean;
  loanedToName: string | null;
  loanedAt: string | null;
}
