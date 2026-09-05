import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createVehicleSchema,
  updateVehicleSchema,
  UserRole,
  vehicleQuerySchema,
  type CreateVehicleInput,
  type FleetPanelRow,
  type FleetPanelSummary,
  type Paginated,
  type UpdateVehicleInput,
  type Vehicle,
  type VehicleQuery,
} from '@app/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { VehiclesService } from './vehicles.service';

@ApiTags('frota')
@ApiBearerAuth()
@Controller('vehicles')
@UseGuards(RolesGuard)
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  /** RF-37 — painel da frota com estados ao vivo e KPIs no topo. */
  @Get('panel')
  panel(
    @Query(new ZodValidationPipe(vehicleQuerySchema)) query: VehicleQuery,
  ): Promise<{ summary: FleetPanelSummary; rows: FleetPanelRow[] }> {
    return this.vehicles.fleetPanel(query);
  }

  @Get()
  list(
    @Query(new ZodValidationPipe(vehicleQuerySchema)) query: VehicleQuery,
  ): Promise<Paginated<Vehicle>> {
    return this.vehicles.list(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Vehicle> {
    return this.vehicles.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.PCM)
  create(
    @Body(new ZodValidationPipe(createVehicleSchema)) body: CreateVehicleInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<Vehicle> {
    return this.vehicles.create(body, actorId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.PCM)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateVehicleSchema)) body: UpdateVehicleInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<Vehicle> {
    return this.vehicles.update(id, body, actorId);
  }
}
