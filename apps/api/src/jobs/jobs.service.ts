import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OdometerService } from '../odometer/odometer.service';
import { MaterialsService } from '../materials/materials.service';
import { OperationsService } from '../operations/operations.service';
import { MetricsService } from '../metrics/metrics.service';

/**
 * As rotinas que o processo precisa sem ninguém apertar botão:
 *
 *  - a cada 5 min   janelas de reposição vencidas viram "estourada" (RF-29)
 *  - a cada hora    projeção de km recalculada e degradação marcada (RF-10/RF-14),
 *                   peças com prazo vencido escalonadas (RF-24)
 *  - todo dia 02:10 snapshot dos indicadores do mês corrente e do anterior (E8)
 *
 * Cada rotina é independente e engole o próprio erro: uma falha não derruba
 * as outras nem a API.
 */
@Injectable()
export class JobsService {
  private readonly log = new Logger('Jobs');

  constructor(
    private readonly odometer: OdometerService,
    private readonly materials: MaterialsService,
    private readonly operations: OperationsService,
    private readonly metrics: MetricsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'expire-replacement-windows' })
  async expireWindows() {
    await this.run('janelas de reposição', async () => {
      const r = await this.operations.expireWindows();
      return r.missed ? `${r.missed} estourada(s)` : null;
    });
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'refresh-km-projections' })
  async refreshProjections() {
    await this.run('projeção de km', async () => {
      const r = await this.odometer.refreshAllProjections();
      return `${r.updated} atualizada(s), ${r.degraded} degradada(s)`;
    });
  }

  @Cron('30 * * * *', { name: 'escalate-overdue-parts' })
  async escalateParts() {
    await this.run('peças com prazo vencido', async () => {
      const r = await this.materials.escalateOverdue();
      return r.escalated ? `${r.escalated} escalonada(s)` : null;
    });
  }

  @Cron('10 2 * * *', { name: 'metric-snapshots' })
  async snapshots() {
    await this.run('snapshot de indicadores', async () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      await this.metrics.snapshotMonth(lastMonth);
      await this.metrics.snapshotMonth(thisMonth);
      return 'mês anterior e corrente';
    });
  }

  private async run(name: string, fn: () => Promise<string | null>) {
    try {
      const detail = await fn();
      if (detail) this.log.log(`${name}: ${detail}`);
    } catch (err) {
      this.log.error(`${name} falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
