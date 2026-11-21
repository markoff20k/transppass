import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { EventsModule } from '../events/events.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { NoticesService } from './notices.service';

@Module({
  imports: [MetricsModule, EventsModule],
  controllers: [DashboardController],
  providers: [DashboardService, NoticesService],
})
export class DashboardModule {}
