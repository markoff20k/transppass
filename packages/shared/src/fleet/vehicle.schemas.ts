import { z } from 'zod';

/** RF-35 — cadastro da frota com tecnologia, fonte de km e offset de hodômetro. */

export const VehicleTechnology = {
  DIESEL: 'DIESEL',
  EBUS: 'EBUS',
} as const;
export type VehicleTechnology = (typeof VehicleTechnology)[keyof typeof VehicleTechnology];

export const KmSource = {
  MANUAL: 'MANUAL',
  TELEMETRY: 'TELEMETRY',
  JB_API: 'JB_API',
} as const;
export type KmSource = (typeof KmSource)[keyof typeof KmSource];

export const VehicleStatus = {
  AVAILABLE: 'AVAILABLE',
  IN_LINE: 'IN_LINE',
  AWAITING_TRIAGE: 'AWAITING_TRIAGE',
  FIELD_SERVICE: 'FIELD_SERVICE',
  AWAITING_MAINTENANCE: 'AWAITING_MAINTENANCE',
  IN_MAINTENANCE: 'IN_MAINTENANCE',
  AWAITING_PART: 'AWAITING_PART',
  IN_INSPECTION: 'IN_INSPECTION',
  IN_CLEANING: 'IN_CLEANING',
  OUT_OF_SERVICE: 'OUT_OF_SERVICE',
} as const;
export type VehicleStatus = (typeof VehicleStatus)[keyof typeof VehicleStatus];

/** Classes operacionais da SPTrans, como vêm na Escala de Carros da Transppass. */
export const VehicleClass = {
  BASICO_12M: 'BASICO_12M',
  PADRON_13M: 'PADRON_13M',
  PADRON_15M: 'PADRON_15M',
  EPADRON_13M: 'EPADRON_13M',
  EPADRON_15M: 'EPADRON_15M',
  ARTICULADO_18M: 'ARTICULADO_18M',
  ARTICULADO_23M: 'ARTICULADO_23M',
  EARTICULADO_23M: 'EARTICULADO_23M',
} as const;
export type VehicleClass = (typeof VehicleClass)[keyof typeof VehicleClass];

export const VEHICLE_CLASS_LABELS: Record<VehicleClass, string> = {
  BASICO_12M: 'Básico 12M',
  PADRON_13M: 'Padron 13M',
  PADRON_15M: 'Padron 15M',
  EPADRON_13M: 'ePadron 13M',
  EPADRON_15M: 'ePadron 15M',
  ARTICULADO_18M: 'Articulado 18M',
  ARTICULADO_23M: 'Articulado 23M',
  EARTICULADO_23M: 'eArticulado 23M',
};

/** Classes elétricas: a tecnologia do carro decorre da classe. */
export const ELECTRIC_CLASSES: readonly VehicleClass[] = [
  VehicleClass.EPADRON_13M,
  VehicleClass.EPADRON_15M,
  VehicleClass.EARTICULADO_23M,
];

/** Papel do carro na escala da operação. */
export const FleetRole = {
  OPERACIONAL: 'OPERACIONAL',
  RESERVA: 'RESERVA',
  /** Guincho e carro de treinamento: existem no cadastro, não entram na operação nem no MKBF. */
  APOIO: 'APOIO',
} as const;
export type FleetRole = (typeof FleetRole)[keyof typeof FleetRole];

export const FLEET_ROLE_LABELS: Record<FleetRole, string> = {
  OPERACIONAL: 'Operacional',
  RESERVA: 'Reserva',
  APOIO: 'Apoio',
};

export const VEHICLE_TECHNOLOGY_LABELS: Record<VehicleTechnology, string> = {
  DIESEL: 'Diesel',
  EBUS: 'eBUS',
};

export const KM_SOURCE_LABELS: Record<KmSource, string> = {
  MANUAL: 'Lançamento manual',
  TELEMETRY: 'Telemetria',
  JB_API: 'API do JB',
};

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  AVAILABLE: 'Disponível',
  IN_LINE: 'Em linha',
  AWAITING_TRIAGE: 'Aguardando triagem',
  FIELD_SERVICE: 'Socorro em campo',
  AWAITING_MAINTENANCE: 'Na fila',
  IN_MAINTENANCE: 'Em manutenção',
  AWAITING_PART: 'Aguardando peça',
  IN_INSPECTION: 'Em inspeção',
  IN_CLEANING: 'Em limpeza',
  OUT_OF_SERVICE: 'Fora de operação',
};

/** Estados que contam como carro disponível para a operação (RN-01). */
export const AVAILABLE_STATUSES: readonly VehicleStatus[] = [
  VehicleStatus.AVAILABLE,
  VehicleStatus.IN_LINE,
];

/** Campo numérico opcional: string vazia do formulário vira undefined, não 0. */
export function optionalNumber<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), schema.optional());
}

export const plateSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/, 'Placa inválida (padrão brasileiro ou Mercosul)')
  .transform((v) => v.replace('-', ''));

export const createVehicleSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Informe o prefixo')
    .max(16, 'Prefixo muito longo'),
  plate: plateSchema,
  technology: z.nativeEnum(VehicleTechnology),
  kmSource: z.nativeEnum(KmSource),
  odometerOffset: z.coerce.number().int().default(0),
  manufacturer: z.string().trim().max(60).optional(),
  model: z.string().trim().max(60).optional(),
  modelYear: optionalNumber(z.coerce.number().int().min(1980).max(2100)),
  garageId: z.string().uuid().optional(),
  vehicleClass: z.preprocess((v) => (v === '' ? undefined : v), z.nativeEnum(VehicleClass).optional()),
  lot: z.string().trim().toUpperCase().max(8).optional(),
  fleetRole: z.preprocess((v) => (v === '' ? undefined : v), z.nativeEnum(FleetRole).optional()),
});

export const updateVehicleSchema = createVehicleSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const vehicleQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(500).default(20),
  search: z.string().trim().max(60).optional(),
  technology: z.nativeEnum(VehicleTechnology).optional(),
  status: z.nativeEnum(VehicleStatus).optional(),
  garageId: z.string().uuid().optional(),
  vehicleClass: z.nativeEnum(VehicleClass).optional(),
  lot: z.string().trim().max(8).optional(),
  onlyActive: z.coerce.boolean().default(true),
});

export const vehicleSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  plate: z.string(),
  technology: z.nativeEnum(VehicleTechnology),
  kmSource: z.nativeEnum(KmSource),
  odometerOffset: z.number().int(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  modelYear: z.number().int().nullable(),
  garageId: z.string().uuid().nullable(),
  vehicleClass: z.nativeEnum(VehicleClass).nullable(),
  lot: z.string().nullable(),
  fleetRole: z.nativeEnum(FleetRole).nullable(),
  status: z.nativeEnum(VehicleStatus),
  currentKm: z.number().int(),
  lastReadingAt: z.string().datetime().nullable(),
  isActive: z.boolean(),
  /** Frota real da Transppass: prefixo do CCO, chassi, carroceria, lotação. */
  ccoPrefix: z.string().nullable().optional(),
  /** Aplicação no cadastro da Transppass: FROTA, GUINCHO ou TREINAMENTO. */
  application: z.string().nullable().optional(),
  chassisCode: z.string().nullable().optional(),
  vin: z.string().nullable().optional(),
  bodyMaker: z.string().nullable().optional(),
  bodyYear: z.number().int().nullable().optional(),
  fabricationYear: z.number().int().nullable().optional(),
  hasAc: z.boolean().optional(),
  seats: z.number().int().nullable().optional(),
  acquiredAt: z.string().datetime().nullable().optional(),
  isImported: z.boolean().optional(),
});

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
export type VehicleQuery = z.infer<typeof vehicleQuerySchema>;
export type Vehicle = z.infer<typeof vehicleSchema>;

/** Linha do painel da frota (RF-37): estado ao vivo + saúde da projeção de km. */
export interface FleetPanelRow extends Vehicle {
  projectedKm: number | null;
  avgDailyKm: number | null;
  /** Projeção sem leitura há mais de 2 dias (RF-14). */
  isKmDegraded: boolean;
  daysSinceLastReading: number | null;
  /** Próxima preventiva pelo plano vigente: nome do pacote, km que faltam e quanto do intervalo já rodou (0–1). */
  nextPackageName: string | null;
  kmToNextPackage: number | null;
  nextPackageProgress: number | null;
  /** Motorista do checklist de hoje, quando houver. */
  driverName: string | null;
  openWorkOrderCode: string | null;
}

/** A página do carro: o veículo como produto, com o que a manutenção precisa saber hoje. */
export interface VehicleOverview {
  vehicle: Vehicle;
  garageName: string | null;
  projectedKm: number | null;
  avgDailyKm: number | null;
  isKmDegraded: boolean;
  daysSinceLastReading: number | null;
  driverToday: { name: string; registration: string } | null;
  lastDailyCheck: { at: string; result: 'OK' | 'NOK' } | null;
  nextPackage: { name: string; windowKm: number; kmToWindow: number; progress: number; daysToWindow: number | null } | null;
  openWorkOrder: { id: string; code: string; status: string; openedAt: string } | null;
  last30: { kmTraveled: number; returns: number; workOrders: number; mkbf: number | null; downtimeHours: number; availability: number };
  kmByDay: { date: string; km: number }[];
  components: { id: string; kind: string; label: string; lifePct: number; remainingKm: number; status: 'OK' | 'NEAR' | 'OVER' }[];
  recentEvents: { id: string; code: string; reportedAt: string; description: string; failureCode: string | null; status: string; isUnscheduledReturn: boolean }[];
  recentWorkOrders: { id: string; code: string; type: string; status: string; openedAt: string; releasedAt: string | null }[];
  /** Fichas de manutenção reais da Transppass (as mais recentes) e quantas houve em 30 dias. */
  records: MaintenanceRecordRow[];
  recordsLast30: number;
  partsCostLast30: number;
  /** Linhas em que o carro rodou nos últimos 30 dias com dado real. */
  lines30: { line: string; days: number; kmInLine: number; kmIdle: number; trips: number }[];
}

/** Ficha de manutenção real (arquivo VBM0503 + serviços VBM0805 + peças VBM0404). */
export interface MaintenanceRecordRow {
  id: string;
  externalOs: string;
  openedAt: string;
  kind: string;
  kindLabel: string | null;
  /** Algum item com km-limite: manutenção preventiva por km (carta do cliente, item 6). */
  isPreventive: boolean;
  allegedCode: string | null;
  allegedText: string | null;
  allegedDetail: string | null;
  foundCode: string | null;
  foundText: string | null;
  actions: string | null;
  fieldActions: string | null;
  mechanicReg: string | null;
  line: string | null;
  cost: number | null;
  partsCost: number;
  items: { componentCode: string | null; componentLabel: string; kmAtService: number | null; kmLimit: number | null }[];
  materials: { materialCode: string | null; description: string; quantity: number; totalCost: number }[];
}

/** Classificação de falhas da Transppass. */
export interface TransppassCodeRow {
  kind: 'ALEGADO' | 'CONSTATADO' | 'FICHA';
  code: string;
  description: string;
  group: string | null;
}

/** Tabela de modelos de chassi da Transppass (arquivo "1-MODELO DO CHASSI"): o código do sistema deles → fabricante, modelo e classe. */
export interface ChassisModelRow {
  code: string;
  description: string;
  manufacturer: string;
  model: string;
  vehicleClass: VehicleClass;
  /** Classe como está escrita na tabela da Transppass (ex.: "Padron 15m", "eArticulado AC"). */
  rawClass: string;
  hasAc: boolean;
  isElectric: boolean;
}

/** KPIs do topo do painel (RF-37 / RF-38). */
export interface FleetPanelSummary {
  total: number;
  available: number;
  availabilityRate: number;
  byStatus: Record<VehicleStatus, number>;
  degradedKmCount: number;
  /** Carros por classe operacional, para o painel ler a frota como a Escala lê. */
  byClass: Partial<Record<VehicleClass, number>>;
}
