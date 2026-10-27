import { BadRequestException, Body, Controller, Get, Injectable, Module, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  AUDIT_AREAS,
  AuditKind,
  auditCriteria,
  auditMaxPerItem,
  createAuditSchema,
  type AuditAreaStatus,
  type AuditRow,
  type AuditSummary,
  type CreateAuditInput,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

const DAY_MS = 86_400_000;
const PERIOD_DAYS: Record<AuditKind, number> = { FIVE_S: 30, COMPLIANCE: 90 };

/**
 * Kaizen — auditorias 5S (mensal) e de conformidade (trimestral). A nota é
 * a soma dos critérios; a próxima data é o calendário do Kaizen; o que está
 * atrasado aparece na Daily e na tela de auditorias.
 */
@Injectable()
export class AuditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateAuditInput, actorId: string): Promise<AuditRow> {
    const defs = auditCriteria(input.kind);
    const max = auditMaxPerItem(input.kind);
    const byKey = new Map(defs.map((d) => [d.key, d]));
    const items = input.items.filter((i) => byKey.has(i.key));
    if (items.length !== defs.length) throw new BadRequestException(`A auditoria tem ${defs.length} critérios; avalie todos`);
    for (const i of items) if (i.score > max) throw new BadRequestException(`Nota máxima por critério é ${max}`);
    const total = items.reduce((s, i) => s + i.score, 0);
    const score = Math.round((total / (defs.length * max)) * 100);
    const auditedAt = input.auditedAt ?? new Date();
    const row = await this.prisma.processAudit.create({
      data: {
        kind: input.kind,
        area: input.area,
        auditedAt,
        auditorId: actorId,
        score,
        actions: input.actions ?? null,
        nextDueAt: new Date(auditedAt.getTime() + PERIOD_DAYS[input.kind] * DAY_MS),
        items: { create: items.map((i) => ({ key: i.key, label: byKey.get(i.key)!.label, score: i.score, max, note: i.note ?? null })) },
      },
    });
    await this.audit.write({ actorId, action: 'processAudit.create', entity: 'ProcessAudit', entityId: row.id, after: { kind: row.kind, area: row.area, score } });
    return (await this.list()).find((r) => r.id === row.id)!;
  }

  async list(kind?: AuditKind, limit = 60): Promise<AuditRow[]> {
    const rows = await this.prisma.processAudit.findMany({
      where: kind ? { kind } : undefined,
      orderBy: { auditedAt: 'desc' },
      take: limit,
      include: { items: true },
    });
    const userIds = [...new Set(rows.map((r) => r.auditorId))];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const name = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as AuditKind,
      area: r.area as AuditRow['area'],
      auditedAt: r.auditedAt.toISOString(),
      auditorName: name.get(r.auditorId) ?? null,
      score: r.score,
      items: r.items.map((i) => ({ key: i.key, label: i.label, score: i.score, max: i.max, note: i.note })),
      actions: r.actions,
      nextDueAt: r.nextDueAt.toISOString(),
    }));
  }

  async summary(now = new Date()): Promise<AuditSummary> {
    const rows = await this.prisma.processAudit.findMany({ orderBy: { auditedAt: 'desc' }, select: { kind: true, area: true, score: true, auditedAt: true, nextDueAt: true } });
    const status = (kind: AuditKind): AuditAreaStatus[] =>
      AUDIT_AREAS.map((area) => {
        const hist = rows.filter((r) => r.kind === kind && r.area === area);
        const last = hist[0];
        const prev = hist[1];
        return {
          area,
          kind,
          lastScore: last?.score ?? null,
          previousScore: prev?.score ?? null,
          lastAt: last?.auditedAt.toISOString() ?? null,
          nextDueAt: last?.nextDueAt.toISOString() ?? null,
          // Sem auditoria nenhuma, está devendo; com auditoria, deve quando passou da próxima data.
          isOverdue: !last || last.nextDueAt < now,
        };
      });
    const fiveS = status(AuditKind.FIVE_S);
    const compliance = status(AuditKind.COMPLIANCE);
    const avg = (xs: AuditAreaStatus[]) => {
      const v = xs.map((x) => x.lastScore).filter((x): x is number => x !== null);
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
    };
    return { fiveS, compliance, averageFiveS: avg(fiveS), averageCompliance: avg(compliance), overdue: [...fiveS, ...compliance].filter((x) => x.isOverdue).length };
  }
}

const AUDITORS = [UserRole.ADMIN, UserRole.PCM, UserRole.GESTAO, UserRole.MANUTENCAO, UserRole.ESTOQUE] as const;

@ApiTags('auditorias')
@ApiBearerAuth()
@Controller('audits')
@UseGuards(RolesGuard)
export class AuditsController {
  constructor(private readonly audits: AuditsService) {}

  @Get()
  list(@Query('kind') kind?: string): Promise<AuditRow[]> {
    return this.audits.list(kind === 'FIVE_S' || kind === 'COMPLIANCE' ? kind : undefined);
  }

  @Get('summary')
  summary(): Promise<AuditSummary> {
    return this.audits.summary();
  }

  @Post()
  @Roles(...AUDITORS)
  create(@Body(new ZodValidationPipe(createAuditSchema)) body: CreateAuditInput, @CurrentUser('sub') actorId: string): Promise<AuditRow> {
    return this.audits.create(body, actorId);
  }
}

@Module({
  controllers: [AuditsController],
  providers: [AuditsService],
  exports: [AuditsService],
})
export class AuditsModule {}
