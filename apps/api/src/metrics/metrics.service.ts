import { Injectable } from '@nestjs/common';
import { InspectionResult, OdometerStatus, WorkOrderStatus } from '@prisma/client';
import {
  FieldOutcome,
  type DowntimeByCause,
  type MetricsQuery,
  type MkbfResult,
  type R1Metrics,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Indicadores do R1 (RF-38/RF-39).
 *
 * O critério de saída do R1 no PRD é "MKBF publicado automaticamente". Nada
 * aqui é digitado: tudo sai dos estados que o processo já produziu. Se o número
 * parecer errado, o lugar de olhar é o processo, não uma planilha paralela.
 */
@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async r1(query: MetricsQuery): Promise<R1Metrics> {
    const { from, to } = resolvePeriod(query);

    const [mkbf, downtime, triage, field, rework, released] = await Promise.all([
      this.mkbf(from, to),
      this.downtimeByCause(from, to),
      this.triageSla(from, to),
      this.fieldResolution(from, to),
      this.internalRework(from, to),
      this.releasedWorkOrders(from, to),
    ]);

    return {
      mkbf,
      downtimeByCause: downtime.byCause,
      totalDowntimeMinutes: downtime.total,
      triageSla: triage,
      fieldResolution: field,
      internalRework: rework,
      workOrdersReleased: released.count,
      averageDowntimeMinutes: released.averageMinutes,
    };
  }

  /**
   * MKBF = km rodados ÷ retornos não programados.
   *
   * O numerador vem dos deltas de odômetro já validados — leitura recusada não
   * entra, senão um erro de digitação inflaria o indicador. O denominador conta
   * os eventos que de fato tiraram o carro da rua: o que foi deferido ou
   * cancelado na triagem tem isUnscheduledReturn falso e não conta.
   */
  async mkbf(from: Date, to: Date): Promise<MkbfResult> {
    const readings = await this.prisma.odometerReading.aggregate({
      where: {
        readAt: { gte: from, lte: to },
        status: { not: OdometerStatus.REJECTED },
        deltaKm: { gt: 0 },
      },
      _sum: { deltaKm: true },
    });

    const unscheduledReturns = await this.prisma.failureEvent.count({
      where: { reportedAt: { gte: from, lte: to }, isUnscheduledReturn: true },
    });

    const kmTraveled = readings._sum.deltaKm ?? 0;

    return {
      kmTraveled,
      unscheduledReturns,
      // Sem retorno no período a divisão não tem significado — devolver zero ou
      // um número enorme daria a impressão errada de desempenho.
      mkbf: unscheduledReturns > 0 ? Math.round(kmTraveled / unscheduledReturns) : null,
      periodStart: from.toISOString(),
      periodEnd: to.toISOString(),
    };
  }

  /** RF-39 — decomposição do relógio: onde o carro parado realmente ficou. */
  private async downtimeByCause(
    from: Date,
    to: Date,
  ): Promise<{ byCause: DowntimeByCause[]; total: number }> {
    const segments = await this.prisma.downtimeSegment.findMany({
      where: { startedAt: { gte: from, lte: to } },
      select: { cause: true, minutes: true, startedAt: true, endedAt: true },
    });

    const now = new Date();
    const byCause = new Map<string, number>();

    for (const s of segments) {
      const minutes = s.endedAt
        ? (s.minutes ?? 0)
        : Math.max(0, Math.round((now.getTime() - s.startedAt.getTime()) / 60_000));
      byCause.set(s.cause, (byCause.get(s.cause) ?? 0) + minutes);
    }

    const total = [...byCause.values()].reduce((a, b) => a + b, 0);

    return {
      total,
      byCause: [...byCause.entries()]
        .map(([cause, minutes]) => ({
          cause: cause as DowntimeByCause['cause'],
          minutes,
          share: total ? minutes / total : 0,
        }))
        .sort((a, b) => b.minutes - a.minutes),
    };
  }

  /**
   * SLA de triagem. O PRD registra os valores-alvo como questão aberta
   * (seção 12), então aqui só se mede — mediana e p90, que descrevem melhor
   * uma distribuição com cauda longa do que a média.
   */
  private async triageSla(from: Date, to: Date) {
    const rows = await this.prisma.triage.findMany({
      where: { decidedAt: { gte: from, lte: to } },
      select: { slaSeconds: true },
      orderBy: { slaSeconds: 'asc' },
    });

    const values = rows.map((r) => r.slaSeconds);
    return {
      count: values.length,
      medianSeconds: percentile(values, 0.5),
      p90Seconds: percentile(values, 0.9),
    };
  }

  private async fieldResolution(from: Date, to: Date) {
    const rows = await this.prisma.fieldService.findMany({
      where: { dispatchedAt: { gte: from, lte: to }, outcome: { not: null } },
      select: { outcome: true },
    });

    const total = rows.length;
    const resolvedInField = rows.filter(
      (r) => r.outcome === FieldOutcome.RESOLVED_IN_FIELD,
    ).length;

    return { total, resolvedInField, rate: total ? resolvedInField / total : null };
  }

  /** Retrabalho interno: reprovações de inspeção sobre o total inspecionado. */
  private async internalRework(from: Date, to: Date) {
    const rows = await this.prisma.inspection.findMany({
      where: { inspectedAt: { gte: from, lte: to } },
      select: { result: true },
    });

    const inspections = rows.length;
    const rejections = rows.filter((r) => r.result === InspectionResult.REJECTED).length;

    return { inspections, rejections, rate: inspections ? rejections / inspections : null };
  }

  private async releasedWorkOrders(from: Date, to: Date) {
    const rows = await this.prisma.workOrder.findMany({
      where: {
        status: WorkOrderStatus.RELEASED,
        releasedAt: { gte: from, lte: to },
      },
      select: { downtimeMinutes: true },
    });

    const minutes = rows.map((r) => r.downtimeMinutes ?? 0);
    return {
      count: rows.length,
      averageMinutes: minutes.length
        ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length)
        : null,
    };
  }
}

/** Sem período informado, o mês corrente — a cadência do indicador é mensal. */
function resolvePeriod(query: MetricsQuery): { from: Date; to: Date } {
  const now = new Date();
  return {
    from: query.from ?? new Date(now.getFullYear(), now.getMonth(), 1),
    to: query.to ?? now,
  };
}

function percentile(sortedValues: number[], p: number): number | null {
  if (sortedValues.length === 0) return null;
  const index = Math.min(sortedValues.length - 1, Math.floor(p * sortedValues.length));
  return sortedValues[index] ?? null;
}
