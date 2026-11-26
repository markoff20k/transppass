import 'reflect-metadata';
import { IaReadingsService, parseReading } from './ia-readings.service';

const valid = { summary: 'O mês fechou com MKBF abaixo da média, puxado pelas quebras de mecânica.', insights: [{ kind: 'mkbf', tone: 'bad', date: null, title: 'MKBF 3.193 km, piorou 21,4%', text: '1.366.513 km ÷ 428 quebras.' }] };

describe('parseReading', () => {
  it('aceita JSON puro', () => {
    expect(parseReading(JSON.stringify(valid))?.insights).toHaveLength(1);
  });
  it('aceita JSON em cerca de código e com texto em volta', () => {
    expect(parseReading('Aqui está:\n```json\n' + JSON.stringify(valid) + '\n```\n')?.summary).toBe(valid.summary);
  });
  it('recusa formato errado', () => {
    expect(parseReading('não é json')).toBeNull();
    expect(parseReading(JSON.stringify({ summary: 'x', insights: [] }))).toBeNull();
    expect(parseReading(JSON.stringify({ summary: valid.summary, insights: [{ kind: 'alien', tone: 'bad', title: 't', text: 'x' }] }))).toBeNull();
  });
});

describe('IaReadingsService.generate', () => {
  const boardData = { month: '2026-11', from: '2026-11-01', to: '2026-11-30', lastDataDate: '2026-11-18', days: [], totals: {}, previousMonth: '2026-10', previous: {}, worstLines: [], consumption: {}, history: [], readingSource: 'rules', insights: valid.insights };
  const board = { board: jest.fn().mockResolvedValue(boardData), rulesInsights: jest.fn().mockResolvedValue(valid.insights) };
  const config = { get: () => 3 };

  it('grava a leitura que o modelo devolve, com os dados do quadro no prompt', async () => {
    const upsert = jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({ kind: 'month', key: '2026-11', summary: create.summary, insights: create.insights, model: 'm', usage: null, generatedAt: new Date() }));
    const provider = { kind: 'anthropic' as const, model: 'm', turn: jest.fn(), complete: jest.fn(async (req: { prompt: string }) => { expect(req.prompt).toContain('<dados>'); expect(req.prompt).toContain('"month":"2026-11"'); return { text: JSON.stringify(valid), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }; }) };
    const svc = new IaReadingsService({ aiReading: { upsert } } as never, board as never, config as never, provider, {} as never);
    const r = await svc.generate('month', '2026-11');
    expect(r.summary).toBe(valid.summary);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('resposta fora do formato não grava nada e avisa', async () => {
    const upsert = jest.fn();
    const provider = { kind: 'anthropic' as const, model: 'm', turn: jest.fn(), complete: jest.fn(async () => ({ text: 'desculpe, não consigo', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } })) };
    const svc = new IaReadingsService({ aiReading: { upsert } } as never, board as never, config as never, provider, {} as never);
    await expect(svc.generate('month', '2026-11')).rejects.toThrow('formato');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('sem provedor, recusa', async () => {
    const svc = new IaReadingsService({} as never, board as never, config as never, null, {} as never);
    await expect(svc.generate('month', '2026-11')).rejects.toThrow('desligada');
  });
});
