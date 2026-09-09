import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { UserRole } from '@app/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { NotificationsService } from '../common/notifications.service';

const inboxQuerySchema = z.object({ onlyUnread: z.coerce.boolean().default(true) });

/** RN-16 — a caixa de cada usuario: o que e dele mais o que e do perfil dele. */
@ApiTags('notificacoes')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  inbox(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') role: UserRole,
    @Query(new ZodValidationPipe(inboxQuerySchema)) query: z.infer<typeof inboxQuerySchema>,
  ) {
    return this.notifications.inbox(userId, role, query.onlyUnread);
  }

  @Post(':id/read')
  markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('sub') userId: string) {
    return this.notifications.markRead(id, userId);
  }
}
