import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CleaningStatus,
  InspectionResult,
  OdometerStatus,
  ScheduleStatus,
  TaskStatus,
  WorkOrderStatus,
} from '@prisma/client';
import {
  FieldOutcome,
  MetricKey,
  type DowntimeByCause,
  type MetricHistoryPoint,
  type MetricsHistoryQuery,
  type MetricsQuery,
  type MkbfResult,
  type CodeAlignment,
  type ProcessAdherence,
  AVAILABLE_STATUSES,
  describeFailureCode,
  type DailyBoard,
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

    const [mkbf, downtime, triage, field, rework, released, adherence, codeAlignment] = await Promise.all([
      this.mkbf(from, to),
      this.downtimeByCause(from, to),
      this.triageSla(from, to),
      this.fieldResolution(from, to),
      this.internalRework(from, to),
      this.releasedWorkOrders(from, to),
      this.adherence(from, to),
      this.codeAlignment(from, to),
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
      adherence,
      codeAlignment,
    };
  }

  /** Quadro da Daily (A3 §9): ontem, 7 e 30 dias, e o que atacar hoje. */
  async daily(now = new Date()): Promise<DailyBoard> {
    const DAY = 86_400_000;
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startYesterday = new Date(startToday.getTime() - DAY);
    const d7 = new Date(now.getTime() - 7 * DAY);
    const d30 = new Date(now.getTime() - 30 * DAY);
    const d60 = new Date(now.getTime() - 60 * DAY);

    const [mkbf30, mkbf60, avail7, rework, fleet, byStatus, missedY, missed7, missed30, woOpen, woOverdue, woOpenedY, woReleasedY, waitingPart, inQueue, evY, ev7, checks, recent, repeats, stale, audits, kanban, lostY, lost7, lost30, components, recs30, tripAgg] = await Promise.all([
      this.mkbf(d30, now),
      this.mkbf(d60, d30),
      this.availability(d7, now),
      this.internalRework(d30, now),
      this.prisma.vehicle.count({ where: { isActive: true } }),
      this.prisma.vehicle.groupBy({ by: ['status'], where: { isActive: true }, _count: { _all: true } }),
      this.prisma.replacementDemand.count({ where: { status: 'MISSED', windowEndsAt: { gte: startYesterday, lt: startToday } } }),
      this.prisma.replacementDemand.count({ where: { status: 'MISSED', windowEndsAt: { gte: d7 } } }),
      this.prisma.replacementDemand.count({ where: { status: 'MISSED', windowEndsAt: { gte: d30 } } }),
      this.prisma.workOrder.count({ where: { status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] } } }),
      this.prisma.workOrder.count({ where: { status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] }, estimatedCompletionAt: { lt: now } } }),
      this.prisma.workOrder.count({ where: { openedAt: { gte: startYesterday, lt: startToday } } }),
      this.prisma.workOrder.count({ where: { releasedAt: { gte: startYesterday, lt: startToday } } }),
      this.prisma.workOrder.count({ where: { status: WorkOrderStatus.WAITING_PART } }),
      this.prisma.workOrder.count({ where: { status: WorkOrderStatus.OPEN } }),
      this.prisma.failureEvent.count({ where: { isUnscheduledReturn: true, reportedAt: { gte: startYesterday, lt: startToday } } }),
      this.prisma.failureEvent.count({ where: { isUnscheduledReturn: true, reportedAt: { gte: d7 } } }),
      this.prisma.dailyCheck.findMany({ where: { checkedAt: { gte: startToday } }, select: { vehicleId: true, result: true } }),
      this.prisma.failureEvent.findMany({ where: { isUnscheduledReturn: true, reportedAt: { gte: d7 } }, select: { failureModeCode: true, subsystemCode: true, catalogItem: { select: { code: true, description: true } } } }),
      this.prisma.failureEvent.groupBy({ by: ['vehicleId'], where: { isUnscheduledReturn: true, reportedAt: { gte: d30 } }, _count: { _all: true }, _max: { reportedAt: true }, orderBy: { _count: { vehicleId: 'desc' } }, take: 8 }),
      this.prisma.kmProjection.count({ where: { isDegraded: true } }),
      this.prisma.processAudit.findMany({ orderBy: { auditedAt: 'desc' }, select: { kind: true, area: true, nextDueAt: true } }),
      this.prisma.material.findMany({ where: { isActive: true, reorderPoint: { not: null } }, select: { stockQty: true, reorderPoint: true } }),
      this.prisma.failureEvent.aggregate({ where: { reportedAt: { gte: startYesterday, lt: startToday } }, _sum: { lostTrips: true } }),
      this.prisma.failureEvent.aggregate({ where: { reportedAt: { gte: d7 } }, _sum: { lostTrips: true } }),
      this.prisma.failureEvent.aggregate({ where: { reportedAt: { gte: d30 } }, _sum: { lostTrips: true } }),
      this.prisma.vehicleComponent.findMany({ where: { removedAt: null, vehicle: { isActive: true } }, select: { installedAtKm: true, expectedLifeKm: true, vehicle: { select: { currentKm: true } } } }),
      this.prisma.maintenanceRecord.findMany({ where: { openedAt: { gte: d30 } }, select: { foundCode: true, foundText: true, materials: { select: { totalCost: true } } } }),
      this.prisma.lineTripDay.aggregate({ where: { date: { gte: d30 } }, _sum: { planned: true, monitored: true, lost: true } }),
    ]);
    const foundTop = new Map<string, { code: string; label: string; count: number }>();
    for (const r of recs30) {
      if (!r.foundCode) continue;
      const cur = foundTop.get(r.foundCode) ?? { code: r.foundCode, label: r.foundText ?? r.foundCode, count: 0 };
      cur.count += 1;
      foundTop.set(r.foundCode, cur);
    }
    const maintenanceRecords = recs30.length
      ? { last30: recs30.length, partsCostLast30: Math.round(recs30.reduce((s, r) => s + r.materials.reduce((x, m) => x + Number(m.totalCost), 0), 0)), topFound: [...foundTop.values()].sort((a, b) => b.count - a.count).slice(0, 5) }
      : null;
    const trips = (tripAgg._sum.planned ?? 0) > 0 ? { planned30: tripAgg._sum.planned ?? 0, monitored30: tripAgg._sum.monitored ?? 0, lost30: tripAgg._sum.lost ?? 0 } : null;
    const componentsOverLife = components.filter((c) => c.vehicle.currentKm - c.installedAtKm >= c.expectedLifeKm).length;
    const kanbanBelow = kanban.filter((m) => Number(m.stockQty) <= (m.reorderPoint ?? 0)).length;
    const AUDIT_AREAS_N = 7;
    const latestAudit = new Map<string, Date>();
    for (const a of audits) if (!latestAudit.has(`${a.kind}:${a.area}`)) latestAudit.set(`${a.kind}:${a.area}`, a.nextDueAt);
    const auditsOverdue = 2 * AUDIT_AREAS_N - [...latestAudit.values()].filter((d) => d >= now).length;

    const available = byStatus.filter((s) => (AVAILABLE_STATUSES as readonly string[]).includes(s.status)).reduce((sum, s) => sum + s._count._all, 0);
    const top = new Map<string, { key: string; description: string; count: number }>();
    for (const e of recent) {
      const key = e.catalogItem?.code ?? (e.failureModeCode && e.subsystemCode ? `${e.failureModeCode}-${e.subsystemCode}` : 'outros');
      const description = e.catalogItem?.description ?? describeFailureCode(e.failureModeCode, e.subsystemCode) ?? 'Sem código';
      const cur = top.get(key) ?? { key, description, count: 0 };
      cur.count += 1;
      top.set(key, cur);
    }
    const repeatIds = repeats.filter((r) => r._count._all >= 2).map((r) => r.vehicleId);
    const repeatVehicles = repeatIds.length ? await this.prisma.vehicle.findMany({ where: { id: { in: repeatIds } }, select: { id: true, code: true } }) : [];
    const codeById = new Map(repeatVehicles.map((v) => [v.id, v.code]));
    const checkedVehicles = new Set(checks.map((c) => c.vehicleId));
    const nokVehicles = new Set(checks.filter((c) => c.result === 'NOK').map((c) => c.vehicleId));

    return {
      date: startToday.toISOString(),
      mkbf: { last30: mkbf30.mkbf, previous30: mkbf60.mkbf, kmLast30: mkbf30.kmTraveled, returnsLast30: mkbf30.unscheduledReturns },
      availability: { now: fleet ? available / fleet : 0, last7: avail7, target: 0.85 },
      rework: { rateLast30: rework.rate, inspectionsLast30: rework.inspections, rejectionsLast30: rework.rejections },
      // Viagens perdidas apuradas pelo CCO quando existem (base real); senão, o proxy das janelas estouradas.
      lostTrips: (lost30._sum.lostTrips ?? 0) > 0
        ? { yesterday: lostY._sum.lostTrips ?? 0, last7: lost7._sum.lostTrips ?? 0, last30: lost30._sum.lostTrips ?? 0, note: 'viagens perdidas apuradas pelo CCO (ocorrências com V_Perdida)' }
        : { yesterday: missedY, last7: missed7, last30: missed30, note: 'janelas de reposição estouradas (RF-29) — proxy até a Operação apurar viagens perdidas' },
      workOrders: { open: woOpen, overdue: woOverdue, openedYesterday: woOpenedY, releasedYesterday: woReleasedY, waitingPart, inQueue },
      events: { yesterday: evY, last7: ev7, avgPerDay7: Math.round((ev7 / 7) * 10) / 10 },
      dailyChecks: { fleet, checked: checkedVehicles.size, nok: nokVehicles.size },
      topFailures7d: [...top.values()].sort((a, b) => b.count - a.count).slice(0, 6),
      repeatVehicles30d: repeats
        .filter((r) => r._count._all >= 2)
        .map((r) => ({ vehicleId: r.vehicleId, vehicleCode: codeById.get(r.vehicleId) ?? '—', count: r._count._all, lastAt: (r._max.reportedAt ?? now).toISOString() })),
      staleOdometer: stale,
      auditsOverdue,
      kanbanBelow,
      componentsOverLife,
      maintenanceRecords,
      trips,
    };
  }

  /**
   * Seção 8.2 do padrão de codificação: o código decidido no registro se
   * sustenta frente ao que a manutenção constata? Compara, por evento com
   * código e constatação (sub-OS ou socorro), o Sistema (3 dígitos) e o
   * Subsistema completo.
   */
  private async codeAlignment(from: Date, to: Date): Promise<CodeAlignment> {
    const events = await this.prisma.failureEvent.findMany({
      where: { reportedAt: { gte: from, lte: to }, subsystemCode: { not: null } },
      select: {
        subsystemCode: true,
        fieldService: { select: { confirmedSubsystemCode: true } },
        workOrder: { select: { tasks: { where: { confirmedSubsystemCode: { not: null } }, select: { confirmedSubsystemCode: true }, take: 1 } } },
      },
    });
    let compared = 0;
    let systemMatch = 0;
    let fullMatch = 0;
    for (const e of events) {
      const confirmed = e.workOrder?.tasks[0]?.confirmedSubsystemCode ?? e.fieldService?.confirmedSubsystemCode ?? null;
      if (!confirmed || !e.subsystemCode) continue;
      compared += 1;
      if (confirmed.slice(0, 3) === e.subsystemCode.slice(0, 3)) systemMatch += 1;
      if (confirmed === e.subsystemCode) fullMatch += 1;
    }
    return { compared, systemMatch, fullMatch, systemRate: compared ? systemMatch / compared : null, fullRate: compared ? fullMatch / compared : null };
  }

  /**
   * Aderência à preventiva e adoção do processo (ARBITRADO — ver shared).
   * Preventiva: das paradas com data planejada no período, quantas entraram
   * na garagem até a data (ou antes do km da janela + tolerância). Adoção: das
   * OS liberadas, quantas tiveram toda sub-OS inspecionada e a limpeza feita.
   */
  private async adherence(from: Date, to: Date): Promise<ProcessAdherence> {
    const [schedules, released] = await Promise.all([
      this.prisma.scheduledMaintenance.findMany({
        where: { plannedDate: { gte: from, lte: to }, status: { not: ScheduleStatus.CANCELLED } },
        select: { plannedDate: true, status: true, workOrder: { select: { openedAt: true } } },
      }),
      this.prisma.workOrder.findMany({
        where: { status: WorkOrderStatus.RELEASED, releasedAt: { gte: from, lte: to } },
        select: {
          cleaning: { select: { status: true } },
          tasks: { where: { status: { not: TaskStatus.CANCELLED } }, select: { status: true } },
        },
      }),
    ]);

    const onTime = schedules.filter((s) => {
      const started = s.workOrder?.openedAt;
      if (!started || !s.plannedDate) return false;
      // Tolerância de um dia sobre a data planejada.
      return started.getTime() <= s.plannedDate.getTime() + 24 * 60 * 60_000;
    }).length;

    const complete = released.filter(
      (wo) => wo.tasks.length > 0 && wo.tasks.every((t) => t.status === TaskStatus.APPROVED) && wo.cleaning?.status === CleaningStatus.DONE,
    ).length;

    return {
      preventive: { due: schedules.length, onTime, rate: schedules.length ? onTime / schedules.length : null },
      adoption: { released: released.length, complete, rate: released.length ? complete / released.length : null },
    };
  }

  /** Disponibilidade média do mês: carros sem OS aberta ÷ frota, amostrada a cada 6 h. */
  private async availability(from: Date, to: Date): Promise<number | null> {
    const fleet = await this.prisma.vehicle.count({ where: { isActive: true } });
    if (fleet === 0) return null;
    const workOrders = await this.prisma.workOrder.findMany({
      where: { openedAt: { lte: to }, OR: [{ releasedAt: null }, { releasedAt: { gte: from } }], status: { not: WorkOrderStatus.CANCELLED } },
      select: { openedAt: true, releasedAt: true },
    });
    let sum = 0;
    let samples = 0;
    for (let t = from.getTime(); t <= to.getTime(); t += 6 * 60 * 60_000) {
      const at = new Date(t);
      const down = workOrders.filter((w) => w.openedAt <= at && (!w.releasedAt || w.releasedAt >= at)).length;
      sum += (fleet - down) / fleet;
      samples += 1;
    }
    return samples ? sum / samples : null;
  }

  // --- Snapshots mensais (E8) ------------------------------------------------

  /** Calcula e grava (upsert) todos os indicadores de um mês. Idempotente. */
  async snapshotMonth(monthStart: Date): Promise<void> {
    const start = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59, 999);
    const end = monthEnd < new Date() ? monthEnd : new Date();

    const [r1, availability] = await Promise.all([this.r1({ from: start, to: end }), this.availability(start, end)]);

    const rows: { metric: MetricKey; value: number | null; detail?: object }[] = [
      { metric: MetricKey.MKBF, value: r1.mkbf.mkbf, detail: { kmTraveled: r1.mkbf.kmTraveled, unscheduledReturns: r1.mkbf.unscheduledReturns } },
      { metric: MetricKey.FLEET_AVAILABILITY, value: availability },
      { metric: MetricKey.DOWNTIME_BY_CAUSE, value: r1.totalDowntimeMinutes, detail: { byCause: r1.downtimeByCause } },
      { metric: MetricKey.FIELD_RESOLUTION, value: r1.fieldResolution.rate, detail: r1.fieldResolution },
      { metric: MetricKey.INTERNAL_REWORK, value: r1.internalRework.rate, detail: r1.internalRework },
      { metric: MetricKey.TRIAGE_SLA, value: r1.triageSla.medianSeconds, detail: r1.triageSla },
      { metric: MetricKey.PREVENTIVE_ADHERENCE, value: r1.adherence.preventive.rate, detail: r1.adherence.preventive },
      { metric: MetricKey.ADOPTION, value: r1.adherence.adoption.rate, detail: r1.adherence.adoption },
    ];

    for (const row of rows) {
      if (row.value === null) continue;
      await this.prisma.metricSnapshot.upsert({
        where: { metric_scope_periodStart_periodEnd: { metric: row.metric, scope: 'FLEET', periodStart: start, periodEnd: monthEnd } },
        update: { value: row.value, detail: row.detail as Prisma.InputJsonValue | undefined, computedAt: new Date() },
        create: { metric: row.metric, scope: 'FLEET', periodStart: start, periodEnd: monthEnd, value: row.value, detail: row.detail as Prisma.InputJsonValue | undefined },
      });
    }
  }

  /** Série mensal dos snapshots; meses sem snapshot são calculados na hora e gravados. */
  async history(query: MetricsHistoryQuery): Promise<MetricHistoryPoint[]> {
    const now = new Date();
    const months: Date[] = [];
    for (let i = query.months - 1; i >= 0; i -= 1) months.push(new Date(now.getFullYear(), now.getMonth() - i, 1));

    const stored = await this.prisma.metricSnapshot.findMany({
      where: { scope: 'FLEET', periodStart: { gte: months[0] } },
      select: { metric: true, periodStart: true, value: true },
    });
    const have = new Set(stored.map((s) => s.periodStart.toISOString().slice(0, 7)));

    for (const m of months) {
      // Mês corrente sempre recalculado; passados só se faltarem.
      const key = m.toISOString().slice(0, 7);
      if (!have.has(key) || m.getMonth() === now.getMonth()) await this.snapshotMonth(m);
    }

    const rows = await this.prisma.metricSnapshot.findMany({
      where: { scope: 'FLEET', periodStart: { gte: months[0] } },
      select: { metric: true, periodStart: true, value: true },
    });

    return months.map((m) => {
      const key = m.toISOString().slice(0, 7);
      const values: Partial<Record<MetricKey, number | null>> = {};
      for (const r of rows) {
        if (r.periodStart.toISOString().slice(0, 7) === key) values[r.metric as MetricKey] = Number(r.value);
      }
      return { month: m.toISOString(), values };
    });
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
        // Guincho e carro de treinamento rodam, mas não são frota em operação.
        vehicle: { application: 'FROTA' },
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
