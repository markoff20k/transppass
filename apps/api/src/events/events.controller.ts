import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createEventSchema,
  dispatchFieldServiceSchema,
  eventQuerySchema,
  fieldOutcomeSchema,
  fieldStepSchema,
  triageSchema,
  UserRole,
  type CreateEventInput,
  type DispatchFieldServiceInput,
  type EventQuery,
  type FailureEventSummary,
  type FieldOutcomeInput,
  type FieldStepInput,
  type Paginated,
  type TriageInput,
} from '@app/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { EventsService } from './events.service';

@ApiTags('eventos')
@ApiBearerAuth()
@Controller('events')
@UseGuards(RolesGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(eventQuerySchema)) query: EventQuery,
  ): Promise<Paginated<FailureEventSummary>> {
    return this.events.list(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<FailureEventSummary> {
    return this.events.findOne(id);
  }

  /** RF-01 — o CCO registra em segundos, com o catálogo ajudando. */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.CCO, UserRole.PCM, UserRole.MANUTENCAO, UserRole.INSPETOR, UserRole.LIMPEZA)
  create(
    @Body(new ZodValidationPipe(createEventSchema)) body: CreateEventInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<FailureEventSummary> {
    return this.events.create(body, actorId);
  }

  /** RF-03 — a triagem é do PCM: é ele quem gere os eventos. */
  @Post(':id/triage')
  @Roles(UserRole.ADMIN, UserRole.PCM)
  triage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(triageSchema)) body: TriageInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<FailureEventSummary> {
    return this.events.triage(id, body, actorId);
  }

  // --- Socorro em campo (RF-04) ---------------------------------------------

  @Post(':id/field/dispatch')
  @Roles(UserRole.ADMIN, UserRole.PCM, UserRole.CCO, UserRole.SOCORRO)
  dispatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(dispatchFieldServiceSchema)) body: DispatchFieldServiceInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<FailureEventSummary> {
    return this.events.dispatch(id, body, actorId);
  }

  @Post(':id/field/step')
  @Roles(UserRole.ADMIN, UserRole.SOCORRO, UserRole.PCM)
  step(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(fieldStepSchema)) body: FieldStepInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<FailureEventSummary> {
    return this.events.fieldStep(id, body, actorId);
  }

  @Post(':id/field/outcome')
  @Roles(UserRole.ADMIN, UserRole.SOCORRO, UserRole.PCM)
  outcome(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(fieldOutcomeSchema)) body: FieldOutcomeInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<FailureEventSummary> {
    return this.events.fieldOutcome(id, body, actorId);
  }
}
