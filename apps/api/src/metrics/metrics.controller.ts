import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  BOARD_INDICATORS,
  indicatorTargetSchema,
  metricsBoardDayQuerySchema,
  metricsBoardQuerySchema,
  metricsHistoryQuerySchema,
  metricsQuerySchema,
  UserRole,
  type BoardDayDetail,
  type BoardIndicator,
  type DailyBoard,
  type IndicatorTarget,
  type IndicatorTargetInput,
  type MetricHistoryPoint,
  type MetricsBoard,
  type MetricsBoardDayQuery,
  type MetricsBoardQuery,
  type MetricsHistoryQuery,
  type MetricsQuery,
  type R1Metrics,
} from '@app/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MetricsService } from './metrics.service';
import { BoardService } from './board.service';

@ApiTags('indicadores')
@ApiBearerAuth()
@Controller('metrics')
@UseGuards(RolesGuard)
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly board: BoardService,
  ) {}

  /** Criterio de saida do R1: MKBF publicado automaticamente. */
  @Get()
  r1(@Query(new ZodValidationPipe(metricsQuerySchema)) query: MetricsQuery): Promise<R1Metrics> {
    return this.metrics.r1(query);
  }

  /** Série mensal dos snapshots (E8). */
  /** Quadro da Daily de 15 min (A3 do Kaizen, §9). */
  @Get('daily')
  daily(): Promise<DailyBoard> {
    return this.metrics.daily();
  }

  /** Quadro de acompanhamento diário do mês (o quadro branco da garagem), com totais, mês anterior, 12 meses, consumo e metas. */
  @Get('board')
  boardMonth(@Query(new ZodValidationPipe(metricsBoardQuerySchema)) query: MetricsBoardQuery): Promise<MetricsBoard> {
    return this.board.board(query.month);
  }

  /** Um dia do quadro: as quebras, as linhas com viagem perdida e a frota coberta. */
  @Get('board/day')
  boardDay(@Query(new ZodValidationPipe(metricsBoardDayQuerySchema)) query: MetricsBoardDayQuery): Promise<BoardDayDetail> {
    return this.board.day(query.date);
  }

  /** Meta e responsável de um indicador do quadro. */
  @Put('targets/:key')
  @Roles(UserRole.ADMIN, UserRole.PCM, UserRole.GESTAO)
  setTarget(@Param('key') key: string, @Body(new ZodValidationPipe(indicatorTargetSchema)) body: IndicatorTargetInput, @CurrentUser('sub') userId: string): Promise<IndicatorTarget> {
    if (!(key in BOARD_INDICATORS)) throw new BadRequestException('Indicador desconhecido');
    return this.board.setTarget(key as BoardIndicator, body, userId);
  }

  @Get('history')
  history(@Query(new ZodValidationPipe(metricsHistoryQuerySchema)) query: MetricsHistoryQuery): Promise<MetricHistoryPoint[]> {
    return this.metrics.history(query);
  }

  /** Recalcula o snapshot do mês corrente agora (o agendador faz isso toda madrugada). */
  @Post('snapshot')
  @Roles(UserRole.ADMIN, UserRole.PCM)
  @HttpCode(204)
  async snapshot(): Promise<void> {
    const now = new Date();
    await this.metrics.snapshotMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  }
}
