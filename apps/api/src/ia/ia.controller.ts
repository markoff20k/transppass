import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import {
  iaConversationCreateSchema,
  iaMessageInputSchema,
  iaReadingParamsSchema,
  type IaConversation,
  type IaConversationCreateInput,
  type IaConversationDetail,
  type IaMessageInput,
  type IaReading,
  type IaStatus,
  type IaStreamEvent,
} from '@app/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { IaService } from './ia.service';
import { IaReadingsService } from './ia-readings.service';

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

  // --- Fase 2: leituras do mês ---------------------------------------------------

  @Get('readings/:kind/:key')
  reading(@Param(new ZodValidationPipe(iaReadingParamsSchema)) p: { kind: 'month'; key: string }): Promise<IaReading> {
    return this.readings.get(p.kind, p.key);
  }

  @Post('readings/:kind/:key')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.PCM, UserRole.GESTAO)
  @ApiOperation({ summary: 'Redige agora a leitura do mês pelo modelo' })
  generate(@Param(new ZodValidationPipe(iaReadingParamsSchema)) p: { kind: 'month'; key: string }): Promise<IaReading> {
    return this.readings.generate(p.kind, p.key);
  }

  @Delete('readings/:kind/:key')
  @HttpCode(204)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.PCM, UserRole.GESTAO)
  dropReading(@Param(new ZodValidationPipe(iaReadingParamsSchema)) p: { kind: 'month'; key: string }): Promise<void> {
    return this.readings.remove(p.kind, p.key);
  }
}
