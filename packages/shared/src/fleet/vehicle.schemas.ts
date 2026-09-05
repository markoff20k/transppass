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
  modelYear: z.coerce.number().int().min(1980).max(2100).optional(),
  garageId: z.string().uuid().optional(),
});

export const updateVehicleSchema = createVehicleSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const vehicleQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(60).optional(),
  technology: z.nativeEnum(VehicleTechnology).optional(),
  status: z.nativeEnum(VehicleStatus).optional(),
  garageId: z.string().uuid().optional(),
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
  status: z.nativeEnum(VehicleStatus),
  currentKm: z.number().int(),
  lastReadingAt: z.string().datetime().nullable(),
  isActive: z.boolean(),
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
}

/** KPIs do topo do painel (RF-37 / RF-38). */
export interface FleetPanelSummary {
  total: number;
  available: number;
  availabilityRate: number;
  byStatus: Record<VehicleStatus, number>;
  degradedKmCount: number;
}
