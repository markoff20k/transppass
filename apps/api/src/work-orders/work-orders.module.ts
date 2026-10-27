import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { MaterialsModule } from '../materials/materials.module';
import { WorkOrdersController } from './work-orders.controller';
import { WorkOrdersService } from './work-orders.service';

@Module({
  imports: [QueueModule, MaterialsModule],
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService],
  exports: [WorkOrdersService],
})
export class WorkOrdersModule {}
