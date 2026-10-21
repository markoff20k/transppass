import { z } from 'zod';
import { VehicleTechnology } from '../fleet/vehicle.schemas.js';

/** Inteiro opcional: string vazia do formulário vira undefined. */
const optionalInt = () =>
  z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().int().min(0).optional());

/**
 * RF-34 — planos preventivos, pacotes (janelas de km), tarefas, kits e o
 * cadastro de materiais. É o que a Preventiva (E3) consome para montar o
 * escopo e o kit D-1. Planos são versionados por documento controlado;
 * o que está em uso é o `isActive` mais recente de cada tecnologia.
 */

export const createPlanSchema = z.object({
  code: z.string().trim().toUpperCase().min(1, 'Informe o código').max(24),
  name: z.string().trim().min(3, 'Informe o nome').max(120),
  technology: z.nativeEnum(VehicleTechnology),
  controlledDocument: z.string().trim().max(60).optional(),
  effectiveFrom: z.coerce.date().optional(),
  /** Plano por modelo (IT.MAN-01 varia por modelo). Vazio = vale para a tecnologia inteira. */
  manufacturer: z.string().trim().max(60).optional(),
  vehicleModel: z.string().trim().max(60).optional(),
});

export const updatePlanSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  controlledDocument: z.string().trim().max(60).optional(),
  isActive: z.boolean().optional(),
});

export const createPackageSchema = z.object({
  code: z.string().trim().toUpperCase().min(1, 'Informe o código').max(24),
  name: z.string().trim().min(3, 'Informe o nome').max(120),
  intervalKm: z.coerce.number().int().positive('Informe a janela em km'),
  toleranceKm: z.coerce.number().int().min(0).default(500),
  /** Tolerância para baixo quando difere da de cima (IT.MAN-01: 2.000 abaixo, 1.000 acima). */
  toleranceBelowKm: optionalInt(),
  /** Primeiro gatilho; depois repete a cada intervalKm (pacote A: 15.000 + n×30.000). */
  offsetKm: z.coerce.number().int().min(0).default(0),
  /** Periodicidade em dias para pacotes por tempo (AC semanal/mensal, dedetização). */
  periodDays: optionalInt(),
});

export const updatePackageSchema = createPackageSchema.partial();

export const createPlanTaskSchema = z.object({
  code: z.string().trim().toUpperCase().min(1, 'Informe o código').max(24),
  description: z.string().trim().min(3, 'Descreva a tarefa').max(255),
  specialtyId: z.string().uuid().optional(),
  estimatedMinutes: z.coerce.number().int().positive().optional(),
  /** Seção do documento controlado (Motor, Freios e Ar, Elétrica...). */
  section: z.string().trim().max(40).optional(),
  /** Só para carros equipados ("elevador", "câmbio Voith"). */
  equipmentCondition: z.string().trim().max(80).optional(),
});

export const updatePlanTaskSchema = createPlanTaskSchema.partial();

export const kitItemInputSchema = z.object({
  materialId: z.string().uuid(),
  quantity: z.coerce.number().positive('Quantidade deve ser maior que zero'),
});

export const createKitSchema = z.object({
  code: z.string().trim().toUpperCase().min(1, 'Informe o código').max(24),
  name: z.string().trim().min(3, 'Informe o nome').max(120),
  items: z.array(kitItemInputSchema).default([]),
});

/** Kits são versionados: salvar itens cria uma versão nova e encerra a anterior. */
export const updateKitSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  items: z.array(kitItemInputSchema).optional(),
  isActive: z.boolean().optional(),
});

export const createMaterialSchema = z.object({
  code: z.string().trim().toUpperCase().min(1, 'Informe o código').max(32),
  description: z.string().trim().min(3, 'Descreva o material').max(255),
  unit: z.string().trim().min(1, 'Informe a unidade').max(8),
  isSerialized: z.boolean().default(false),
  classCode: z.string().trim().max(8).optional(),
  manufacturerRef: z.string().trim().max(80).optional(),
  location: z.string().trim().toUpperCase().max(24).optional(),
  stockQty: optionalInt(),
  isPreventive: z.boolean().optional(),
});

export const updateMaterialSchema = createMaterialSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type CreatePackageInput = z.infer<typeof createPackageSchema>;
export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;
export type CreatePlanTaskInput = z.infer<typeof createPlanTaskSchema>;
export type UpdatePlanTaskInput = z.infer<typeof updatePlanTaskSchema>;
export type KitItemInput = z.infer<typeof kitItemInputSchema>;
export type CreateKitInput = z.infer<typeof createKitSchema>;
export type UpdateKitInput = z.infer<typeof updateKitSchema>;
export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;

// --- Saída: a árvore do plano ------------------------------------------------

export interface PlanTaskRow {
  id: string;
  code: string;
  description: string;
  specialtyId: string | null;
  specialtyName: string | null;
  estimatedMinutes: number | null;
  section: string | null;
  equipmentCondition: string | null;
}

export interface KitItemRow {
  materialId: string;
  materialCode: string;
  materialDescription: string;
  unit: string;
  quantity: number;
}

export interface PlanKitRow {
  id: string;
  code: string;
  name: string;
  version: number;
  isActive: boolean;
  items: KitItemRow[];
}

export interface PlanPackageTree {
  id: string;
  code: string;
  name: string;
  intervalKm: number;
  toleranceKm: number;
  toleranceBelowKm: number | null;
  offsetKm: number;
  periodDays: number | null;
  tasks: PlanTaskRow[];
  /** Versão vigente do kit (a mais recente ativa), se houver. */
  kit: PlanKitRow | null;
  estimatedMinutes: number;
}

export interface PlanTree {
  id: string;
  code: string;
  name: string;
  technology: VehicleTechnology;
  manufacturer: string | null;
  vehicleModel: string | null;
  version: number;
  controlledDocument: string | null;
  effectiveFrom: string;
  isActive: boolean;
  packages: PlanPackageTree[];
}

export interface MaterialRow {
  id: string;
  code: string;
  description: string;
  unit: string;
  isSerialized: boolean;
  isActive: boolean;
  /** Quantos kits vigentes usam o material. */
  kitCount: number;
  classCode: string | null;
  manufacturerRef: string | null;
  location: string | null;
  abcClass: string | null;
  stockQty: number;
  avgCost: number | null;
  isPreventive: boolean;
}

/** Classes contábeis do almoxarifado (4 primeiros dígitos = grupo). */
export const MATERIAL_CLASS_GROUPS: Record<string, string> = {
  '0101': 'Mecânica',
  '0102': 'Carroceria e acabamento',
  '0302': 'Lubrificantes',
  '0401': 'Pneus novos',
  '0402': 'Pneus recapados',
  '0403': 'Rodas e borracharia',
  '0601': 'Abastecimento',
  '1001': 'Consumo e ferramental',
  '2001': 'Recondicionados',
  '2101': 'Montagem interna',
};

export function materialGroupLabel(classCode: string | null): string {
  if (!classCode) return 'Sem classe';
  return MATERIAL_CLASS_GROUPS[classCode.slice(0, 4)] ?? `Classe ${classCode}`;
}
