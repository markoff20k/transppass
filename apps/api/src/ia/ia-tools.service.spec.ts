import 'reflect-metadata';
import { IaToolsService } from './ia-tools.service';

/** Serviços de apoio como dublês: só o que cada ferramenta testada chama. */
function build(overrides: Partial<Record<string, unknown>> = {}) {
  const board = { board: jest.fn().mockResolvedValue({ month: '2026-11', from: '2026-11-01', to: '2026-11-30', lastDataDate: '2026-11-18', days: [{ date: '2026-11-04', empty: false, failures: 41, km: 70000, fleet: { pct: 95, covered: 900, programmed: 950 }, trips: { lost: 100 } }], totals: { mkbf: 3193 }, previousMonth: '2026-10', previous: {}, worstLines: [], consumption: {}, history: [], targets: {}, readingSource: 'rules', insights: [{ kind: 'mkbf', tone: 'info', date: null, title: 't', text: 'x' }] }) };
  const metrics = { mkbf: jest.fn().mockResolvedValue({ kmTraveled: 1000, unscheduledReturns: 2, mkbf: 500 }) };
  const prisma = { vehicle: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) } };
  const svc = new IaToolsService(
    (overrides.prisma ?? prisma) as never,
    (overrides.metrics ?? metrics) as never,
    (overrides.board ?? board) as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc, board, metrics, prisma };
}

describe('IaToolsService', () => {
  it('expõe as ferramentas com nomes únicos e schema JSON', () => {
    const { svc } = build();
    const names = svc.definitions.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['frota_resumo', 'carro', 'quadro_mes', 'mkbf', 'fila', 'os_lista', 'eventos', 'consumo_frota', 'preventivas']));
    for (const d of svc.definitions) {
      expect(d.input_schema.type).toBe('object');
      expect((d.description ?? '').length).toBeGreaterThan(20);
    }
  });

  it('entrada inválida não roda a consulta e volta como erro legível', async () => {
    const { svc, metrics } = build();
    const r = await svc.execute('mkbf', { from: '2026-13-45', to: 'ontem' });
    expect(r.ok).toBe(false);
    expect(metrics.mkbf).not.toHaveBeenCalled();
    const body = JSON.parse(r.content) as { tool: string; error: string; issues: string[] };
    expect(body.tool).toBe('mkbf');
    expect(body.issues.join(' ')).toContain('to');
  });

  it('ferramenta desconhecida não quebra', async () => {
    const { svc } = build();
    const r = await svc.execute('inexistente', {});
    expect(r.ok).toBe(false);
    expect(r.content).toContain('Ferramenta desconhecida');
  });

  it('quadro_mes devolve JSON compacto com o nome da ferramenta e o rótulo do mês', async () => {
    const { svc, board } = build();
    const r = await svc.execute('quadro_mes', { month: '2026-11' });
    expect(r.ok).toBe(true);
    expect(r.label).toBe('Quadro de 2026-11');
    expect(board.board).toHaveBeenCalledWith('2026-11');
    const body = JSON.parse(r.content) as Record<string, unknown>;
    expect(body.tool).toBe('quadro_mes');
    expect(body.worstFailureDays).toEqual([{ date: '2026-11-04', failures: 41, km: 70000 }]);
  });

  it('mkbf converte as datas em início e fim do dia', async () => {
    const { svc, metrics } = build();
    const r = await svc.execute('mkbf', { from: '2026-11-01', to: '2026-11-22' });
    expect(r.ok).toBe(true);
    const [from, to] = metrics.mkbf.mock.calls[0] as [Date, Date];
    expect(from.getHours()).toBe(0);
    expect(to.getHours()).toBe(23);
    expect(r.label).toBe('MKBF de 01/11 a 22/11');
  });

  it('erro do serviço vira resultado com is_error, não exceção', async () => {
    const { svc } = build({ board: { board: jest.fn().mockRejectedValue(new Error('banco fora')) } });
    const r = await svc.execute('quadro_mes', { month: '2026-11' });
    expect(r.ok).toBe(false);
    expect(r.content).toContain('banco fora');
  });

  it('carro inexistente responde found=false', async () => {
    const { svc } = build();
    const r = await svc.execute('carro', { code: '999' });
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.content)).toMatchObject({ tool: 'carro', found: false });
  });

  it('resultado grande é cortado no teto, avisando', async () => {
    const big = Array.from({ length: 5000 }, (_, i) => ({ i, text: 'x'.repeat(40) }));
    const { svc } = build({ board: { board: jest.fn().mockResolvedValue({ month: '2026-11', from: '', to: '', lastDataDate: null, days: [], totals: {}, previousMonth: '', previous: {}, worstLines: big, consumption: {}, history: [], targets: {}, readingSource: 'rules', insights: [] }) } });
    const r = await svc.execute('quadro_mes', { month: '2026-11' });
    expect(r.content.length).toBeLessThanOrEqual(14_001);
  });
});
