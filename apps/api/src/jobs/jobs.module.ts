import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OdometerModule } from '../odometer/odometer.module';
import { MaterialsModule } from '../materials/materials.module';
import { OperationsModule } from '../operations/operations.module';
import { MetricsModule } from '../metrics/metrics.module';
import { JobsService } from './jobs.service';

/**
 * Agendador interno. O PRD deixava a infraestrutura em aberto (seção 12) e
 * por isso tudo era endpoint; com a hospedagem definida, as rotinas rodam
 * sozinhas aqui — os endpoints continuam existindo para disparo manual.
 */
@Module({
  imports: [ScheduleModule.forRoot(), OdometerModule, MaterialsModule, OperationsModule, MetricsModule],
  providers: [JobsService],
})
export class JobsModule {}
