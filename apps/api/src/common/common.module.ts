import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { DowntimeService } from './downtime.service';
import { NotificationsService } from './notifications.service';
import { MailService } from './mail.service';

@Global()
@Module({
  providers: [AuditService, DowntimeService, NotificationsService, MailService],
  exports: [AuditService, DowntimeService, NotificationsService, MailService],
})
export class CommonModule {}
