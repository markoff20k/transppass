import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OdometerStatus, Prisma, ScheduleStatus, VehicleStatus as PrismaVehicleStatus, WorkOrderStatus } from '@prisma/client';
import { nextTrigger, packagesFor } from '../scheduling/scheduling.service';
import {
  AVAILABLE_STATUSES,
  paginate,
  VehicleStatus,
  type CreateVehicleInput,
  type FleetPanelRow,
  type FleetPanelSummary,
  type Paginated,
  type UpdateVehicleInput,
  type Vehicle,
  type ChassisModelRow,
  type VehicleClass,
  type VehicleOverview,
  type VehicleQuery,
  COMPONENT_KINDS,
  COMPONENT_NEAR_LIFE_PCT,
  describeFailureCode,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

const DAY_MS = 86_400_000;

/** RF-35 (cadastro da frota) e RF-37 (painel com estados ao vivo e KPIs). */
@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateVehicleInput, actorId: string): Promise<Vehicle> {
    const clash = await this.prisma.vehicle.findFirst({
      where: { OR: [{ code: input.code }, { plate: input.plate }] },
      select: { code: true, plate: true },
    });

    if (clash) {
      throw new ConflictException(
        clash.code === input.code
          ? `Já existe carro com o prefixo ${input.code}`
          : `Já existe carro com a placa ${input.plate}`,
      );
    }

    const vehicle = await this.prisma.vehicle.create({ data: input });
    await this.audit.write({
      actorId,
      action: 'vehicle.create',
      entity: 'Vehicle',
      entityId: vehicle.id,
      after: input,
    });

    return toVehicle(vehicle);
  }

  async update(id: string, input: UpdateVehicleInput, actorId: string): Promise<Vehicle> {
    const before = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Carro não encontrado');

    const after = await this.prisma.vehicle.update({ where: { id }, data: input });

    // Offset de hodômetro reescreve a base de cálculo de todo km futuro:
    // a mudança precisa ficar rastreável no PRD (seção 8, auditoria).
    await this.audit.write({
      actorId,
      action: 'vehicle.update',
      entity: 'Vehicle',
      entityId: id,
      before: { odometerOffset: before.odometerOffset, kmSource: before.kmSource, isActive: before.isActive },
      after: input,
    });

    return toVehicle(after);
  }

  async findOne(id: string): Promise<Vehicle> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) throw new NotFoundException('Carro não encontrado');
    return toVehicle(vehicle);
  }

  async list(query: VehicleQuery): Promise<Paginated<Vehicle>> {
    const where = buildWhere(query);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.vehicle.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return paginate(rows.map(toVehicle), total, { page: query.page, perPage: query.perPage });
  }

  /**
   * Painel da frota (RF-37): estado ao vivo de cada carro somado à saúde da
   * projeção de km, para que a degradação apareça no mesmo lugar em que o PCM
   * já olha — e não num relatório separado que ninguém abre.
   */
  async fleetPanel(
    query: VehicleQuery,
    now: Date = new Date(),
  ): Promise<{ summary: FleetPanelSummary; rows: FleetPanelRow[] }> {
    const where = buildWhere(query);

    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const [vehicles, packages, checksToday, openWos] = await Promise.all([
      this.prisma.vehicle.findMany({ where, orderBy: { code: 'asc' }, include: { kmProjection: true } }),
      this.activePackages(now),
      this.prisma.dailyCheck.findMany({ where: { checkedAt: { gte: startToday } }, orderBy: { checkedAt: 'desc' }, select: { vehicleId: true, operator: { select: { name: true } } } }),
      this.prisma.workOrder.findMany({ where: { status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] } }, orderBy: { openedAt: 'desc' }, select: { vehicleId: true, code: true } }),
    ]);
    const driverByVehicle = new Map<string, string>();
    for (const c of checksToday) if (!driverByVehicle.has(c.vehicleId) && c.operator) driverByVehicle.set(c.vehicleId, c.operator.name);
    const woByVehicle = new Map<string, string>();
    for (const w of openWos) if (!woByVehicle.has(w.vehicleId)) woByVehicle.set(w.vehicleId, w.code);

    const rows: FleetPanelRow[] = vehicles.map((v) => {
      const lastReadingAt = v.kmProjection?.lastReadingAt ?? v.lastReadingAt;
      const next = nextPackageFor(packages, v);
      return {
        ...toVehicle(v),
        projectedKm: v.kmProjection?.projectedKm ?? null,
        avgDailyKm: v.kmProjection ? Number(v.kmProjection.avgDailyKm) : null,
        isKmDegraded: v.kmProjection?.isDegraded ?? false,
        daysSinceLastReading: lastReadingAt
          ? Math.floor((now.getTime() - lastReadingAt.getTime()) / DAY_MS)
          : null,
        nextPackageName: next?.name ?? null,
        kmToNextPackage: next?.kmToWindow ?? null,
        nextPackageProgress: next?.progress ?? null,
        driverName: driverByVehicle.get(v.id) ?? null,
        openWorkOrderCode: woByVehicle.get(v.id) ?? null,
      };
    });

    const byStatus = Object.fromEntries(
      Object.values(VehicleStatus).map((s) => [s, 0]),
    ) as Record<VehicleStatus, number>;

    for (const row of rows) byStatus[row.status] += 1;

    const byClass: Partial<Record<VehicleClass, number>> = {};
    for (const row of rows) {
      if (row.vehicleClass) byClass[row.vehicleClass] = (byClass[row.vehicleClass] ?? 0) + 1;
    }

    const available = rows.filter((r) => AVAILABLE_STATUSES.includes(r.status)).length;

    return {
      summary: {
        total: rows.length,
        available,
        availabilityRate: rows.length ? available / rows.length : 0,
        byStatus,
        degradedKmCount: rows.filter((r) => r.isKmDegraded).length,
        byClass,
      },
      rows,
    };
  }

  /** Tabela de modelos de chassi da Transppass, para o cadastro resolver fabricante, modelo, classe e tecnologia pelo código. */
  async listChassisModels(): Promise<ChassisModelRow[]> {
    const rows = await this.prisma.chassisModel.findMany({ orderBy: { code: 'asc' } });
    return rows.map((c) => ({ code: c.code, description: c.description, manufacturer: c.manufacturer, model: c.model, vehicleClass: c.vehicleClass as VehicleClass, rawClass: c.rawClass, hasAc: c.hasAc, isElectric: c.isElectric }));
  }

  private activePackages(now: Date) {
    return this.prisma.maintenancePackage.findMany({
      where: { plan: { isActive: true, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] } },
      include: { plan: true },
      orderBy: { intervalKm: 'asc' },
    });
  }

  /** A página do carro: estado, próxima preventiva, vida dos componentes, km e histórico dos últimos 30 dias. */
  async overview(id: string, now: Date = new Date()): Promise<VehicleOverview> {
    const v = await this.prisma.vehicle.findUnique({ where: { id }, include: { kmProjection: true, garage: { select: { name: true } } } });
    if (!v) throw new NotFoundException('Carro não encontrado');
    const d30 = new Date(now.getTime() - 30 * DAY_MS);
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const [packages, readings, events30, recentEvents, workOrders, components, lastCheck, openSchedule, records, records30, lineDays] = await Promise.all([
      this.activePackages(now),
      this.prisma.odometerReading.findMany({ where: { vehicleId: id, readAt: { gte: d30 }, status: { not: OdometerStatus.REJECTED } }, select: { readAt: true, deltaKm: true } }),
      this.prisma.failureEvent.count({ where: { vehicleId: id, reportedAt: { gte: d30 }, isUnscheduledReturn: true } }),
      this.prisma.failureEvent.findMany({ where: { vehicleId: id }, orderBy: { reportedAt: 'desc' }, take: 8, include: { catalogItem: { select: { description: true } } } }),
      this.prisma.workOrder.findMany({ where: { vehicleId: id }, orderBy: { openedAt: 'desc' }, take: 40, select: { id: true, code: true, type: true, status: true, openedAt: true, releasedAt: true } }),
      this.prisma.vehicleComponent.findMany({ where: { vehicleId: id, removedAt: null } }),
      this.prisma.dailyCheck.findFirst({ where: { vehicleId: id }, orderBy: { checkedAt: 'desc' }, include: { operator: { select: { name: true, registration: true } } } }),
      this.prisma.scheduledMaintenance.findFirst({ where: { vehicleId: id, status: { in: [ScheduleStatus.PLANNED, ScheduleStatus.CONFIRMED, ScheduleStatus.IN_EXECUTION] } }, select: { targetKm: true, package: { select: { name: true, intervalKm: true } } } }),
      this.prisma.maintenanceRecord.findMany({ where: { vehicleId: id }, orderBy: { openedAt: 'desc' }, take: 8, include: { items: true, materials: true } }),
      this.prisma.maintenanceRecord.findMany({ where: { vehicleId: id, openedAt: { gte: d30 } }, select: { id: true, materials: { select: { totalCost: true } } } }),
      this.prisma.vehicleLineDay.findMany({ where: { vehicleId: id, date: { gte: d30 } }, select: { line: true, date: true, kmInLine: true, kmIdle: true, trips: true } }),
    ]);
    const linesMap = new Map<string, { line: string; days: Set<string>; kmInLine: number; kmIdle: number; trips: number }>();
    for (const l of lineDays) {
      const key = l.line ?? '—';
      const cur = linesMap.get(key) ?? { line: key, days: new Set<string>(), kmInLine: 0, kmIdle: 0, trips: 0 };
      cur.days.add(l.date.toISOString().slice(0, 10)); cur.kmInLine += Number(l.kmInLine); cur.kmIdle += Number(l.kmIdle); cur.trips += l.trips;
      linesMap.set(key, cur);
    }

    // Km por dia (30 dias), pela data local da leitura
    const byDay = new Map<string, number>();
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date(startToday.getTime() - i * DAY_MS);
      byDay.set(localDate(d), 0);
    }
    let kmTraveled = 0;
    for (const r of readings) {
      if (!r.deltaKm || r.deltaKm <= 0) continue;
      kmTraveled += r.deltaKm;
      const key = localDate(r.readAt);
      if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + r.deltaKm);
    }

    // Horas parado em OS dentro da janela
    let downtimeMs = 0;
    for (const w of workOrders) {
      if (w.status === WorkOrderStatus.CANCELLED) continue;
      const start = Math.max(w.openedAt.getTime(), d30.getTime());
      const end = Math.min((w.releasedAt ?? now).getTime(), now.getTime());
      if (end > start) downtimeMs += end - start;
    }
    const windowMs = 30 * DAY_MS;

    const next = openSchedule
      ? { name: openSchedule.package.name, windowKm: openSchedule.targetKm, kmToWindow: openSchedule.targetKm - v.currentKm, progress: clamp01(1 - (openSchedule.targetKm - v.currentKm) / Math.max(1, openSchedule.package.intervalKm)) }
      : nextPackageFor(packages, v);
    const avg = v.kmProjection ? Number(v.kmProjection.avgDailyKm) : null;
    const lastReadingAt = v.kmProjection?.lastReadingAt ?? v.lastReadingAt;
    const openWo = workOrders.find((w) => w.status !== WorkOrderStatus.RELEASED && w.status !== WorkOrderStatus.CANCELLED) ?? null;

    return {
      vehicle: toVehicle(v),
      garageName: v.garage?.name ?? null,
      projectedKm: v.kmProjection?.projectedKm ?? null,
      avgDailyKm: avg,
      isKmDegraded: v.kmProjection?.isDegraded ?? false,
      daysSinceLastReading: lastReadingAt ? Math.floor((now.getTime() - lastReadingAt.getTime()) / DAY_MS) : null,
      driverToday: lastCheck && lastCheck.checkedAt >= startToday && lastCheck.operator ? { name: lastCheck.operator.name, registration: lastCheck.operator.registration } : null,
      lastDailyCheck: lastCheck ? { at: lastCheck.checkedAt.toISOString(), result: lastCheck.result === 'NOK' ? 'NOK' : 'OK' } : null,
      nextPackage: next ? { ...next, daysToWindow: avg && avg > 0 ? Math.round(next.kmToWindow / avg) : null } : null,
      openWorkOrder: openWo ? { id: openWo.id, code: openWo.code, status: openWo.status, openedAt: openWo.openedAt.toISOString() } : null,
      last30: {
        kmTraveled,
        returns: events30,
        workOrders: workOrders.filter((w) => w.openedAt >= d30).length,
        mkbf: events30 > 0 ? Math.round(kmTraveled / events30) : null,
        downtimeHours: Math.round(downtimeMs / 3_600_000),
        availability: clamp01(1 - downtimeMs / windowMs),
      },
      kmByDay: [...byDay.entries()].map(([date, km]) => ({ date, km })),
      components: components
        .map((c) => {
          const usedKm = Math.max(0, v.currentKm - c.installedAtKm);
          const lifePct = c.expectedLifeKm > 0 ? Math.round((usedKm / c.expectedLifeKm) * 100) : 0;
          const status: 'OK' | 'NEAR' | 'OVER' = usedKm >= c.expectedLifeKm ? 'OVER' : lifePct >= COMPONENT_NEAR_LIFE_PCT ? 'NEAR' : 'OK';
          return { id: c.id, kind: c.kind, label: COMPONENT_KINDS[c.kind as keyof typeof COMPONENT_KINDS]?.label ?? c.kind, lifePct, remainingKm: c.expectedLifeKm - usedKm, status };
        })
        .sort((a, b) => b.lifePct - a.lifePct)
        .slice(0, 5),
      recentEvents: recentEvents.map((e) => ({
        id: e.id,
        code: e.code,
        reportedAt: e.reportedAt.toISOString(),
        description: e.catalogItem?.description ?? describeFailureCode(e.failureModeCode, e.subsystemCode) ?? e.reportedDescription ?? 'Ocorrência',
        failureCode: e.failureCode,
        status: e.status,
        isUnscheduledReturn: e.isUnscheduledReturn,
      })),
      recentWorkOrders: workOrders.slice(0, 6).map((w) => ({ id: w.id, code: w.code, type: w.type, status: w.status, openedAt: w.openedAt.toISOString(), releasedAt: w.releasedAt?.toISOString() ?? null })),
      records: records.map((r) => ({
        id: r.id, externalOs: r.externalOs, openedAt: r.openedAt.toISOString(), kind: r.kind, kindLabel: r.kindLabel, isPreventive: r.isPreventive,
        allegedCode: r.allegedCode, allegedText: r.allegedText, allegedDetail: r.allegedDetail, foundCode: r.foundCode, foundText: r.foundText,
        actions: r.actions, fieldActions: r.fieldActions, mechanicReg: r.mechanicReg, line: r.line, cost: r.cost === null ? null : Number(r.cost),
        partsCost: r.materials.reduce((s, m) => s + Number(m.totalCost), 0),
        items: r.items.map((i) => ({ componentCode: i.componentCode, componentLabel: i.componentLabel, kmAtService: i.kmAtService, kmLimit: i.kmLimit })),
        materials: r.materials.map((m) => ({ materialCode: m.materialCode, description: m.description, quantity: Number(m.quantity), totalCost: Number(m.totalCost) })),
      })),
      recordsLast30: records30.length,
      partsCostLast30: Math.round(records30.reduce((s, r) => s + r.materials.reduce((x, m) => x + Number(m.totalCost), 0), 0) * 100) / 100,
      lines30: [...linesMap.values()].map((l) => ({ line: l.line, days: l.days.size, kmInLine: Math.round(l.kmInLine), kmIdle: Math.round(l.kmIdle), trips: l.trips })).sort((a, b) => b.kmInLine - a.kmInLine).slice(0, 8),
    };
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Próxima preventiva do carro pelo plano vigente: o menor gatilho acima do km atual. */
function nextPackageFor<T extends { name: string; intervalKm: number; offsetKm: number; plan: { technology: string; vehicleModel: string | null; manufacturer?: string | null } }>(
  packages: T[],
  v: { technology: string; model: string | null; manufacturer?: string | null; currentKm: number },
): { name: string; windowKm: number; kmToWindow: number; progress: number } | null {
  let next: { pkg: T; windowKm: number } | null = null;
  for (const pkg of packagesFor(packages, v)) {
    const windowKm = nextTrigger(v.currentKm, pkg);
    if (!next || windowKm < next.windowKm || (windowKm === next.windowKm && pkg.intervalKm > next.pkg.intervalKm)) next = { pkg, windowKm };
  }
  if (!next) return null;
  const kmToWindow = next.windowKm - v.currentKm;
  return { name: next.pkg.name, windowKm: next.windowKm, kmToWindow, progress: clamp01(1 - kmToWindow / Math.max(1, next.pkg.intervalKm)) };
}

function buildWhere(query: VehicleQuery): Prisma.VehicleWhereInput {
  return {
    ...(query.onlyActive ? { isActive: true } : {}),
    ...(query.technology ? { technology: query.technology } : {}),
    ...(query.status ? { status: query.status as PrismaVehicleStatus } : {}),
    ...(query.garageId ? { garageId: query.garageId } : {}),
    ...(query.vehicleClass ? { vehicleClass: query.vehicleClass } : {}),
    ...(query.lot ? { lot: query.lot } : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: 'insensitive' as const } },
            { plate: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
}

function toVehicle(v: {
  id: string;
  code: string;
  plate: string;
  technology: Vehicle['technology'];
  kmSource: Vehicle['kmSource'];
  odometerOffset: number;
  manufacturer: string | null;
  model: string | null;
  modelYear: number | null;
  garageId: string | null;
  vehicleClass: string | null;
  lot: string | null;
  fleetRole: string | null;
  status: Vehicle['status'];
  currentKm: number;
  lastReadingAt: Date | null;
  isActive: boolean;
  ccoPrefix?: string | null;
  application?: string | null;
  chassisCode?: string | null;
  vin?: string | null;
  bodyMaker?: string | null;
  bodyYear?: number | null;
  fabricationYear?: number | null;
  hasAc?: boolean;
  seats?: number | null;
  acquiredAt?: Date | null;
  isImported?: boolean;
}): Vehicle {
  return {
    id: v.id,
    code: v.code,
    plate: v.plate,
    technology: v.technology,
    kmSource: v.kmSource,
    odometerOffset: v.odometerOffset,
    manufacturer: v.manufacturer,
    model: v.model,
    modelYear: v.modelYear,
    garageId: v.garageId,
    vehicleClass: (v.vehicleClass as Vehicle['vehicleClass']) ?? null,
    lot: v.lot,
    fleetRole: (v.fleetRole as Vehicle['fleetRole']) ?? null,
    status: v.status,
    currentKm: v.currentKm,
    lastReadingAt: v.lastReadingAt?.toISOString() ?? null,
    isActive: v.isActive,
    ccoPrefix: v.ccoPrefix ?? null,
    application: v.application ?? 'FROTA',
    chassisCode: v.chassisCode ?? null,
    vin: v.vin ?? null,
    bodyMaker: v.bodyMaker ?? null,
    bodyYear: v.bodyYear ?? null,
    fabricationYear: v.fabricationYear ?? null,
    hasAc: v.hasAc ?? false,
    seats: v.seats ?? null,
    acquiredAt: v.acquiredAt?.toISOString() ?? null,
    isImported: v.isImported ?? false,
  };
}
