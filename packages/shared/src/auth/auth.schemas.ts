import { z } from 'zod';

/**
 * Contrato de autenticação compartilhado entre web e api.
 * O backend valida com estes schemas; o frontend infere os tipos deles.
 * Nada aqui pode importar de apps/ — este pacote é a única ponte entre os dois.
 */

export const emailSchema = z.string().trim().toLowerCase().email('E-mail inválido');

export const passwordSchema = z
  .string()
  .min(8, 'A senha deve ter no mínimo 8 caracteres')
  .max(128, 'A senha deve ter no máximo 128 caracteres');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

/** Perfis por área, espelhando o organograma da seção 5 do PRD. */
export const UserRole = {
  ADMIN: 'ADMIN',
  PCM: 'PCM',
  CCO: 'CCO',
  PLANTAO: 'PLANTAO',
  SOCORRO: 'SOCORRO',
  MANUTENCAO: 'MANUTENCAO',
  MECANICO: 'MECANICO',
  INSPETOR: 'INSPETOR',
  ESTOQUE: 'ESTOQUE',
  LIMPEZA: 'LIMPEZA',
  GESTAO: 'GESTAO',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const userRoleSchema = z.nativeEnum(UserRole);

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrador',
  PCM: 'PCM',
  CCO: 'CCO',
  PLANTAO: 'Plantão',
  SOCORRO: 'Socorro',
  MANUTENCAO: 'Manutenção',
  MECANICO: 'Mecânico',
  INSPETOR: 'Inspetor',
  ESTOQUE: 'Estoque',
  LIMPEZA: 'Limpeza',
  GESTAO: 'Gestão',
};

export const publicUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  role: userRoleSchema,
  registration: z.string().nullable(),
  garageId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
});

export const authResponseSchema = z.object({
  user: publicUserSchema,
  tokens: authTokensSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
export type AuthTokens = z.infer<typeof authTokensSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;

/** Payload que viaja dentro do access token. */
export interface JwtAccessPayload {
  sub: string;
  email: string;
  role: UserRole;
}

// --- Administração de usuários (RF-36) -------------------------------------

export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  email: emailSchema,
  password: passwordSchema,
  role: userRoleSchema,
  registration: z.string().trim().max(32).optional(),
  garageId: z.string().uuid().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  password: passwordSchema.optional(),
  role: userRoleSchema.optional(),
  registration: z.string().trim().max(32).optional(),
  garageId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
});

export const userQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(60).optional(),
  role: userRoleSchema.optional(),
  onlyActive: z.coerce.boolean().default(true),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UserQuery = z.infer<typeof userQuerySchema>;
