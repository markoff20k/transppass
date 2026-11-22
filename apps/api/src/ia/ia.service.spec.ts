import 'reflect-metadata';
import type Anthropic from '@anthropic-ai/sdk';
import type { IaStreamEvent } from '@app/shared';
import { IaService } from './ia.service';
import type { IaProvider, IaTurnRequest, IaTurnResult } from './ia-provider';

/** Prisma em memória: uma conversa, mensagens gravadas em ordem. */
function memoryPrisma(userId = 'u1', conversationId = 'c1') {
  const messages: Record<string, unknown>[] = [];
  return {
    messages,
    aiConversation: {
      findFirst: jest.fn(async (q: { where: { id: string; userId: string } }) => (q.where.id === conversationId && q.where.userId === userId ? { id: conversationId, title: 'Nova conversa', messages: [...messages] } : null)),
      update: jest.fn(async () => undefined),
    },
    aiMessage: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: (data.id as string) ?? `m${messages.length + 1}`, createdAt: new Date(), toolCalls: null, usage: null, error: null, ...data };
        messages.push(row);
        return row;
      }),
    },
  };
}

/** Provedor roteirizado: devolve as rodadas na ordem; se acabar, repete a última. */
function scripted(turns: IaTurnResult[], onReq?: (r: IaTurnRequest) => void): IaProvider & { calls: IaTurnRequest[] } {
  const calls: IaTurnRequest[] = [];
  return {
    kind: 'fake',
    model: 'roteiro',
    calls,
    async turn(req) {
      // cópia: o serviço continua mutando o mesmo array de mensagens depois da rodada
      calls.push({ ...req, messages: [...req.messages] });
      onReq?.(req);
      const t = turns[Math.min(calls.length - 1, turns.length - 1)] as IaTurnResult;
      const text = t.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      if (text) req.onText(text.text);
      return t;
    },
    async complete() {
      return { text: '{}', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    },
  };
}

const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 };
const toolUse = (id: string, name: string, input: unknown): Anthropic.ToolUseBlock => ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } });
const textBlock = (text: string): Anthropic.TextBlock => ({ type: 'text', text, citations: null });

const tools = {
  definitions: [{ name: 'fila', description: 'd', input_schema: { type: 'object', properties: {} } }],
  find: (name: string) => (name === 'fila' ? { label: () => 'Fila de manutenção' } : undefined),
  execute: jest.fn(async (name: string) => ({ ok: name === 'fila', content: JSON.stringify({ tool: name, waiting: 2 }), label: name === 'fila' ? 'Fila de manutenção' : name })),
};

describe('IaService.send', () => {
  beforeEach(() => tools.execute.mockClear());

  it('roda a consulta, devolve o resultado ao modelo e grava pergunta e resposta', async () => {
    const prisma = memoryPrisma();
    const provider = scripted([
      { content: [toolUse('t1', 'fila', {})], stopReason: 'tool_use', usage },
      { content: [textBlock('2 carros esperando valeta.')], stopReason: 'end_turn', usage },
    ]);
    const svc = new IaService(prisma as never, tools as never, provider);
    const events: IaStreamEvent[] = [];
    await svc.send('u1', 'c1', { text: 'quem está na fila?', context: { route: '/fila', label: 'Fila' } }, (e) => events.push(e));

    expect(events.map((e) => e.type)).toEqual(['start', 'tool', 'tool', 'text', 'done']);
    expect(tools.execute).toHaveBeenCalledWith('fila', {});
    // A segunda rodada recebeu o tool_result com o id certo.
    const second = provider.calls[1] as IaTurnRequest;
    const last = second.messages[second.messages.length - 1] as Anthropic.MessageParam;
    expect(last.role).toBe('user');
    expect((last.content as Anthropic.ToolResultBlockParam[])[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
    // O contexto da tela vai só para o modelo, não para o texto gravado.
    const first = provider.calls[0] as IaTurnRequest;
    expect(first.messages[0]?.content).toBe('[Tela: Fila (/fila)]\nquem está na fila?');
    expect(prisma.messages[0]).toMatchObject({ role: 'user', text: 'quem está na fila?' });
    const done = events[events.length - 1] as Extract<IaStreamEvent, { type: 'done' }>;
    expect(done.message.text).toBe('2 carros esperando valeta.');
    expect(done.message.toolCalls).toHaveLength(1);
    expect(done.title).toBe('quem está na fila?');
    // Os blocos gravados do assistente têm as duas rodadas (tool_use + tool_result + texto).
    const assistantRow = prisma.messages[1] as { blocks: Anthropic.MessageParam[]; usage: { input: number } };
    expect(assistantRow.blocks.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant']);
    expect(assistantRow.usage.input).toBe(20);
  });

  it('o sistema tem o bloco fixo em cache e a data de hoje no bloco volátil', async () => {
    const prisma = memoryPrisma();
    const provider = scripted([{ content: [textBlock('ok')], stopReason: 'end_turn', usage }]);
    const svc = new IaService(prisma as never, tools as never, provider);
    await svc.send('u1', 'c1', { text: 'oi' }, () => undefined);
    const sys = (provider.calls[0] as IaTurnRequest).system;
    expect(sys).toHaveLength(2);
    expect(sys[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(sys[0]?.text).toContain('MKBF');
    expect(sys[1]?.text).toContain('Hoje é');
    expect(sys[1]?.text).toContain(new Date().toISOString().slice(0, 7));
  });

  it('modelo que não para de consultar é obrigado a concluir', async () => {
    const prisma = memoryPrisma();
    let n = 0;
    const provider = scripted([{ content: [toolUse('t', 'fila', {})], stopReason: 'tool_use', usage }], (req) => {
      n += 1;
      // Na rodada forçada não há ferramentas: o roteiro devolve texto.
      if (req.tools.length === 0) (provider as unknown as { last: boolean }).last = true;
    });
    // substitui o turn para responder texto quando as ferramentas somem
    const base = provider.turn.bind(provider);
    provider.turn = async (req) => (req.tools.length === 0 ? (req.onText('Conclusão.'), { content: [textBlock('Conclusão.')], stopReason: 'end_turn' as const, usage }) : base(req));
    const svc = new IaService(prisma as never, tools as never, provider);
    const events: IaStreamEvent[] = [];
    await svc.send('u1', 'c1', { text: 'loop' }, (e) => events.push(e));
    const done = events[events.length - 1] as Extract<IaStreamEvent, { type: 'done' }>;
    expect(done.message.text).toBe('Conclusão.');
    expect(tools.execute).toHaveBeenCalledTimes(8);
    // 8 rodadas com ferramentas passaram pelo roteiro; a nona (forçada) respondeu texto
    expect(n).toBe(8);
  });

  it('erro do provedor vira mensagem gravada com o erro, e o stream termina em done', async () => {
    const prisma = memoryPrisma();
    const provider: IaProvider = { kind: 'anthropic', model: 'm', turn: async () => { throw new Error('401 chave inválida'); }, complete: async () => ({ text: '', usage }) };
    const svc = new IaService(prisma as never, tools as never, provider);
    const events: IaStreamEvent[] = [];
    await svc.send('u1', 'c1', { text: 'x' }, (e) => events.push(e));
    const done = events[events.length - 1] as Extract<IaStreamEvent, { type: 'done' }>;
    expect(done.message.error).toContain('401');
    expect(done.message.text).toContain('Não consegui responder');
  });

  it('conversa de outro usuário não existe para quem pergunta', async () => {
    const prisma = memoryPrisma('u1', 'c1');
    const provider = scripted([{ content: [textBlock('ok')], stopReason: 'end_turn', usage }]);
    const svc = new IaService(prisma as never, tools as never, provider);
    await expect(svc.send('u2', 'c1', { text: 'x' }, () => undefined)).rejects.toThrow('Conversa não encontrada');
  });

  it('sem provedor, a API diz que está desligada', async () => {
    const svc = new IaService(memoryPrisma() as never, tools as never, null);
    expect(svc.status()).toMatchObject({ enabled: false, provider: 'off' });
    await expect(svc.send('u1', 'c1', { text: 'x' }, () => undefined)).rejects.toThrow('desligada');
  });
});
