import { z } from 'zod';
import { VehicleTechnology } from '../fleet/vehicle.schemas.js';

/**
 * Kaizen 15–17 — técnicos de manutenção e inspetores: especialidade,
 * tecnologias em que atuam e nível de experiência (1, 2 ou 3). O critério
 * de classificação é da Manutenção; o sistema só registra e usa.
 */

export const TECHNICIAN_LEVELS = [1, 2, 3] as const;
export type TechnicianLevel = (typeof TECHNICIAN_LEVELS)[number];

export const TECHNICIAN_LEVEL_LABELS: Record<TechnicianLevel, string> = {
  1: 'Nível 1 — iniciante',
  2: 'Nível 2 — pleno',
  3: 'Nível 3 — sênior',
};

export const createTechnicianSchema = z.object({
  registration: z.string().trim().min(1, 'Informe a matrícula').max(32),
  name: z.string().trim().min(3, 'Informe o nome').max(120),
  specialtyId: z.string().uuid('Selecione a especialidade'),
  technologies: z.array(z.nativeEnum(VehicleTechnology)).min(1, 'Marque ao menos uma tecnologia'),
  level: z.coerce.number().int().min(1).max(3).default(1),
  isInspector: z.boolean().default(false),
  /** Conta do sistema, quando o técnico também opera as telas. */
  userId: z.string().uuid().optional(),
});

export const updateTechnicianSchema = createTechnicianSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type CreateTechnicianInput = z.infer<typeof createTechnicianSchema>;
export type UpdateTechnicianInput = z.infer<typeof updateTechnicianSchema>;

export interface TechnicianRow {
  id: string;
  registration: string;
  name: string;
  specialtyId: string;
  specialtyCode: string;
  specialtyName: string;
  technologies: VehicleTechnology[];
  level: TechnicianLevel;
  isInspector: boolean;
  isActive: boolean;
  userId: string | null;
  /** Sub-OS em andamento atribuídas a ele agora. */
  openTasks: number;
  trainings: number;
  /** Treinamentos vencidos ou vencendo em 30 dias. */
  trainingsExpiring: number;
  /** Atua em eBUS sem treinamento de alta tensão vigente. */
  missingHighVoltage: boolean;
}

/** Kaizen — matriz de treinamentos: o que cada técnico fez e o que vence. */
export const TRAINING_KINDS = {
  PLANO_MANUTENCAO: 'Plano de manutenção (IT.MAN)',
  ALTA_TENSAO: 'Alta tensão / eBUS (NR-10 + fabricante)',
  NR: 'Norma regulamentadora (NR-12, NR-35…)',
  PROCEDIMENTO: 'POP / procedimento interno',
  OUTRO: 'Outro',
} as const;
export type TrainingKind = keyof typeof TRAINING_KINDS;

export const createTrainingSchema = z.object({
  kind: z.enum(Object.keys(TRAINING_KINDS) as [TrainingKind, ...TrainingKind[]]),
  title: z.string().trim().min(3, 'Informe o treinamento').max(120),
  completedAt: z.coerce.date({ message: 'Informe a data' }),
  validUntil: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.date().optional()),
  hours: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().int().min(0).optional()),
  note: z.string().trim().max(255).optional(),
});
export type CreateTrainingInput = z.infer<typeof createTrainingSchema>;

export interface TrainingRow {
  id: string;
  kind: TrainingKind;
  title: string;
  completedAt: string;
  validUntil: string | null;
  hours: number | null;
  note: string | null;
  isExpired: boolean;
}
