import { Body, Controller, Get, Injectable, Module, NotFoundException, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  COMPONENT_KINDS,
  COMPONENT_KIND_KEYS,
  COMPONENT_NEAR_LIFE_PCT,
  installComponentSchema,
  type ComponentKind,
  type ComponentLifeStatus,
  type ComponentRow,
  type ComponentsSummary,
  type InstallComponentInput,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

/**
 * Kaizen — componentes rastreáveis com vida por km. Cada troca fecha o
 * componente anterior (com a vida real que ele fez) e abre o novo a partir
 * do km do carro; a lista mostra o que está perto ou acima da vida esperada.
 */
@Injectable()
export class ComponentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private status(usedKm: number, expectedLifeKm: number, lifePct: number): ComponentLifeStatus {
    return usedKm >= expectedLifeKm ? 'OVER' : lifePct >= COMPONENT_NEAR_LIFE_PCT ? 'NEAR' : 'OK';
  }

  async list(vehicleId?: string): Promise<ComponentRow[]> {
    const rows = await this.prisma.vehicleComponent.findMany({
      where: { removedAt: null, ...(vehicleId ? { vehicleId } : {}), vehicle: { isActive: true } },
      include: { vehicle: { select: { code: true, technology: true, currentKm: true, kmProjection: { select: { avgDailyKm: true } } } } },
    });
    const removed = await this.prisma.vehicleComponent.findMany({
      where: { removedAt: { not: null }, ...(vehicleId ? { vehicleId } : {}) },
      orderBy: { removedAt: 'desc' },
      select: { vehicleId: true, kind: true, installedAtKm: true, removedAtKm: true },
    });
    const previous = new Map<string, number>();
    for (const r of removed) {
      const key = `${r.vehicleId}:${r.kind}`;
      if (!previous.has(key) && r.removedAtKm !== null) previous.set(key, Math.max(0, r.removedAtKm - r.installedAtKm));
    }
    const order: Record<ComponentLifeStatus, number> = { OVER: 0, NEAR: 1, OK: 2 };
    return rows
      .map((c) => {
        const usedKm = Math.max(0, c.vehicle.currentKm - c.installedAtKm);
        const lifePct = c.expectedLifeKm > 0 ? Math.round((usedKm / c.expectedLifeKm) * 100) : 0;
        const remainingKm = c.expectedLifeKm - usedKm;
        const avg = c.vehicle.kmProjection ? Number(c.vehicle.kmProjection.avgDailyKm) : 0;
        return {
          id: c.id,
          vehicleId: c.vehicleId,
          vehicleCode: c.vehicle.code,
          technology: c.vehicle.technology,
          kind: c.kind as ComponentKind,
          kindLabel: COMPONENT_KINDS[c.kind as ComponentKind]?.label ?? c.kind,
          serialNumber: c.serialNumber,
          installedAt: c.installedAt.toISOString(),
          installedAtKm: c.installedAtKm,
          expectedLifeKm: c.expectedLifeKm,
          currentKm: c.vehicle.currentKm,
          usedKm,
          lifePct,
          remainingKm,
          daysToLife: avg > 0 ? Math.round(remainingKm / avg) : null,
          status: this.status(usedKm, c.expectedLifeKm, lifePct),
          installReason: c.installReason as ComponentRow['installReason'],
          note: c.note,
          previousLifeKm: previous.get(`${c.vehicleId}:${c.kind}`) ?? null,
        };
      })
      .sort((a, b) => order[a.status] - order[b.status] || b.lifePct - a.lifePct || a.vehicleCode.localeCompare(b.vehicleCode));
  }

  async summary(): Promise<ComponentsSummary> {
    const active = await this.list();
    const removed = await this.prisma.vehicleComponent.findMany({
      where: { removedAt: { not: null } },
      select: { kind: true, installedAtKm: true, removedAtKm: true, removalReason: true },
    });
    const byKind = COMPONENT_KIND_KEYS.map((kind) => {
      const act = active.filter((c) => c.kind === kind);
      const rem = removed.filter((r) => r.kind === kind && r.removedAtKm !== null);
      const lives = rem.map((r) => Math.max(0, (r.removedAtKm ?? 0) - r.installedAtKm));
      return {
        kind,
        label: COMPONENT_KINDS[kind].label,
        expectedLifeKm: COMPONENT_KINDS[kind].lifeKm,
        active: act.length,
        over: act.filter((c) => c.status === 'OVER').length,
        near: act.filter((c) => c.status === 'NEAR').length,
        removals: rem.length,
        failures: rem.filter((r) => r.removalReason === 'FALHA').length,
        avgLifeAtRemovalKm: lives.length ? Math.round(lives.reduce((a, b) => a + b, 0) / lives.length) : null,
      };
    }).filter((k) => k.active > 0 || k.removals > 0);
    return {
      tracked: active.length,
      over: active.filter((c) => c.status === 'OVER').length,
      near: active.filter((c) => c.status === 'NEAR').length,
      byKind,
    };
  }

  /** Registra a troca: fecha o componente atual do mesmo tipo e abre o novo. */
  async install(input: InstallComponentInput, actorId: string): Promise<ComponentRow[]> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: input.vehicleId }, select: { id: true, code: true, currentKm: true } });
    if (!vehicle) throw new NotFoundException('Carro não encontrado');
    const km = input.installedAtKm ?? vehicle.currentKm;
    const at = input.installedAt ?? new Date();
    const current = await this.prisma.vehicleComponent.findFirst({ where: { vehicleId: vehicle.id, kind: input.kind, removedAt: null } });
    await this.prisma.$transaction(async (tx) => {
      if (current) {
        await tx.vehicleComponent.update({ where: { id: current.id }, data: { removedAt: at, removedAtKm: km, removalReason: input.reason === 'INICIAL' ? 'PREVENTIVA' : input.reason } });
      }
      await tx.vehicleComponent.create({
        data: {
          vehicleId: vehicle.id,
          kind: input.kind,
          serialNumber: input.serialNumber ?? null,
          installedAt: at,
          installedAtKm: km,
          expectedLifeKm: input.expectedLifeKm ?? COMPONENT_KINDS[input.kind].lifeKm,
          installReason: input.reason,
          note: input.note ?? null,
        },
      });
    });
    await this.audit.write({ actorId, action: 'component.install', entity: 'Vehicle', entityId: vehicle.id, after: { kind: input.kind, km, reason: input.reason, replaced: Boolean(current) } });
    return this.list(vehicle.id);
  }
}

const EDITORS = [UserRole.ADMIN, UserRole.PCM, UserRole.MANUTENCAO] as const;

@ApiTags('componentes')
@ApiBearerAuth()
@Controller('components')
@UseGuards(RolesGuard)
export class ComponentsController {
  constructor(private readonly components: ComponentsService) {}

  @Get()
  list(@Query('vehicleId') vehicleId?: string): Promise<ComponentRow[]> {
    return this.components.list(vehicleId || undefined);
  }

  @Get('summary')
  summary(): Promise<ComponentsSummary> {
    return this.components.summary();
  }

  @Post()
  @Roles(...EDITORS)
  install(@Body(new ZodValidationPipe(installComponentSchema)) body: InstallComponentInput, @CurrentUser('sub') actorId: string): Promise<ComponentRow[]> {
    return this.components.install(body, actorId);
  }
}

@Module({
  controllers: [ComponentsController],
  providers: [ComponentsService],
  exports: [ComponentsService],
})
export class ComponentsModule {}
