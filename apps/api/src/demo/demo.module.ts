import { Module } from '@nestjs/common';
import { OdometerModule } from '../odometer/odometer.module';
import { EventsModule } from '../events/events.module';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import { MaterialsModule } from '../materials/materials.module';
import { OperationsModule } from '../operations/operations.module';
import { DemoSimulatorService } from './demo-simulator.service';
import { DemoController } from './demo.controller';

/**
 * Simulador de demonstração (DEMO_SIMULATOR=true). Usa os mesmos serviços de
 * negócio que as telas usam — nada entra no banco por fora do processo.
 */
@Module({
  imports: [OdometerModule, EventsModule, WorkOrdersModule, MaterialsModule, OperationsModule],
  controllers: [DemoController],
  providers: [DemoSimulatorService],
})
export class DemoModule {}
