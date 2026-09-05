import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { metricsQuerySchema, type MetricsQuery, type R1Metrics } from '@app/shared';
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
}
