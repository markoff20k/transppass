import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  odometerBatchSchema,
  odometerQuerySchema,
  UserRole,
  type KmProjection,
  type OdometerBatchInput,
  type OdometerBatchResult,
  type OdometerQuery,
  type OdometerReading,
  type Paginated,
} from '@app/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OdometerService } from './odometer.service';

@ApiTags('quilometragem')
@ApiBearerAuth()
@Controller('odometer')
@UseGuards(RolesGuard)
export class OdometerController {
  constructor(private readonly odometer: OdometerService) {}

  /** RF-14 — lançamento diário de km diesel, em lote, com validação na origem. */
  @Post('batch')
  @Roles(UserRole.ADMIN, UserRole.PCM, UserRole.CCO, UserRole.MANUTENCAO)
  registerBatch(
    @Body(new ZodValidationPipe(odometerBatchSchema)) body: OdometerBatchInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<OdometerBatchResult> {
    return this.odometer.registerBatch(body, actorId);
  }

  @Get('readings')
  list(
    @Query(new ZodValidationPipe(odometerQuerySchema)) query: OdometerQuery,
  ): Promise<Paginated<OdometerReading>> {
    return this.odometer.list(query);
  }

  @Get('projection/:vehicleId')
  projection(@Param('vehicleId', ParseUUIDPipe) vehicleId: string): Promise<KmProjection> {
    return this.odometer.refreshProjection(vehicleId);
  }

  /**
   * Varredura da frota inteira. Fica exposta para o R0 poder ser operado à mão
   * e para servir de gatilho ao agendador quando a infra de hospedagem estiver
   * definida (questão aberta do PRD, seção 12).
   */
  @Post('projections/refresh')
  @Roles(UserRole.ADMIN, UserRole.PCM)
  refreshAll(): Promise<{ updated: number; degraded: number }> {
    return this.odometer.refreshAllProjections();
  }
}
