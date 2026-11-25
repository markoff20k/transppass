import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  consumptionQuerySchema,
  consumptionVehicleQuerySchema,
  type ConsumptionFleet,
  type ConsumptionQuery,
  type ConsumptionVehicleDetail,
  type ConsumptionVehicleQuery,
} from '@app/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ConsumptionService } from './consumption.service';

@ApiTags('consumo')
@ApiBearerAuth()
@Controller('consumption')
@UseGuards(RolesGuard)
export class ConsumptionController {
  constructor(private readonly consumption: ConsumptionService) {}

  /** Frota: diesel (km/l) ou energia (kWh/km) no período, com a comparação carro a carro. */
  @Get()
  fleet(@Query(new ZodValidationPipe(consumptionQuerySchema)) query: ConsumptionQuery): Promise<ConsumptionFleet> {
    return this.consumption.fleet(query);
  }

  /** Um carro: rendimento no período, contra o grupo dele e contra o próprio histórico. */
  @Get('vehicles/:id')
  vehicle(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(consumptionVehicleQuerySchema)) query: ConsumptionVehicleQuery,
  ): Promise<ConsumptionVehicleDetail> {
    return this.consumption.vehicle(id, query);
  }
}
