import { z } from 'zod';
import type { BoardInsight } from '../metrics/metrics.schemas.js';

/**
 * ia.Transppass — o agente de PCM. O front conversa com a API (nunca com o
 * modelo direto): a API guarda as conversas por usuário, dá ao modelo
 * ferramentas só de leitura sobre os dados do sistema e devolve a resposta
 * em streaming (SSE).
 */

export const IA_NAME = 'ia.Transppass';

export const iaMessageInputSchema = z.object({
  text: z.string().trim().min(1, 'Escreva a pergunta').max(4000),
  /** Onde a pessoa estava quando perguntou (rota e rótulo da tela), para o agente situar a resposta. */
  context: z
    .object({
      route: z.string().trim().max(120).optional(),
      label: z.string().trim().max(160).optional(),
    })
    .optional(),
});
export type IaMessageInput = z.infer<typeof iaMessageInputSchema>;

export const iaConversationCreateSchema = z.object({
  title: z.string().trim().max(120).optional(),
});
export type IaConversationCreateInput = z.infer<typeof iaConversationCreateSchema>;

export type IaProviderKind = 'anthropic' | 'fake' | 'off';

export interface IaStatus {
  /** Há um provedor configurado (chave da Anthropic ou simulado). */
  enabled: boolean;
  provider: IaProviderKind;
  name: string;
}

/** Uma consulta que o agente fez aos dados para responder. */
export interface IaToolCall {
  id: string;
  name: string;
  /** Rótulo legível: "MKBF de 1 a 22/11". */
  label: string;
  input: Record<string, unknown>;
  ok: boolean;
  ms: number;
}

export interface IaUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface IaMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls: IaToolCall[];
  usage: IaUsage | null;
  error: string | null;
  createdAt: string;
}

export interface IaConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface IaConversationDetail extends IaConversation {
  messages: IaMessage[];
}

/** Eventos do stream SSE de uma resposta. */
export type IaStreamEvent =
  | { type: 'start'; messageId: string; conversationId: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; call: IaToolCall; phase: 'start' | 'end' }
  | { type: 'done'; message: IaMessage; title: string }
  | { type: 'error'; message: string };

// --- Fase 2: leituras redigidas pelo modelo -----------------------------------

/** month = a leitura do mês em Indicadores; day = a frase do dia no topo do Dashboard. */
export const IA_READING_KINDS = ['month', 'day'] as const;
export type IaReadingKind = (typeof IA_READING_KINDS)[number];

export const iaReadingParamsSchema = z
  .object({
    kind: z.enum(IA_READING_KINDS),
    key: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Mês AAAA-MM ou dia AAAA-MM-DD'),
  })
  .refine((p) => (p.kind === 'month' ? p.key.length === 7 : p.key.length === 10), 'Chave não combina com o tipo');

/** Quanto tempo a frase do dia vale antes de ser redigida de novo. */
export const IA_DAY_READING_TTL_MINUTES = 60;
export type IaReadingParams = z.infer<typeof iaReadingParamsSchema>;

/** A leitura do mês redigida pela ia.Transppass a partir dos números do quadro. */
export interface IaReading {
  kind: IaReadingKind;
  key: string;
  /** Um parágrafo de abertura: o mês em duas ou três frases. */
  summary: string;
  insights: BoardInsight[];
  generatedAt: string;
  usage: IaUsage | null;
}

/** De onde veio a leitura do mês mostrada em Indicadores. */
export type ReadingSource = 'ia' | 'rules';
