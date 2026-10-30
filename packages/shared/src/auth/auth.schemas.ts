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

/** Onde os avisos rápidos (toasts) aparecem na tela. */
export const TOAST_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type ToastPosition = (typeof TOAST_POSITIONS)[number];

/** Máximo de atalhos no cabeçalho. */
export const MAX_SHORTCUTS = 4;

/**
 * Preferências da própria pessoa — guardadas na conta, não no navegador, para
 * seguirem o usuário de uma máquina a outra.
 */
export const userPreferencesSchema = z.object({
  /** Chaves de navegação (as mesmas do menu lateral), na ordem do cabeçalho. */
  shortcuts: z.array(z.string().min(1).max(40)).max(MAX_SHORTCUTS).default([]),
  notifications: z.boolean().default(true),
  toastPosition: z.enum(TOAST_POSITIONS).default('bottom-right'),
});

export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const updatePreferencesSchema = userPreferencesSchema.partial();
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

export const publicUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  role: userRoleSchema,
  registration: z.string().nullable(),
  garageId: z.string().uuid().nullable(),
  phone: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  preferences: userPreferencesSchema,
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
});

// --- Resumo e atividades da própria conta ----------------------------------

export const ACCOUNT_ACTIVITY_CATEGORIES = ['security', 'profile', 'preferences', 'system'] as const;
export type AccountActivityCategory = (typeof ACCOUNT_ACTIVITY_CATEGORIES)[number];

export const accountActivityQuerySchema = z.object({
  category: z.enum(ACCOUNT_ACTIVITY_CATEGORIES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

export type AccountActivityQuery = z.infer<typeof accountActivityQuerySchema>;

/** Um registro da trilha de auditoria visto pela própria pessoa. */
export interface AccountActivity {
  id: string;
  action: string;
  category: AccountActivityCategory;
  entity: string;
  entityId: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AccountSummary {
  /** Ações registradas na trilha de auditoria pela pessoa, no mês corrente. */
  actionsThisMonth: number;
  /** Eventos de falha abertos pela pessoa no mês corrente. */
  eventsThisMonth: number;
  lastLoginAt: string | null;
  /** Sessões (refresh tokens) ainda válidas. */
  activeSessions: number;
  memberSince: string;
}

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

// --- Recuperação de senha ----------------------------------------------------

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20, 'Link inválido').max(200),
  newPassword: passwordSchema,
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Resposta do admin ao gerar um link de redefinição para alguém. */
export interface PasswordResetLink {
  url: string;
  expiresAt: string;
  /** Se o e-mail foi enviado pelo servidor (SMTP configurado). */
  emailed: boolean;
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

// --- Perfil da própria pessoa ---------------------------------------------

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  phone: z.string().trim().max(32).optional(),
  /** Data URL de imagem (JPEG/PNG/WebP), no máximo ~300 KB — redimensionada no navegador. */
  avatarUrl: z
    .string()
    .max(400_000, 'Imagem grande demais')
    .regex(/^data:image\/(png|jpeg|webp);base64,/, 'Imagem inválida')
    .nullable()
    .optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual'),
  newPassword: passwordSchema,
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UserQuery = z.infer<typeof userQuerySchema>;
