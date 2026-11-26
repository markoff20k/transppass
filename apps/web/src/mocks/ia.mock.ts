import { HttpResponse, delay, http } from 'msw';
import type { IaConversation, IaConversationDetail, IaMessage, IaStatus, IaStreamEvent } from '@app/shared';

/**
 * ia.Transppass no modo mock (VITE_MOCK=true): provedor "simulado", duas
 * conversas de exemplo e uma resposta em SSE que consulta uma ferramenta e
 * escreve um parágrafo, para o painel ser visto sem API.
 */
const status: IaStatus = { enabled: true, provider: 'fake', name: 'ia.Transppass' };

const now = () => new Date().toISOString();
const conversations = new Map<string, IaConversationDetail>([
  [
    'conv-1',
    {
      id: 'conv-1',
      title: 'Como está o MKBF do mês?',
      createdAt: '2026-11-21T10:00:00.000Z',
      updatedAt: '2026-11-21T10:01:00.000Z',
      messageCount: 2,
      messages: [
        { id: 'm1', role: 'user', text: 'Como está o MKBF do mês?', toolCalls: [], usage: null, error: null, createdAt: '2026-11-21T10:00:00.000Z' },
        {
          id: 'm2',
          role: 'assistant',
          text: '**3.193 km** entre falhas em novembro, dados até 18/11.\n\n- Piorou 21,4% contra outubro (4.064 km).\n- O pior dia foi 04/11, com 41 quebras.\n- Mecânica concentra as quebras.',
          toolCalls: [{ id: 't1', name: 'quadro_mes', label: 'Quadro de 2026-11', input: { month: '2026-11' }, ok: true, ms: 420 }],
          usage: { input: 1800, output: 120, cacheRead: 2400, cacheWrite: 0 },
          error: null,
          createdAt: '2026-11-21T10:01:00.000Z',
        },
      ],
    },
  ],
]);

const summary = (c: IaConversationDetail): IaConversation => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, messageCount: c.messages.length });

const sse = (events: IaStreamEvent[], gap = 40) =>
  new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      for (const ev of events) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        await new Promise((r) => setTimeout(r, gap));
      }
      controller.close();
    },
  });

export const iaHandlers = [
  http.get('*/api/ia/status', async () => {
    await delay();
    return HttpResponse.json(status);
  }),
  http.get('*/api/ia/conversations', async () => {
    await delay();
    return HttpResponse.json([...conversations.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summary));
  }),
  http.post('*/api/ia/conversations', async () => {
    const id = `conv-${Date.now()}`;
    const c: IaConversationDetail = { id, title: 'Nova conversa', createdAt: now(), updatedAt: now(), messageCount: 0, messages: [] };
    conversations.set(id, c);
    return HttpResponse.json(summary(c), { status: 201 });
  }),
  http.get('*/api/ia/conversations/:id', async ({ params }) => {
    const c = conversations.get(String(params.id));
    return c ? HttpResponse.json(c) : HttpResponse.json({ statusCode: 404, code: 'NOT_FOUND', message: 'Conversa não encontrada', timestamp: now(), path: '' }, { status: 404 });
  }),
  http.delete('*/api/ia/conversations/:id', async ({ params }) => {
    conversations.delete(String(params.id));
    return new HttpResponse(null, { status: 204 });
  }),
  http.post('*/api/ia/conversations/:id/messages', async ({ params, request }) => {
    const c = conversations.get(String(params.id));
    if (!c) return HttpResponse.json({ statusCode: 404, code: 'NOT_FOUND', message: 'Conversa não encontrada', timestamp: now(), path: '' }, { status: 404 });
    const body = (await request.json()) as { text: string };
    const text = `Resposta simulada para "${body.text}".\n\n- A frota tem **460 carros**, 441 rodando agora.\n- 4 esperando valeta; o mais antigo há 8,0h.\n- Dados do quadro de novembro, até 18/11.`;
    const call = { id: `t-${Date.now()}`, name: 'frota_resumo', label: 'A frota agora', input: {}, ok: true, ms: 380 };
    const messageId = `a-${Date.now()}`;
    const final: IaMessage = { id: messageId, role: 'assistant', text, toolCalls: [call], usage: { input: 1500, output: 90, cacheRead: 2400, cacheWrite: 0 }, error: null, createdAt: now() };
    const title = c.messages.length === 0 ? body.text.slice(0, 60) : c.title;
    c.title = title;
    c.messages.push({ id: `u-${Date.now()}`, role: 'user', text: body.text, toolCalls: [], usage: null, error: null, createdAt: now() }, final);
    c.messageCount = c.messages.length;
    c.updatedAt = now();
    const events: IaStreamEvent[] = [
      { type: 'start', messageId, conversationId: c.id },
      { type: 'tool', call: { ...call, ms: 0 }, phase: 'start' },
      { type: 'tool', call, phase: 'end' },
      ...text.match(/.{1,16}/gs)!.map((delta) => ({ type: 'text', delta }) as IaStreamEvent),
      { type: 'done', message: final, title },
    ];
    return new HttpResponse(sse(events), { headers: { 'Content-Type': 'text/event-stream' } });
  }),
  http.get('*/api/ia/readings/day/today', async () => {
    await delay(400);
    return HttpResponse.json({ kind: 'day', key: now().slice(0, 10), summary: '13 carros parados: 4 esperando peça e 7 na fila, o mais antigo há 9,5 h; 3 OS estouradas. O MKBF de novembro está em 4.043 km, 0,5% abaixo de outubro, com dados até 18/11.', insights: [], generatedAt: now(), usage: null });
  }),
  http.get('*/api/ia/readings/:kind/:key', async () => HttpResponse.json({ statusCode: 404, code: 'NOT_FOUND', message: 'Sem leitura', timestamp: now(), path: '' }, { status: 404 })),
  http.post('*/api/ia/readings/:kind/:key', async ({ params }) => {
    await delay(600);
    return HttpResponse.json({ kind: params.kind, key: params.key, summary: 'Leitura simulada.', insights: [], generatedAt: now(), usage: null });
  }),
];
