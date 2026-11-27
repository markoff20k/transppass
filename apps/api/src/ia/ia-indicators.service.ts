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
  type IaPageReading,
  type IaPageReadingName,
  type WidgetKind,
} from '@app/shared';
import { WidgetsService } from '../dashboard/widgets.service';
import { PrismaService } from '../prisma/prisma.service';
import { MaterialsService } from '../materials/materials.service';
import { IA_PROVIDER, describeProviderError, type IaProvider } from './ia-provider';

const TONE = z.enum(['good', 'bad', 'warn', 'info']);
const sectionSchema = z.object({
  summary: z.string().trim().min(10).max(600),
  items: z.array(z.object({ kind: z.string(), tone: TONE, title: z.string().trim().min(3).max(140), text: z.string().trim().min(3).max(400) })).min(1).max(6),
});
const cardSchema = z.object({ text: z.string().trim().min(10).max(500), tone: TONE });
const pageSchema = z.object({
  summary: z.string().trim().min(10).max(700),
  items: z.array(z.object({ tone: TONE, title: z.string().trim().min(3).max(140), text: z.string().trim().min(3).max(420) })).min(1).max(6),
});

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
    private readonly prisma: PrismaService,
    private readonly materials: MaterialsService,
  ) {}

  /**
   * A leitura de uma página (Ordens de serviço, Estoque): a ia.Transppass lê o
   * resumo dos mesmos dados que a página mostra e escreve um parágrafo e até
   * seis pontos. Vale uma hora; "force" redige de novo.
   */
  page(name: IaPageReadingName, force: boolean): Promise<IaPageReading> {
    return this.cached(`page:${name}`, force, async (provider) => {
      const data = name === 'stock' ? await this.stockSnapshot() : await this.workOrdersSnapshot();
      const subject = name === 'stock' ? 'o almoxarifado (estoque, reposição, solicitações das valetas, ferramentas, pool rotativo e consumo de peças)' : 'as ordens de serviço (as abertas agora no sistema e o histórico de fichas e OS da manutenção)';
      const prompt = `Leia o resumo abaixo (JSON) sobre ${subject} e escreva a leitura da página para a equipe de manutenção. Responda SOMENTE com um JSON válido, sem comentários nem cercas de código:
{"summary": "1 ou 2 frases: o que mais importa nesta página agora", "items": [{"tone": "good|bad|warn|info", "title": "até 90 caracteres, com o número principal", "text": "1 ou 2 frases com a comparação, o porquê e onde agir"}]}

Regras:
- De 3 a 6 itens, do mais importante para o menos; um assunto por item.
- Compare a janela atual ("current") com a anterior ("previous") quando houver; diga até que dia há dado ("dataThrough").
- Aponte concentrações: carro, defeito, material ou fornecedor que se repete. Use os nomes e códigos como vêm nos dados.
- Seções vazias (sem OS aberta, sem solicitação pendente) valem no máximo um item, tom info.
- Não repita o mesmo número em dois itens. Não cite a palavra JSON nem estas instruções.

<pagina>${JSON.stringify(data)}</pagina>`;
      const parsed = await this.completeJson(provider, prompt, 4000, pageSchema, `leitura da página ${name}`);
      if (!parsed) throw new ServiceUnavailableException('A ia.Transppass não devolveu a leitura no formato esperado.');
      return { summary: parsed.summary, items: parsed.items, generatedAt: new Date().toISOString(), dataThrough: (data as { dataThrough: string | null }).dataThrough } satisfies IaPageReading;
    }) as Promise<IaPageReading>;
  }

  /** Ordens de serviço: as abertas agora e o histórico (fichas importadas + OS do sistema) em janelas de 30 dias. */
  private async workOrdersSnapshot() {
    const now = new Date();
    const open = await this.prisma.workOrder.findMany({
      where: { status: { notIn: ['RELEASED', 'CANCELLED'] } },
      select: { code: true, status: true, openedAt: true, estimatedCompletionAt: true, type: true, vehicle: { select: { code: true } } },
      orderBy: { openedAt: 'asc' },
    });
    const last = await this.prisma.maintenanceRecord.findFirst({ orderBy: { openedAt: 'desc' }, select: { openedAt: true } });
    const end = last?.openedAt ?? now;
    const curFrom = new Date(end.getTime() - 30 * DAY);
    const prevFrom = new Date(curFrom.getTime() - 30 * DAY);
    const window = async (from: Date, to: Date) => {
      const where = { openedAt: { gt: from, lte: to } };
      const [total, byKind, alleged, found, cars, preventive, parts] = await Promise.all([
        this.prisma.maintenanceRecord.count({ where }),
        this.prisma.maintenanceRecord.groupBy({ by: ['kind', 'kindLabel'], where, _count: { _all: true } }),
        this.prisma.maintenanceRecord.groupBy({ by: ['allegedText'], where: { ...where, kind: { in: ['A', 'S', 'T'] }, allegedText: { not: null } }, _count: { _all: true }, orderBy: { _count: { allegedText: 'desc' } }, take: 6 }),
        this.prisma.maintenanceRecord.groupBy({ by: ['foundText'], where: { ...where, foundText: { not: null } }, _count: { _all: true }, orderBy: { _count: { foundText: 'desc' } }, take: 6 }),
        this.prisma.maintenanceRecord.groupBy({ by: ['vehicleId'], where: { ...where, kind: { in: ['A', 'S', 'T'] } }, _count: { _all: true }, orderBy: { _count: { vehicleId: 'desc' } }, take: 5 }),
        this.prisma.maintenanceRecord.count({ where: { ...where, isPreventive: true } }),
        this.prisma.maintenanceRecordMaterial.aggregate({ where: { appliedAt: { gt: from, lte: to } }, _sum: { totalCost: true } }),
      ]);
      const codes = new Map((await this.prisma.vehicle.findMany({ where: { id: { in: cars.map((c) => c.vehicleId) } }, select: { id: true, code: true } })).map((v) => [v.id, v.code]));
      return {
        from: iso(from),
        to: iso(to),
        records: total,
        breakdownsAST: byKind.filter((k) => ['A', 'S', 'T'].includes(k.kind)).reduce((a, k) => a + k._count._all, 0),
        preventive,
        byKind: byKind.map((k) => ({ kind: k.kind, label: k.kindLabel, n: k._count._all })).sort((a, b) => b.n - a.n).slice(0, 8),
        topAllegedInBreakdowns: alleged.map((a) => ({ defect: a.allegedText, n: a._count._all })),
        topFound: found.map((f) => ({ found: f.foundText, n: f._count._all })),
        carsWithMostBreakdowns: cars.map((c) => ({ car: codes.get(c.vehicleId) ?? '?', breakdowns: c._count._all })),
        partsCostBRL: Math.round(Number(parts._sum.totalCost ?? 0)),
      };
    };
    const [current, previous] = await Promise.all([window(curFrom, end), window(prevFrom, curFrom)]);
    return {
      now: now.toISOString(),
      dataThrough: last ? iso(last.openedAt) : null,
      openInSystem: {
        total: open.length,
        byStatus: Object.entries(open.reduce<Record<string, number>>((a, o) => ({ ...a, [o.status]: (a[o.status] ?? 0) + 1 }), {})).map(([status, n]) => ({ status, n })),
        overdue: open.filter((o) => o.estimatedCompletionAt && o.estimatedCompletionAt < now).length,
        oldest: open.slice(0, 5).map((o) => ({ os: o.code, car: o.vehicle.code, status: o.status, hoursOpen: Math.round((now.getTime() - o.openedAt.getTime()) / 3_600_000) })),
      },
      history: { current, previous },
    };
  }

  /** Estoque: reposição, solicitações, ferramentas, pool e o consumo de peças em janelas de 30 dias. */
  private async stockSnapshot() {
    const now = new Date();
    const [kanban, tools, pool, requests] = await Promise.all([
      this.materials.listKanban(),
      this.materials.listTools(),
      this.materials.listPool(),
      this.prisma.materialRequest.findMany({
        where: { status: { in: ['REQUESTED', 'SEPARATED', 'WAITING_PART'] } },
        select: { status: true, requestedAt: true, quantity: true, material: { select: { code: true, description: true } }, workOrder: { select: { code: true, vehicle: { select: { code: true } } } } },
        orderBy: { requestedAt: 'asc' },
      }),
    ]);
    const last = await this.prisma.maintenanceRecordMaterial.findFirst({ orderBy: { appliedAt: 'desc' }, select: { appliedAt: true } });
    const end = last?.appliedAt ?? now;
    const curFrom = new Date(end.getTime() - 30 * DAY);
    const prevFrom = new Date(curFrom.getTime() - 30 * DAY);
    const window = async (from: Date, to: Date) => {
      const where = { appliedAt: { gt: from, lte: to } };
      const [sum, mats, classes, cars] = await Promise.all([
        this.prisma.maintenanceRecordMaterial.aggregate({ where, _sum: { totalCost: true }, _count: { _all: true } }),
        this.prisma.maintenanceRecordMaterial.groupBy({ by: ['materialCode', 'description'], where, _sum: { totalCost: true, quantity: true }, orderBy: { _sum: { totalCost: 'desc' } }, take: 8 }),
        this.prisma.maintenanceRecordMaterial.groupBy({ by: ['className'], where, _sum: { totalCost: true }, orderBy: { _sum: { totalCost: 'desc' } }, take: 5 }),
        this.prisma.maintenanceRecordMaterial.groupBy({ by: ['vehicleId'], where: { ...where, vehicleId: { not: null } }, _sum: { totalCost: true }, orderBy: { _sum: { totalCost: 'desc' } }, take: 5 }),
      ]);
      const codes = new Map((await this.prisma.vehicle.findMany({ where: { id: { in: cars.map((c) => c.vehicleId as string) } }, select: { id: true, code: true } })).map((v) => [v.id, v.code]));
      return {
        from: iso(from),
        to: iso(to),
        partsApplied: sum._count._all,
        costBRL: Math.round(Number(sum._sum.totalCost ?? 0)),
        topMaterialsByCost: mats.map((m) => ({ code: m.materialCode, material: m.description, qty: Math.round(Number(m._sum.quantity ?? 0)), costBRL: Math.round(Number(m._sum.totalCost ?? 0)) })),
        topClassesByCost: classes.map((k) => ({ class: k.className, costBRL: Math.round(Number(k._sum.totalCost ?? 0)) })),
        carsWithMostPartsCost: cars.map((k) => ({ car: codes.get(k.vehicleId as string) ?? '?', costBRL: Math.round(Number(k._sum.totalCost ?? 0)) })),
      };
    };
    const [current, previous] = await Promise.all([window(curFrom, end), window(prevFrom, curFrom)]);
    const soon = new Date(now.getTime() + 30 * DAY);
    return {
      now: now.toISOString(),
      dataThrough: last ? iso(last.appliedAt) : null,
      reorder: {
        itemsAtOrBelowPoint: kanban.length,
        outOfStock: kanban.filter((k) => k.stockQty <= 0).length,
        note: 'O sistema não registra pedido de compra ao fornecedor; bayRequestsWaiting conta solicitações das valetas (mecânicos) que esperam o material, não compras.',
        withBayRequestsWaiting: kanban.filter((k) => k.pendingRequests > 0).length,
        mostCritical: [...kanban].sort((a, b) => a.stockQty / Math.max(1, a.reorderPoint) - b.stockQty / Math.max(1, b.reorderPoint)).slice(0, 8).map((k) => ({ code: k.code, material: k.description, stock: k.stockQty, reorderPoint: k.reorderPoint, supplier: k.supplierName, supplierSlaDays: k.supplierSlaDays, abc: k.abcClass, bayRequestsWaiting: k.pendingRequests })),
      },
      requestsFromBays: {
        pending: requests.length,
        byStatus: Object.entries(requests.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {})).map(([status, n]) => ({ status, n })),
        oldest: requests.slice(0, 5).map((r) => ({ material: `${r.material.code} ${r.material.description}`, os: r.workOrder?.code ?? null, car: r.workOrder?.vehicle.code ?? null, hoursWaiting: Math.round((now.getTime() - r.requestedAt.getTime()) / 3_600_000), status: r.status })),
      },
      tools: {
        total: tools.length,
        calibrationExpired: tools.filter((t) => t.isCalibrationExpired).length,
        calibrationDueIn30Days: tools.filter((t) => !t.isCalibrationExpired && t.calibrationDueAt && new Date(t.calibrationDueAt) < soon).length,
        insufficient: tools.filter((t) => t.availableQty < t.requiredQty).map((t) => ({ code: t.code, tool: t.description, available: t.availableQty, required: t.requiredQty })).slice(0, 5),
      },
      rotatingPool: Object.entries(pool.reduce<Record<string, number>>((a, p) => ({ ...a, [p.status]: (a[p.status] ?? 0) + 1 }), {})).map(([status, n]) => ({ status, n })),
      partsConsumption: { current, previous },
    };
  }

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

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

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
