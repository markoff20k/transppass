import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { MaterialsModule } from '../materials/materials.module';
import { WorkOrdersController } from './work-orders.controller';
import { WorkOrdersService } from './work-orders.service';
import { MaintenanceHistoryService } from './maintenance-history.service';

@Module({
  imports: [QueueModule, MaterialsModule],
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService, MaintenanceHistoryService],
  exports: [WorkOrdersService, MaintenanceHistoryService],
})
export class WorkOrdersModule {}
