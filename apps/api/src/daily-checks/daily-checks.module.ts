import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EventOrigin, UserRole } from '@prisma/client';
import {
  createDailyCheckSchema,
  dailyCheckItemsFor,
  dailyCheckQuerySchema,
  DAILY_CHECK_ITEMS,
  type CreateDailyCheckInput,
  type DailyCheckQuery,
  type DailyCheckRow,
  type DailyCheckSummary,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { EventsService } from '../events/events.service';
import { EventsModule } from '../events/events.module';

const DAY_MS = 86_400_000;

/** Início e fim do dia local informado (YYYY-MM-DD) ou de hoje. */
function dayBounds(date?: string): { from: Date; to: Date; key: string } {
  const base = date ? new Date(`${date}T00:00:00`) : new Date();
  const from = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const to = new Date(from.getTime() + DAY_MS);
  const key = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
  return { from, to, key };
}

/**
 * Checklist diário de conservação (Fluxos PCM p.8). Item reprovado abre o
 * evento corretivo na hora, pelo mesmo caminho que o CCO usaria: triagem,
 * fila, OS. Nada de lista paralela de "pendências do pátio".
 */
@Injectable()
export class DailyChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  async create(input: CreateDailyCheckInput, actorId: string): Promise<DailyCheckRow> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: input.vehicleId } });
    if (!vehicle) throw new NotFoundException('Carro não encontrado');
    if (!vehicle.isActive) throw new BadRequestException('Carro inativo não recebe checklist');

    const defs = dailyCheckItemsFor(vehicle.technology);
    const byKey = new Map(defs.map((d) => [d.key, d]));
    const items = input.items.filter((i) => byKey.has(i.key));
    if (items.length !== defs.length) {
      throw new BadRequestException(`O checklist de ${vehicle.technology === 'EBUS' ? 'eBUS' : 'diesel'} tem ${defs.length} itens; marque todos`);
    }
    const nok = items.filter((i) => !i.ok);

    // Reprovou: um evento corretivo, no código do primeiro item, com todos os
    // itens reprovados na descrição. O catálogo decide fast-track/segurança.
    let eventId: string | null = null;
    if (nok.length > 0) {
      const first = byKey.get(nok[0]!.key)!;
      const description = nok.map((i) => `${byKey.get(i.key)!.label}${i.note ? ` (${i.note})` : ''}`).join('; ');
      const ev = await this.events.create(
        {
          vehicleId: vehicle.id,
          origin: EventOrigin.GARAGE,
          operatorId: input.operatorId,
          failureModeCode: first.failureModeCode,
          subsystemCode: first.subsystemCode,
          reportedDescription: `Checklist diário reprovado: ${description}`.slice(0, 500),
        } as Parameters<EventsService['create']>[0],
        actorId,
      );
      eventId = ev.id;
    }

    const row = await this.prisma.dailyCheck.create({
      data: {
        vehicleId: vehicle.id,
        checkedById: actorId,
        operatorId: input.operatorId ?? null,
        odometerKm: input.odometerKm ?? null,
        note: input.note ?? null,
        result: nok.length ? 'NOK' : 'OK',
        eventId,
        items: { create: items.map((i) => ({ key: i.key, label: byKey.get(i.key)!.label, ok: i.ok, note: i.note ?? null })) },
      },
    });
    await this.audit.write({ actorId, action: 'dailyCheck.create', entity: 'DailyCheck', entityId: row.id, after: { vehicleCode: vehicle.code, result: row.result, nok: nok.map((i) => i.key), eventId } });
    return (await this.list({ vehicleId: vehicle.id })).find((r) => r.id === row.id)!;
  }

  async list(query: DailyCheckQuery): Promise<DailyCheckRow[]> {
    const { from, to } = dayBounds(query.date);
    const rows = await this.prisma.dailyCheck.findMany({
      where: { checkedAt: { gte: from, lt: to }, ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}) },
      orderBy: { checkedAt: 'desc' },
      include: { vehicle: { select: { code: true, plate: true, technology: true } }, operator: { select: { name: true } }, event: { select: { code: true } }, items: { where: { ok: false } } },
    });
    const userIds = [...new Set(rows.map((r) => r.checkedById))];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      id: r.id,
      vehicleId: r.vehicleId,
      vehicleCode: r.vehicle.code,
      vehiclePlate: r.vehicle.plate,
      technology: r.vehicle.technology,
      checkedAt: r.checkedAt.toISOString(),
      checkedByName: nameById.get(r.checkedById) ?? null,
      operatorName: r.operator?.name ?? null,
      odometerKm: r.odometerKm,
      result: r.result as DailyCheckRow['result'],
      nokItems: r.items.map((i) => ({ key: i.key, label: i.label, note: i.note })),
      note: r.note,
      eventId: r.eventId,
      eventCode: r.event?.code ?? null,
    }));
  }

  async summary(date?: string): Promise<DailyCheckSummary> {
    const { from, to, key } = dayBounds(date);
    const [fleet, rows] = await Promise.all([
      this.prisma.vehicle.count({ where: { isActive: true } }),
      this.prisma.dailyCheck.findMany({ where: { checkedAt: { gte: from, lt: to } }, select: { vehicleId: true, result: true } }),
    ]);
    const vehicles = new Set(rows.map((r) => r.vehicleId));
    const nok = new Set(rows.filter((r) => r.result === 'NOK').map((r) => r.vehicleId)).size;
    return { date: key, fleet, checked: vehicles.size, ok: vehicles.size - nok, nok, pending: Math.max(0, fleet - vehicles.size) };
  }

  /** A definição dos itens é do sistema, não do banco: a tela pede aqui para não duplicar. */
  template() {
    return DAILY_CHECK_ITEMS;
  }
}

const CHECKERS = [UserRole.ADMIN, UserRole.PCM, UserRole.MANUTENCAO, UserRole.MECANICO, UserRole.INSPETOR, UserRole.CCO, UserRole.PLANTAO] as const;

@ApiTags('checklist diário')
@ApiBearerAuth()
@Controller('daily-checks')
@UseGuards(RolesGuard)
export class DailyChecksController {
  constructor(private readonly checks: DailyChecksService) {}

  @Get()
  list(@Query(new ZodValidationPipe(dailyCheckQuerySchema)) query: DailyCheckQuery): Promise<DailyCheckRow[]> {
    return this.checks.list(query);
  }

  @Get('summary')
  summary(@Query('date') date?: string): Promise<DailyCheckSummary> {
    return this.checks.summary(date);
  }

  @Get('template')
  template() {
    return this.checks.template();
  }

  @Post()
  @Roles(...CHECKERS)
  create(@Body(new ZodValidationPipe(createDailyCheckSchema)) body: CreateDailyCheckInput, @CurrentUser('sub') actorId: string): Promise<DailyCheckRow> {
    return this.checks.create(body, actorId);
  }
}

@Module({
  imports: [EventsModule],
  controllers: [DailyChecksController],
  providers: [DailyChecksService],
  exports: [DailyChecksService],
})
export class DailyChecksModule {}
