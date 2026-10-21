import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET muito curto'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET muito curto'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  /** URL pública do front, usada nos links de e-mail. Padrão: a primeira origem do CORS. */
  APP_URL: z.string().url().optional(),
  /** smtp://user:senha@host:587 — sem isso o sistema não envia e-mail e o admin passa o link à mão. */
  SMTP_URL: z.string().optional(),
  /** Liga o simulador de demonstração: a garagem anda sozinha a cada 5 minutos. */
  DEMO_SIMULATOR: z.enum(['true', 'false']).default('false'),
  /** Fator de aceleração do simulador (tempos de espera divididos por ele). 1 = tempo real. */
  DEMO_SPEED: z.coerce.number().positive().default(1),
  /** Ignora o horário de operação (útil para testar de madrugada). */
  DEMO_ALL_HOURS: z.enum(['true', 'false']).default('false'),
  MAIL_FROM: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;
