import { Injectable, Logger } from '@nestjs/common';
import { EventStatus, OdometerStatus, QueueStatus, ScheduleStatus, UserRole, WorkOrderStatus } from '@prisma/client';
import { VehicleStatus, type BoardInsight, type DashboardNotice, type DashboardNotices, type NoticeSeverity } from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { BoardService } from '../metrics/board.service';
import { isoDay } from '../consumption/consumption.calc';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** O quadro de indicadores leva segundos no primeiro acesso: o cartão não espera por ele. */
const BOARD_WAIT_MS = 2_500;
/** Km que chega por remessa mensal deixa a frota inteira "sem leitura": acima disto o aviso vira o de remessa. */
const DEGRADED_FLEET_SHARE = 0.3;
const SEVERITY_ORDER: Record<NoticeSeverity, number> = { critical: 0, warning: 1, info: 2, good: 3 };

const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
/** "81-123, 81-456 e mais 3" — os primeiros códigos e quantos ficaram de fora. */
function listCodes(codes: string[], total: number, max = 3): string {
  const shown = codes.slice(0, max);
  const rest = total - shown.length;
  if (shown.length === 0) return '';
  if (rest <= 0) return shown.length === 1 ? shown[0] as string : `${shown.slice(0, -1).join(', ')} e ${shown[shown.length - 1]}`;
  return `${shown.join(', ')} e mais ${rest}`;
}
function hoursAgo(d: Date, now: Date): string {
  const h = Math.floor((now.getTime() - d.getTime()) / HOUR_MS);
  if (h < 1) return 'há menos de 1 h';
  if (h < 48) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} dias`;
}

/**
 * Avisos e alertas do Dashboard — o cartão de cima da tela inicial.
 *
 * Reúne numa lista só, por gravidade, o que pede atenção agora:
 *   crítico   falha de segurança aberta, peça e OS com prazo vencido
 *   atenção   triagem parada, fila velha, preventiva vencida, planilha de
 *             consumo com dias sem registro ou odômetro parado, indicador
 *             que piorou no quadro, notificação que fala de prazo estourado
 *   aviso     até quando os dados do ERP-JB chegaram, leituras do quadro,
 *             a caixa de notificações de quem está olhando
 *   bom       indicador que melhorou (um só, para a lista não virar boletim)
 *
 * Tudo deriva de estado: nenhum aviso é digitado. Cada item leva à tela onde
 * se resolve; notificação da caixa pode ser dada como ciente dali mesmo.
 */
@Injectable()
export class NoticesService {
  private readonly log = new Logger(NoticesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly board: BoardService,
  ) {}

  async build(userId: string, role: UserRole): Promise<DashboardNotices> {
    const now = new Date();
    const [garage, preventive, freshness, sheet, inbox, board] = await Promise.all([
      this.garage(now),
      this.preventive(now),
      this.freshness(now),
      this.sheet(now),
      this.inbox(userId, role),
      this.fromBoard(),
    ]);
    const items = [...garage, ...preventive, ...freshness.items, ...sheet, ...inbox, ...board].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.at ?? '').localeCompare(a.at ?? ''),
    );
    const counts: Record<NoticeSeverity, number> = { critical: 0, warning: 0, info: 0, good: 0 };
    for (const i of items) counts[i.severity] += 1;
    return { generatedAt: now.toISOString(), items, counts, dataThrough: freshness.dataThrough };
  }

  // --- a garagem agora -----------------------------------------------------------------

  private async garage(now: Date): Promise<DashboardNotice[]> {
    const openEvent = { status: { notIn: [EventStatus.CLOSED, EventStatus.CANCELLED] } };
    const [safety, safetyTotal, overdueWo, overdueWoTotal, overdueParts, oldestPart, triage, oldestTriage, waiting, oldestQueue] = await Promise.all([
      this.prisma.failureEvent.findMany({ where: { ...openEvent, isSafety: true }, orderBy: { reportedAt: 'asc' }, take: 3, select: { vehicle: { select: { code: true } }, reportedAt: true } }),
      this.prisma.failureEvent.count({ where: { ...openEvent, isSafety: true } }),
      this.prisma.workOrder.findMany({
        where: { status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] }, estimatedCompletionAt: { lt: now } },
        orderBy: { estimatedCompletionAt: 'asc' },
        take: 3,
        select: { estimatedCompletionAt: true, vehicle: { select: { code: true } } },
      }),
      this.prisma.workOrder.count({ where: { status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] }, estimatedCompletionAt: { lt: now } } }),
      this.prisma.partWaiting.count({ where: { resolvedAt: null, expectedAt: { lt: now } } }),
      this.prisma.partWaiting.findFirst({ where: { resolvedAt: null, expectedAt: { lt: now } }, orderBy: { expectedAt: 'asc' }, select: { expectedAt: true, materialRequest: { select: { workOrder: { select: { vehicle: { select: { code: true } } } } } } } }),
      this.prisma.failureEvent.count({ where: { status: EventStatus.REGISTERED, triage: null } }),
      this.prisma.failureEvent.findFirst({ where: { status: EventStatus.REGISTERED, triage: null }, orderBy: { reportedAt: 'asc' }, select: { reportedAt: true } }),
      this.prisma.vehicle.count({ where: { isActive: true, status: VehicleStatus.AWAITING_MAINTENANCE } }),
      this.prisma.queueEntry.findFirst({ where: { status: QueueStatus.WAITING, vehicle: { status: VehicleStatus.AWAITING_MAINTENANCE } }, orderBy: { enteredAt: 'asc' }, select: { enteredAt: true, vehicle: { select: { code: true } } } }),
    ]);

    const out: DashboardNotice[] = [];
    if (safetyTotal > 0) {
      const codes = listCodes(safety.map((e) => e.vehicle.code), safetyTotal);
      out.push({
        id: 'safety',
        severity: 'critical',
        kind: 'safety',
        title: `${safetyTotal} ${plural(safetyTotal, 'falha de segurança em aberto', 'falhas de segurança em aberto')}`,
        text: `${codes ? `Carro ${codes}. ` : ''}Falha marcada como de segurança sem encerramento: tem prioridade sobre qualquer outra OS.`,
        to: '/eventos',
        at: safety[0]?.reportedAt.toISOString() ?? now.toISOString(),
        source: 'Eventos',
        count: safetyTotal,
        notificationId: null,
      });
    }
    if (overdueWoTotal > 0) {
      const codes = listCodes(overdueWo.map((w) => w.vehicle.code), overdueWoTotal);
      const worst = overdueWo[0]?.estimatedCompletionAt;
      out.push({
        id: 'wo-overdue',
        severity: 'critical',
        kind: 'workorders',
        title: `${overdueWoTotal} ${plural(overdueWoTotal, 'OS com prazo estourado', 'OS com prazo estourado')}`,
        text: `${codes ? `Carro ${codes}. ` : ''}${worst ? `A mais atrasada venceu ${hoursAgo(worst, now)}.` : ''} A previsão de conclusão passou e o carro continua na oficina.`,
        to: '/os',
        at: worst?.toISOString() ?? now.toISOString(),
        source: 'Oficina',
        count: overdueWoTotal,
        notificationId: null,
      });
    }
    if (overdueParts > 0) {
      const code = oldestPart?.materialRequest.workOrder?.vehicle.code;
      out.push({
        id: 'parts-overdue',
        severity: 'critical',
        kind: 'parts',
        title: `${overdueParts} ${plural(overdueParts, 'peça com prazo vencido', 'peças com prazo vencido')}`,
        text: `${oldestPart ? `A mais antiga venceu ${hoursAgo(oldestPart.expectedAt, now)}${code ? `, carro ${code}` : ''}. ` : ''}Carro parado sem ninguém trabalhando nele até a peça chegar.`,
        to: '/estoque',
        at: oldestPart?.expectedAt.toISOString() ?? now.toISOString(),
        source: 'Estoque',
        count: overdueParts,
        notificationId: null,
      });
    }
    if (triage > 0) {
      out.push({
        id: 'triage',
        severity: 'warning',
        kind: 'triage',
        title: `${triage} ${plural(triage, 'evento aguardando triagem', 'eventos aguardando triagem')}`,
        text: `${oldestTriage ? `O mais antigo espera ${hoursAgo(oldestTriage.reportedAt, now)}. ` : ''}Sem triagem o carro não entra na fila nem volta à linha.`,
        to: '/triagem',
        at: oldestTriage?.reportedAt.toISOString() ?? now.toISOString(),
        source: 'Triagem',
        count: triage,
        notificationId: null,
      });
    }
    if (oldestQueue) {
      const hours = (now.getTime() - oldestQueue.enteredAt.getTime()) / HOUR_MS;
      if (hours >= 12 || waiting > 5) {
        out.push({
          id: 'queue',
          severity: 'warning',
          kind: 'queue',
          title: `${waiting} ${plural(waiting, 'carro na fila da oficina', 'carros na fila da oficina')}`,
          text: `O carro ${oldestQueue.vehicle.code} espera ${hoursAgo(oldestQueue.enteredAt, now)} por valeta e mecânico.`,
          to: '/fila',
          at: oldestQueue.enteredAt.toISOString(),
          source: 'Fila',
          count: waiting,
          notificationId: null,
        });
      }
    }
    return out;
  }

  // --- preventivas vencidas ------------------------------------------------------------

  private async preventive(now: Date): Promise<DashboardNotice[]> {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const where = {
      status: { in: [ScheduleStatus.PLANNED, ScheduleStatus.CONFIRMED] },
      OR: [{ plannedDate: { lt: today } }, { plannedDate: null, projectedDate: { lt: today } }],
    };
    const [total, rows] = await Promise.all([
      this.prisma.scheduledMaintenance.count({ where }),
      this.prisma.scheduledMaintenance.findMany({ where, orderBy: { projectedDate: 'asc' }, take: 3, select: { plannedDate: true, projectedDate: true, vehicle: { select: { code: true } } } }),
    ]);
    if (total === 0) return [];
    const first = rows[0];
    const date = first ? (first.plannedDate ?? first.projectedDate) : null;
    return [
      {
        id: 'preventive-overdue',
        severity: 'warning',
        kind: 'preventive',
        title: `${total} ${plural(total, 'preventiva vencida sem parada', 'preventivas vencidas sem parada')}`,
        text: `Carro ${listCodes(rows.map((r) => r.vehicle.code), total)}.${date ? ` A mais antiga estava prevista para ${fmtDay(isoDay(date))}.` : ''} Carro rodando além do plano de manutenção.`,
        to: '/preventiva',
        at: date?.toISOString() ?? null,
        source: 'Preventiva',
        count: total,
        notificationId: null,
      },
    ];
  }

  // --- até quando os dados chegaram ----------------------------------------------------

  private async freshness(now: Date): Promise<{ items: DashboardNotice[]; dataThrough: DashboardNotices['dataThrough'] }> {
    const [km, consumption, failures, lineDays, degraded, fleet] = await Promise.all([
      this.prisma.odometerReading.aggregate({ where: { status: { not: OdometerStatus.REJECTED }, vehicle: { application: 'FROTA' } }, _max: { readAt: true } }),
      this.prisma.consumptionReading.aggregate({ _max: { date: true } }),
      this.prisma.failureEvent.aggregate({ where: { isUnscheduledReturn: true }, _max: { reportedAt: true } }),
      this.prisma.vehicleLineDay.aggregate({ _max: { date: true } }),
      this.prisma.kmProjection.count({ where: { isDegraded: true } }),
      this.prisma.vehicle.count({ where: { isActive: true, application: 'FROTA' } }),
    ]);
    const dataThrough = {
      km: km._max.readAt ? isoDay(km._max.readAt) : null,
      consumption: consumption._max.date ? consumption._max.date.toISOString().slice(0, 10) : null,
      failures: failures._max.reportedAt ? isoDay(failures._max.reportedAt) : null,
      lineDays: lineDays._max.date ? lineDays._max.date.toISOString().slice(0, 10) : null,
    };
    const items: DashboardNotice[] = [];
    const today = isoDay(now);
    const ageDays = (iso: string | null) => (iso ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / DAY_MS) : null);
    const kmAge = ageDays(dataThrough.km);
    // Km que chega por remessa: a frota inteira fica "sem leitura" e o alerta por carro perde o sentido.
    const remittance = kmAge !== null && kmAge >= 3 && fleet > 0 && degraded >= fleet * DEGRADED_FLEET_SHARE;
    if (kmAge !== null && kmAge >= 3) {
      const parts = [
        dataThrough.km ? `km até ${fmtDay(dataThrough.km)}` : null,
        dataThrough.failures ? `fichas até ${fmtDay(dataThrough.failures)}` : null,
        dataThrough.consumption ? `consumo até ${fmtDay(dataThrough.consumption)}` : null,
        dataThrough.lineDays ? `carro-linha-dia até ${fmtDay(dataThrough.lineDays)}` : null,
      ].filter(Boolean);
      items.push({
        id: 'data-through',
        severity: kmAge > 20 ? 'warning' : 'info',
        kind: 'data',
        title: `Dados do ERP-JB até ${fmtDay(dataThrough.km as string)}`,
        text: `${parts.join(', ').replace(/^./, (c) => c.toUpperCase())}. ${kmAge > 20 ? 'A remessa está atrasada: ' : ''}MKBF, consumo e o quadro diário do mês seguem parciais até a próxima carga.`,
        to: '/indicadores',
        at: `${dataThrough.km}T12:00:00.000Z`,
        source: 'ERP-JB',
        count: null,
        notificationId: null,
      });
    }
    if (degraded > 0 && !remittance) {
      items.push({
        id: 'km-degraded',
        severity: 'warning',
        kind: 'km',
        title: `${degraded} ${plural(degraded, 'carro sem leitura de km há 2+ dias', 'carros sem leitura de km há 2+ dias')}`,
        text: 'A projeção da preventiva desses carros está publicada em modo degradado.',
        to: '/km',
        at: now.toISOString(),
        source: 'Km',
        count: degraded,
        notificationId: null,
      });
    }
    return { items, dataThrough };
  }

  // --- o que a planilha de consumo deixou de registrar ----------------------------------

  private async sheet(now: Date): Promise<DashboardNotice[]> {
    const since = new Date(now.getTime() - 120 * DAY_MS);
    const rows = await this.prisma.notification.findMany({
      where: { createdAt: { gte: since }, OR: [{ entity: 'ConsumptionGap' }, { entity: 'Vehicle', title: { startsWith: 'Odômetro parado no carro ' } }] },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, body: true, entity: true, createdAt: true },
    });
    const seen = new Set<string>();
    const gaps: typeof rows = [];
    const stalls: { code: string; from: string; to: string; createdAt: Date }[] = [];
    for (const r of rows) {
      if (seen.has(r.title)) continue;
      seen.add(r.title);
      if (r.entity === 'ConsumptionGap') gaps.push(r);
      else {
        const m = /Odômetro parado no carro (\S+) de (\S+) a (\S+)/.exec(r.title);
        if (m) stalls.push({ code: m[1] as string, from: m[2] as string, to: m[3] as string, createdAt: r.createdAt });
      }
    }
    const out: DashboardNotice[] = gaps.map((g) => ({
      id: `gap:${g.id}`,
      severity: 'warning',
      kind: 'sheet',
      title: g.title,
      text: g.body,
      to: '/consumo',
      at: g.createdAt.toISOString(),
      source: 'Planilha de consumo',
      count: null,
      notificationId: null,
    }));
    if (stalls.length > 0) {
      const first = stalls[0] as (typeof stalls)[number];
      out.push({
        id: 'stalls',
        severity: 'warning',
        kind: 'sheet',
        title: stalls.length === 1 ? `Odômetro parado no carro ${first.code} de ${first.from} a ${first.to}` : `${stalls.length} carros com odômetro parado na planilha de consumo`,
        text: `${stalls.map((s) => `${s.code} (${s.from} a ${s.to})`).join(', ')}. Abastecimento registrado com km que não anda: o trecho sai do cálculo de consumo e o km fica subestimado. Pedir ao ERP-JB a leitura corrigida.`,
        to: '/consumo',
        at: first.createdAt.toISOString(),
        source: 'Planilha de consumo',
        count: stalls.length,
        notificationId: null,
      });
    }
    return out;
  }

  // --- a caixa de quem está olhando -----------------------------------------------------

  private async inbox(userId: string, role: UserRole): Promise<DashboardNotice[]> {
    const rows = await this.prisma.notification.findMany({
      where: {
        OR: [{ userId }, { role }],
        readAt: null,
        NOT: [{ entity: 'ConsumptionGap' }, { title: { startsWith: 'Odômetro parado no carro ' } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });
    const route: Record<string, string> = {
      WorkOrder: '/os',
      Inspection: '/os',
      MaterialRequest: '/estoque',
      KitSeparation: '/preventiva',
      ScheduledMaintenance: '/preventiva',
      QueueEntry: '/fila',
      ReplacementDemand: '/plantao',
      KmProjection: '/km',
      Vehicle: '/frota',
    };
    return rows.map((n) => ({
      id: `inbox:${n.id}`,
      severity: /vencid|estourad|reprovad|degradad|sem reserva/i.test(n.title) ? 'warning' : 'info',
      kind: 'notification',
      title: n.title,
      text: n.body,
      to: n.entity ? route[n.entity] ?? null : null,
      at: n.createdAt.toISOString(),
      source: 'Notificação',
      count: null,
      notificationId: n.id,
    }));
  }

  // --- leituras do quadro de indicadores -----------------------------------------------

  private async fromBoard(): Promise<DashboardNotice[]> {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), BOARD_WAIT_MS));
    const board = await Promise.race([
      this.board.board().catch((e: unknown) => {
        this.log.warn(`quadro indisponível para os avisos: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }),
      timeout,
    ]);
    if (!board) return [];
    const map = (i: BoardInsight): NoticeSeverity | null => {
      if (i.kind === 'data') return null; // o frescor dos dados já tem aviso próprio
      if (i.tone === 'bad') return 'warning';
      if (i.tone === 'warn') return i.kind === 'day' ? 'warning' : 'info';
      if (i.tone === 'good') return 'good';
      return null; // leituras neutras ficam no quadro
    };
    const out: DashboardNotice[] = [];
    let goods = 0;
    for (const i of board.insights) {
      const severity = map(i);
      if (!severity) continue;
      if (severity === 'good' && goods++ > 0) continue;
      out.push({
        id: `board:${i.kind}:${i.date ?? board.month}:${i.title.slice(0, 24)}`,
        severity,
        kind: 'indicator',
        title: i.title,
        text: i.text,
        to: '/indicadores',
        at: i.date ? `${i.date}T12:00:00.000Z` : `${board.to}T12:00:00.000Z`,
        source: 'Indicadores',
        count: null,
        notificationId: null,
      });
      if (out.length >= 4) break;
    }
    return out;
  }
}
