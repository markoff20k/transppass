import { Module } from '@nestjs/common';

import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { BoardService } from './board.service';
import { AvailabilityService } from './availability.service';
import { ConsumptionModule } from '../consumption/consumption.module';

@Module({
  imports: [ConsumptionModule],
  controllers: [MetricsController],
  providers: [MetricsService, BoardService, AvailabilityService],
  exports: [MetricsService, BoardService, AvailabilityService],
})
export class MetricsModule {}
