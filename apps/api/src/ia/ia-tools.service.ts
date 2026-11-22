import { Injectable } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { VehicleStatus, VehicleTechnology } from '@prisma/client';
import { z } from 'zod';
import {
  consumptionQuerySchema,
  eventQuerySchema,
  metricsQuerySchema,
  queueQuerySchema,
  workOrderQuerySchema,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { BoardService } from '../metrics/board.service';
import { ConsumptionService } from '../consumption/consumption.service';
import { QueueService } from '../queue/queue.service';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import { EventsService } from '../events/events.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { IN_SHOP_STATUSES } from '../common/vehicle-status';

/**
 * As ferramentas do agente: só leitura, cada uma um recorte compacto dos
 * mesmos serviços que alimentam as telas. O modelo nunca toca no banco
 * direto; recebe JSON pequeno (teto de tamanho) e o nome da ferramenta dentro
 * do resultado. Toda entrada passa por zod antes de rodar.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = z.string().regex(ISO_DAY, 'AAAA-MM-DD');
const month = z.string().regex(/^\d{4}-\d{2}$/, 'AAAA-MM');
const MAX_CHARS = 14_000;

export interface IaToolDef {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  inputSchema: Anthropic.Tool['input_schema'];
  label: (input: Record<string, unknown>) => string;
  run: (input: Record<string, unknown>) => Promise<unknown>;
}

const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const range = (from: string, to: string) => (from === to ? fmtDay(from) : `${fmtDay(from)} a ${fmtDay(to)}`);
const round = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);

@Injectable()
export class IaToolsService {
  readonly tools: IaToolDef[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly board: BoardService,
    private readonly consumption: ConsumptionService,
    private readonly queue: QueueService,
    private readonly workOrders: WorkOrdersService,
    private readonly events: EventsService,
    private readonly vehicles: VehiclesService,
    private readonly scheduling: SchedulingService,
  ) {
    this.tools = [
      this.tool({
        name: 'frota_resumo',
        description:
          'A frota agora: quantos carros em cada estado (em linha, disponível no pátio, aguardando triagem, socorro em campo, aguardando manutenção/fila, em execução, aguardando peça, inspeção, limpeza, fora de operação), disponibilidade e os carros parados com o motivo. Use para "como está a frota/garagem agora".',
        schema: z.object({}),
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        label: () => 'A frota agora',
        run: () => this.fleetNow(),
      }),
      this.tool({
        name: 'carro',
        description:
          'Tudo de um carro pelo prefixo (número) ou placa: estado atual, km projetado, OS aberta, últimos 30 dias (km, quebras, OS, MKBF), próxima preventiva, eventos e OS recentes, fichas de manutenção reais e as linhas em que rodou.',
        schema: z.object({ code: z.string().trim().min(2).max(12).describe('Prefixo (ex.: 085) ou placa') }),
        inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'Prefixo (ex.: 085) ou placa' } }, required: ['code'], additionalProperties: false },
        label: (i) => `Carro ${String(i.code ?? '')}`,
        run: (i) => this.vehicle(String(i.code)),
      }),
      this.tool({
        name: 'quadro_mes',
        description:
          'O quadro do mês dos Indicadores: MKBF, km, quebras, cumprimento de frota e de viagens, viagens perdidas, carros em operação, o mês anterior para comparar, os piores dias, as linhas que mais perderam viagens, consumo diesel/elétrico do mês e a leitura de regras do sistema. Use para perguntas sobre um mês (MKBF do mês, pior dia, tendência).',
        schema: z.object({ month: month.describe('Mês AAAA-MM') }),
        inputSchema: { type: 'object', properties: { month: { type: 'string', description: 'Mês no formato AAAA-MM' } }, required: ['month'], additionalProperties: false },
        label: (i) => `Quadro de ${String(i.month ?? '')}`,
        run: (i) => this.monthBoard(String(i.month)),
      }),
      this.tool({
        name: 'mkbf',
        description: 'MKBF (km rodados ÷ retornos não programados) de um intervalo de datas qualquer, para toda a frota. Para um mês fechado prefira quadro_mes.',
        schema: z.object({ from: day, to: day }),
        inputSchema: { type: 'object', properties: { from: { type: 'string', description: 'AAAA-MM-DD' }, to: { type: 'string', description: 'AAAA-MM-DD' } }, required: ['from', 'to'], additionalProperties: false },
        label: (i) => `MKBF de ${range(String(i.from), String(i.to))}`,
        run: (i) => this.mkbf(String(i.from), String(i.to)),
      }),
      this.tool({
        name: 'indicadores_oficina',
        description:
          'Indicadores da oficina num intervalo: tempo parado por causa (fila, execução, material, inspeção, limpeza), SLA de triagem (mediana e p90), resolução em campo, retrabalho interno, OS liberadas, aderência à preventiva e adoção do processo.',
        schema: z.object({ from: day, to: day }),
        inputSchema: { type: 'object', properties: { from: { type: 'string', description: 'AAAA-MM-DD' }, to: { type: 'string', description: 'AAAA-MM-DD' } }, required: ['from', 'to'], additionalProperties: false },
        label: (i) => `Oficina de ${range(String(i.from), String(i.to))}`,
        run: (i) => this.workshop(String(i.from), String(i.to)),
      }),
      this.tool({
        name: 'consumo_frota',
        description:
          'Consumo da frota num período: km/l (diesel) ou kWh/km (elétricos), km e litros/kWh, comparação com o período anterior, rendimento por grupo (tecnologia), os carros que mais fogem do padrão e a qualidade do dado (dias sem registro).',
        schema: z.object({ energy: z.enum(['DIESEL', 'EBUS']).default('DIESEL'), from: day, to: day }),
        inputSchema: { type: 'object', properties: { energy: { type: 'string', enum: ['DIESEL', 'EBUS'], description: 'DIESEL ou EBUS (elétricos)' }, from: { type: 'string', description: 'AAAA-MM-DD' }, to: { type: 'string', description: 'AAAA-MM-DD' } }, required: ['from', 'to'], additionalProperties: false },
        label: (i) => `Consumo ${i.energy === 'EBUS' ? 'elétrico' : 'diesel'} de ${range(String(i.from), String(i.to))}`,
        run: (i) => this.fleetConsumption(i.energy === 'EBUS' ? VehicleTechnology.EBUS : VehicleTechnology.DIESEL, String(i.from), String(i.to)),
      }),
      this.tool({
        name: 'consumo_carro',
        description: 'Consumo de um carro (prefixo) num período: rendimento, desvio contra o grupo, posição no ranking e o mês a mês.',
        schema: z.object({ code: z.string().trim().min(2).max(12), from: day, to: day }),
        inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'Prefixo ou placa' }, from: { type: 'string' }, to: { type: 'string' } }, required: ['code', 'from', 'to'], additionalProperties: false },
        label: (i) => `Consumo do carro ${String(i.code)} de ${range(String(i.from), String(i.to))}`,
        run: (i) => this.vehicleConsumption(String(i.code), String(i.from), String(i.to)),
      }),
      this.tool({
        name: 'fila',
        description: 'A fila de manutenção agora: quem espera valeta (posição, criticidade, há quanto tempo, falha) e quem está em atendimento.',
        schema: z.object({}),
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        label: () => 'Fila de manutenção',
        run: () => this.queueNow(),
      }),
      this.tool({
        name: 'os_lista',
        description: 'Ordens de serviço: por padrão as abertas (as que prendem o carro). Pode filtrar só atrasadas, por carro, por status ou por texto (código da OS, prefixo, placa).',
        schema: z.object({
          onlyOpen: z.boolean().default(true),
          onlyOverdue: z.boolean().default(false),
          status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_PART', 'TECH_CLOSED', 'IN_INSPECTION', 'IN_CLEANING', 'RELEASED', 'CANCELLED']).optional(),
          search: z.string().trim().max(40).optional(),
        }),
        inputSchema: {
          type: 'object',
          properties: {
            onlyOpen: { type: 'boolean', description: 'Só as que ainda prendem o carro (padrão true)' },
            onlyOverdue: { type: 'boolean', description: 'Só as atrasadas' },
            status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'WAITING_PART', 'TECH_CLOSED', 'IN_INSPECTION', 'IN_CLEANING', 'RELEASED', 'CANCELLED'] },
            search: { type: 'string', description: 'Código da OS, prefixo ou placa' },
          },
          additionalProperties: false,
        },
        label: (i) => (i.search ? `OS "${String(i.search)}"` : i.onlyOverdue ? 'OS atrasadas' : i.status ? `OS ${String(i.status)}` : 'OS abertas'),
        run: (i) => this.workOrderList(i),
      }),
      this.tool({
        name: 'eventos',
        description:
          'Quebras e ocorrências (fichas/eventos) num intervalo: total, por status, as mais recentes, e os carros e falhas que mais aparecem. Pode filtrar por carro (prefixo/placa) e por texto da falha.',
        schema: z.object({ from: day, to: day, vehicle: z.string().trim().max(40).optional(), failure: z.string().trim().max(60).optional(), status: z.enum(['REGISTERED', 'IN_TRIAGE', 'FIELD_SERVICE', 'RECALLED', 'DEFERRED', 'IN_MAINTENANCE', 'CLOSED', 'CANCELLED']).optional() }),
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'AAAA-MM-DD' },
            to: { type: 'string', description: 'AAAA-MM-DD' },
            vehicle: { type: 'string', description: 'Prefixo ou placa' },
            failure: { type: 'string', description: 'Texto da falha (ex.: alternador, porta)' },
            status: { type: 'string', enum: ['REGISTERED', 'IN_TRIAGE', 'FIELD_SERVICE', 'RECALLED', 'DEFERRED', 'IN_MAINTENANCE', 'CLOSED', 'CANCELLED'] },
          },
          required: ['from', 'to'],
          additionalProperties: false,
        },
        label: (i) => `Quebras de ${range(String(i.from), String(i.to))}${i.vehicle ? ` do carro ${String(i.vehicle)}` : ''}${i.failure ? ` (${String(i.failure)})` : ''}`,
        run: (i) => this.eventList(i),
      }),
      this.tool({
        name: 'preventivas',
        description: 'Preventivas: os carros mais perto (ou já além) da janela do plano, com km atual, km que faltam e dias estimados.',
        schema: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
        inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: 'Quantos carros (padrão 20)' } }, additionalProperties: false },
        label: () => 'Preventivas próximas',
        run: (i) => this.preventives(Number(i.limit ?? 20)),
      }),
    ];
  }

  /** As definições no formato da API (nome, descrição e schema JSON). */
  get definitions(): Anthropic.Tool[] {
    return this.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  }

  find(name: string): IaToolDef | undefined {
    return this.tools.find((t) => t.name === name);
  }

  /** Roda uma ferramenta validando a entrada; devolve JSON compacto com o nome dentro. */
  async execute(name: string, rawInput: unknown): Promise<{ ok: boolean; content: string; label: string }> {
    const tool = this.find(name);
    if (!tool) return { ok: false, content: JSON.stringify({ tool: name, error: 'Ferramenta desconhecida' }), label: name };
    const parsed = tool.schema.safeParse(rawInput ?? {});
    const input = (parsed.success ? parsed.data : {}) as Record<string, unknown>;
    const label = tool.label({ ...((rawInput as Record<string, unknown>) ?? {}), ...input });
    if (!parsed.success) {
      return { ok: false, content: JSON.stringify({ tool: name, error: 'Entrada inválida', issues: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`) }), label };
    }
    try {
      const result = await tool.run(input);
      return { ok: true, content: compact({ tool: name, ...(result as object) }), label };
    } catch (err) {
      return { ok: false, content: JSON.stringify({ tool: name, error: err instanceof Error ? err.message : String(err) }), label };
    }
  }

  private tool(def: IaToolDef): IaToolDef {
    return def;
  }

  // --- As consultas ---------------------------------------------------------

  private async fleetNow() {
    const rows = await this.prisma.vehicle.findMany({
      where: { isActive: true },
      select: {
        code: true,
        status: true,
        technology: true,
        failureEvents: { where: { status: { notIn: ['CLOSED', 'CANCELLED'] } }, orderBy: { reportedAt: 'desc' }, take: 1, select: { reportedAt: true, reportedDescription: true, catalogItem: { select: { description: true } } } },
        workOrders: { where: { status: { notIn: ['RELEASED', 'CANCELLED'] } }, orderBy: { openedAt: 'desc' }, take: 1, select: { code: true, status: true, openedAt: true } },
      },
    });
    const byStatus: Record<string, number> = {};
    for (const v of rows) byStatus[v.status] = (byStatus[v.status] ?? 0) + 1;
    const available = rows.filter((v) => v.status === VehicleStatus.AVAILABLE || v.status === VehicleStatus.IN_LINE).length;
    const stopped = rows
      .filter((v) => v.status !== VehicleStatus.AVAILABLE && v.status !== VehicleStatus.IN_LINE)
      .map((v) => ({
        code: v.code,
        status: v.status,
        technology: v.technology,
        reason: v.failureEvents[0]?.catalogItem?.description ?? v.failureEvents[0]?.reportedDescription ?? (v.workOrders[0] ? `OS ${v.workOrders[0].code}` : null),
        since: (v.workOrders[0]?.openedAt ?? v.failureEvents[0]?.reportedAt ?? null)?.toISOString() ?? null,
        workOrder: v.workOrders[0] ? { code: v.workOrders[0].code, status: v.workOrders[0].status } : null,
      }))
      .slice(0, 60);
    return {
      total: rows.length,
      available,
      availabilityPct: rows.length ? round((available / rows.length) * 100) : null,
      inShop: rows.filter((v) => (IN_SHOP_STATUSES as string[]).includes(v.status)).length,
      byStatus,
      stopped,
      legend: 'IN_LINE = rodando; AVAILABLE = disponível no pátio; AWAITING_TRIAGE = aguardando triagem; FIELD_SERVICE = socorro na rua; AWAITING_MAINTENANCE = na fila; IN_MAINTENANCE = em execução; AWAITING_PART = aguardando peça; IN_INSPECTION = inspeção; IN_CLEANING = limpeza; OUT_OF_SERVICE = fora de operação',
    };
  }

  private async findVehicle(code: string) {
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return this.prisma.vehicle.findFirst({
      where: { OR: [{ code: { equals: c, mode: 'insensitive' } }, { plate: { equals: c, mode: 'insensitive' } }, { code: { endsWith: c } }] },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, plate: true },
    });
  }

  private async vehicle(code: string) {
    const v = await this.findVehicle(code);
    if (!v) return { found: false, message: `Nenhum carro com prefixo ou placa "${code}"` };
    const o = await this.vehicles.overview(v.id);
    return {
      found: true,
      vehicle: { code: o.vehicle.code, plate: o.vehicle.plate, status: o.vehicle.status, technology: o.vehicle.technology, vehicleClass: o.vehicle.vehicleClass, model: o.vehicle.model, manufacturer: o.vehicle.manufacturer, lot: o.vehicle.lot, garage: o.garageName },
      projectedKm: o.projectedKm,
      avgDailyKm: o.avgDailyKm,
      isKmDegraded: o.isKmDegraded,
      daysSinceLastReading: o.daysSinceLastReading,
      driverToday: o.driverToday,
      lastDailyCheck: o.lastDailyCheck,
      nextPackage: o.nextPackage,
      openWorkOrder: o.openWorkOrder,
      last30: o.last30,
      recentEvents: o.recentEvents.slice(0, 8),
      recentWorkOrders: o.recentWorkOrders.slice(0, 6),
      records: o.records.slice(0, 8),
      recordsLast30: o.recordsLast30,
      partsCostLast30: o.partsCostLast30,
      lines30: o.lines30.slice(0, 6),
    };
  }

  private async monthBoard(key: string) {
    const b = await this.board.board(key);
    const days = b.days.filter((d) => !d.empty);
    const worstFleet = [...days].filter((d) => d.fleet.pct !== null).sort((a, c) => (a.fleet.pct as number) - (c.fleet.pct as number)).slice(0, 3);
    const worstFailures = [...days].sort((a, c) => c.failures - a.failures).slice(0, 3);
    return {
      month: b.month,
      from: b.from,
      to: b.to,
      lastDataDate: b.lastDataDate,
      daysWithData: days.length,
      totals: b.totals,
      previousMonth: b.previousMonth,
      previous: b.previous,
      worstFleetDays: worstFleet.map((d) => ({ date: d.date, pct: d.fleet.pct, covered: d.fleet.covered, programmed: d.fleet.programmed, holiday: d.holiday })),
      worstFailureDays: worstFailures.map((d) => ({ date: d.date, failures: d.failures, km: d.km })),
      worstLines: b.worstLines.slice(0, 5),
      consumption: b.consumption,
      history: b.history.slice(-6),
      targets: Object.fromEntries(Object.entries(b.targets).map(([k, t]) => [k, { target: t.target, responsible: t.responsible }])),
      readingSource: b.readingSource,
      insights: b.insights.map((i) => ({ kind: i.kind, tone: i.tone, date: i.date, title: i.title, text: i.text })),
    };
  }

  private async mkbf(from: string, to: string) {
    const r = await this.metrics.mkbf(new Date(`${from}T00:00:00`), new Date(`${to}T23:59:59.999`));
    return { from, to, kmTraveled: r.kmTraveled, unscheduledReturns: r.unscheduledReturns, mkbf: r.mkbf };
  }

  private async workshop(from: string, to: string) {
    const q = metricsQuerySchema.parse({ from: `${from}T00:00:00`, to: `${to}T23:59:59.999` });
    const r = await this.metrics.r1(q);
    return {
      from,
      to,
      downtimeByCause: r.downtimeByCause,
      totalDowntimeMinutes: r.totalDowntimeMinutes,
      averageDowntimeMinutes: r.averageDowntimeMinutes,
      triageSla: r.triageSla,
      fieldResolution: r.fieldResolution,
      internalRework: r.internalRework,
      workOrdersReleased: r.workOrdersReleased,
      adherence: r.adherence,
      codeAlignment: r.codeAlignment,
    };
  }

  private async fleetConsumption(energy: VehicleTechnology, from: string, to: string) {
    const q = consumptionQuerySchema.parse({ energy, from, to, months: 12 });
    const f = await this.consumption.fleet(q);
    const worst = [...f.vehicles]
      .filter((v) => v.deviation !== null)
      .sort((a, b) => (b.deviation as number) - (a.deviation as number))
      .slice(0, 10)
      .map((v) => ({ code: v.code, tech: v.tech, ratio: v.ratio, reference: v.reference, deviation: v.deviation, flag: v.flag, km: v.km, days: v.days }));
    return {
      energy,
      from: f.from,
      to: f.to,
      unit: energy === VehicleTechnology.DIESEL ? 'km/l (maior é melhor)' : 'kWh/km (menor é melhor)',
      current: f.current,
      previous: { ...f.previous, from: f.previousFrom, to: f.previousTo },
      fleetVehicles: f.fleetVehicles,
      byTech: f.byTech,
      flags: { high: f.vehicles.filter((v) => v.flag === 'HIGH').length, watch: f.vehicles.filter((v) => v.flag === 'WATCH').length, noData: f.vehicles.filter((v) => v.flag === 'NO_DATA').length },
      worstVehicles: worst,
      monthly: f.monthly.slice(-6),
      quality: { vehiclesWithoutData: f.quality.vehiclesWithoutData, daysKmWithoutFuel: f.quality.daysKmWithoutFuel, daysFuelWithoutKm: f.quality.daysFuelWithoutKm, lastDate: f.quality.lastDate, lastKmDate: f.quality.lastKmDate, missingDates: f.quality.missingDates.slice(0, 10), stalledVehicles: f.quality.stalledVehicles.length },
      source: f.source,
    };
  }

  private async vehicleConsumption(code: string, from: string, to: string) {
    const v = await this.findVehicle(code);
    if (!v) return { found: false, message: `Nenhum carro com prefixo ou placa "${code}"` };
    const d = await this.consumption.vehicle(v.id, { from, to });
    return { found: true, ...d, daily: undefined, monthly: d.monthly.slice(-6) };
  }

  private async queueNow() {
    const rows = await this.queue.list(queueQuerySchema.parse({}));
    const waiting = rows.filter((r) => r.status === 'WAITING');
    const inService = rows.filter((r) => r.status === 'IN_SERVICE');
    const pick = (r: (typeof rows)[number]) => ({ position: r.position, vehicle: r.vehicleCode, plate: r.vehiclePlate, criticality: r.criticality, isFastTrack: r.isFastTrack, isSafety: r.isSafety, failure: r.failureDescription, workOrder: r.workOrderCode, enteredAt: r.enteredAt, startedAt: r.startedAt, waitingHours: r.waitingHours, estimatedCompletionAt: r.estimatedCompletionAt });
    return { waiting: waiting.length, inService: inService.length, queue: waiting.slice(0, 30).map(pick), service: inService.slice(0, 30).map(pick) };
  }

  private async workOrderList(i: Record<string, unknown>) {
    const q = workOrderQuerySchema.parse({ page: 1, perPage: 25, onlyOpen: i.onlyOpen ?? true, onlyOverdue: i.onlyOverdue ?? false, status: i.status, search: i.search });
    const page = await this.workOrders.list(q);
    return { total: page.meta.total, shown: page.data.length, workOrders: page.data };
  }

  private async eventList(i: Record<string, unknown>) {
    const from = String(i.from);
    const to = String(i.to);
    const q = eventQuerySchema.parse({ page: 1, perPage: 20, from: `${from}T00:00:00`, to: `${to}T23:59:59.999`, vehicle: i.vehicle, failure: i.failure, status: i.status });
    const [page, summary] = await Promise.all([this.events.list(q), this.events.summary()]);
    // Contagem por status e os carros/falhas que mais aparecem, sem paginar tudo: consulta direta.
    const where = {
      reportedAt: { gte: new Date(`${from}T00:00:00`), lte: new Date(`${to}T23:59:59.999`) },
      ...(i.status ? { status: i.status as never } : {}),
      ...(i.vehicle ? { vehicle: { OR: [{ code: { contains: String(i.vehicle), mode: 'insensitive' as const } }, { plate: { contains: String(i.vehicle), mode: 'insensitive' as const } }] } } : {}),
    };
    const [byStatus, byVehicle, total] = await Promise.all([
      this.prisma.failureEvent.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.failureEvent.groupBy({ by: ['vehicleId'], where, _count: { _all: true }, orderBy: { _count: { vehicleId: 'desc' } }, take: 5 }),
      this.prisma.failureEvent.count({ where }),
    ]);
    const codes = await this.prisma.vehicle.findMany({ where: { id: { in: byVehicle.map((b) => b.vehicleId) } }, select: { id: true, code: true } });
    const codeOf = new Map(codes.map((c) => [c.id, c.code]));
    return {
      from,
      to,
      total,
      unscheduledReturns: await this.prisma.failureEvent.count({ where: { ...where, isUnscheduledReturn: true } }),
      byStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])),
      topVehicles: byVehicle.map((b) => ({ code: codeOf.get(b.vehicleId) ?? b.vehicleId, count: b._count._all })),
      now: summary,
      recent: page.data.slice(0, 15).map((e) => ({ code: e.code, vehicle: e.vehicleCode, reportedAt: e.reportedAt, status: e.status, origin: e.origin, description: e.failureLabel ?? e.catalog?.description ?? e.reportedDescription ?? null, line: e.lineCode ?? null, isUnscheduledReturn: e.isUnscheduledReturn })),
    };
  }

  private async preventives(limit: number) {
    const rows = await this.scheduling.timeline();
    const sorted = rows
      .filter((r) => r.kmToWindow !== null)
      .sort((a, b) => (a.kmToWindow as number) - (b.kmToWindow as number))
      .slice(0, limit)
      .map((r) => ({ vehicle: r.vehicleCode, technology: r.technology, currentKm: r.currentKm, nextPackage: r.nextPackageName, nextWindowKm: r.nextWindowKm, kmToWindow: r.kmToWindow, daysToWindow: r.daysToWindow, isKmDegraded: r.isKmDegraded }));
    return { total: rows.length, overdue: rows.filter((r) => (r.kmToWindow ?? 1) < 0).length, next: sorted };
  }
}

/** JSON com teto de tamanho: além dele, corta listas até caber e avisa. */
function compact(value: object): string {
  let s = JSON.stringify(value, dateReplacer);
  if (s.length <= MAX_CHARS) return s;
  const shrink = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.slice(0, Math.max(3, Math.floor(v.length / 2))).map(shrink);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, shrink(x)]));
    return v;
  };
  let cur: unknown = value;
  for (let i = 0; i < 6 && s.length > MAX_CHARS; i += 1) {
    cur = shrink(cur);
    s = JSON.stringify({ ...(cur as object), truncated: true }, dateReplacer);
  }
  return s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}…` : s;
}

function dateReplacer(_k: string, v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : v;
}
