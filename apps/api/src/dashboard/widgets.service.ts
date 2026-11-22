import { Injectable } from '@nestjs/common';
import { VehicleTechnology, WorkOrderStatus } from '@prisma/client';
import type { DashboardWidget, WidgetKind, WidgetQuery } from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { BoardService } from '../metrics/board.service';
import { ConsumptionService } from '../consumption/consumption.service';

const DAY_MS = 86_400_000;
const fmtInt = (n: number) => Math.round(n).toLocaleString('pt-BR');
const fmtPct = (n: number) =>
  `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** Quanto maior, melhor? Decide a cor da variação contra o período anterior. */
const HIGHER_IS_BETTER: Record<WidgetKind, boolean> = {
  mkbf: true,
  breakdowns: false,
  km: true,
  availability: true,
  lostTrips: false,
  tripsDone: true,
  downtime: false,
  woReleased: true,
  woOpened: false,
  rescues: false,
  fieldResolution: true,
  triageSla: false,
  rework: false,
  consumptionDiesel: true,
  consumptionEbus: true,
};

const UNIT: Record<WidgetKind, DashboardWidget['unit']> = {
  mkbf: 'km',
  breakdowns: 'count',
  km: 'km',
  availability: 'pct',
  lostTrips: 'count',
  tripsDone: 'pct',
  downtime: 'minutes',
  woReleased: 'count',
  woOpened: 'count',
  rescues: 'count',
  fieldResolution: 'pct',
  triageSla: 'minutes',
  rework: 'pct',
  consumptionDiesel: 'kml',
  consumptionEbus: 'kmkwh',
};

interface Computed {
  value: number | null;
  detail: string | null;
}

/**
 * Widgets do Dashboard: um indicador, um período, um escopo, um número.
 *
 * Cada cartão da seção de indicadores pede `kind` + `from`/`to` (dias civis,
 * fuso de São Paulo) e, se quiser, `vehicleId` para olhar um carro só. Recebe
 * o valor do período, o do período igual logo antes (para a variação) e uma
 * linha de detalhe com a conta por trás. Tudo sai das mesmas funções que
 * alimentam o R1 e o quadro mensal: o número que a pessoa monta aqui é o
 * mesmo que ela vê nas telas de indicador.
 */
@Injectable()
export class WidgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly board: BoardService,
    private readonly consumption: ConsumptionService,
  ) {}

  async build(q: WidgetQuery): Promise<DashboardWidget> {
    const v = q.vehicleId;
    const days =
      Math.round((startOfDay(q.to).getTime() - startOfDay(q.from).getTime()) / DAY_MS) + 1;
    const window = (fromIso: string, toIso: string) => {
      const from = startOfDay(fromIso);
      const to = endOfDay(toIso);
      const prevTo = new Date(from.getTime() - 1);
      const prevFrom = new Date(from.getTime() - days * DAY_MS);
      return Promise.all([
        this.compute(q.kind, from, to, fromIso, toIso, v),
        this.compute(q.kind, prevFrom, prevTo, isoDay(prevFrom), isoDay(prevTo), v),
      ]);
    };
    let used = { from: q.from, to: q.to };
    let fellBack = false;
    let [current, previous] = await window(q.from, q.to);
    // Sem dado no período (remessa que ainda não chegou, dia sem planilha): recua
    // para o dia mais recente com dado deste indicador, mantendo o tamanho da janela.
    if (current.value === null) {
      const last = await this.lastDataDay(q.kind, q.from, v);
      if (last) {
        used = { from: addDaysIso(last, -(days - 1)), to: last };
        [current, previous] = await window(used.from, used.to);
        fellBack = true;
      }
    }
    const vehicle = v
      ? await this.prisma.vehicle.findUnique({ where: { id: v }, select: { code: true } })
      : null;
    return {
      kind: q.kind,
      from: q.from,
      to: q.to,
      value: current.value,
      previous: previous.value,
      unit: UNIT[q.kind],
      detail: current.detail,
      higherIsBetter: HIGHER_IS_BETTER[q.kind],
      vehicleCode: vehicle?.code ?? null,
      used,
      fellBack,
    };
  }

  /**
   * Último dia, antes de `before`, em que este indicador tem dado. Só para os
   * indicadores que dependem de remessa ou planilha; contagens (OS, socorro,
   * triagem) valem zero e não recuam.
   */
  private async lastDataDay(kind: WidgetKind, before: string, v?: string): Promise<string | null> {
    const lt = new Date(`${before}T00:00:00`);
    switch (kind) {
      case 'mkbf':
      case 'km':
      case 'breakdowns': {
        const r = await this.prisma.odometerReading.findFirst({
          where: {
            readAt: { lt },
            deltaKm: { gt: 0 },
            vehicle: { application: 'FROTA' },
            ...(v ? { vehicleId: v } : {}),
          },
          orderBy: { readAt: 'desc' },
          select: { readAt: true },
        });
        return r ? isoDay(r.readAt) : null;
      }
      case 'lostTrips':
      case 'tripsDone': {
        if (v) {
          const e = await this.prisma.failureEvent.findFirst({
            where: { vehicleId: v, reportedAt: { lt } },
            orderBy: { reportedAt: 'desc' },
            select: { reportedAt: true },
          });
          return e ? isoDay(e.reportedAt) : null;
        }
        const r = await this.prisma.lineTripDay.findFirst({
          where: { date: { lt: new Date(`${before}T00:00:00Z`) }, planned: { gt: 0 } },
          orderBy: { date: 'desc' },
          select: { date: true },
        });
        return r ? r.date.toISOString().slice(0, 10) : null;
      }
      case 'consumptionDiesel':
      case 'consumptionEbus': {
        const r = await this.prisma.consumptionReading.findFirst({
          where: { date: { lt: new Date(`${before}T00:00:00Z`) }, ...(v ? { vehicleId: v } : {}) },
          orderBy: { date: 'desc' },
          select: { date: true },
        });
        return r ? r.date.toISOString().slice(0, 10) : null;
      }
      default:
        return null;
    }
  }

  private async compute(
    kind: WidgetKind,
    from: Date,
    to: Date,
    fromIso: string,
    toIso: string,
    v?: string,
  ): Promise<Computed> {
    const byVehicle = v ? { vehicleId: v } : {};
    switch (kind) {
      case 'mkbf': {
        const r = await this.metrics.mkbf(from, to, v);
        return {
          value: r.mkbf,
          detail: `${fmtInt(r.kmTraveled)} km ÷ ${fmtInt(r.unscheduledReturns)} quebras`,
        };
      }
      case 'breakdowns': {
        const r = await this.metrics.mkbf(from, to, v);
        return { value: r.unscheduledReturns, detail: `${fmtInt(r.kmTraveled)} km rodados` };
      }
      case 'km': {
        const r = await this.metrics.mkbf(from, to, v);
        return { value: r.kmTraveled, detail: `${fmtInt(r.unscheduledReturns)} quebras` };
      }
      case 'availability': {
        const r = await this.metrics.availability(from, to, v);
        return {
          value: r === null ? null : r * 100,
          detail: v
            ? 'horas sem OS aberta ÷ horas do período'
            : 'carros prontos ÷ frota, amostrado a cada 6 h',
        };
      }
      case 'lostTrips':
      case 'tripsDone': {
        if (v) {
          // Por carro, as viagens perdidas vêm das fichas; o cumprimento é da linha, não do carro.
          if (kind === 'tripsDone') return { value: null, detail: 'disponível só para a frota' };
          const agg = await this.prisma.failureEvent.aggregate({
            where: { vehicleId: v, reportedAt: { gte: from, lte: to } },
            _sum: { lostTrips: true },
          });
          return { value: agg._sum.lostTrips ?? 0, detail: 'somadas das fichas do carro' };
        }
        const agg = await this.prisma.lineTripDay.aggregate({
          where: {
            date: { gte: new Date(`${fromIso}T00:00:00Z`), lte: new Date(`${toIso}T00:00:00Z`) },
          },
          _sum: { planned: true, lost: true },
        });
        const planned = agg._sum.planned ?? 0;
        const lost = agg._sum.lost ?? 0;
        if (planned === 0) return { value: null, detail: null };
        const pct = ((planned - lost) / planned) * 100;
        return kind === 'lostTrips'
          ? {
              value: lost,
              detail: `${fmtInt(planned)} programadas · ${fmtPct(100 - pct)} perdidas`,
            }
          : { value: pct, detail: `${fmtInt(planned - lost)} de ${fmtInt(planned)} viagens` };
      }
      case 'downtime': {
        const r = await this.metrics.releasedWorkOrders(from, to, v);
        return { value: r.averageMinutes, detail: `${fmtInt(r.count)} OS liberadas` };
      }
      case 'woReleased': {
        const r = await this.metrics.releasedWorkOrders(from, to, v);
        return {
          value: r.count,
          detail:
            r.averageMinutes === null
              ? null
              : `média de ${Math.round(r.averageMinutes / 60)} h parado por OS`,
        };
      }
      case 'woOpened': {
        const n = await this.prisma.workOrder.count({
          where: {
            openedAt: { gte: from, lte: to },
            status: { not: WorkOrderStatus.CANCELLED },
            ...byVehicle,
          },
        });
        return { value: n, detail: null };
      }
      case 'rescues': {
        const [total, field] = await Promise.all([
          this.prisma.fieldService.count({
            where: {
              dispatchedAt: { gte: from, lte: to },
              ...(v ? { event: { vehicleId: v } } : {}),
            },
          }),
          this.metrics.fieldResolution(from, to, v),
        ]);
        return {
          value: total,
          detail: field.rate === null ? null : `${fmtPct(field.rate * 100)} resolvidos na rua`,
        };
      }
      case 'fieldResolution': {
        const r = await this.metrics.fieldResolution(from, to, v);
        return {
          value: r.rate === null ? null : r.rate * 100,
          detail: `${fmtInt(r.resolvedInField)} de ${fmtInt(r.total)} socorros`,
        };
      }
      case 'triageSla': {
        const r = await this.metrics.triageSla(from, to, v);
        return {
          value: r.medianSeconds === null ? null : r.medianSeconds / 60,
          detail: r.count
            ? `${fmtInt(r.count)} triagens${r.p90Seconds === null ? '' : ` · p90 ${fmtInt(r.p90Seconds / 60)} min`}`
            : null,
        };
      }
      case 'rework': {
        const r = await this.metrics.internalRework(from, to, v);
        return {
          value: r.rate === null ? null : r.rate * 100,
          detail: `${fmtInt(r.rejections)} reprovações em ${fmtInt(r.inspections)} inspeções`,
        };
      }
      case 'consumptionDiesel':
      case 'consumptionEbus': {
        const energy =
          kind === 'consumptionDiesel' ? VehicleTechnology.DIESEL : VehicleTechnology.EBUS;
        if (v) {
          try {
            const d = await this.consumption.vehicle(v, { from: fromIso, to: toIso });
            return {
              value: d.current.ratio,
              detail: `${fmtInt(d.current.days)} dias com abastecimento`,
            };
          } catch {
            return { value: null, detail: null };
          }
        }
        const r = await this.board.consumptionSummary(energy, fromIso, toIso);
        return {
          value: r?.ratio ?? null,
          detail: r ? `${fmtInt(r.vehicles)} carros · ${fmtInt(r.high)} acima da faixa` : null,
        };
      }
    }
  }
}

function startOfDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}
function endOfDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return isoDay(new Date(y, m - 1, d + n));
}
