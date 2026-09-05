import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  queueQuerySchema,
  reorderQueueSchema,
  UserRole,
  type QueueChangeRow,
  type QueueEntryRow,
  type QueueQuery,
  type ReorderQueueInput,
} from '@app/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { QueueService } from './queue.service';

@ApiTags('fila')
@ApiBearerAuth()
@Controller('queue')
@UseGuards(RolesGuard)
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(queueQuerySchema)) query: QueueQuery,
  ): Promise<QueueEntryRow[]> {
    return this.queue.list(query);
  }

  /** RF-08 — a fila so muda por aqui, e so com codigo de motivo. */
  @Post('reorder')
  @Roles(UserRole.ADMIN, UserRole.PCM)
  reorder(
    @Body(new ZodValidationPipe(reorderQueueSchema)) body: ReorderQueueInput,
    @CurrentUser('sub') actorId: string,
  ): Promise<QueueEntryRow[]> {
    return this.queue.reorder(body, actorId);
  }

  /** Trilha imutavel de uma posicao: e o que permite auditar e aprender. */
  @Get(':id/history')
  history(@Param('id', ParseUUIDPipe) id: string): Promise<QueueChangeRow[]> {
    return this.queue.history(id);
  }
}
