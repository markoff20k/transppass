import type Anthropic from '@anthropic-ai/sdk';
import type { IaProviderKind, IaUsage } from '@app/shared';

/**
 * O que o agente precisa de um provedor de modelo: uma rodada de conversa
 * (com ferramentas e texto em streaming) e uma conclusão simples (para a
 * leitura do mês). A API fala com a Anthropic por aqui; em desenvolvimento e
 * QA, um provedor simulado responde com o mesmo formato, sem chave e sem custo.
 */
export interface IaTurnRequest {
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  maxTokens: number;
  onText: (delta: string) => void;
  signal?: AbortSignal;
}

export interface IaTurnResult {
  content: Anthropic.ContentBlock[];
  stopReason: Anthropic.Message['stop_reason'];
  usage: IaUsage;
}

export interface IaCompleteRequest {
  system: string;
  prompt: string;
  maxTokens: number;
}

export interface IaCompleteResult {
  text: string;
  usage: IaUsage;
}

export interface IaProvider {
  readonly kind: IaProviderKind;
  readonly model: string;
  turn(req: IaTurnRequest): Promise<IaTurnResult>;
  complete(req: IaCompleteRequest): Promise<IaCompleteResult>;
}

export const IA_PROVIDER = Symbol('IA_PROVIDER');

export const EMPTY_USAGE: IaUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export const addUsage = (a: IaUsage, b: IaUsage): IaUsage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
});
