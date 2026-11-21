import { Module } from '@nestjs/common';

import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { BoardService } from './board.service';
import { ConsumptionModule } from '../consumption/consumption.module';

@Module({
  imports: [ConsumptionModule],
  controllers: [MetricsController],
  providers: [MetricsService, BoardService],
  exports: [MetricsService, BoardService],
})
export class MetricsModule {}
