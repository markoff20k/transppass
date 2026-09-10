import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  assignReserveSchema,
  createDemandSchema,
  demandQuerySchema,
  UserRole,
  type AssignReserveInput,
  type CreateDemandInput,
  type DemandQuery,
  type DemandRow,
  type ExpectedReturnRow,
  type OperatorCandidate,
  type OperatorRow,
  type ReserveCandidate,
} from '@app/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OperationsService } from './operations.service';

const PLANTAO = [UserRole.ADMIN, UserRole.PLANTAO, UserRole.CCO, UserRole.PCM] as const;

@ApiTags('plantão')
@ApiBearerAuth()
@Controller('operations')
@UseGuards(RolesGuard)
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('demands')
  list(@Query(new ZodValidationPipe(demandQuerySchema)) query: DemandQuery): Promise<DemandRow[]> {
    return this.operations.listDemands(query);
  }

  @Get('demands/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<DemandRow> {
    return this.operations.findDemand(id);
  }

  /** RF-29 — demanda com janela em contagem. */
  @Post('demands')
  @Roles(...PLANTAO)
  create(
    @Body(new ZodValidationPipe(createDemandSchema)) body: CreateDemandInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<DemandRow> {
    return this.operations.createDemand(body, actorId);
  }

  /** RF-30 — reserva filtrada pela habilitação. */
  @Post('demands/:id/assign')
  @Roles(...PLANTAO)
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(assignReserveSchema)) body: AssignReserveInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<DemandRow> {
    return this.operations.assignReserve(id, body, actorId);
  }

  /** RF-31 — devolução do titular recolhe a reserva. */
  @Post('demands/:id/return')
  @Roles(...PLANTAO)
  returnReserve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('sub') actorId: string): Promise<DemandRow> {
    return this.operations.returnReserve(id, actorId);
  }

  @Post('demands/:id/cancel')
  @Roles(...PLANTAO)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('sub') actorId: string): Promise<DemandRow> {
    return this.operations.cancelDemand(id, actorId);
  }

  @Post('demands/expire')
  @Roles(UserRole.ADMIN, UserRole.PLANTAO, UserRole.PCM)
  expire(): Promise<{ missed: number }> {
    return this.operations.expireWindows();
  }

  @Get('reserves')
  reserves(): Promise<ReserveCandidate[]> {
    return this.operations.reserveCandidates();
  }

  @Get('operators')
  operators(): Promise<OperatorRow[]> {
    return this.operations.operators();
  }

  @Get('operators/for-vehicle/:vehicleId')
  operatorsFor(@Param('vehicleId', ParseUUIDPipe) vehicleId: string): Promise<OperatorCandidate[]> {
    return this.operations.operatorCandidates(vehicleId);
  }

  /** RF-31 — retornos previstos ao vivo das OS. */
  @Get('returns')
  returns(): Promise<ExpectedReturnRow[]> {
    return this.operations.expectedReturns();
  }
}
