import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VehicleStatus as PrismaVehicleStatus } from '@prisma/client';
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
  type VehicleQuery,
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

    const vehicles = await this.prisma.vehicle.findMany({
      where,
      orderBy: { code: 'asc' },
      include: { kmProjection: true },
    });

    const rows: FleetPanelRow[] = vehicles.map((v) => {
      const lastReadingAt = v.kmProjection?.lastReadingAt ?? v.lastReadingAt;
      return {
        ...toVehicle(v),
        projectedKm: v.kmProjection?.projectedKm ?? null,
        avgDailyKm: v.kmProjection ? Number(v.kmProjection.avgDailyKm) : null,
        isKmDegraded: v.kmProjection?.isDegraded ?? false,
        daysSinceLastReading: lastReadingAt
          ? Math.floor((now.getTime() - lastReadingAt.getTime()) / DAY_MS)
          : null,
      };
    });

    const byStatus = Object.fromEntries(
      Object.values(VehicleStatus).map((s) => [s, 0]),
    ) as Record<VehicleStatus, number>;

    for (const row of rows) byStatus[row.status] += 1;

    const available = rows.filter((r) => AVAILABLE_STATUSES.includes(r.status)).length;

    return {
      summary: {
        total: rows.length,
        available,
        availabilityRate: rows.length ? available / rows.length : 0,
        byStatus,
        degradedKmCount: rows.filter((r) => r.isKmDegraded).length,
      },
      rows,
    };
  }
}

function buildWhere(query: VehicleQuery): Prisma.VehicleWhereInput {
  return {
    ...(query.onlyActive ? { isActive: true } : {}),
    ...(query.technology ? { technology: query.technology } : {}),
    ...(query.status ? { status: query.status as PrismaVehicleStatus } : {}),
    ...(query.garageId ? { garageId: query.garageId } : {}),
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
  status: Vehicle['status'];
  currentKm: number;
  lastReadingAt: Date | null;
  isActive: boolean;
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
    status: v.status,
    currentKm: v.currentKm,
    lastReadingAt: v.lastReadingAt?.toISOString() ?? null,
    isActive: v.isActive,
  };
}
