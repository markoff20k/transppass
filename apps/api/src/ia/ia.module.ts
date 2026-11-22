import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsModule } from '../metrics/metrics.module';
import { ConsumptionModule } from '../consumption/consumption.module';
import { QueueModule } from '../queue/queue.module';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import { EventsModule } from '../events/events.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { IaController } from './ia.controller';
import { IaService } from './ia.service';
import { IaToolsService } from './ia-tools.service';
import { IaReadingsService } from './ia-readings.service';
import { IA_PROVIDER, type IaProvider } from './ia-provider';
import { AnthropicProvider } from './anthropic.provider';
import { FakeProvider } from './fake.provider';

/**
 * ia.Transppass — o agente de PCM. O provedor vem do ambiente: com
 * ANTHROPIC_API_KEY (ou IA_PROVIDER=anthropic) fala com a Anthropic;
 * IA_PROVIDER=fake liga o simulado (desenvolvimento e QA, sem chave);
 * sem nenhum dos dois o agente fica desligado e a API diz isso no status.
 */
@Module({
  imports: [MetricsModule, ConsumptionModule, QueueModule, WorkOrdersModule, EventsModule, VehiclesModule, SchedulingModule],
  controllers: [IaController],
  providers: [
    IaToolsService,
    IaService,
    IaReadingsService,
    {
      provide: IA_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): IaProvider | null => {
        const log = new Logger('ia.Transppass');
        const key = config.get<string>('ANTHROPIC_API_KEY');
        const model = config.get<string>('IA_MODEL') ?? 'claude-opus-5-5';
        const mode = config.get<string>('IA_PROVIDER') ?? (key ? 'anthropic' : 'off');
        if (mode === 'fake') {
          log.warn('provedor SIMULADO ligado (IA_PROVIDER=fake): respostas de mentira, só para desenvolvimento');
          return new FakeProvider();
        }
        if (mode === 'anthropic') {
          if (!key) {
            log.error('IA_PROVIDER=anthropic sem ANTHROPIC_API_KEY: agente desligado');
            return null;
          }
          log.log(`ligada com a Anthropic (${model})`);
          return new AnthropicProvider(key, model);
        }
        log.log('desligada (sem ANTHROPIC_API_KEY)');
        return null;
      },
    },
  ],
  exports: [IaService],
})
export class IaModule {}
