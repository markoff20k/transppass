import Anthropic from '@anthropic-ai/sdk';
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

/**
 * O erro do provedor em uma frase para a tela, sem citar fornecedor nem modelo:
 * para o usuário a IA é só a ia.Transppass (o detalhe técnico vai para o log).
 */
export function describeProviderError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return 'o acesso da ia.Transppass está mal configurado; avise o administrador do sistema';
  if (err instanceof Anthropic.RateLimitError) return 'a ia.Transppass está com muitas perguntas agora; tente de novo em instantes';
  if (err instanceof Anthropic.BadRequestError) return 'a ia.Transppass não conseguiu processar esta pergunta';
  if (err instanceof Anthropic.APIConnectionError) return 'a ia.Transppass está fora do ar no momento (rede ou tempo esgotado)';
  if (err instanceof Anthropic.APIError) return `a ia.Transppass respondeu com erro ${err.status ?? ''}`.trim();
  return 'a ia.Transppass teve um erro inesperado; tente de novo';
}
