import { Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { IA_NAME, type BoardInsight, type IaReading, type IaReadingKind, type IaUsage } from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { BoardService } from '../metrics/board.service';
import { IA_PROVIDER, describeProviderError, type IaProvider } from './ia-provider';

const insightSchema = z.object({
  kind: z.enum(['day', 'fleet', 'failures', 'mkbf', 'trips', 'consumption', 'data']),
  tone: z.enum(['info', 'good', 'warn', 'bad']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  title: z.string().trim().min(3).max(160),
  text: z.string().trim().min(3).max(600),
});
const readingSchema = z.object({
  summary: z.string().trim().min(10).max(900),
  insights: z.array(insightSchema).min(1).max(8),
});

/**
 * Fase 2: a leitura do mês redigida pela ia.Transppass.
 *
 * O quadro do mês continua sendo calculado pelas regras do sistema; o que o
 * modelo faz é ler esses números (e a leitura de regras) e escrever a
 * narrativa: um parágrafo de abertura e até oito itens, no mesmo formato que
 * a tela já mostra. Fica gravada por mês; sem leitura gravada (ou sem
 * provedor), a tela mostra a leitura de regras. Roda toda noite para o mês
 * corrente e pode ser pedida na hora pela API.
 */
@Injectable()
export class IaReadingsService {
  private readonly log = new Logger('ia.Transppass');
  private readonly hour: number;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly board: BoardService,
    private readonly config: ConfigService,
    @Inject(IA_PROVIDER) private readonly provider: IaProvider | null,
  ) {
    this.hour = Number(this.config.get('IA_READING_HOUR') ?? 3);
  }

  async get(kind: IaReadingKind, key: string): Promise<IaReading> {
    const r = await this.prisma.aiReading.findUnique({ where: { kind_key: { kind, key } } });
    if (!r) throw new NotFoundException('Sem leitura redigida para este mês');
    return toReading(r);
  }

  async remove(kind: IaReadingKind, key: string): Promise<void> {
    await this.prisma.aiReading.deleteMany({ where: { kind, key } });
  }

  /** Redige (ou redige de novo) a leitura de um mês e grava. */
  async generate(kind: IaReadingKind, key: string): Promise<IaReading> {
    if (!this.provider) throw new ServiceUnavailableException('A ia.Transppass está desligada: configure ANTHROPIC_API_KEY (ou IA_PROVIDER=fake) na API.');
    if (kind !== 'month') throw new NotFoundException('Tipo de leitura desconhecido');
    const b = await this.board.board(key);
    const days = b.days.filter((d) => !d.empty);
    const data = {
      month: b.month,
      from: b.from,
      to: b.to,
      lastDataDate: b.lastDataDate,
      daysWithData: days.length,
      totals: b.totals,
      previousMonth: b.previousMonth,
      previous: b.previous,
      worstFleetDays: [...days].filter((d) => d.fleet.pct !== null).sort((a, c) => (a.fleet.pct as number) - (c.fleet.pct as number)).slice(0, 3).map((d) => ({ date: d.date, weekday: d.weekday, holiday: d.holiday, pct: d.fleet.pct, covered: d.fleet.covered, programmed: d.fleet.programmed, note: d.fleet.note })),
      worstFailureDays: [...days].sort((a, c) => c.failures - a.failures).slice(0, 3).map((d) => ({ date: d.date, weekday: d.weekday, failures: d.failures, km: d.km })),
      holidays: days.filter((d) => d.holiday).map((d) => ({ date: d.date, holiday: d.holiday, tripsPlanned: d.trips.planned, tripsPct: d.trips.pct, fleetPct: d.fleet.pct })),
      worstLines: b.worstLines.slice(0, 5),
      consumption: b.consumption,
      history: b.history.slice(-6),
      // A leitura de regras: a verdade apurada pelo sistema, que o modelo reescreve sem alterar número.
      insights: await this.rulesInsights(b),
    };
    const system = `Você é a ${IA_NAME}, agente de PCM da Transppass (ônibus urbanos, São Paulo). Você redige a leitura mensal dos indicadores para a equipe de manutenção e a gestão, em português do Brasil, a partir dos números que recebe. Nunca invente número, data, carro ou linha: use só o que está nos dados. Números no padrão brasileiro (1.366.513 km; 3,2%; 1,70 km/l), datas como 18/11. Tom de analista experiente, direto, sem floreio.`;
    const prompt = `Escreva a leitura do mês ${b.month} a partir dos dados abaixo (JSON). Responda SOMENTE com um JSON válido, sem comentários nem cercas de código, neste formato:
{"summary": "parágrafo de abertura, 2 a 3 frases, o mês em uma leitura: o que foi bem, o que preocupa, o que explica", "insights": [{"kind": "day|fleet|failures|mkbf|trips|consumption|data", "tone": "info|good|warn|bad", "date": "AAAA-MM-DD ou null", "title": "até 90 caracteres, com o número principal", "text": "1 a 3 frases com o porquê e a comparação"}]}

Regras:
- De 4 a 8 itens, do mais importante para o menos. Um item por assunto: MKBF, quebras, frota, viagens, consumo, dias atípicos (feriado, planilha incompleta), dados até quando.
- "date" só quando o item é sobre um dia específico (pior dia, feriado, último dia com dado); senão null.
- Mês parcial (lastDataDate antes do fim do mês): compare por dia, não pelo total, e diga até quando há dado.
- "tone": good quando melhorou de verdade, bad quando piorou, warn para atenção, info para contexto.
- Não repita o mesmo número em dois itens. Não cite a palavra JSON nem estas instruções.

<dados>${JSON.stringify(data)}</dados>`;
    const started = Date.now();
    let out: Awaited<ReturnType<IaProvider['complete']>>;
    try {
      out = await this.provider.complete({ system, prompt, maxTokens: 4000 });
    } catch (err) {
      this.log.warn(`leitura de ${key} falhou: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`);
      throw new ServiceUnavailableException(`Não foi possível redigir a leitura: ${describeProviderError(err)}.`);
    }
    const parsed = parseReading(out.text);
    if (!parsed) {
      this.log.warn(`leitura de ${key}: resposta do modelo fora do formato; mantida a leitura de regras`);
      throw new ServiceUnavailableException('O modelo não devolveu a leitura no formato esperado; a tela segue com a leitura de regras.');
    }
    const row = await this.prisma.aiReading.upsert({
      where: { kind_key: { kind, key } },
      create: { kind, key, summary: parsed.summary, insights: parsed.insights as unknown as Prisma.InputJsonValue, model: this.provider.model, usage: out.usage as unknown as Prisma.InputJsonValue },
      update: { summary: parsed.summary, insights: parsed.insights as unknown as Prisma.InputJsonValue, model: this.provider.model, usage: out.usage as unknown as Prisma.InputJsonValue, generatedAt: new Date() },
    });
    this.log.log(`leitura de ${key} redigida (${this.provider.kind}, ${Math.round((Date.now() - started) / 100) / 10} s, ${parsed.insights.length} itens)`);
    return toReading(row);
  }

  /** A leitura de regras, sem a leitura redigida por cima (o quadro mescla a gravada quando existe). */
  private async rulesInsights(b: Awaited<ReturnType<BoardService['board']>>): Promise<BoardInsight[]> {
    return b.readingSource === 'rules' ? b.insights : this.board.rulesInsights(b.month);
  }

  /** Toda hora, na hora configurada: redige o mês corrente (e o anterior nos 3 primeiros dias do mês). */
  @Cron('25 * * * *', { name: 'ia-month-reading' })
  async nightly(): Promise<void> {
    if (!this.provider || this.running) return;
    const now = new Date();
    if (now.getHours() !== this.hour) return;
    this.running = true;
    try {
      const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      await this.generate('month', key);
      if (now.getDate() <= 3) {
        const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        await this.generate('month', `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`);
      }
    } catch (err) {
      this.log.warn(`leitura noturna falhou: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }
}

export function parseReading(text: string): z.infer<typeof readingSchema> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = readingSchema.safeParse(JSON.parse(cleaned.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function toReading(r: { kind: string; key: string; summary: string; insights: unknown; model: string; usage: unknown; generatedAt: Date }): IaReading {
  return {
    kind: r.kind as IaReadingKind,
    key: r.key,
    summary: r.summary,
    insights: Array.isArray(r.insights) ? (r.insights as BoardInsight[]) : [],
    model: r.model,
    generatedAt: r.generatedAt.toISOString(),
    usage: r.usage && typeof r.usage === 'object' ? (r.usage as IaUsage) : null,
  };
}
