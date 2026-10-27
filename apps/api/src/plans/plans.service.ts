import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateKitInput,
  CreateMaterialInput,
  CreatePackageInput,
  CreatePlanInput,
  CreatePlanTaskInput,
  MaterialRow,
  PlanKitRow,
  PlanTree,
  UpdateKitInput,
  UpdateMaterialInput,
  UpdatePackageInput,
  UpdatePlanInput,
  UpdatePlanTaskInput,
  CatalogKitRow,
  TaskToolInput,
  TaskToolRow,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

/**
 * RF-34 — cadastro do plano preventivo: planos → pacotes (janelas de km) →
 * tarefas, mais o kit de cada pacote e o cadastro de materiais.
 *
 * Duas regras que o PRD deixa implícitas e aqui ficam explícitas: o plano é
 * um documento controlado (nunca se apaga, desativa-se), e o kit é versionado
 * — salvar itens cria uma versão nova e encerra a anterior, para que a
 * separação de um kit já programado continue apontando para o que valia.
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<PlanTree[]> {
    const plans = await this.prisma.maintenancePlan.findMany({
      orderBy: [{ technology: 'asc' }, { code: 'asc' }, { version: 'desc' }],
      include: {
        packages: {
          orderBy: { intervalKm: 'asc' },
          include: {
            tasks: { orderBy: { code: 'asc' }, include: { specialty: { select: { name: true } }, tools: { include: { tool: true } } } },
            kits: {
              where: { isActive: true },
              orderBy: { version: 'desc' },
              take: 1,
              include: { items: { include: { material: true } } },
            },
          },
        },
      },
    });

    return plans.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      technology: p.technology,
      manufacturer: p.manufacturer,
      vehicleModel: p.vehicleModel,
      version: p.version,
      controlledDocument: p.controlledDocument,
      effectiveFrom: p.effectiveFrom.toISOString(),
      isActive: p.isActive,
      packages: p.packages.map((pkg) => ({
        id: pkg.id,
        code: pkg.code,
        name: pkg.name,
        intervalKm: pkg.intervalKm,
        toleranceKm: pkg.toleranceKm,
        toleranceBelowKm: pkg.toleranceBelowKm,
        offsetKm: pkg.offsetKm,
        periodDays: pkg.periodDays,
        tasks: pkg.tasks.map((t) => ({
          id: t.id,
          code: t.code,
          description: t.description,
          specialtyId: t.specialtyId,
          specialtyName: t.specialty?.name ?? null,
          estimatedMinutes: t.estimatedMinutes,
          section: t.section,
          equipmentCondition: t.equipmentCondition,
          tools: t.tools.map((tt) => ({ toolId: tt.toolId, code: tt.tool.code, description: tt.tool.description, quantity: tt.quantity })),
        })),
        kit: pkg.kits[0] ? toKitRow(pkg.kits[0]) : null,
        estimatedMinutes: pkg.tasks.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0),
      })),
    }));
  }

  // --- Planos ----------------------------------------------------------------

  async createPlan(input: CreatePlanInput, actorId: string) {
    const exists = await this.prisma.maintenancePlan.findFirst({ where: { code: input.code } });
    if (exists) throw new ConflictException(`Já existe um plano com o código ${input.code}`);
    const plan = await this.prisma.maintenancePlan.create({
      data: {
        code: input.code,
        name: input.name,
        technology: input.technology,
        controlledDocument: input.controlledDocument,
        effectiveFrom: input.effectiveFrom ?? new Date(),
        manufacturer: input.manufacturer,
        vehicleModel: input.vehicleModel,
      },
    });
    await this.audit.write({ actorId, action: 'plan.create', entity: 'MaintenancePlan', entityId: plan.id, after: { code: plan.code, technology: plan.technology } });
    return plan;
  }

  async updatePlan(id: string, input: UpdatePlanInput, actorId: string) {
    const before = await this.prisma.maintenancePlan.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Plano não encontrado');
    const plan = await this.prisma.maintenancePlan.update({
      where: { id },
      data: {
        name: input.name,
        controlledDocument: input.controlledDocument,
        isActive: input.isActive,
        ...(input.isActive === false && !before.effectiveTo ? { effectiveTo: new Date() } : {}),
      },
    });
    await this.audit.write({ actorId, action: 'plan.update', entity: 'MaintenancePlan', entityId: id, before: { isActive: before.isActive }, after: { isActive: plan.isActive } });
    return plan;
  }

  // --- Pacotes ---------------------------------------------------------------

  async createPackage(planId: string, input: CreatePackageInput, actorId: string) {
    const plan = await this.prisma.maintenancePlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plano não encontrado');
    const clash = await this.prisma.maintenancePackage.findUnique({ where: { planId_code: { planId, code: input.code } } });
    if (clash) throw new ConflictException(`O plano já tem o pacote ${input.code}`);
    const pkg = await this.prisma.maintenancePackage.create({ data: { ...input, planId } });
    await this.audit.write({ actorId, action: 'plan.package.create', entity: 'MaintenancePackage', entityId: pkg.id, after: { planId, code: pkg.code, intervalKm: pkg.intervalKm } });
    return pkg;
  }

  async updatePackage(id: string, input: UpdatePackageInput, actorId: string) {
    const pkg = await this.prisma.maintenancePackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('Pacote não encontrado');
    const updated = await this.prisma.maintenancePackage.update({ where: { id }, data: input });
    await this.audit.write({ actorId, action: 'plan.package.update', entity: 'MaintenancePackage', entityId: id, before: { intervalKm: pkg.intervalKm }, after: { intervalKm: updated.intervalKm } });
    return updated;
  }

  // --- Tarefas ---------------------------------------------------------------

  async createTask(packageId: string, input: CreatePlanTaskInput, actorId: string) {
    const pkg = await this.prisma.maintenancePackage.findUnique({ where: { id: packageId } });
    if (!pkg) throw new NotFoundException('Pacote não encontrado');
    const clash = await this.prisma.maintenanceTask.findUnique({ where: { packageId_code: { packageId, code: input.code } } });
    if (clash) throw new ConflictException(`O pacote já tem a tarefa ${input.code}`);
    const task = await this.prisma.maintenanceTask.create({ data: { ...input, packageId } });
    await this.audit.write({ actorId, action: 'plan.task.create', entity: 'MaintenanceTask', entityId: task.id, after: { packageId, code: task.code } });
    return task;
  }

  async updateTask(id: string, input: UpdatePlanTaskInput, actorId: string) {
    const task = await this.prisma.maintenanceTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Tarefa não encontrada');
    const updated = await this.prisma.maintenanceTask.update({ where: { id }, data: input });
    await this.audit.write({ actorId, action: 'plan.task.update', entity: 'MaintenanceTask', entityId: id });
    return updated;
  }

  /** Tarefa que já entrou no escopo de alguma parada não pode sumir do histórico. */
  async deleteTask(id: string, actorId: string): Promise<void> {
    const task = await this.prisma.maintenanceTask.findUnique({ where: { id }, include: { _count: { select: { scopeItems: true } } } });
    if (!task) throw new NotFoundException('Tarefa não encontrada');
    if (task._count.scopeItems > 0) {
      throw new BadRequestException('Esta tarefa já entrou no escopo de paradas programadas e não pode ser excluída');
    }
    await this.prisma.maintenanceTask.delete({ where: { id } });
    await this.audit.write({ actorId, action: 'plan.task.delete', entity: 'MaintenanceTask', entityId: id, before: { code: task.code, packageId: task.packageId } });
  }

  // --- Kits ------------------------------------------------------------------

  async createKit(packageId: string, input: CreateKitInput, actorId: string): Promise<PlanKitRow> {
    const pkg = await this.prisma.maintenancePackage.findUnique({ where: { id: packageId } });
    if (!pkg) throw new NotFoundException('Pacote não encontrado');
    await this.assertMaterials(input.items.map((i) => i.materialId));
    const last = await this.prisma.kit.findFirst({ where: { code: input.code }, orderBy: { version: 'desc' } });
    const kit = await this.prisma.$transaction(async (tx) => {
      // Um pacote tem um kit vigente: o anterior é encerrado.
      await tx.kit.updateMany({ where: { packageId, isActive: true }, data: { isActive: false, effectiveTo: new Date() } });
      return tx.kit.create({
        data: {
          code: input.code,
          name: input.name,
          packageId,
          version: (last?.version ?? 0) + 1,
          effectiveFrom: new Date(),
          items: { create: input.items.map((i) => ({ materialId: i.materialId, quantity: i.quantity })) },
        },
        include: { items: { include: { material: true } } },
      });
    });
    await this.audit.write({ actorId, action: 'plan.kit.create', entity: 'Kit', entityId: kit.id, after: { code: kit.code, version: kit.version, items: input.items.length } });
    return toKitRow(kit);
  }

  /** Mudar itens gera versão nova; nome e ativação mudam na própria versão. */
  async updateKit(id: string, input: UpdateKitInput, actorId: string): Promise<PlanKitRow> {
    const kit = await this.prisma.kit.findUnique({ where: { id }, include: { items: { include: { material: true } } } });
    if (!kit) throw new NotFoundException('Kit não encontrado');

    if (input.items) {
      await this.assertMaterials(input.items.map((i) => i.materialId));
      const next = await this.prisma.$transaction(async (tx) => {
        await tx.kit.update({ where: { id }, data: { isActive: false, effectiveTo: new Date() } });
        return tx.kit.create({
          data: {
            code: kit.code,
            name: input.name ?? kit.name,
            packageId: kit.packageId,
            version: kit.version + 1,
            effectiveFrom: new Date(),
            items: { create: input.items!.map((i) => ({ materialId: i.materialId, quantity: i.quantity })) },
          },
          include: { items: { include: { material: true } } },
        });
      });
      await this.audit.write({ actorId, action: 'plan.kit.version', entity: 'Kit', entityId: next.id, before: { version: kit.version }, after: { version: next.version, items: input.items.length } });
      return toKitRow(next);
    }

    const updated = await this.prisma.kit.update({
      where: { id },
      data: { name: input.name, isActive: input.isActive },
      include: { items: { include: { material: true } } },
    });
    await this.audit.write({ actorId, action: 'plan.kit.update', entity: 'Kit', entityId: id });
    return toKitRow(updated);
  }

  // --- Materiais -------------------------------------------------------------

  async listMaterials(): Promise<MaterialRow[]> {
    const rows = await this.prisma.material.findMany({
      orderBy: { code: 'asc' },
      include: { _count: { select: { kitItems: { where: { kit: { isActive: true } } } } }, supplier: { select: { name: true } } },
    });
    return rows.map((m) => ({
      id: m.id,
      code: m.code,
      description: m.description,
      unit: m.unit,
      isSerialized: m.isSerialized,
      isActive: m.isActive,
      kitCount: m._count.kitItems,
      classCode: m.classCode,
      manufacturerRef: m.manufacturerRef,
      location: m.location,
      abcClass: m.abcClass,
      stockQty: Number(m.stockQty),
      avgCost: m.avgCost === null ? null : Number(m.avgCost),
      isPreventive: m.isPreventive,
      supplierId: m.supplierId,
      supplierName: m.supplier?.name ?? null,
      warrantyMonths: m.warrantyMonths,
      warrantyKm: m.warrantyKm,
    }));
  }

  async createMaterial(input: CreateMaterialInput, actorId: string) {
    const clash = await this.prisma.material.findUnique({ where: { code: input.code } });
    if (clash) throw new ConflictException(`Já existe o material ${input.code}`);
    const m = await this.prisma.material.create({ data: input });
    await this.audit.write({ actorId, action: 'material.create', entity: 'Material', entityId: m.id, after: { code: m.code } });
    return m;
  }

  async updateMaterial(id: string, input: UpdateMaterialInput, actorId: string) {
    const m = await this.prisma.material.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Material não encontrado');
    if (input.code && input.code !== m.code) {
      const clash = await this.prisma.material.findUnique({ where: { code: input.code } });
      if (clash) throw new ConflictException(`Já existe o material ${input.code}`);
    }
    const updated = await this.prisma.material.update({ where: { id }, data: input });
    await this.audit.write({ actorId, action: 'material.update', entity: 'Material', entityId: id, before: { isActive: m.isActive }, after: { isActive: updated.isActive } });
    return updated;
  }

  private async assertMaterials(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length !== ids.length) throw new BadRequestException('O mesmo material aparece mais de uma vez no kit');
    if (unique.length === 0) return;
    const count = await this.prisma.material.count({ where: { id: { in: unique }, isActive: true } });
    if (count !== unique.length) throw new BadRequestException('Há material inexistente ou desativado no kit');
  }
  // --- Kaizen 3: ferramental por tarefa ----------------------------------------

  async addTaskTool(taskId: string, input: TaskToolInput, actorId: string): Promise<TaskToolRow[]> {
    const task = await this.prisma.maintenanceTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Tarefa não encontrada');
    const tool = await this.prisma.tool.findUnique({ where: { id: input.toolId } });
    if (!tool) throw new NotFoundException('Ferramenta não encontrada');
    await this.prisma.maintenanceTaskTool.upsert({
      where: { taskId_toolId: { taskId, toolId: input.toolId } },
      update: { quantity: input.quantity },
      create: { taskId, toolId: input.toolId, quantity: input.quantity },
    });
    await this.audit.write({ actorId, action: 'plan.task.tool.add', entity: 'MaintenanceTask', entityId: taskId, after: { toolId: input.toolId, quantity: input.quantity } });
    return this.listTaskTools(taskId);
  }

  async removeTaskTool(taskId: string, toolId: string, actorId: string): Promise<TaskToolRow[]> {
    await this.prisma.maintenanceTaskTool.deleteMany({ where: { taskId, toolId } });
    await this.audit.write({ actorId, action: 'plan.task.tool.remove', entity: 'MaintenanceTask', entityId: taskId, after: { toolId } });
    return this.listTaskTools(taskId);
  }

  private async listTaskTools(taskId: string): Promise<TaskToolRow[]> {
    const rows = await this.prisma.maintenanceTaskTool.findMany({ where: { taskId }, include: { tool: true }, orderBy: { tool: { code: 'asc' } } });
    return rows.map((tt) => ({ toolId: tt.toolId, code: tt.tool.code, description: tt.tool.description, quantity: tt.quantity }));
  }

  // --- Kaizen 2: kit corretivo por falha do catálogo -----------------------------

  async listCatalogKits(): Promise<CatalogKitRow[]> {
    const kits = await this.prisma.kit.findMany({
      where: { isActive: true, catalogItemId: { not: null } },
      orderBy: [{ catalogItemId: 'asc' }, { version: 'desc' }],
      include: { items: { include: { material: true } } },
    });
    const seen = new Set<string>();
    const out: CatalogKitRow[] = [];
    for (const k of kits) {
      if (seen.has(k.catalogItemId!)) continue;
      seen.add(k.catalogItemId!);
      out.push({ ...toKitRow(k), catalogItemId: k.catalogItemId! });
    }
    return out;
  }

  /** Mudar os itens cria versão nova e encerra a anterior, como no kit preventivo. */
  async saveCatalogKit(catalogItemId: string, input: CreateKitInput, actorId: string): Promise<CatalogKitRow> {
    const item = await this.prisma.failureCatalogItem.findUnique({ where: { id: catalogItemId } });
    if (!item) throw new NotFoundException('Falha do catálogo não encontrada');
    await this.assertMaterials(input.items.map((i) => i.materialId));
    const last = await this.prisma.kit.findFirst({ where: { code: input.code }, orderBy: { version: 'desc' } });
    const kit = await this.prisma.$transaction(async (tx) => {
      await tx.kit.updateMany({ where: { catalogItemId, isActive: true }, data: { isActive: false, effectiveTo: new Date() } });
      return tx.kit.create({
        data: {
          code: input.code,
          name: input.name,
          catalogItemId,
          version: (last?.version ?? 0) + 1,
          effectiveFrom: new Date(),
          items: { create: input.items.map((i) => ({ materialId: i.materialId, quantity: i.quantity })) },
        },
        include: { items: { include: { material: true } } },
      });
    });
    await this.audit.write({ actorId, action: 'catalog.kit.save', entity: 'Kit', entityId: kit.id, after: { catalogItemId, code: kit.code, version: kit.version, items: input.items.length } });
    return { ...toKitRow(kit), catalogItemId };
  }

}

function toKitRow(kit: {
  id: string;
  code: string;
  name: string;
  version: number;
  isActive: boolean;
  items: { materialId: string; quantity: { toNumber(): number } | number; material: { code: string; description: string; unit: string } }[];
}): PlanKitRow {
  return {
    id: kit.id,
    code: kit.code,
    name: kit.name,
    version: kit.version,
    isActive: kit.isActive,
    items: kit.items.map((i) => ({
      materialId: i.materialId,
      materialCode: i.material.code,
      materialDescription: i.material.description,
      unit: i.material.unit,
      quantity: typeof i.quantity === 'number' ? i.quantity : i.quantity.toNumber(),
    })),
  };

}
