import type Anthropic from '@anthropic-ai/sdk';
import { FakeProvider } from './fake.provider';

const tools: Anthropic.Tool[] = ['frota_resumo', 'carro', 'quadro_mes', 'mkbf', 'indicadores_oficina', 'consumo_frota', 'consumo_carro', 'fila', 'os_lista', 'eventos', 'preventivas'].map((name) => ({
  name,
  description: name,
  input_schema: { type: 'object', properties: {} },
}));

const ask = (text: string) => ({ system: [], tools, maxTokens: 100, onText: () => undefined, messages: [{ role: 'user' as const, content: text }] });

describe('FakeProvider', () => {
  const p = new FakeProvider();

  it.each([
    ['Como está o MKBF do mês?', 'quadro_mes'],
    ['quem está na fila?', 'fila'],
    ['como está o carro 085?', 'carro'],
    ['consumo diesel deste mês', 'consumo_frota'],
    ['quais OS estão atrasadas?', 'os_lista'],
    ['quantas quebras houve ontem?', 'eventos'],
    ['preventivas vencidas', 'preventivas'],
    ['tempo parado por causa', 'indicadores_oficina'],
    ['como está a frota agora?', 'frota_resumo'],
  ])('escolhe a ferramenta pela pergunta: %s → %s', async (q, expected) => {
    const r = await p.turn(ask(q));
    expect(r.stopReason).toBe('tool_use');
    const use = r.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    expect(use?.name).toBe(expected);
  });

  it('o carro 085 vira entrada { code: "085" }', async () => {
    const r = await p.turn(ask('como está o carro 085?'));
    const use = r.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    expect(use?.input).toEqual({ code: '085' });
  });

  it('depois do resultado, redige texto em streaming e encerra', async () => {
    let streamed = '';
    const r = await p.turn({
      ...ask('x'),
      onText: (d) => {
        streamed += d;
      },
      messages: [
        { role: 'user', content: 'quem está na fila?' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'fila', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify({ tool: 'fila', waiting: 3, queue: [1, 2, 3] }) }] },
      ],
    });
    expect(r.stopReason).toBe('end_turn');
    const text = r.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '';
    expect(text).toBe(streamed);
    expect(text).toContain('fila');
    expect(text).toContain('waiting = 3');
  });

  it('a leitura do mês devolve JSON com resumo e os itens de regra do prompt', async () => {
    const insights = [{ kind: 'mkbf', tone: 'info', date: null, title: 'MKBF 3.000 km', text: 'ok' }];
    const r = await p.complete({ system: 's', maxTokens: 100, prompt: `antes <dados>${JSON.stringify({ month: '2026-11', insights })}</dados> depois` });
    const parsed = JSON.parse(r.text) as { summary: string; insights: unknown[] };
    expect(parsed.summary).toContain('2026-11');
    expect(parsed.insights).toEqual(insights);
  });
});
