import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createScheduleSchema,
  rescheduleSchema,
  reserveTeamSchema,
  scheduleQuerySchema,
  UserRole,
  type BacklogItemRow,
  type CreateScheduleInput,
  type KitSeparationRow,
  type KmTimelineRow,
  type PlanPackageRow,
  type RescheduleInput,
  type ReserveTeamInput,
  type ScheduleDetail,
  type ScheduleQuery,
  type ScheduleSummary,
} from '@app/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SchedulingService } from './scheduling.service';

@ApiTags('preventiva')
@ApiBearerAuth()
@Controller('scheduling')
@UseGuards(RolesGuard)
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  /** RF-10 — linha do tempo por km projetado, com antecipação por desvio. */
  @Get('timeline')
  timeline(): Promise<KmTimelineRow[]> {
    return this.scheduling.timeline();
  }

  @Get('packages')
  packages(): Promise<PlanPackageRow[]> {
    return this.scheduling.packages();
  }

  @Get('backlog/:vehicleId')
  backlog(@Param('vehicleId', ParseUUIDPipe) vehicleId: string): Promise<BacklogItemRow[]> {
    return this.scheduling.backlog(vehicleId);
  }

  /** RF-25 — fila de kits do Estoque, com o D-1 calculado. */
  @Get('kits')
  kits(): Promise<KitSeparationRow[]> {
    return this.scheduling.kits();
  }

  @Get()
  list(@Query(new ZodValidationPipe(scheduleQuerySchema)) query: ScheduleQuery): Promise<ScheduleSummary[]> {
    return this.scheduling.list(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ScheduleDetail> {
    return this.scheduling.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.PCM)
  create(
    @Body(new ZodValidationPipe(createScheduleSchema)) body: CreateScheduleInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<ScheduleDetail> {
    return this.scheduling.create(body, actorId);
  }

  @Post(':id/reschedule')
  @Roles(UserRole.ADMIN, UserRole.PCM)
  reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(rescheduleSchema)) body: RescheduleInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<ScheduleDetail> {
    return this.scheduling.reschedule(id, body, actorId);
  }

  @Post(':id/kit/separate')
  @Roles(UserRole.ADMIN, UserRole.ESTOQUE)
  separateKit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('sub') actorId: string): Promise<ScheduleDetail> {
    return this.scheduling.separateKit(id, actorId);
  }

  @Post(':id/team')
  @Roles(UserRole.ADMIN, UserRole.MANUTENCAO)
  reserveTeam(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reserveTeamSchema)) body: ReserveTeamInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<ScheduleDetail> {
    return this.scheduling.reserveTeam(id, body, actorId);
  }

  /** RN-10 — só sai da escala com kit e equipe confirmados. */
  @Post(':id/confirm')
  @Roles(UserRole.ADMIN, UserRole.PCM)
  confirm(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('sub') actorId: string): Promise<ScheduleDetail> {
    return this.scheduling.confirm(id, actorId);
  }

  /** Entrada na garagem: abre a OS-mãe preventiva. */
  @Post(':id/start')
  @Roles(UserRole.ADMIN, UserRole.PCM, UserRole.MANUTENCAO)
  start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('sub') actorId: string): Promise<ScheduleDetail> {
    return this.scheduling.start(id, actorId);
  }
}
