import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { KmSource, OdometerStatus, Prisma, UserRole } from '@prisma/client';
import {
  classifyOdometerDelta,
  KM_DEGRADATION_DAYS,
  type KmProjection,
  type OdometerBatchInput,
  type OdometerBatchResult,
  type OdometerBatchResultItem,
  type OdometerEntryInput,
  type OdometerQuery,
  type OdometerReading,
  type Paginated,
} from '@app/shared';
import { paginate } from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;

/**
 * RF-14/15 — quilometragem.
 *
 * Duas fontes convivem: a telemetria dos eBUS escreve sozinha, e o diesel
 * depende de lançamento humano. O PRD trata essa disciplina como o principal
 * risco do R0 (seção 10), então a validação acontece na origem e a ausência
 * de leitura tem consequência visível: a projeção degrada e o PCM é alertado.
 */
@Injectable()
export class OdometerService {
  private readonly logger = new Logger(OdometerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registerBatch(
    input: OdometerBatchInput,
    actorId: string,
    source: KmSource = KmSource.MANUAL,
  ): Promise<OdometerBatchResult> {
    const vehicleIds = [...new Set(input.entries.map((e) => e.vehicleId))];
    if (vehicleIds.length !== input.entries.length) {
      throw new BadRequestException('Há mais de uma leitura para o mesmo carro no lote');
    }

    const vehicles = await this.prisma.vehicle.findMany({
      where: { id: { in: vehicleIds } },
      select: { id: true, code: true, odometerOffset: true, currentKm: true, lastReadingAt: true },
    });
    const byId = new Map(vehicles.map((v) => [v.id, v]));

    const items: OdometerBatchResultItem[] = [];

    for (const entry of input.entries) {
      const vehicle = byId.get(entry.vehicleId);
      if (!vehicle) {
        items.push({
          vehicleId: entry.vehicleId,
          vehicleCode: '—',
          accepted: false,
          status: OdometerStatus.REJECTED,
          deltaKm: null,
          message: 'Carro não encontrado',
        });
        continue;
      }

      items.push(await this.registerOne(entry, vehicle, actorId, source));
    }

    return {
      accepted: items.filter((i) => i.accepted).length,
      suspect: items.filter((i) => i.status === OdometerStatus.SUSPECT).length,
      rejected: items.filter((i) => i.status === OdometerStatus.REJECTED).length,
      items,
    };
  }

  private async registerOne(
    entry: OdometerEntryInput,
    vehicle: { id: string; code: string; odometerOffset: number; currentKm: number },
    actorId: string,
    source: KmSource,
  ): Promise<OdometerBatchResultItem> {
    // O offset absorve trocas de hodômetro: a leitura crua fica preservada,
    // e a série histórica continua contínua em adjustedKm.
    const adjustedKm = entry.rawKm + vehicle.odometerOffset;

    const previous = await this.prisma.odometerReading.findFirst({
      where: { vehicleId: vehicle.id, status: { not: OdometerStatus.REJECTED } },
      orderBy: { readAt: 'desc' },
      select: { adjustedKm: true, readAt: true },
    });

    const deltaKm = previous ? adjustedKm - previous.adjustedKm : null;
    const { status, message } = classifyOdometerDelta(deltaKm);

    if (status === OdometerStatus.REJECTED) {
      // Recusada não entra na série, mas fica registrada para auditoria da tela.
      await this.prisma.odometerReading.create({
        data: {
          vehicleId: vehicle.id,
          rawKm: entry.rawKm,
          adjustedKm,
          deltaKm,
          readAt: entry.readAt,
          source,
          status,
          enteredById: actorId,
          note: entry.note ?? message ?? undefined,
        },
      });

      return {
        vehicleId: vehicle.id,
        vehicleCode: vehicle.code,
        accepted: false,
        status,
        deltaKm,
        message,
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.odometerReading.create({
        data: {
          vehicleId: vehicle.id,
          rawKm: entry.rawKm,
          adjustedKm,
          deltaKm,
          readAt: entry.readAt,
          source,
          status,
          enteredById: actorId,
          note: entry.note,
        },
      });

      // Só avança o acumulado do carro; leitura atrasada não anda para trás.
      if (adjustedKm > vehicle.currentKm) {
        await tx.vehicle.update({
          where: { id: vehicle.id },
          data: { currentKm: adjustedKm, lastReadingAt: entry.readAt },
        });
      }
    });

    await this.refreshProjection(vehicle.id);

    return {
      vehicleId: vehicle.id,
      vehicleCode: vehicle.code,
      accepted: true,
      status,
      deltaKm,
      message,
    };
  }

  /**
   * Recalcula a média diária sobre a janela recente e projeta o km de hoje.
   * Sem leitura há mais de KM_DEGRADATION_DAYS dias, a projeção segue sendo
   * publicada — mas marcada como degradada, e o PCM recebe notificação.
   */
  async refreshProjection(vehicleId: string, now: Date = new Date()): Promise<KmProjection> {
    const readings = await this.prisma.odometerReading.findMany({
      where: { vehicleId, status: { not: OdometerStatus.REJECTED } },
      orderBy: { readAt: 'desc' },
      take: 30,
      select: { adjustedKm: true, readAt: true },
    });

    const latest = readings[0];
    if (!latest) {
      throw new NotFoundException('Carro sem nenhuma leitura de odômetro');
    }

    const oldest = readings[readings.length - 1]!;
    const spanDays = Math.max(1, (latest.readAt.getTime() - oldest.readAt.getTime()) / DAY_MS);
    const spanKm = latest.adjustedKm - oldest.adjustedKm;
    const avgDailyKm = readings.length > 1 ? Math.max(0, spanKm / spanDays) : 0;

    const daysSinceReading = (now.getTime() - latest.readAt.getTime()) / DAY_MS;
    const isDegraded = daysSinceReading > KM_DEGRADATION_DAYS;
    const projectedKm = Math.round(latest.adjustedKm + avgDailyKm * Math.max(0, daysSinceReading));

    const existing = await this.prisma.kmProjection.findUnique({ where: { vehicleId } });

    // degradedSince preserva o início do problema em degradações consecutivas.
    const degradedSince = isDegraded ? (existing?.degradedSince ?? now) : null;

    const saved = await this.prisma.kmProjection.upsert({
      where: { vehicleId },
      create: {
        vehicleId,
        avgDailyKm: new Prisma.Decimal(avgDailyKm.toFixed(2)),
        projectedKm,
        projectedAt: now,
        lastReadingAt: latest.readAt,
        isDegraded,
        degradedSince,
        sampleDays: Math.round(spanDays),
      },
      update: {
        avgDailyKm: new Prisma.Decimal(avgDailyKm.toFixed(2)),
        projectedKm,
        projectedAt: now,
        lastReadingAt: latest.readAt,
        isDegraded,
        degradedSince,
        sampleDays: Math.round(spanDays),
      },
    });

    if (isDegraded && !existing?.isDegraded) {
      await this.notifyDegradation(vehicleId, latest.readAt);
    }

    return {
      vehicleId: saved.vehicleId,
      avgDailyKm: Number(saved.avgDailyKm),
      projectedKm: saved.projectedKm,
      projectedAt: saved.projectedAt.toISOString(),
      lastReadingAt: saved.lastReadingAt?.toISOString() ?? null,
      isDegraded: saved.isDegraded,
      degradedSince: saved.degradedSince?.toISOString() ?? null,
      sampleDays: saved.sampleDays,
    };
  }

  /**
   * Varredura diária de toda a frota: quem passou da janela sem leitura entra
   * em degradação, mesmo sem ninguém ter lançado nada — é justamente a ausência
   * de lançamento que precisa gerar sinal.
   */
  async refreshAllProjections(now: Date = new Date()): Promise<{ updated: number; degraded: number }> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    let updated = 0;
    let degraded = 0;

    for (const { id } of vehicles) {
      try {
        const projection = await this.refreshProjection(id, now);
        updated += 1;
        if (projection.isDegraded) degraded += 1;
      } catch (err) {
        // Carro ainda sem leitura nenhuma não é erro: é o estado inicial.
        if (!(err instanceof NotFoundException)) {
          this.logger.error(`Falha ao projetar km do carro ${id}`, err as Error);
        }
      }
    }

    return { updated, degraded };
  }

  private async notifyDegradation(vehicleId: string, lastReadingAt: Date): Promise<void> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { code: true },
    });

    await this.prisma.notification.create({
      data: {
        role: UserRole.PCM,
        title: `Projeção de km degradada — carro ${vehicle?.code ?? vehicleId}`,
        body:
          `Sem leitura de odômetro desde ${lastReadingAt.toLocaleDateString('pt-BR')}. ` +
          `A projeção segue publicada em modo degradado até o próximo lançamento.`,
        entity: 'Vehicle',
        entityId: vehicleId,
      },
    });
  }

  async list(query: OdometerQuery): Promise<Paginated<OdometerReading>> {
    const where: Prisma.OdometerReadingWhereInput = {
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.from || query.to
        ? { readAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.odometerReading.findMany({
        where,
        orderBy: { readAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
        include: { vehicle: { select: { code: true } } },
      }),
      this.prisma.odometerReading.count({ where }),
    ]);

    return paginate(
      rows.map((r) => ({
        id: r.id,
        vehicleId: r.vehicleId,
        vehicleCode: r.vehicle.code,
        rawKm: r.rawKm,
        adjustedKm: r.adjustedKm,
        deltaKm: r.deltaKm,
        readAt: r.readAt.toISOString(),
        source: r.source,
        status: r.status,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      { page: query.page, perPage: query.perPage },
    );
  }
}
