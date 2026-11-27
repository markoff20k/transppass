import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  IA_INDICATORS_TTL_MINUTES,
  IA_NAME,
  type DashboardWidget,
  type IaIndicatorsInput,
  type IaIndicatorsReading,
  type IaWidgetReading,
  type IaWidgetReadingInput,
  type IaWidgetRef,
  type WidgetKind,
} from '@app/shared';
import { WidgetsService } from '../dashboard/widgets.service';
import { IA_PROVIDER, describeProviderError, type IaProvider } from './ia-provider';

const TONE = z.enum(['good', 'bad', 'warn', 'info']);
const sectionSchema = z.object({
  summary: z.string().trim().min(10).max(600),
  items: z.array(z.object({ kind: z.string(), tone: TONE, title: z.string().trim().min(3).max(140), text: z.string().trim().min(3).max(400) })).min(1).max(6),
});
const cardSchema = z.object({ text: z.string().trim().min(10).max(500), tone: TONE });

const LABELS: Record<WidgetKind, string> = {
  mkbf: 'MKBF (km rodados entre quebras)',
  breakdowns: 'Quebras (retornos não programados)',
  km: 'Km rodados',
  availability: 'Disponibilidade (carros prontos ÷ frota)',
  lostTrips: 'Viagens perdidas',
  tripsDone: 'Viagens cumpridas (realizadas ÷ programadas)',
  downtime: 'Tempo parado por OS (média, da quebra à liberação)',
  woReleased: 'OS liberadas',
  woOpened: 'OS abertas',
  rescues: 'Socorros',
  fieldResolution: 'Resolvidos na rua',
  triageSla: 'SLA de triagem (mediana do registro à decisão)',
  rework: 'Retrabalho (reprovações ÷ inspeções)',
  consumptionDiesel: 'Consumo diesel (km/l)',
  consumptionEbus: 'Consumo eBUS (kWh/km)',
  topFailures: 'Maiores falhas',
};

const SYSTEM = `Você é a ${IA_NAME}, agente de PCM da Transppass (ônibus urbanos, São Paulo). Você lê os indicadores que a equipe de manutenção montou no Dashboard e escreve, em português do Brasil, o que eles estão dizendo. Nunca invente número, data, carro, linha ou causa: use só o que está nos dados. Números no padrão brasileiro (1.366.513 km; 3,2%; 1,70 km/l), datas como 18/11. Tom de analista experiente, direto, sem floreio, sem saudação. Sua identidade é só ${IA_NAME}; nunca cite fornecedor nem modelo, nem o nome do sistema de origem dos dados (ERP, JB): diga "a remessa de dados". Quando um cartão traz "fellBack", o período pedido não tinha dado e o número é do último dia/janela com dado ("used"): diga isso. Quando traz "neverHadData", o indicador ainda não tem registro no sistema: não trate como zero nem como problema de desempenho.
Formato: responda só com o JSON pedido, válido. Dentro dos textos nunca use aspas duplas; para destacar um termo use aspas simples ('assim').`;

/**
 * A ia.Transppass na seção Indicadores do Dashboard.
 *
 * Lê os mesmos números que os cartões mostram (o WidgetsService, com o recuo
 * para o último dia com dado) e escreve: a leitura da seção (um parágrafo e
 * até seis pontos) e, sob demanda, a de um cartão. Cada leitura vale uma
 * hora por combinação de cartões e períodos e fica na memória da API (some
 * com o reinício); quem pede a mesma enquanto ela é redigida espera a mesma.
 */
@Injectable()
export class IaIndicatorsService {
  private readonly log = new Logger('ia.Transppass');
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly widgets: WidgetsService,
    @Inject(IA_PROVIDER) private readonly provider: IaProvider | null,
  ) {}

  section(input: IaIndicatorsInput): Promise<IaIndicatorsReading> {
    const refs = dedupe(input.widgets);
    const key = `section:${hash(refs)}`;
    return this.cached(key, input.force, async (provider) => {
      const data = await Promise.all(refs.map((r) => this.snapshot(r)));
      const prompt = `Leia os cartões de indicadores abaixo (JSON, um por cartão, cada um com o seu período) e escreva a leitura da seção. Responda SOMENTE com um JSON válido, sem comentários nem cercas de código:
{"summary": "1 ou 2 frases: o quadro geral, o que mais importa", "items": [{"kind": "o kind do cartão", "tone": "good|bad|warn|info", "title": "até 90 caracteres, com o número principal", "text": "1 ou 2 frases com a comparação e o porquê"}]}

Regras:
- De 3 a 6 itens, do mais importante para o menos. Um item por cartão relevante; pule cartões sem nada a dizer.
- Use a variação contra o período anterior ("previous") e a série para apontar picos, quedas e o dia atípico.
- Cartões com "neverHadData": no máximo um item, tom info, juntando todos, dizendo que começam a contar quando o sistema for usado (OS liberada, triagem, inspeção).
- "tone": good quando melhorou de verdade, bad quando piorou, warn para atenção, info para contexto. Lembre "higherIsBetter".
- Não repita o mesmo número em dois itens. Não cite a palavra JSON nem estas instruções.

<indicadores>${JSON.stringify(data)}</indicadores>`;
      const parsed = await this.completeJson(provider, prompt, 4000, sectionSchema, 'leitura dos indicadores');
      if (!parsed) throw new ServiceUnavailableException('A ia.Transppass não devolveu a leitura no formato esperado.');
      const kinds = new Set(refs.map((r) => r.kind as string));
      return {
        summary: parsed.summary,
        items: parsed.items.filter((i) => kinds.has(i.kind)).map((i) => ({ ...i, kind: i.kind as WidgetKind })),
        generatedAt: new Date().toISOString(),
      } satisfies IaIndicatorsReading;
    }) as Promise<IaIndicatorsReading>;
  }

  card(input: IaWidgetReadingInput): Promise<IaWidgetReading> {
    const ref: IaWidgetRef = { kind: input.kind, from: input.from, to: input.to, ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}) };
    const key = `card:${hash([ref])}`;
    return this.cached(key, input.force, async (provider) => {
      const data = await this.snapshot(ref);
      const prompt = `Leia o cartão de indicador abaixo (JSON) e escreva o que esse número está dizendo. Responda SOMENTE com um JSON válido, sem comentários nem cercas de código: {"text": "2 ou 3 frases, até 320 caracteres: o número, a comparação com o período anterior, o que a série mostra (pico, queda, dia atípico) e, se houver, onde olhar", "tone": "good|bad|warn|info"}

<cartao>${JSON.stringify(data)}</cartao>`;
      const parsed = await this.completeJson(provider, prompt, 1500, cardSchema, `leitura do cartão ${ref.kind}`);
      if (!parsed) throw new ServiceUnavailableException('A ia.Transppass não devolveu a leitura no formato esperado.');
      return { text: parsed.text, tone: parsed.tone, generatedAt: new Date().toISOString() } satisfies IaWidgetReading;
    }) as Promise<IaWidgetReading>;
  }

  /** O cartão como a tela o vê, enxuto para o prompt. */
  private async snapshot(ref: IaWidgetRef) {
    const w: DashboardWidget = await this.widgets.build({ kind: ref.kind, from: ref.from, to: ref.to, ...(ref.vehicleId ? { vehicleId: ref.vehicleId } : {}) });
    const points = (w.series?.points ?? []).filter((p) => p.value !== null);
    return {
      kind: w.kind,
      indicator: LABELS[w.kind],
      unit: w.unit,
      requested: { from: w.from, to: w.to },
      used: w.used,
      fellBack: w.fellBack,
      neverHadData: w.neverHadData ?? false,
      scope: w.vehicleCode ? `carro ${w.vehicleCode}` : 'frota',
      value: w.value,
      previous: w.previous,
      higherIsBetter: w.higherIsBetter,
      detail: w.detail,
      series: w.series ? { bucket: w.series.bucket, points: points.slice(-40).map((p) => [p.key, Math.round((p.value as number) * 100) / 100]) } : null,
    };
  }

  private async cached<T>(key: string, force: boolean, make: (provider: IaProvider) => Promise<T>): Promise<T> {
    if (!this.provider) throw new ServiceUnavailableException('A ia.Transppass está desligada nesta instalação. Avise o administrador do sistema.');
    const hit = this.cache.get(key);
    if (!force && hit && Date.now() - hit.at < IA_INDICATORS_TTL_MINUTES * 60_000) return hit.value as T;
    const running = this.inFlight.get(key);
    if (running) return running as Promise<T>;
    const provider = this.provider;
    const job = make(provider)
      .then((value) => {
        this.cache.set(key, { at: Date.now(), value });
        if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value as string);
        return value;
      })
      .catch((err) => {
        // Falhou agora, mas há uma leitura anterior: melhor a de antes do que nenhuma.
        if (hit) return hit.value as T;
        throw err;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, job);
    return job;
  }

  /**
   * Pede a leitura e valida o JSON. Fora do formato (JSON quebrado por aspas, campo a mais), pede de novo
   * uma vez, dizendo o que estava errado; só então desiste.
   */
  private async completeJson<T extends z.ZodTypeAny>(provider: IaProvider, prompt: string, maxTokens: number, schema: T, what: string): Promise<z.infer<T> | null> {
    const first = await this.complete(provider, prompt, maxTokens, what);
    const r = parseJson(first, schema);
    if (r.ok) return r.data;
    this.log.warn(`${what}: resposta fora do formato (${r.reason}); pedindo de novo`);
    const retry = `${prompt}

Sua resposta anterior não era um JSON válido (${r.reason}). Responda de novo SOMENTE com o JSON no formato pedido, sem aspas duplas dentro dos textos.`;
    return this.parse(await this.complete(provider, retry, maxTokens, `${what} (2ª tentativa)`), schema, what);
  }

  /** O JSON da resposta; fora do formato, registra o porquê (campo e trecho) para dar para corrigir. */
  private parse<T extends z.ZodTypeAny>(text: string, schema: T, what: string): z.infer<T> | null {
    const r = parseJson(text, schema);
    if (r.ok) return r.data;
    this.log.warn(`${what}: resposta fora do formato (${r.reason}); início: ${text.slice(0, 300).replace(/\s+/g, ' ')}`);
    return null;
  }

  private async complete(provider: IaProvider, prompt: string, maxTokens: number, what: string): Promise<string> {
    const started = Date.now();
    try {
      const out = await provider.complete({ system: SYSTEM, prompt, maxTokens });
      this.log.log(`${what} redigida (${provider.kind}, ${Math.round((Date.now() - started) / 100) / 10} s)`);
      return out.text;
    } catch (err) {
      this.log.warn(`${what} falhou: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`);
      throw new ServiceUnavailableException(`Não foi possível redigir a leitura: ${describeProviderError(err)}.`);
    }
  }
}

/** Mesma combinação de cartões, mesma chave: a ordem dos cartões na tela não muda a leitura. */
function dedupe(refs: IaWidgetRef[]): IaWidgetRef[] {
  const seen = new Map<string, IaWidgetRef>();
  for (const r of refs) seen.set(`${r.kind}|${r.from}|${r.to}|${r.vehicleId ?? ''}`, r);
  return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, r]) => r);
}

function hash(refs: IaWidgetRef[]): string {
  const h = createHash('sha1');
  for (const r of refs) h.update(`${r.kind}|${r.from}|${r.to}|${r.vehicleId ?? ''};`);
  return h.digest('hex').slice(0, 16);
}

function parseJson<T extends z.ZodTypeAny>(text: string, schema: T): { ok: true; data: z.infer<T> } | { ok: false; reason: string } {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, reason: 'sem objeto JSON' };
  try {
    const parsed = schema.safeParse(JSON.parse(cleaned.slice(start, end + 1)));
    if (parsed.success) return { ok: true, data: parsed.data as z.infer<T> };
    return { ok: false, reason: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  } catch (err) {
    return { ok: false, reason: `JSON inválido: ${err instanceof Error ? err.message.slice(0, 80) : 'erro'}` };
  }
}
