import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  paginate,
  type CatalogQuery,
  type CreateFailureCatalogItemInput,
  type CreateReasonCodeInput,
  type FailureCatalogItem,
  type Paginated,
  type ReasonCode,
  type ReasonCodeList,
  type UpdateFailureCatalogItemInput,
  type UpdateReasonCodeInput,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

/**
 * RF-32/33 — catálogo de falhas versionado e as cinco listas de códigos.
 *
 * O catálogo é o que dá inteligência à triagem (RF-02) e decide o fast-track
 * (RF-06), então versão publicada é imutável: um item novo entra sempre na
 * versão rascunho, e eventos antigos continuam apontando para a versão sob a
 * qual foram registrados.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** A versão rascunho é a única editável; criada sob demanda. */
  async currentDraftVersion() {
    const draft = await this.prisma.failureCatalogVersion.findFirst({
      where: { publishedAt: null },
      orderBy: { version: 'desc' },
    });
    if (draft) return draft;

    const last = await this.prisma.failureCatalogVersion.findFirst({
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    return this.prisma.failureCatalogVersion.create({
      data: { version: (last?.version ?? 0) + 1 },
    });
  }

  async publishedVersion() {
    return this.prisma.failureCatalogVersion.findFirst({
      where: { publishedAt: { not: null } },
      orderBy: { version: 'desc' },
    });
  }

  async publishVersion(versionId: string, actorId: string) {
    const version = await this.prisma.failureCatalogVersion.findUnique({
      where: { id: versionId },
      include: { _count: { select: { items: true } } },
    });
    if (!version) throw new NotFoundException('Versão do catálogo não encontrada');
    if (version.publishedAt) throw new ConflictException('Esta versão já foi publicada');
    if (version._count.items === 0) {
      throw new BadRequestException('Não é possível publicar uma versão sem itens');
    }

    const published = await this.prisma.failureCatalogVersion.update({
      where: { id: versionId },
      data: { publishedAt: new Date(), publishedById: actorId },
    });

    await this.audit.write({
      actorId,
      action: 'catalog.publish',
      entity: 'FailureCatalogVersion',
      entityId: versionId,
      after: { version: published.version, items: version._count.items },
    });

    return published;
  }

  async createItem(
    input: CreateFailureCatalogItemInput,
    actorId: string,
  ): Promise<FailureCatalogItem> {
    const draft = await this.currentDraftVersion();

    const exists = await this.prisma.failureCatalogItem.findUnique({
      where: { versionId_code: { versionId: draft.id, code: input.code } },
    });
    if (exists) throw new ConflictException(`Já existe o código ${input.code} nesta versão`);

    const item = await this.prisma.failureCatalogItem.create({
      data: { ...input, versionId: draft.id },
    });

    await this.audit.write({
      actorId,
      action: 'catalog.item.create',
      entity: 'FailureCatalogItem',
      entityId: item.id,
      after: input,
    });

    return toCatalogItem(item);
  }

  async updateItem(
    id: string,
    input: UpdateFailureCatalogItemInput,
    actorId: string,
  ): Promise<FailureCatalogItem> {
    const before = await this.prisma.failureCatalogItem.findUnique({
      where: { id },
      include: { version: { select: { publishedAt: true } } },
    });
    if (!before) throw new NotFoundException('Item do catálogo não encontrado');
    if (before.version.publishedAt) {
      throw new ConflictException(
        'Versão publicada é imutável — crie uma nova versão para alterar o catálogo',
      );
    }

    const next = { ...before, ...input };
    if (next.isSafety && next.isDeferrable) {
      // RF-05: falha de segurança nunca pode ser deferida.
      throw new BadRequestException('Falha de segurança não pode ser marcada como deferível');
    }

    const item = await this.prisma.failureCatalogItem.update({ where: { id }, data: input });

    await this.audit.write({
      actorId,
      action: 'catalog.item.update',
      entity: 'FailureCatalogItem',
      entityId: id,
      before: {
        isFastTrack: before.isFastTrack,
        isSafety: before.isSafety,
        isDeferrable: before.isDeferrable,
      },
      after: input,
    });

    return toCatalogItem(item);
  }

  async listItems(query: CatalogQuery): Promise<Paginated<FailureCatalogItem>> {
    const versionId = query.versionId ?? (await this.publishedVersion())?.id ?? (await this.currentDraftVersion()).id;

    const where: Prisma.FailureCatalogItemWhereInput = {
      versionId,
      ...(query.onlyActive ? { isActive: true } : {}),
      ...(query.isFastTrack !== undefined ? { isFastTrack: query.isFastTrack } : {}),
      ...(query.isSafety !== undefined ? { isSafety: query.isSafety } : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' as const } },
              { description: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.failureCatalogItem.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.failureCatalogItem.count({ where }),
    ]);

    return paginate(rows.map(toCatalogItem), total, { page: query.page, perPage: query.perPage });
  }

  // --- Códigos de motivo (RF-33) -------------------------------------------

  async listReasonCodes(list?: ReasonCodeList, onlyActive = true): Promise<ReasonCode[]> {
    const rows = await this.prisma.reasonCode.findMany({
      where: { ...(list ? { list } : {}), ...(onlyActive ? { isActive: true } : {}) },
      orderBy: [{ list: 'asc' }, { code: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      list: r.list,
      code: r.code,
      description: r.description,
      isActive: r.isActive,
    }));
  }

  async createReasonCode(input: CreateReasonCodeInput, actorId: string): Promise<ReasonCode> {
    const exists = await this.prisma.reasonCode.findUnique({
      where: { list_code: { list: input.list, code: input.code } },
    });
    if (exists) throw new ConflictException(`Já existe o código ${input.code} nesta lista`);

    const created = await this.prisma.reasonCode.create({ data: input });
    await this.audit.write({
      actorId,
      action: 'reasonCode.create',
      entity: 'ReasonCode',
      entityId: created.id,
      after: input,
    });

    return {
      id: created.id,
      list: created.list,
      code: created.code,
      description: created.description,
      isActive: created.isActive,
    };
  }

  /** RF-33 — desativação em vez de exclusão: registros antigos seguem legíveis. */
  async updateReasonCode(
    id: string,
    input: UpdateReasonCodeInput,
    actorId: string,
  ): Promise<ReasonCode> {
    const before = await this.prisma.reasonCode.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Código de motivo não encontrado');

    const updated = await this.prisma.reasonCode.update({ where: { id }, data: input });
    await this.audit.write({
      actorId,
      action: 'reasonCode.update',
      entity: 'ReasonCode',
      entityId: id,
      before: { description: before.description, isActive: before.isActive },
      after: input,
    });

    return {
      id: updated.id,
      list: updated.list,
      code: updated.code,
      description: updated.description,
      isActive: updated.isActive,
    };
  }
}

function toCatalogItem(item: {
  id: string;
  versionId: string;
  code: string;
  description: string;
  system: string | null;
  subsystem: string | null;
  isFastTrack: boolean;
  isSafety: boolean;
  isDeferrable: boolean;
  probableCause: string | null;
  estimatedRepairMinutes: number | null;
  fieldResolutionRate: Prisma.Decimal | null;
  fieldResolutionSamples: number;
  isActive: boolean;
}): FailureCatalogItem {
  return {
    id: item.id,
    versionId: item.versionId,
    code: item.code,
    description: item.description,
    system: item.system,
    subsystem: item.subsystem,
    isFastTrack: item.isFastTrack,
    isSafety: item.isSafety,
    isDeferrable: item.isDeferrable,
    probableCause: item.probableCause,
    estimatedRepairMinutes: item.estimatedRepairMinutes,
    fieldResolutionRate: item.fieldResolutionRate ? Number(item.fieldResolutionRate) : null,
    fieldResolutionSamples: item.fieldResolutionSamples,
    isActive: item.isActive,
  };
}
