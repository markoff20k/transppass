import { z } from 'zod';

/**
 * Kaizen — qualidade de peças e fornecedores: o "laboratório de inspeção
 * técnica de peças" do A3 (contramedida 2) e a gestão de fornecedores com
 * SLA (roadmap, médio prazo). A reincidência por peça e por fornecedor é o
 * que alimenta a conversa de garantia e de contrato.
 */

export const createSupplierSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  cnpj: z.string().trim().max(18).optional(),
  contact: z.string().trim().max(160).optional(),
  claimSlaDays: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().int().min(0).optional()),
});
export const updateSupplierSchema = createSupplierSchema.partial().extend({ isActive: z.boolean().optional() });
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

export interface SupplierRow {
  id: string;
  name: string;
  cnpj: string | null;
  contact: string | null;
  claimSlaDays: number | null;
  isActive: boolean;
  materials: number;
  rejections90d: number;
  claimsOpen: number;
}

export const PartInspectionResult = { APPROVED: 'APPROVED', REJECTED: 'REJECTED' } as const;
export type PartInspectionResult = (typeof PartInspectionResult)[keyof typeof PartInspectionResult];

export const PART_REJECTION_REASONS = {
  DEFEITO_FABRICACAO: 'Defeito de fabricação',
  FORA_DE_ESPEC: 'Fora da especificação',
  DANO_TRANSPORTE: 'Dano de transporte / embalagem',
  FALHA_PREMATURA: 'Falha prematura em uso',
  DESGASTE_NORMAL: 'Desgaste normal (não é defeito)',
  OUTRO: 'Outro',
} as const;
export type PartRejectionReason = keyof typeof PART_REJECTION_REASONS;

export const WARRANTY_CLAIM_LABELS = {
  NONE: 'Sem reclamação',
  OPENED: 'Reclamação aberta',
  ACCEPTED: 'Aceita pelo fornecedor',
  DENIED: 'Negada',
} as const;
export type WarrantyClaimStatus = keyof typeof WARRANTY_CLAIM_LABELS;

export const createPartInspectionSchema = z.object({
  materialId: z.string().uuid('Selecione a peça'),
  supplierId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
  workOrderId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
  vehicleId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
  serialNumber: z.string().trim().max(64).optional(),
  quantity: z.coerce.number().positive().default(1),
  result: z.nativeEnum(PartInspectionResult),
  reason: z.enum(Object.keys(PART_REJECTION_REASONS) as [PartRejectionReason, ...PartRejectionReason[]]),
  kmInService: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().int().min(0).optional()),
  underWarranty: z.boolean().default(false),
  claimStatus: z.enum(Object.keys(WARRANTY_CLAIM_LABELS) as [WarrantyClaimStatus, ...WarrantyClaimStatus[]]).default('NONE'),
  note: z.string().trim().max(500).optional(),
});
export type CreatePartInspectionInput = z.infer<typeof createPartInspectionSchema>;

export const updatePartInspectionSchema = z.object({
  claimStatus: z.enum(Object.keys(WARRANTY_CLAIM_LABELS) as [WarrantyClaimStatus, ...WarrantyClaimStatus[]]),
  note: z.string().trim().max(500).optional(),
});
export type UpdatePartInspectionInput = z.infer<typeof updatePartInspectionSchema>;

export interface PartInspectionRow {
  id: string;
  materialId: string;
  materialCode: string;
  materialDescription: string;
  supplierId: string | null;
  supplierName: string | null;
  workOrderId: string | null;
  workOrderCode: string | null;
  vehicleCode: string | null;
  serialNumber: string | null;
  quantity: number;
  result: PartInspectionResult;
  reason: PartRejectionReason;
  kmInService: number | null;
  underWarranty: boolean;
  claimStatus: WarrantyClaimStatus;
  note: string | null;
  inspectedByName: string | null;
  inspectedAt: string;
}

export interface QualitySummary {
  inspected90d: number;
  rejected90d: number;
  warrantyOpen: number;
  bySupplier: { supplierId: string; supplierName: string; inspected: number; rejected: number; claimsOpen: number }[];
  byReason: { reason: PartRejectionReason; count: number }[];
}
