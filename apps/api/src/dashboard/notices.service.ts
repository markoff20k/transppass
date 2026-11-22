import { Injectable } from '@nestjs/common';
import { EventStatus, InspectionResult, OdometerStatus, QueueStatus, ReplacementDemandStatus, ScheduleStatus, WorkOrderStatus } from '@prisma/client';
import type { DashboardNotice, DashboardNotices, NoticeSeverity } from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { isoDay } from '../consumption/consumption.calc';

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Carro quebrado na rua: a partir daqui o socorro vira atenção, e depois crítico. */
const RESCUE_WARN_MIN = 30;
const RESCUE_CRIT_MIN = 50;
/** Ficha registrada sem decisão de triagem. */
const TRIAGE_WARN_MIN = 10;
const TRIAGE_CRIT_MIN = 30;
/** Carro na fila da oficina sem valeta. */
const QUEUE_WARN_H = 12;
/** OS e peça com prazo estourado: atenção ao vencer, crítico depois disto. */
const WO_CRIT_H = 24;
const PART_CRIT_H = 48;
/** Janela de carro reserva fechando. */
const REPLACEMENT_WARN_MIN = 20;
/** Liberações recentes que ainda valem uma linha de boa notícia. */
const RELEASE_WINDOW_H = 3;
const RELEASE_MAX = 3;
const PREVENTIVE_MAX = 5;
const SEVERITY_ORDER: Record<NoticeSeverity, number> = { critical: 0, warning: 1, info: 2, good: 3 };
const TZ = 'America/Sao_Paulo';

const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fmtClock = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const minutesBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / MIN_MS));
/** "há 52 min", "há 3 h 10 min", "há 2 dias". */
function since(from: Date, now: Date): string {
  const min = minutesBetween(from, now);
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `há ${h} h ${m} min` : `há ${h} h`;
  }
  return `há ${Math.floor(min / (24 * 60))} dias`;
}
const short = (s: string | null | undefined, max = 60) => (s ? (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s) : null);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Letreiro do Dashboard: fatos reais em andamento no sistema, um por linha,
 * com a área responsável na frente.
 *
 *   [Socorro]       carro quebrado na rua, aguardando socorro ou com socorro no local
 *   [CCO]           ficha registrada sem triagem
 *   [Oficina]       falha de segurança em aberto, OS com prazo estourado,
 *                   carro liberado há pouco (boa notícia)
 *   [Almoxarifado]  peça com prazo vencido segurando uma OS
 *   [Fila]          carro esperando valeta além da conta
 *   [Plantão]       linha sem carro reserva com a janela fechando ou vencida
 *   [Qualidade]     inspeção reprovada, retrabalho
 *   [PCM]           preventiva vencida com o carro rodando
 *
 * Nada aqui é digitado: toda linha sai de um registro com hora, e o tempo
 * decorrido é recalculado a cada chamada (o letreiro atualiza a cada minuto).
 */
@Injectable()
export class NoticesService {
  constructor(private readonly prisma: PrismaService) {}

  async build(): Promise<DashboardNotices> {
    const now = new Date();
    const [rescue, triage, safety, workOrders, parts, queue, replacement, inspections, releases, preventive, freshness] = await Promise.all([
      this.rescue(now),
      this.triage(now),
      this.safety(now),
      this.workOrders(now),
      this.parts(now),
      this.queue(now),
      this.replacement(now),
      this.inspections(now),
      this.releases(now),
      this.preventive(now),
      this.freshness(),
    ]);
    const items = [...rescue, ...triage, ...safety, ...workOrders, ...parts, ...queue, ...replacement, ...inspections, ...releases, ...preventive, ...freshness.items].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.at ?? '').localeCompare(b.at ?? ''),
    );
    const counts: Record<NoticeSeverity, number> = { critical: 0, warning: 0, info: 0, good: 0 };
    for (const i of items) counts[i.severity] += 1;
    return { generatedAt: now.toISOString(), items, counts, dataThrough: freshness.dataThrough };
  }

  // --- [Socorro] carro quebrado na rua -------------------------------------------------

  private async rescue(now: Date): Promise<DashboardNotice[]> {
    const rows = await this.prisma.fieldService.findMany({
      where: { outcome: null, event: { status: { notIn: [EventStatus.CLOSED, EventStatus.CANCELLED] } } },
      orderBy: { dispatchedAt: 'asc' },
      select: {
        id: true,
        kind: true,
        reclassifiedAt: true,
        dispatchedAt: true,
        arrivedAt: true,
        supportVehicleCode: true,
        event: { select: { code: true, reportedAt: true, lineCode: true, locationDescription: true, reportedDescription: true, catalogItem: { select: { description: true } }, vehicle: { select: { code: true } } } },
      },
    });
    return rows.map((f) => {
      const e = f.event;
      const min = minutesBetween(e.reportedAt, now);
      const where = [e.lineCode ? `na linha ${e.lineCode}` : 'na rua', e.locationDescription ? `(${short(e.locationDescription, 40)})` : null].filter(Boolean).join(' ');
      const who = f.kind === 'PAM' ? 'PAM' : 'socorro';
      const stage = f.arrivedAt
        ? `${who} no local ${since(f.arrivedAt, now)}${f.supportVehicleCode ? ` (${f.supportVehicleCode})` : ''}`
        : `aguardando ${who} ${since(f.dispatchedAt, now)}`;
      const failure = short(e.catalogItem?.description ?? e.reportedDescription);
      return {
        id: `rescue:${f.id}`,
        severity: min >= RESCUE_CRIT_MIN ? 'critical' : min >= RESCUE_WARN_MIN ? 'warning' : 'info',
        kind: 'rescue',
        area: f.kind === 'PAM' ? 'PAM' : 'Socorro',
        title: `Carro ${e.vehicle.code} quebrado ${where} ${since(e.reportedAt, now)}, ${stage}`,
        text: `Ficha ${e.code}${failure ? `: ${lower(failure)}` : ''}. Registrada às ${fmtClock(e.reportedAt)}.${f.reclassifiedAt ? ` PAM passou de 30 min e virou Socorro às ${fmtClock(f.reclassifiedAt)}.` : ''}`,
        to: '/socorro',
        at: e.reportedAt.toISOString(),
        vehicleCode: e.vehicle.code,
      } satisfies DashboardNotice;
    });
  }

  // --- [CCO] ficha sem triagem ---------------------------------------------------------

  private async triage(now: Date): Promise<DashboardNotice[]> {
    const rows = await this.prisma.failureEvent.findMany({
      where: { status: EventStatus.REGISTERED, triage: null },
      orderBy: { reportedAt: 'asc' },
      take: 12,
      select: { id: true, code: true, reportedAt: true, lineCode: true, origin: true, reportedDescription: true, catalogItem: { select: { description: true } }, vehicle: { select: { code: true } } },
    });
    return rows.map((e) => {
      const min = minutesBetween(e.reportedAt, now);
      const failure = short(e.catalogItem?.description ?? e.reportedDescription, 48);
      const where = e.lineCode ? ` na linha ${e.lineCode}` : e.origin === 'GARAGE' ? ' na garagem' : '';
      return {
        id: `triage:${e.id}`,
        severity: min >= TRIAGE_CRIT_MIN ? 'critical' : min >= TRIAGE_WARN_MIN ? 'warning' : 'info',
        kind: 'triage',
        area: 'CCO',
        title: `Carro ${e.vehicle.code}${where} com ${failure ? lower(failure) : 'falha'} aguardando triagem ${since(e.reportedAt, now)}`,
        text: `Ficha ${e.code} sem decisão: ninguém disse ainda se o carro recebe socorro, recolhe ou segue viagem.`,
        to: '/triagem',
        at: e.reportedAt.toISOString(),
        vehicleCode: e.vehicle.code,
      } satisfies DashboardNotice;
    });
  }

  // --- [Oficina] falha de segurança em aberto -------------------------------------------

  private async safety(now: Date): Promise<DashboardNotice[]> {
    const rows = await this.prisma.failureEvent.findMany({
      where: { isSafety: true, status: { notIn: [EventStatus.CLOSED, EventStatus.CANCELLED] }, fieldService: { is: null } },
      orderBy: { reportedAt: 'asc' },
      take: 8,
      select: { id: true, code: true, reportedAt: true, reportedDescription: true, catalogItem: { select: { description: true } }, vehicle: { select: { code: true } }, workOrder: { select: { id: true, code: true } } },
    });
    return rows.map((e) => {
      const failure = short(e.catalogItem?.description ?? e.reportedDescription, 48);
      return {
        id: `safety:${e.id}`,
        severity: 'critical',
        kind: 'safety',
        area: 'Oficina',
        title: `Falha de segurança no carro ${e.vehicle.code}${failure ? ` (${lower(failure)})` : ''} em aberto ${since(e.reportedAt, now)}`,
        text: `Ficha ${e.code}${e.workOrder ? `, OS ${e.workOrder.code}` : ', ainda sem OS'}. Tem prioridade sobre qualquer outro serviço da oficina.`,
        to: e.workOrder ? `/os/${e.workOrder.id}` : '/eventos',
        at: e.reportedAt.toISOString(),
        vehicleCode: e.vehicle.code,
      } satisfies DashboardNotice;
    });
  }

  // --- [Oficina] OS com prazo estourado -------------------------------------------------

  private async workOrders(now: Date): Promise<DashboardNotice[]> {
    const rows = await this.prisma.workOrder.findMany({
      where: { status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] }, estimatedCompletionAt: { lt: now } },
      orderBy: { estimatedCompletionAt: 'asc' },
      take: 12,
      select: { id: true, code: true, status: true, estimatedCompletionAt: true, openedAt: true, vehicle: { select: { code: true } } },
    });
    const stage: Record<WorkOrderStatus, string> = {
      OPEN: 'ainda sem mecânico',
      IN_PROGRESS: 'em execução',
      WAITING_PART: 'parada aguardando peça',
      TECH_CLOSED: 'aguardando inspeção',
      IN_INSPECTION: 'em inspeção',
      IN_CLEANING: 'na limpeza',
      RELEASED: 'liberada',
      CANCELLED: 'cancelada',
    };
    return rows.map((w) => {
      const lateH = (now.getTime() - w.estimatedCompletionAt.getTime()) / HOUR_MS;
      const due = w.estimatedCompletionAt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ });
      return {
        id: `wo:${w.id}`,
        severity: lateH >= WO_CRIT_H ? 'critical' : 'warning',
        kind: 'workorders',
        area: 'Oficina',
        title: `OS ${w.code} do carro ${w.vehicle.code} estourou o prazo ${since(w.estimatedCompletionAt, now)}, ${stage[w.status]}`,
        text: `Aberta ${since(w.openedAt, now)}, previsão de conclusão era ${due}.`,
        to: `/os/${w.id}`,
        at: w.estimatedCompletionAt.toISOString(),
        vehicleCode: w.vehicle.code,
      } satisfies DashboardNotice;
    });
  }

  // --- [Almoxarifado] peça com prazo vencido --------------------------------------------

  private async parts(now: Date): Promise<DashboardNotice[]> {
    const rows = await this.prisma.partWaiting.findMany({
      where: { resolvedAt: null, expectedAt: { lt: now } },
      orderBy: { expectedAt: 'asc' },
      take: 12,
      select: {
        id: true,
        expectedAt: true,
        escalatedAt: true,
        reasonCode: { select: { description: true } },
        materialRequest: { select: { material: { select: { code: true, description: true } }, workOrder: { select: { id: true, code: true, vehicle: { select: { code: true } } } } } },
      },
    });
    return rows.map((p) => {
      const lateH = (now.getTime() - p.expectedAt.getTime()) / HOUR_MS;
      const wo = p.materialRequest.workOrder;
      const part = short(p.materialRequest.material.description, 44) ?? p.materialRequest.material.code;
      return {
        id: `part:${p.id}`,
        severity: lateH >= PART_CRIT_H ? 'critical' : 'warning',
        kind: 'parts',
        area: 'Almoxarifado',
        title: `${part}${wo ? ` do carro ${wo.vehicle.code}` : ''} com prazo vencido ${since(p.expectedAt, now)}${wo ? `, OS ${wo.code} parada` : ''}`,
        text: `Motivo da espera: ${lower(p.reasonCode.description)}. ${p.escalatedAt ? `Escalonada ao PCM ${since(p.escalatedAt, now)}.` : 'Ainda não escalonada.'}`,
        to: wo ? `/os/${wo.id}` : '/estoque',
        at: p.expectedAt.toISOString(),
        vehicleCode: wo?.vehicle.code ?? null,
      } satisfies DashboardNotice;
    });
  }

  // --- [Fila] carro esperando valeta ----------------------------------------------------

  private async queue(now: Date): Promise<DashboardNotice[]> {
    const limit = new Date(now.getTime() - QUEUE_WARN_H * HOUR_MS);
    const rows = await this.prisma.queueEntry.findMany({
      where: { status: QueueStatus.WAITING, enteredAt: { lt: limit } },
      orderBy: { enteredAt: 'asc' },
      take: 8,
      select: { id: true, enteredAt: true, position: true, criticality: true, vehicle: { select: { code: true } } },
    });
    return rows.map(
      (q) =>
        ({
          id: `queue:${q.id}`,
          severity: 'warning',
          kind: 'queue',
          area: 'Fila',
          title: `Carro ${q.vehicle.code} aguarda valeta ${since(q.enteredAt, now)}, ${q.position}º da fila`,
          text: `Entrou na fila da oficina e ainda não começou o serviço${q.criticality ? ` (criticidade ${q.criticality})` : ''}.`,
          to: '/fila',
          at: q.enteredAt.toISOString(),
          vehicleCode: q.vehicle.code,
        }) satisfies DashboardNotice,
    );
  }

  // --- [Plantão] linha sem carro reserva ------------------------------------------------

  private async replacement(now: Date): Promise<DashboardNotice[]> {
    const soon = new Date(now.getTime() + REPLACEMENT_WARN_MIN * MIN_MS);
    const rows = await this.prisma.replacementDemand.findMany({
      where: { status: ReplacementDemandStatus.OPEN, windowEndsAt: { lt: soon } },
      orderBy: { windowEndsAt: 'asc' },
      take: 8,
      select: { id: true, lineCode: true, requestedAt: true, windowEndsAt: true, originVehicle: { select: { code: true } } },
    });
    return rows.map((d) => {
      const late = d.windowEndsAt.getTime() <= now.getTime();
      const left = minutesBetween(now, d.windowEndsAt);
      return {
        id: `replacement:${d.id}`,
        severity: late ? 'critical' : 'warning',
        kind: 'replacement',
        area: 'Plantão',
        title: late
          ? `Linha ${d.lineCode} sem carro reserva, janela venceu ${since(d.windowEndsAt, now)}`
          : `Linha ${d.lineCode} ainda sem carro reserva, janela fecha em ${left} min`,
        text: `Troca pedida ${since(d.requestedAt, now)}${d.originVehicle ? ` para substituir o carro ${d.originVehicle.code}` : ''}. Sem reserva a viagem se perde.`,
        to: '/plantao',
        at: d.windowEndsAt.toISOString(),
        vehicleCode: d.originVehicle?.code ?? null,
      } satisfies DashboardNotice;
    });
  }

  // --- [Qualidade] inspeção reprovada ---------------------------------------------------

  private async inspections(now: Date): Promise<DashboardNotice[]> {
    const since24 = new Date(now.getTime() - DAY_MS);
    const rows = await this.prisma.inspection.findMany({
      where: { result: InspectionResult.REJECTED, inspectedAt: { gte: since24 }, task: { workOrder: { status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] } } } },
      orderBy: { inspectedAt: 'desc' },
      take: 6,
      select: { id: true, inspectedAt: true, reasonCode: { select: { description: true } }, task: { select: { description: true, workOrder: { select: { id: true, code: true, vehicle: { select: { code: true } } } } } } },
    });
    return rows.map(
      (i) =>
        ({
          id: `inspection:${i.id}`,
          severity: 'warning',
          kind: 'inspection',
          area: 'Qualidade',
          title: `Inspeção da OS ${i.task.workOrder.code} (carro ${i.task.workOrder.vehicle.code}) reprovada ${since(i.inspectedAt, now)}, retrabalho`,
          text: `${short(i.task.description, 70)}${i.reasonCode ? `. Motivo: ${lower(i.reasonCode.description)}` : ''}.`,
          to: `/os/${i.task.workOrder.id}`,
          at: i.inspectedAt.toISOString(),
          vehicleCode: i.task.workOrder.vehicle.code,
        }) satisfies DashboardNotice,
    );
  }

  // --- [Oficina] carro liberado há pouco -------------------------------------------------

  private async releases(now: Date): Promise<DashboardNotice[]> {
    const from = new Date(now.getTime() - RELEASE_WINDOW_H * HOUR_MS);
    const rows = await this.prisma.workOrder.findMany({
      where: { status: WorkOrderStatus.RELEASED, releasedAt: { gte: from } },
      orderBy: { releasedAt: 'desc' },
      take: RELEASE_MAX,
      select: { id: true, code: true, releasedAt: true, downtimeMinutes: true, vehicle: { select: { code: true } } },
    });
    return rows.flatMap((w) => {
      if (!w.releasedAt) return [];
      const down = w.downtimeMinutes ? ` após ${w.downtimeMinutes >= 60 ? `${Math.round(w.downtimeMinutes / 60)} h` : `${w.downtimeMinutes} min`} parado` : '';
      return [
        {
          id: `release:${w.id}`,
          severity: 'good',
          kind: 'release',
          area: 'Oficina',
          title: `Carro ${w.vehicle.code} liberado para a linha ${since(w.releasedAt, now)}${down}`,
          text: `OS ${w.code} encerrada com inspeção aprovada.`,
          to: `/os/${w.id}`,
          at: w.releasedAt.toISOString(),
          vehicleCode: w.vehicle.code,
        } satisfies DashboardNotice,
      ];
    });
  }

  // --- [PCM] preventiva vencida ---------------------------------------------------------

  private async preventive(now: Date): Promise<DashboardNotice[]> {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const rows = await this.prisma.scheduledMaintenance.findMany({
      where: {
        status: { in: [ScheduleStatus.PLANNED, ScheduleStatus.CONFIRMED] },
        OR: [{ plannedDate: { lt: today } }, { plannedDate: null, projectedDate: { lt: today } }],
      },
      orderBy: { projectedDate: 'asc' },
      take: PREVENTIVE_MAX,
      select: { id: true, plannedDate: true, projectedDate: true, targetKm: true, package: { select: { name: true } }, vehicle: { select: { code: true } } },
    });
    return rows.map((s) => {
      const date = s.plannedDate ?? s.projectedDate;
      return {
        id: `preventive:${s.id}`,
        severity: 'warning',
        kind: 'preventive',
        area: 'PCM',
        title: `Preventiva ${s.package.name} do carro ${s.vehicle.code} vencida desde ${fmtDay(isoDay(date))}, carro rodando`,
        text: `Prevista para ${s.targetKm.toLocaleString('pt-BR')} km e ainda sem parada agendada na oficina.`,
        to: '/preventiva',
        at: date.toISOString(),
        vehicleCode: s.vehicle.code,
      } satisfies DashboardNotice;
    });
  }

  // --- até quando os dados importados chegaram (só no payload, não vira linha) -----------

  private async freshness(): Promise<{ items: DashboardNotice[]; dataThrough: DashboardNotices['dataThrough'] }> {
    const [km, consumption, failures, lineDays] = await Promise.all([
      this.prisma.odometerReading.aggregate({ where: { status: { not: OdometerStatus.REJECTED }, vehicle: { application: 'FROTA' } }, _max: { readAt: true } }),
      this.prisma.consumptionReading.aggregate({ _max: { date: true } }),
      this.prisma.failureEvent.aggregate({ where: { isUnscheduledReturn: true }, _max: { reportedAt: true } }),
      this.prisma.vehicleLineDay.aggregate({ _max: { date: true } }),
    ]);
    const dataThrough = {
      km: km._max.readAt ? isoDay(km._max.readAt) : null,
      consumption: consumption._max.date ? consumption._max.date.toISOString().slice(0, 10) : null,
      failures: failures._max.reportedAt ? isoDay(failures._max.reportedAt) : null,
      lineDays: lineDays._max.date ? lineDays._max.date.toISOString().slice(0, 10) : null,
    };
    return { items: [], dataThrough };

  }
}
