import { Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { metricsHistoryQuerySchema, metricsQuerySchema, UserRole, type DailyBoard, type MetricHistoryPoint, type MetricsHistoryQuery, type MetricsQuery, type R1Metrics } from '@app/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MetricsService } from './metrics.service';

@ApiTags('indicadores')
@ApiBearerAuth()
@Controller('metrics')
@UseGuards(RolesGuard)
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

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
