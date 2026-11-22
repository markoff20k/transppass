import { z } from 'zod';
import { FAILURE_MODE_CODES, POSITION_CODES, VMRS_SUBSYSTEM_CODES, positionRefinement, type ResolvedFlags } from '../catalog/failure-codes.js';

/**
 * E1 — Eventos corretivos (RF-01 a RF-06).
 *
 * O evento é a porta de entrada do ciclo que o PRD chama de núcleo do MKBF:
 * falha → triagem → fila → OS → portões → liberação.
 */

export const EventOrigin = {
  CCO: 'CCO',
  OPERATOR: 'OPERATOR',
  GARAGE: 'GARAGE',
  INSPECTION: 'INSPECTION',
  CLEANING: 'CLEANING',
} as const;
export type EventOrigin = (typeof EventOrigin)[keyof typeof EventOrigin];

export const EVENT_ORIGIN_LABELS: Record<EventOrigin, string> = {
  CCO: 'CCO',
  OPERATOR: 'Operador',
  GARAGE: 'Garagem',
  INSPECTION: 'Inspeção',
  CLEANING: 'Limpeza',
};

export const EventStatus = {
  REGISTERED: 'REGISTERED',
  IN_TRIAGE: 'IN_TRIAGE',
  FIELD_SERVICE: 'FIELD_SERVICE',
  RECALLED: 'RECALLED',
  DEFERRED: 'DEFERRED',
  IN_MAINTENANCE: 'IN_MAINTENANCE',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  REGISTERED: 'Registrado',
  IN_TRIAGE: 'Em triagem',
  FIELD_SERVICE: 'Socorro em campo',
  RECALLED: 'Recolhido',
  DEFERRED: 'Deferido',
  IN_MAINTENANCE: 'Em manutenção',
  CLOSED: 'Encerrado',
  CANCELLED: 'Cancelado',
};

/**
 * Item 17 — atendimento na rua: PAM (Ponto de Apoio de Manutenção, solução em até
 * 30 min) ou Socorro (carro parado há mais de 30 min, afetando a linha). Um PAM que
 * passa de PAM_LIMIT_MINUTES é reclassificado como Socorro automaticamente.
 */
export const FieldServiceKind = {
  PAM: 'PAM',
  SOCORRO: 'SOCORRO',
} as const;
export type FieldServiceKind = (typeof FieldServiceKind)[keyof typeof FieldServiceKind];

export const FIELD_SERVICE_KIND_LABELS: Record<FieldServiceKind, string> = {
  PAM: 'PAM',
  SOCORRO: 'Socorro',
};

export const FIELD_SERVICE_KIND_HINTS: Record<FieldServiceKind, string> = {
  PAM: 'Ponto de Apoio de Manutenção: solução na rua em até 30 minutos',
  SOCORRO: 'Carro parado há mais de 30 minutos, afetando a linha',
};

/** Minutos que um PAM pode durar antes de virar Socorro. */
export const PAM_LIMIT_MINUTES = 30;

/** RF-03 — os destinos da triagem (item 1: na rua, oficina ou segue na linha). */
export const TriageDestination = {
  FIELD: 'FIELD',
  RECALL: 'RECALL',
  DEFER: 'DEFER',
} as const;
export type TriageDestination = (typeof TriageDestination)[keyof typeof TriageDestination];

export const TRIAGE_DESTINATION_LABELS: Record<TriageDestination, string> = {
  FIELD: 'Atendimento na rua',
  RECALL: 'Oficina',
  DEFER: 'Segue na linha (manutenção à noite)',
};

export const FieldOutcome = {
  RESOLVED_IN_FIELD: 'RESOLVED_IN_FIELD',
  TOWED: 'TOWED',
  RETURNED_UNDER_OWN_POWER: 'RETURNED_UNDER_OWN_POWER',
  NOT_FOUND: 'NOT_FOUND',
  CANCELLED: 'CANCELLED',
} as const;
export type FieldOutcome = (typeof FieldOutcome)[keyof typeof FieldOutcome];

export const FIELD_OUTCOME_LABELS: Record<FieldOutcome, string> = {
  RESOLVED_IN_FIELD: 'Resolvido em campo',
  TOWED: 'Rebocado',
  RETURNED_UNDER_OWN_POWER: 'Retornou por meios próprios',
  NOT_FOUND: 'Carro não localizado',
  CANCELLED: 'Atendimento cancelado',
};

/**
 * Desfechos em que o carro volta a rodar sem passar pela garagem. Falha de
 * segurança nunca chega aqui: o RF-05 bloqueia antes.
 */
export const FIELD_OUTCOMES_RETURNING_TO_LINE: readonly FieldOutcome[] = [
  FieldOutcome.RESOLVED_IN_FIELD,
  FieldOutcome.NOT_FOUND,
];

// --- Registro do evento (RF-01) --------------------------------------------

/** Código composto Modo × Subsistema × Posição (padrão de codificação de falhas). */
const failureCodeInput = {
  failureModeCode: z.enum(FAILURE_MODE_CODES).optional(),
  subsystemCode: z.enum(VMRS_SUBSYSTEM_CODES).optional(),
  position: z.enum(POSITION_CODES).optional(),
};

export const createEventSchema = z.object({
  vehicleId: z.string().uuid('Selecione o carro'),
  /** Atalho do catálogo (falhas frequentes). Opcional. */
  catalogItemId: z.string().uuid().optional(),
  ...failureCodeInput,
  reportedDescription: z.string().trim().max(500).optional(),
  origin: z.nativeEnum(EventOrigin).default(EventOrigin.CCO),
  operatorId: z.string().uuid().optional(),
  lineCode: z.string().trim().max(16).optional(),
  locationDescription: z.string().trim().max(255).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  /** Item 12: RE de quem registra. Sem ele, a API usa a matrícula do cadastro da pessoa. */
  reporterRegistration: z.string().trim().min(1, 'Informe o RE').max(32).optional(),
  /** Item 13: data e hora do evento. Sem ela, vale a hora do registro. */
  reportedAt: z.coerce.date().optional(),
}).superRefine(positionRefinement('subsystemCode', 'position'));

/** Item 13: até quanto tempo para trás a data do evento pode ser ajustada. */
export const EVENT_BACKDATE_MAX_DAYS = 7;

export const eventQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(EventStatus).optional(),
  vehicleId: z.string().uuid().optional(),
  /** Fila de triagem: só os que ainda esperam decisão. */
  pendingTriage: z.coerce.boolean().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  // Filtros por coluna da tabela de eventos (texto = "contém", sem distinguir maiúsculas).
  code: z.string().trim().max(40).optional(),
  /** Prefixo ou placa do carro. */
  vehicle: z.string().trim().max(40).optional(),
  failureCode: z.string().trim().max(20).optional(),
  /** Descrição da falha: catálogo, texto do registro ou defeito do CCO. */
  failure: z.string().trim().max(80).optional(),
  origin: z.nativeEnum(EventOrigin).optional(),
  /** Só com OS aberta a partir do evento, ou só sem. */
  workOrder: z.enum(['with', 'without']).optional(),
});

// --- Triagem (RF-03) --------------------------------------------------------

export const triageSchema = z
  .object({
    destination: z.nativeEnum(TriageDestination),
    /** Atendimento na rua: PAM (padrão) ou Socorro. */
    fieldKind: z.nativeEnum(FieldServiceKind).optional(),
    /** Obrigatório ao deferir: é decisão que adia atendimento. */
    reasonCodeId: z.string().uuid().optional(),
    note: z.string().trim().max(255).optional(),
    /** Confirmação da falha, quando o PCM reclassifica o que o CCO registrou. */
    catalogItemId: z.string().uuid().optional(),
    ...failureCodeInput,
  })
  .refine((v) => v.destination !== TriageDestination.DEFER || Boolean(v.reasonCodeId), {
    message: 'Deferir exige código de motivo',
    path: ['reasonCodeId'],
  })
  .superRefine(positionRefinement('subsystemCode', 'position'));

// --- Socorro em campo (RF-04) ----------------------------------------------

/** Apontamento por toque: cada passo é um botão, sem formulário. */
export const FieldStep = {
  ARRIVED: 'ARRIVED',
  STARTED: 'STARTED',
  FINISHED: 'FINISHED',
} as const;
export type FieldStep = (typeof FieldStep)[keyof typeof FieldStep];

export const fieldStepSchema = z.object({
  step: z.nativeEnum(FieldStep),
});

export const fieldOutcomeSchema = z.object({
  outcome: z.nativeEnum(FieldOutcome),
  confirmedCatalogItemId: z.string().uuid().optional(),
  /** Constatação em campo, no mesmo código do registro — base do alinhamento origem × diagnóstico. */
  confirmedFailureModeCode: z.enum(FAILURE_MODE_CODES).optional(),
  confirmedSubsystemCode: z.enum(VMRS_SUBSYSTEM_CODES).optional(),
  confirmedPosition: z.enum(POSITION_CODES).optional(),
  note: z.string().trim().max(500).optional(),
  materials: z
    .array(
      z.object({
        materialId: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        serialNumber: z.string().trim().max(64).optional(),
      }),
    )
    .default([]),
})
  .superRefine(positionRefinement('confirmedSubsystemCode', 'confirmedPosition'));

/** Item 16: tempo estimado do reparo na rua, informado (ou confirmado) pelo técnico. */
export const fieldEstimateSchema = z.object({
  minutes: z.coerce.number().int('Minutos inteiros').min(5, 'No mínimo 5 minutos').max(720, 'No máximo 12 horas'),
});

/** Sugestão quando não há catálogo nem histórico: o limite do PAM. */
export const DEFAULT_FIELD_REPAIR_MINUTES = 30;

export const dispatchFieldServiceSchema = z.object({
  technicianId: z.string().uuid().optional(),
  supportVehicleCode: z.string().trim().max(16).optional(),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type EventQuery = z.infer<typeof eventQuerySchema>;
export type TriageInput = z.infer<typeof triageSchema>;
export type FieldStepInput = z.infer<typeof fieldStepSchema>;
export type FieldOutcomeInput = z.infer<typeof fieldOutcomeSchema>;
export type DispatchFieldServiceInput = z.infer<typeof dispatchFieldServiceSchema>;
export type FieldEstimateInput = z.infer<typeof fieldEstimateSchema>;

/** Inteligência do catálogo exibida no registro e na triagem (RF-02). */
export interface CatalogIntelligence {
  code: string;
  description: string;
  probableCause: string | null;
  estimatedRepairMinutes: number | null;
  fieldResolutionRate: number | null;
  fieldResolutionSamples: number;
  isFastTrack: boolean;
  isSafety: boolean;
  isDeferrable: boolean;
}

/** Os quatro números do topo da tela de Eventos, contados sobre toda a base. */
export interface EventsSummary {
  registeredToday: number;
  awaitingTriage: number;
  safetyOpen: number;
  deferred: number;
}

export interface FailureEventSummary {
  id: string;
  code: string;
  vehicleId: string;
  vehicleCode: string;
  vehiclePlate: string;
  catalogItemId: string | null;
  catalog: CatalogIntelligence | null;
  /** Código composto do registro (Modo × Subsistema × Posição) e sua leitura. */
  failureModeCode: string | null;
  subsystemCode: string | null;
  position: string | null;
  failureCode: string | null;
  failureLabel: string | null;
  /** Flags resolvidas (regras por código > item do catálogo > padrão). */
  flags: ResolvedFlags;
  reportedDescription: string | null;
  origin: EventOrigin;
  status: EventStatus;
  reportedAt: string;
  /** Item 12: RE de quem registrou. */
  reporterRegistration: string | null;
  lineCode: string | null;
  locationDescription: string | null;
  isUnscheduledReturn: boolean;
  closedAt: string | null;
  /** Segundos desde o registro — o SLA de triagem corre sobre isto. */
  waitingSeconds: number;
  triage: {
    destination: TriageDestination;
    decidedAt: string;
    slaSeconds: number;
    note: string | null;
  } | null;
  fieldService: {
    id: string;
    kind: FieldServiceKind;
    /** Quando o PAM passou de 30 min e virou Socorro. */
    reclassifiedAt: string | null;
    dispatchedAt: string;
    arrivedAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    outcome: FieldOutcome | null;
    supportVehicleCode: string | null;
    confirmedFailureCode: string | null;
    /** Item 16: estimativa gravada pelo técnico (null enquanto ninguém confirmou). */
    estimatedRepairMinutes: number | null;
    estimateSetAt: string | null;
    /** O que o sistema sugere: a mediana real de rua do subsistema; sem ela, 30 min no PAM e o tempo do catálogo no Socorro. */
    suggestedRepairMinutes: number;
    suggestionSource: 'catalog' | 'history' | 'default';
  } | null;
  workOrderId: string | null;
  workOrderCode: string | null;
}
