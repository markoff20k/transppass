import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import {
  iaConversationCreateSchema,
  iaIndicatorsInputSchema,
  iaPageReadingInputSchema,
  iaPageReadingParamsSchema,
  type IaPageReading,
  type IaPageReadingInput,
  type IaPageReadingName,
  iaWidgetReadingInputSchema,
  type IaIndicatorsInput,
  type IaIndicatorsReading,
  type IaWidgetReading,
  type IaWidgetReadingInput,
  iaMessageInputSchema,
  iaReadingParamsSchema,
  type IaConversation,
  type IaConversationCreateInput,
  type IaConversationDetail,
  type IaMessageInput,
  type IaReading,
  type IaReadingParams,
  type IaStatus,
  type IaStreamEvent,
} from '@app/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { IaService } from './ia.service';
import { IaReadingsService } from './ia-readings.service';
import { IaIndicatorsService } from './ia-indicators.service';

/**
 * ia.Transppass pela API: conversas por usuário, resposta em SSE e as
 * leituras do mês redigidas pelo modelo. Toda rota exige sessão; o modelo e
 * a chave ficam só no servidor.
 */
@ApiTags('ia')
@ApiBearerAuth()
@Controller('ia')
export class IaController {
  constructor(
    private readonly ia: IaService,
    private readonly readings: IaReadingsService,
    private readonly indicators: IaIndicatorsService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Se o agente está ligado, com qual provedor e modelo' })
  status(): IaStatus {
    return this.ia.status();
  }

  @Get('conversations')
  list(@CurrentUser('sub') userId: string): Promise<IaConversation[]> {
    return this.ia.listConversations(userId);
  }

  @Post('conversations')
  create(@CurrentUser('sub') userId: string, @Body(new ZodValidationPipe(iaConversationCreateSchema)) body: IaConversationCreateInput): Promise<IaConversation> {
    return this.ia.createConversation(userId, body.title);
  }

  @Get('conversations/:id')
  get(@CurrentUser('sub') userId: string, @Param('id') id: string): Promise<IaConversationDetail> {
    return this.ia.getConversation(userId, id);
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  remove(@CurrentUser('sub') userId: string, @Param('id') id: string): Promise<void> {
    return this.ia.deleteConversation(userId, id);
  }

  /** A resposta chega em Server-Sent Events: text (trechos), tool (consultas), done (mensagem gravada) ou error. */
  @Post('conversations/:id/messages')
  @ApiOperation({ summary: 'Pergunta ao agente; resposta em streaming (SSE)' })
  async send(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(iaMessageInputSchema)) body: IaMessageInput,
    @Res() res: Response,
  ): Promise<void> {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // nginx: não guardar o stream para entregar de uma vez.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const emit = (e: IaStreamEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    // Mantém a conexão viva atrás de proxies enquanto uma consulta demora.
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, 15_000);
    try {
      await this.ia.send(userId, id, body, emit, abort.signal);
    } catch (err) {
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      clearInterval(keepAlive);
      res.end();
    }
  }

  // --- Indicadores do Dashboard: a leitura da seção e a de um cartão -----------------

  @Post('indicators/reading')
  @HttpCode(200)
  @ApiOperation({ summary: 'A leitura da ia.Transppass sobre os cartões da seção Indicadores (vale por uma hora)' })
  indicatorsReading(@Body(new ZodValidationPipe(iaIndicatorsInputSchema)) body: IaIndicatorsInput): Promise<IaIndicatorsReading> {
    return this.indicators.section(body);
  }

  @Post('indicators/card')
  @HttpCode(200)
  @ApiOperation({ summary: 'A leitura da ia.Transppass sobre um cartão de indicador (vale por uma hora)' })
  cardReading(@Body(new ZodValidationPipe(iaWidgetReadingInputSchema)) body: IaWidgetReadingInput): Promise<IaWidgetReading> {
    return this.indicators.card(body);
  }

  @Post('pages/:page/reading')
  @HttpCode(200)
  @ApiOperation({ summary: 'A leitura da ia.Transppass sobre uma página (Ordens de serviço, Estoque); vale por uma hora' })
  pageReading(
    @Param(new ZodValidationPipe(iaPageReadingParamsSchema)) p: { page: IaPageReadingName },
    @Body(new ZodValidationPipe(iaPageReadingInputSchema)) body: IaPageReadingInput,
  ): Promise<IaPageReading> {
    return this.indicators.page(p.page, body.force);
  }

  // --- Fase 2: leituras do mês e a frase do dia ------------------------------------

  /** A frase que abre o Dashboard: redigida de hora em hora a partir da foto da garagem. Vem antes da rota genérica. */
  @Get('readings/day/today')
  @ApiOperation({ summary: 'A leitura do dia da ia.Transppass para o Dashboard (vale por uma hora)' })
  today(): Promise<IaReading> {
    return this.readings.today();
  }

  @Get('readings/:kind/:key')
  reading(@Param(new ZodValidationPipe(iaReadingParamsSchema)) p: IaReadingParams): Promise<IaReading> {
    return this.readings.get(p.kind, p.key);
  }

  @Post('readings/:kind/:key')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.PCM, UserRole.GESTAO)
  @ApiOperation({ summary: 'Redige agora a leitura do mês pelo modelo' })
  generate(@Param(new ZodValidationPipe(iaReadingParamsSchema)) p: IaReadingParams): Promise<IaReading> {
    return this.readings.generate(p.kind, p.key);
  }

  @Delete('readings/:kind/:key')
  @HttpCode(204)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.PCM, UserRole.GESTAO)
  dropReading(@Param(new ZodValidationPipe(iaReadingParamsSchema)) p: IaReadingParams): Promise<void> {
    return this.readings.remove(p.kind, p.key);
  }
}
