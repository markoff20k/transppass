import { Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import type { Prisma } from '@prisma/client';
import {
  IA_NAME,
  type IaConversation,
  type IaConversationDetail,
  type IaMessage,
  type IaMessageInput,
  type IaStatus,
  type IaStreamEvent,
  type IaToolCall,
  type IaUsage,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { IaToolsService } from './ia-tools.service';
import { EMPTY_USAGE, IA_PROVIDER, addUsage, describeProviderError, type IaProvider } from './ia-provider';

/** Quantas idas às ferramentas uma resposta pode ter antes de o agente ser obrigado a concluir. */
const MAX_TOOL_ROUNDS = 8;
const MAX_TOKENS = 4000;
/** Quantas mensagens anteriores voltam para o modelo (as mais recentes). */
const HISTORY_LIMIT = 24;

/**
 * ia.Transppass: a conversa com o agente de PCM.
 *
 * O front manda a pergunta; a API monta o contexto (sistema fixo em cache +
 * a data de hoje), dá ao modelo as ferramentas só de leitura e roda o loop:
 * texto em streaming para o front, consultas executadas aqui e devolvidas ao
 * modelo, até a resposta final. Tudo fica gravado por usuário — os blocos
 * exatos trocados com o modelo, para a conversa continuar íntegra, e o texto
 * e as consultas, para a tela.
 */
@Injectable()
export class IaService {
  private readonly log = new Logger('ia.Transppass');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: IaToolsService,
    @Inject(IA_PROVIDER) private readonly provider: IaProvider | null,
  ) {}

  status(): IaStatus {
    return {
      enabled: this.provider !== null,
      provider: this.provider?.kind ?? 'off',
      name: IA_NAME,
    };
  }

  // --- Conversas -------------------------------------------------------------

  async listConversations(userId: string): Promise<IaConversation[]> {
    const rows = await this.prisma.aiConversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 40,
      include: { _count: { select: { messages: true } } },
    });
    return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), messageCount: r._count.messages }));
  }

  async createConversation(userId: string, title?: string, context?: string): Promise<IaConversation> {
    const r = await this.prisma.aiConversation.create({ data: { userId, title: title?.trim() || 'Nova conversa', context: context ?? null } });
    return { id: r.id, title: r.title, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), messageCount: 0 };
  }

  async getConversation(userId: string, id: string): Promise<IaConversationDetail> {
    const r = await this.prisma.aiConversation.findFirst({ where: { id, userId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!r) throw new NotFoundException('Conversa não encontrada');
    return {
      id: r.id,
      title: r.title,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      messageCount: r.messages.length,
      messages: r.messages.map(toMessage),
    };
  }

  async deleteConversation(userId: string, id: string): Promise<void> {
    const r = await this.prisma.aiConversation.findFirst({ where: { id, userId }, select: { id: true } });
    if (!r) throw new NotFoundException('Conversa não encontrada');
    await this.prisma.aiConversation.delete({ where: { id } });
  }

  // --- A resposta -------------------------------------------------------------

  /**
   * Responde a uma pergunta numa conversa, emitindo eventos conforme o texto
   * chega e as ferramentas rodam. Grava a pergunta antes e a resposta ao fim
   * (também quando dá erro, para a conversa não perder o fio).
   */
  async send(userId: string, conversationId: string, input: IaMessageInput, emit: (e: IaStreamEvent) => void, signal?: AbortSignal): Promise<void> {
    if (!this.provider) throw new ServiceUnavailableException('A ia.Transppass está desligada nesta instalação. Avise o administrador do sistema.');
    const conv = await this.prisma.aiConversation.findFirst({ where: { id: conversationId, userId }, include: { messages: { orderBy: { createdAt: 'asc' }, take: HISTORY_LIMIT * -1 } } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');

    // A pergunta entra já, com o contexto da tela como um prefixo que só o modelo vê.
    const userText = input.text.trim();
    const contextLine = input.context?.label ? `[Tela: ${input.context.label}${input.context.route ? ` (${input.context.route})` : ''}]\n` : '';
    const userBlocks: Anthropic.MessageParam[] = [{ role: 'user', content: `${contextLine}${userText}` }];
    const userRow = await this.prisma.aiMessage.create({ data: { conversationId, role: 'user', text: userText, blocks: userBlocks as unknown as Prisma.InputJsonValue } });
    const isFirst = conv.messages.length === 0;
    const title = isFirst ? clipTitle(userText) : conv.title;
    if (isFirst) await this.prisma.aiConversation.update({ where: { id: conversationId }, data: { title } });

    const assistantId = cryptoId();
    emit({ type: 'start', messageId: assistantId, conversationId });

    const messages: Anthropic.MessageParam[] = [...conv.messages.flatMap(replay), ...userBlocks];
    const system = this.systemPrompt();
    const tools = this.tools.definitions;
    const turns: Anthropic.MessageParam[] = [];
    const calls: IaToolCall[] = [];
    let usage: IaUsage = EMPTY_USAGE;
    let text = '';
    let error: string | null = null;

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
        const forceFinish = round === MAX_TOOL_ROUNDS;
        const result = await this.provider.turn({
          system,
          messages: forceFinish ? [...messages, { role: 'user', content: 'Conclua a resposta com o que já tem, sem novas consultas.' }] : messages,
          tools: forceFinish ? [] : tools,
          maxTokens: MAX_TOKENS,
          onText: (delta) => {
            text += delta;
            emit({ type: 'text', delta });
          },
          signal,
        });
        usage = addUsage(usage, result.usage);
        const assistantTurn: Anthropic.MessageParam = { role: 'assistant', content: toParams(result.content) };
        messages.push(assistantTurn);
        turns.push(assistantTurn);

        if (result.stopReason === 'refusal') {
          const note = 'O modelo não quis responder a esta pergunta.';
          text = text || note;
          emit({ type: 'text', delta: text ? '' : note });
          break;
        }
        const toolUses = result.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        if (toolUses.length === 0 || result.stopReason !== 'tool_use') break;
        if (result.stopReason === 'tool_use' && toolUses.length > 0 && result.content.some((b) => b.type === 'text')) {
          // Texto antes das consultas já foi emitido; separa do que vem depois.
          text += '\n\n';
          emit({ type: 'text', delta: '\n\n' });
        }

        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const use of toolUses) {
          if (signal?.aborted) break;
          const started = Date.now();
          const def = this.tools.find(use.name);
          const pending: IaToolCall = { id: use.id, name: use.name, label: def ? def.label((use.input as Record<string, unknown>) ?? {}) : use.name, input: (use.input as Record<string, unknown>) ?? {}, ok: true, ms: 0 };
          emit({ type: 'tool', call: pending, phase: 'start' });
          const r = await this.tools.execute(use.name, use.input);
          const call: IaToolCall = { ...pending, label: r.label, ok: r.ok, ms: Date.now() - started };
          calls.push(call);
          emit({ type: 'tool', call, phase: 'end' });
          results.push({ type: 'tool_result', tool_use_id: use.id, content: r.content, is_error: r.ok ? undefined : true });
        }
        const resultTurn: Anthropic.MessageParam = { role: 'user', content: results };
        messages.push(resultTurn);
        turns.push(resultTurn);
      }
    } catch (err) {
      if (signal?.aborted) {
        error = 'Resposta interrompida.';
      } else {
        error = describeProviderError(err);
        this.log.warn(`resposta falhou (${this.provider.kind}): ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`);
      }
    }

    const finalText = text.trim() || (error ? `Não consegui responder: ${error}` : 'Sem resposta.');
    const row = await this.prisma.aiMessage.create({
      data: {
        id: assistantId,
        conversationId,
        role: 'assistant',
        text: finalText,
        blocks: turns as unknown as Prisma.InputJsonValue,
        toolCalls: calls as unknown as Prisma.InputJsonValue,
        usage: usage as unknown as Prisma.InputJsonValue,
        error,
      },
    });
    await this.prisma.aiConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    void userRow;
    emit({ type: 'done', message: toMessage(row), title });
  }

  // --- O prompt de sistema ------------------------------------------------------

  private systemPrompt(): Anthropic.TextBlockParam[] {
    const now = new Date();
    const stable = `Você é a ${IA_NAME} (apelido Tipê), o agente de PCM — Planejamento e Controle da Manutenção — da Transppass, empresa de ônibus urbanos de São Paulo. Você conversa com a equipe de manutenção (PCM, CCO, oficina, estoque, gestão) dentro do sistema Módulo PCM.

O QUE VOCÊ FAZ
- Responde perguntas sobre a frota, a garagem, a fila, as OS, as quebras, o consumo e os indicadores, SEMPRE a partir do que as ferramentas devolvem. Nunca invente número, carro, data ou causa. Se a ferramenta não trouxer o dado, diga que não há dado para aquilo e sugira o período ou a tela onde existe.
- Explica o porquê de um número: compara com o período anterior, aponta o pior dia, o carro ou a linha que concentra o problema, a etapa que segurou o carro.
- Não executa ações (não abre OS, não mexe na fila, não altera nada). Se pedirem, diga que isso se faz na tela correspondente e aponte qual.
- Sua identidade é só ${IA_NAME}, a inteligência artificial do Módulo PCM. Se perguntarem qual modelo, empresa ou tecnologia está por trás de você, responda apenas que você é a ${IA_NAME}; nunca cite fornecedor, nome ou versão de modelo.
- Nunca cite o nome do sistema de origem dos dados (ERP, JB ou qualquer sigla de fornecedor), nem em campos que venham das ferramentas: diga "as planilhas da Transppass" ou "a remessa de dados".

COMO VOCÊ RESPONDE
- Em português do Brasil, direto ao ponto, como um analista de PCM experiente falando com colega. Frases curtas. Nada de floreio nem de pedir desculpas.
- Comece pela resposta. Depois o porquê, em até 3 pontos. Cite sempre o período e a fonte dos números (ex.: "quadro de novembro, dados até 18/11").
- Números no padrão brasileiro: 1.366.513 km, 3,2%, 1,70 km/l. Datas como 18/11. Use **negrito** só no número principal. Listas curtas com "-". Sem títulos, sem tabelas grandes.
- Quando a pergunta for vaga ("como está o MKBF?"), assuma o mês corrente até hoje e diga que assumiu.
- Quando a pessoa citar uma tela entre colchetes no início da pergunta, ela está olhando essa tela: use o período e o assunto dela.
- Até 2 consultas por resposta na maioria dos casos; só vá além quando a pergunta exigir cruzar fontes.

GLOSSÁRIO DA TRANSPPASS
- MKBF: km rodados ÷ retornos não programados (quebras). Quanto maior, melhor. Métrica norte da manutenção.
- Quebra / retorno não programado: ficha do CCO com código A, S ou T (o carro voltou ou parou por falha). Fichas de outros tipos não contam no MKBF.
- Frota: carros com aplicação FROTA (operacional); APOIO são veículos de serviço. Lotes AR9 e E8; classes Padron 13 m, Padron 15 m (articulado), Básico 12 m, ePadron (elétricos, eBUS).
- Fluxo da garagem: registro da falha (CCO/motorista) → triagem do PCM com o carro ainda na rua (saídas: atendimento na rua por PAM ou socorro, oficina, ou segue na linha com a manutenção à noite) → fila (aguardando valeta) → OS em execução → aguardando peça → inspeção → limpeza → liberação → volta à linha.
- Estados do carro: IN_LINE rodando; AVAILABLE disponível no pátio; AWAITING_TRIAGE; FIELD_SERVICE socorro na rua; AWAITING_MAINTENANCE na fila; IN_MAINTENANCE em execução; AWAITING_PART aguardando peça; IN_INSPECTION; IN_CLEANING; OUT_OF_SERVICE fora de operação.
- Disponibilidade: carros prontos (rodando ou disponíveis) ÷ frota ativa; meta 85%. Carro parado conta da quebra à liberação.
- Cumprimento de frota: tabelas (linha × tabela) cobertas ÷ programadas. Cumprimento de viagens: viagens feitas ÷ programadas (SPTrans). Viagens perdidas são as não realizadas.
- Consumo: diesel em km/l (maior é melhor); elétricos em kWh/km (menor é melhor). "Fora do padrão" é o carro que gasta 15% a mais que a mediana do grupo ("acima do grupo") ou 7% a mais ("em atenção").
- Tempo parado por causa: horas das OS liberadas, por etapa (fila, execução, material, inspeção, limpeza).
- Dados: a frota, o km diário e as fichas vêm das planilhas importadas da Transppass (remessa periódica; os últimos dias podem estar em branco até a próxima remessa). O fluxo da garagem (triagem, fila, OS) nasce no próprio sistema.

FERRAMENTAS
- frota_resumo (agora), carro (um prefixo), quadro_mes (um mês fechado ou corrente), mkbf (intervalo livre), indicadores_oficina (intervalo), consumo_frota e consumo_carro (período), fila (agora), os_lista, eventos (intervalo), preventivas.
- Datas sempre AAAA-MM-DD; mês AAAA-MM. Para "hoje", "ontem", "esta semana", calcule a partir da data de hoje informada abaixo.`;
    const volatile = `Hoje é ${now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}, ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} (horário de São Paulo). Data ISO de hoje: ${isoDay(now)}. Mês corrente: ${isoDay(now).slice(0, 7)}.`;
    return [
      { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: volatile },
    ];
  }
}

// ---------------------------------------------------------------------------

function toMessage(r: { id: string; role: string; text: string; toolCalls: unknown; usage: unknown; error: string | null; createdAt: Date }): IaMessage {
  return {
    id: r.id,
    role: r.role === 'assistant' ? 'assistant' : 'user',
    text: r.text,
    toolCalls: Array.isArray(r.toolCalls) ? (r.toolCalls as IaToolCall[]) : [],
    usage: r.usage && typeof r.usage === 'object' ? (r.usage as IaUsage) : null,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Os blocos gravados de uma mensagem voltam como as mensagens exatas da API. */
function replay(r: { blocks: unknown }): Anthropic.MessageParam[] {
  return Array.isArray(r.blocks) ? (r.blocks as Anthropic.MessageParam[]) : [];
}

/** Blocos de resposta viram parâmetros reenviáveis (texto, tool_use e pensamento preservados como vieram). */
function toParams(content: Anthropic.ContentBlock[]): Anthropic.ContentBlockParam[] {
  return content as unknown as Anthropic.ContentBlockParam[];
}

const clipTitle = (s: string) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > 60 ? `${one.slice(0, 59)}…` : one;
};

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function cryptoId(): string {
  // uuid v4 sem dependência: o Prisma aceita qualquer uuid válido na coluna.
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
