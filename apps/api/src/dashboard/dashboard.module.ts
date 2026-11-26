import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { EventsModule } from '../events/events.module';
import { ConsumptionModule } from '../consumption/consumption.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { NoticesService } from './notices.service';
import { WidgetsService } from './widgets.service';

@Module({
  imports: [MetricsModule, EventsModule, ConsumptionModule],
  controllers: [DashboardController],
  providers: [DashboardService, NoticesService, WidgetsService],
  // A frase do dia da ia.Transppass lê a mesma foto da garagem que o Dashboard mostra.
  exports: [DashboardService],
})
export class DashboardModule {}
