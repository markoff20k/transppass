import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import type { IaUsage } from '@app/shared';
import type { IaCompleteRequest, IaCompleteResult, IaProvider, IaTurnRequest, IaTurnResult } from './ia-provider';

/**
 * Provedor real: a API da Anthropic pelo SDK oficial. O modelo vem de
 * IA_MODEL (Claude Opus 5.5 por padrão); o raciocínio adaptativo fica ligado
 * por padrão nesses modelos e a profundidade é controlada pelo esforço. O
 * texto chega em streaming e a mensagem final traz os blocos de ferramenta e
 * o consumo de tokens (com leitura do cache do prompt de sistema).
 */
export class AnthropicProvider implements IaProvider {
  readonly kind = 'anthropic' as const;
  private readonly log = new Logger('ia.Transppass');
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  }

  async turn(req: IaTurnRequest): Promise<IaTurnResult> {
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        tools: req.tools,
        messages: req.messages,
        output_config: { effort: 'medium' },
      },
      { signal: req.signal },
    );
    stream.on('text', (delta) => req.onText(delta));
    const message = await stream.finalMessage();
    return { content: message.content, stopReason: message.stop_reason, usage: usageOf(message.usage) };
  }

  async complete(req: IaCompleteRequest): Promise<IaCompleteResult> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
      output_config: { effort: 'medium' },
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') {
      this.log.warn(`leitura recusada pelo modelo (${message.stop_details?.category ?? 'sem categoria'})`);
    }
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { text, usage: usageOf(message.usage) };
  }
}

function usageOf(u: Anthropic.Usage): IaUsage {
  return {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
}
