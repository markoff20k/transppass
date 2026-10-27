import { Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  createPartInspectionSchema,
  createSupplierSchema,
  updatePartInspectionSchema,
  updateSupplierSchema,
  type CreatePartInspectionInput,
  type CreateSupplierInput,
  type PartInspectionRow,
  type QualitySummary,
  type SupplierRow,
  type UpdatePartInspectionInput,
  type UpdateSupplierInput,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

const DAY_MS = 86_400_000;

/**
 * Kaizen — laboratório de inspeção de peças e gestão de fornecedores. Cada
 * peça avaliada vira registro com motivo, garantia e desfecho; a reincidência
 * por fornecedor sai daqui, não de planilha.
 */
@Injectable()
export class QualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- Fornecedores -----------------------------------------------------------

  async listSuppliers(): Promise<SupplierRow[]> {
    const since = new Date(Date.now() - 90 * DAY_MS);
    const rows = await this.prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { materials: { where: { isActive: true } } } },
        inspections: { where: { inspectedAt: { gte: since } }, select: { result: true, claimStatus: true } },
      },
    });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      cnpj: s.cnpj,
      contact: s.contact,
      claimSlaDays: s.claimSlaDays,
      isActive: s.isActive,
      materials: s._count.materials,
      rejections90d: s.inspections.filter((i) => i.result === 'REJECTED').length,
      claimsOpen: s.inspections.filter((i) => i.claimStatus === 'OPENED').length,
    }));
  }

  async createSupplier(input: CreateSupplierInput, actorId: string): Promise<SupplierRow> {
    const clash = await this.prisma.supplier.findUnique({ where: { name: input.name } });
    if (clash) throw new ConflictException(`Já existe o fornecedor ${input.name}`);
    const row = await this.prisma.supplier.create({ data: input });
    await this.audit.write({ actorId, action: 'supplier.create', entity: 'Supplier', entityId: row.id, after: { name: row.name } });
    return (await this.listSuppliers()).find((s) => s.id === row.id)!;
  }

  async updateSupplier(id: string, input: UpdateSupplierInput, actorId: string): Promise<SupplierRow> {
    const before = await this.prisma.supplier.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Fornecedor não encontrado');
    await this.prisma.supplier.update({ where: { id }, data: input });
    await this.audit.write({ actorId, action: 'supplier.update', entity: 'Supplier', entityId: id, after: input });
    return (await this.listSuppliers()).find((s) => s.id === id)!;
  }

  // --- Inspeções de peça -------------------------------------------------------

  async listInspections(limit = 100): Promise<PartInspectionRow[]> {
    const rows = await this.prisma.partInspection.findMany({
      orderBy: { inspectedAt: 'desc' },
      take: limit,
      include: { material: { select: { code: true, description: true } }, supplier: { select: { name: true } } },
    });
    const woIds = rows.map((r) => r.workOrderId).filter((v): v is string => Boolean(v));
    const vehicleIds = rows.map((r) => r.vehicleId).filter((v): v is string => Boolean(v));
    const userIds = [...new Set(rows.map((r) => r.inspectedById))];
    const [wos, vehicles, users] = await Promise.all([
      woIds.length ? this.prisma.workOrder.findMany({ where: { id: { in: woIds } }, select: { id: true, code: true } }) : [],
      vehicleIds.length ? this.prisma.vehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, code: true } }) : [],
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    ]);
    const woCode = new Map(wos.map((w) => [w.id, w.code]));
    const vehicleCode = new Map(vehicles.map((v) => [v.id, v.code]));
    const userName = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      id: r.id,
      materialId: r.materialId,
      materialCode: r.material.code,
      materialDescription: r.material.description,
      supplierId: r.supplierId,
      supplierName: r.supplier?.name ?? null,
      workOrderId: r.workOrderId,
      workOrderCode: r.workOrderId ? (woCode.get(r.workOrderId) ?? null) : null,
      vehicleCode: r.vehicleId ? (vehicleCode.get(r.vehicleId) ?? null) : null,
      serialNumber: r.serialNumber,
      quantity: Number(r.quantity),
      result: r.result as PartInspectionRow['result'],
      reason: r.reason as PartInspectionRow['reason'],
      kmInService: r.kmInService,
      underWarranty: r.underWarranty,
      claimStatus: r.claimStatus as PartInspectionRow['claimStatus'],
      note: r.note,
      inspectedByName: userName.get(r.inspectedById) ?? null,
      inspectedAt: r.inspectedAt.toISOString(),
    }));
  }

  async createInspection(input: CreatePartInspectionInput, actorId: string): Promise<PartInspectionRow> {
    const material = await this.prisma.material.findUnique({ where: { id: input.materialId } });
    if (!material) throw new NotFoundException('Peça não encontrada');
    const row = await this.prisma.partInspection.create({
      data: {
        materialId: input.materialId,
        // Sem fornecedor informado, vale o do cadastro da peça.
        supplierId: input.supplierId ?? material.supplierId ?? null,
        workOrderId: input.workOrderId ?? null,
        vehicleId: input.vehicleId ?? null,
        serialNumber: input.serialNumber ?? null,
        quantity: input.quantity,
        result: input.result,
        reason: input.reason,
        kmInService: input.kmInService ?? null,
        underWarranty: input.underWarranty,
        claimStatus: input.result === 'REJECTED' ? input.claimStatus : 'NONE',
        note: input.note ?? null,
        inspectedById: actorId,
      },
    });
    await this.audit.write({ actorId, action: 'partInspection.create', entity: 'PartInspection', entityId: row.id, after: { materialCode: material.code, result: row.result, reason: row.reason, underWarranty: row.underWarranty } });
    return (await this.listInspections(200)).find((r) => r.id === row.id)!;
  }

  async updateInspection(id: string, input: UpdatePartInspectionInput, actorId: string): Promise<PartInspectionRow> {
    const before = await this.prisma.partInspection.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Inspeção não encontrada');
    await this.prisma.partInspection.update({ where: { id }, data: { claimStatus: input.claimStatus, ...(input.note !== undefined ? { note: input.note } : {}) } });
    await this.audit.write({ actorId, action: 'partInspection.claim', entity: 'PartInspection', entityId: id, before: { claimStatus: before.claimStatus }, after: { claimStatus: input.claimStatus } });
    return (await this.listInspections(200)).find((r) => r.id === id)!;
  }

  async summary(): Promise<QualitySummary> {
    const since = new Date(Date.now() - 90 * DAY_MS);
    const rows = await this.prisma.partInspection.findMany({ where: { inspectedAt: { gte: since } }, include: { supplier: { select: { id: true, name: true } } } });
    const bySupplier = new Map<string, QualitySummary['bySupplier'][number]>();
    const byReason = new Map<string, number>();
    for (const r of rows) {
      const key = r.supplier?.id ?? 'sem';
      const cur = bySupplier.get(key) ?? { supplierId: key, supplierName: r.supplier?.name ?? 'Sem fornecedor', inspected: 0, rejected: 0, claimsOpen: 0 };
      cur.inspected += 1;
      if (r.result === 'REJECTED') {
        cur.rejected += 1;
        byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
      }
      if (r.claimStatus === 'OPENED') cur.claimsOpen += 1;
      bySupplier.set(key, cur);
    }
    return {
      inspected90d: rows.length,
      rejected90d: rows.filter((r) => r.result === 'REJECTED').length,
      warrantyOpen: rows.filter((r) => r.claimStatus === 'OPENED').length,
      bySupplier: [...bySupplier.values()].sort((a, b) => b.rejected - a.rejected),
      byReason: [...byReason.entries()].map(([reason, count]) => ({ reason: reason as QualitySummary['byReason'][number]['reason'], count })).sort((a, b) => b.count - a.count),
    };
  }
}

const EDITORS = [UserRole.ADMIN, UserRole.PCM, UserRole.ESTOQUE] as const;
const INSPECTORS = [UserRole.ADMIN, UserRole.PCM, UserRole.ESTOQUE, UserRole.MANUTENCAO, UserRole.INSPETOR] as const;

@ApiTags('fornecedores')
@ApiBearerAuth()
@Controller('suppliers')
@UseGuards(RolesGuard)
export class SuppliersController {
  constructor(private readonly quality: QualityService) {}

  @Get()
  list(): Promise<SupplierRow[]> {
    return this.quality.listSuppliers();
  }

  @Post()
  @Roles(...EDITORS)
  create(@Body(new ZodValidationPipe(createSupplierSchema)) body: CreateSupplierInput, @CurrentUser('sub') actorId: string): Promise<SupplierRow> {
    return this.quality.createSupplier(body, actorId);
  }

  @Patch(':id')
  @Roles(...EDITORS)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateSupplierSchema)) body: UpdateSupplierInput, @CurrentUser('sub') actorId: string): Promise<SupplierRow> {
    return this.quality.updateSupplier(id, body, actorId);
  }
}

@ApiTags('qualidade de peças')
@ApiBearerAuth()
@Controller('quality')
@UseGuards(RolesGuard)
export class QualityController {
  constructor(private readonly quality: QualityService) {}

  @Get('part-inspections')
  list(@Query('limit') limit?: string): Promise<PartInspectionRow[]> {
    return this.quality.listInspections(limit ? Math.min(500, Number(limit) || 100) : 100);
  }

  @Get('summary')
  summary(): Promise<QualitySummary> {
    return this.quality.summary();
  }

  @Post('part-inspections')
  @Roles(...INSPECTORS)
  create(@Body(new ZodValidationPipe(createPartInspectionSchema)) body: CreatePartInspectionInput, @CurrentUser('sub') actorId: string): Promise<PartInspectionRow> {
    return this.quality.createInspection(body, actorId);
  }

  @Patch('part-inspections/:id')
  @Roles(...INSPECTORS)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updatePartInspectionSchema)) body: UpdatePartInspectionInput, @CurrentUser('sub') actorId: string): Promise<PartInspectionRow> {
    return this.quality.updateInspection(id, body, actorId);
  }
}

@Module({
  controllers: [SuppliersController, QualityController],
  providers: [QualityService],
  exports: [QualityService],
})
export class QualityModule {}
