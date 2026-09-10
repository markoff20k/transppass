import { z } from 'zod';
import type { VehicleStatus, VehicleTechnology } from '../fleet/vehicle.schemas.js';

/**
 * E6 — Operação e Plantão (RF-29 a RF-31).
 *
 * O Plantão cobre a rua com reservas. Precisa de três coisas (PRD, seção 5):
 * janela em contagem, operador habilitado na tecnologia do carro, e previsão
 * de retorno confiável — que chega sozinha, sem telefone (RN-16).
 */

export const ReplacementDemandStatus = {
  OPEN: 'OPEN',
  ASSIGNED: 'ASSIGNED',
  MET: 'MET',
  MISSED: 'MISSED',
  CANCELLED: 'CANCELLED',
} as const;
export type ReplacementDemandStatus =
  (typeof ReplacementDemandStatus)[keyof typeof ReplacementDemandStatus];

export const DEMAND_STATUS_LABELS: Record<ReplacementDemandStatus, string> = {
  OPEN: 'Aberta',
  ASSIGNED: 'Reserva designada',
  MET: 'Janela atendida',
  MISSED: 'Janela estourada',
  CANCELLED: 'Cancelada',
};

/**
 * Janela padrão para cobrir uma linha, em minutos.
 * ARBITRADO: o PRD registra os valores de SLA como questão aberta (seção 12).
 */
export const DEFAULT_REPLACEMENT_WINDOW_MINUTES = 40;

export const createDemandSchema = z.object({
  lineCode: z.string().trim().min(1, 'Informe a linha').max(16),
  /** Carro que saiu da linha e precisa de reposição, quando houver. */
  originVehicleId: z.string().uuid().optional(),
  windowMinutes: z.coerce.number().int().min(5).max(240).default(DEFAULT_REPLACEMENT_WINDOW_MINUTES),
  note: z.string().trim().max(255).optional(),
});

/** RF-30 — a reserva só aceita operador habilitado na tecnologia do carro. */
export const assignReserveSchema = z.object({
  vehicleId: z.string().uuid('Selecione o carro reserva'),
  operatorId: z.string().uuid('Selecione o operador'),
});

export const demandQuerySchema = z.object({
  status: z.nativeEnum(ReplacementDemandStatus).optional(),
  /** Só o que ainda está em aberto ou com reserva na rua. */
  active: z.coerce.boolean().default(true),
});

export type CreateDemandInput = z.infer<typeof createDemandSchema>;
export type AssignReserveInput = z.infer<typeof assignReserveSchema>;
export type DemandQuery = z.infer<typeof demandQuerySchema>;

export interface DemandRow {
  id: string;
  status: ReplacementDemandStatus;
  lineCode: string;
  originVehicleId: string | null;
  originVehicleCode: string | null;
  originReason: string | null;
  requestedAt: string;
  windowEndsAt: string;
  /** Segundos restantes da janela — negativo quando estourou. */
  secondsLeft: number;
  metAt: string | null;
  assignment: {
    id: string;
    vehicleId: string;
    vehicleCode: string;
    operatorId: string;
    operatorName: string;
    assignedAt: string;
    returnedAt: string | null;
  } | null;
  /** RF-31 — previsão de retorno do carro titular, ao vivo da OS. */
  titularReturn: {
    workOrderId: string;
    workOrderCode: string;
    estimatedCompletionAt: string;
    status: string;
    isOverdue: boolean;
  } | null;
}

export interface ReserveCandidate {
  vehicleId: string;
  vehicleCode: string;
  vehiclePlate: string;
  technology: VehicleTechnology;
  status: VehicleStatus;
}

export interface OperatorCandidate {
  operatorId: string;
  registration: string;
  name: string;
  /** Tecnologias em que está habilitado (matriz consumida, não administrada). */
  technologies: VehicleTechnology[];
}

/** RF-31 — o painel do Plantão: retornos previstos ao vivo. */
export interface ExpectedReturnRow {
  workOrderId: string;
  workOrderCode: string;
  vehicleId: string;
  vehicleCode: string;
  vehiclePlate: string;
  status: string;
  estimatedCompletionAt: string;
  isOverdue: boolean;
  /** Minutos até a previsão — negativo se estourou. */
  minutesToReturn: number;
  /** Há reserva cobrindo este carro? */
  coveredByDemandId: string | null;
}

export interface OperatorRow {
  id: string;
  registration: string;
  name: string;
  isActive: boolean;
  technologies: VehicleTechnology[];
}
