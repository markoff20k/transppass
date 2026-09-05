import { z } from 'zod';

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

/** RF-03 — os três destinos da triagem. */
export const TriageDestination = {
  FIELD: 'FIELD',
  RECALL: 'RECALL',
  DEFER: 'DEFER',
} as const;
export type TriageDestination = (typeof TriageDestination)[keyof typeof TriageDestination];

export const TRIAGE_DESTINATION_LABELS: Record<TriageDestination, string> = {
  FIELD: 'Socorro em campo',
  RECALL: 'Recolher',
  DEFER: 'Deferir para a parada programada',
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

export const createEventSchema = z.object({
  vehicleId: z.string().uuid('Selecione o carro'),
  /** Falha do catálogo. Opcional porque o CCO nem sempre sabe classificar. */
  catalogItemId: z.string().uuid().optional(),
  reportedDescription: z.string().trim().max(500).optional(),
  origin: z.nativeEnum(EventOrigin).default(EventOrigin.CCO),
  operatorId: z.string().uuid().optional(),
  lineCode: z.string().trim().max(16).optional(),
  locationDescription: z.string().trim().max(255).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});

export const eventQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(EventStatus).optional(),
  vehicleId: z.string().uuid().optional(),
  /** Fila de triagem: só os que ainda esperam decisão. */
  pendingTriage: z.coerce.boolean().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// --- Triagem (RF-03) --------------------------------------------------------

export const triageSchema = z
  .object({
    destination: z.nativeEnum(TriageDestination),
    /** Obrigatório ao deferir: é decisão que adia atendimento. */
    reasonCodeId: z.string().uuid().optional(),
    note: z.string().trim().max(255).optional(),
    /** Confirmação da falha, quando o PCM reclassifica o que o CCO registrou. */
    catalogItemId: z.string().uuid().optional(),
  })
  .refine((v) => v.destination !== TriageDestination.DEFER || Boolean(v.reasonCodeId), {
    message: 'Deferir exige código de motivo',
    path: ['reasonCodeId'],
  });

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
});

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

export interface FailureEventSummary {
  id: string;
  code: string;
  vehicleId: string;
  vehicleCode: string;
  vehiclePlate: string;
  catalogItemId: string | null;
  catalog: CatalogIntelligence | null;
  reportedDescription: string | null;
  origin: EventOrigin;
  status: EventStatus;
  reportedAt: string;
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
    dispatchedAt: string;
    arrivedAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    outcome: FieldOutcome | null;
    supportVehicleCode: string | null;
  } | null;
  workOrderId: string | null;
  workOrderCode: string | null;
}
