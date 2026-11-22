import type Anthropic from '@anthropic-ai/sdk';
import type { IaCompleteRequest, IaCompleteResult, IaProvider, IaTurnRequest, IaTurnResult } from './ia-provider';

/**
 * Provedor simulado (IA_PROVIDER=fake): sem chave e sem custo, segue o mesmo
 * contrato do provedor real para a pipeline inteira ser exercitada —
 * escolhe uma ferramenta pela pergunta, recebe o resultado e redige uma
 * resposta curta a partir dele, em streaming. A resposta diz que é simulada.
 */
export class FakeProvider implements IaProvider {
  readonly kind = 'fake' as const;
  readonly model = 'simulado';
  private seq = 0;

  async turn(req: IaTurnRequest): Promise<IaTurnResult> {
    const last = req.messages[req.messages.length - 1];
    const results = toolResultsOf(last);
    if (results.length === 0) {
      const question = textOf(last);
      const pick = pickTool(question, req.tools);
      if (pick) {
        this.seq += 1;
        const block: Anthropic.ToolUseBlock = { type: 'tool_use', id: `toolu_fake_${Date.now()}_${this.seq}`, name: pick.name, input: pick.input, caller: { type: 'direct' } };
        return { content: [block], stopReason: 'tool_use', usage: { input: 1200, output: 40, cacheRead: 900, cacheWrite: 0 } };
      }
      const text = `Resposta simulada (sem chave da Anthropic). Entendi a pergunta "${clip(question, 80)}", mas nenhuma das ferramentas do agente se aplica a ela. Pergunte sobre MKBF, quebras, fila, OS, consumo, frota, preventivas ou o quadro do mês.`;
      await stream(text, req.onText, req.signal);
      return { content: [{ type: 'text', text, citations: null }], stopReason: 'end_turn', usage: { input: 1200, output: 60, cacheRead: 900, cacheWrite: 0 } };
    }
    const summary = results
      .map((r) => `• ${r.name}: ${describe(r.content)}`)
      .join('\n');
    const text = `Resposta simulada (sem chave da Anthropic), redigida a partir do que as ferramentas devolveram:\n\n${summary}\n\nCom a chave configurada, a ia.Transppass lê esses mesmos números e escreve a leitura em linguagem natural, citando período e fonte.`;
    await stream(text, req.onText, req.signal);
    return { content: [{ type: 'text', text, citations: null }], stopReason: 'end_turn', usage: { input: 2600, output: 180, cacheRead: 900, cacheWrite: 0 } };
  }

  async complete(req: IaCompleteRequest): Promise<IaCompleteResult> {
    // A leitura do mês: devolve as leituras de regra embutidas no prompt, reescritas com a marca de simulação.
    const m = req.prompt.match(/<dados>([\s\S]*?)<\/dados>/);
    let insights: unknown[] = [];
    let month = '';
    try {
      const data = m ? (JSON.parse(m[1] as string) as { month?: string; insights?: unknown[] }) : {};
      insights = Array.isArray(data.insights) ? data.insights : [];
      month = data.month ?? '';
    } catch {
      insights = [];
    }
    const out = {
      summary: `Leitura simulada de ${month || 'mês'}: sem chave da Anthropic, a ia.Transppass repete aqui o que as regras do sistema apuraram; com a chave, este parágrafo e os itens abaixo são redigidos pelo modelo a partir dos mesmos números.`,
      insights: insights.slice(0, 8),
    };
    return { text: JSON.stringify(out), usage: { input: 3000, output: 400, cacheRead: 0, cacheWrite: 0 } };
  }
}

// ---------------------------------------------------------------------------

function textOf(m: Anthropic.MessageParam | undefined): string {
  if (!m) return '';
  if (typeof m.content === 'string') return m.content;
  return m.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join(' ')
    .trim();
}

function toolResultsOf(m: Anthropic.MessageParam | undefined): { name: string; content: string }[] {
  if (!m || m.role !== 'user' || typeof m.content === 'string') return [];
  return m.content.flatMap((b) => {
    if (b.type !== 'tool_result') return [];
    const content = typeof b.content === 'string' ? b.content : (b.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('');
    // O nome da ferramenta viaja no próprio resultado (a API devolve JSON com "tool").
    let name = 'consulta';
    try {
      const parsed = JSON.parse(content) as { tool?: string };
      if (parsed.tool) name = parsed.tool;
    } catch {
      /* texto livre */
    }
    return [{ name, content }];
  });
}

const today = () => new Date().toISOString().slice(0, 10);
const monthKey = () => today().slice(0, 7);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Escolha de ferramenta por palavras-chave, na ordem do mais específico para o mais geral. */
function pickTool(q: string, tools: Anthropic.Tool[]): { name: string; input: Record<string, unknown> } | null {
  const has = (name: string) => tools.some((t) => t.name === name);
  const s = q.toLowerCase();
  const car = s.match(/\b(?:carro|prefixo|ônibus|onibus|veículo|veiculo)\s*(\d{3,5})\b/) ?? s.match(/\b(\d{3,5})\b/);
  if (/consumo|diesel|km\/l|litros|kwh|rendimento/.test(s) && has('consumo_frota')) {
    return { name: 'consumo_frota', input: { energy: /el[ée]tric|kwh|energia/.test(s) ? 'EBUS' : 'DIESEL', from: `${monthKey()}-01`, to: today() } };
  }
  if (car && has('carro') && /carro|prefixo|ônibus|onibus|veículo|veiculo/.test(s)) return { name: 'carro', input: { code: car[1] } };
  if (/\bfila\b|valeta|esperando/.test(s) && has('fila')) return { name: 'fila', input: {} };
  if (/\bos\b|ordens? de servi[cç]o|atrasad/.test(s) && has('os_lista')) return { name: 'os_lista', input: { onlyOpen: true } };
  if (/preventiv|revis[ãa]o|plano de manuten/.test(s) && has('preventivas')) return { name: 'preventivas', input: {} };
  if (/oficina|retrabalho|triagem|sla|indisponibilidade|tempo parado/.test(s) && has('indicadores_oficina')) {
    return { name: 'indicadores_oficina', input: { from: `${monthKey()}-01`, to: today() } };
  }
  if (/quebra|evento|socorro|falha|defeito/.test(s) && has('eventos')) return { name: 'eventos', input: { from: daysAgo(7), to: today() } };
  if (/mkbf|quadro|m[êe]s|indicador/.test(s) && has('quadro_mes')) return { name: 'quadro_mes', input: { month: monthKey() } };
  if (/frota|garagem|dispon[íi]vel|rodando|agora/.test(s) && has('frota_resumo')) return { name: 'frota_resumo', input: {} };
  if (has('frota_resumo')) return { name: 'frota_resumo', input: {} };
  return null;
}

function describe(json: string): string {
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    const keys = Object.keys(v).filter((k) => k !== 'tool');
    const parts = keys.slice(0, 6).map((k) => {
      const x = v[k];
      if (Array.isArray(x)) return `${k} (${x.length} itens)`;
      if (x && typeof x === 'object') return `${k} {${Object.keys(x as object).slice(0, 5).join(', ')}}`;
      return `${k} = ${String(x)}`;
    });
    return parts.join('; ');
  } catch {
    return clip(json, 160);
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function stream(text: string, onText: (d: string) => void, signal?: AbortSignal): Promise<void> {
  for (let i = 0; i < text.length; i += 14) {
    if (signal?.aborted) return;
    onText(text.slice(i, i + 14));
    await new Promise((r) => setTimeout(r, 12));
  }
}
