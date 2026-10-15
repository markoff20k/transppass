import { z } from 'zod';
import { VehicleTechnology } from '../fleet/vehicle.schemas.js';

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
});

export const updatePackageSchema = createPackageSchema.partial();

export const createPlanTaskSchema = z.object({
  code: z.string().trim().toUpperCase().min(1, 'Informe o código').max(24),
  description: z.string().trim().min(3, 'Descreva a tarefa').max(255),
  specialtyId: z.string().uuid().optional(),
  estimatedMinutes: z.coerce.number().int().positive().optional(),
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
}
