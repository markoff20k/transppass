import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { DowntimeService } from './downtime.service';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  providers: [AuditService, DowntimeService, NotificationsService],
  exports: [AuditService, DowntimeService, NotificationsService],
})
export class CommonModule {}
