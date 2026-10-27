import { Injectable } from '@nestjs/common';
import { WorkOrderStatus } from '@prisma/client';
import type { KaizenReadiness } from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Prontidão do sistema para o Kaizen "Projeto MKBF": contagens ao vivo que
 * provam que cada entregável tem onde morar e já tem carga.
 */
@Injectable()
export class KaizenService {
  constructor(private readonly prisma: PrismaService) {}

  async readiness(): Promise<KaizenReadiness> {
    const p = this.prisma;
    const [
      vehicles, vehiclesWithClass, drivers, conductors, materials, preventiveMaterials, reconditionedMaterials,
      tools, toolUnits, plans, packages, planTasks, preventiveKits, correctiveKits, catalogItems, taskTools,
      tasksWithTools, technicians, inspectors, serializedComponents, thirdPartyWorkOrders, inspections,
    ] = await Promise.all([
      p.vehicle.count({ where: { isActive: true } }),
      p.vehicle.count({ where: { isActive: true, vehicleClass: { not: null }, lot: { not: null } } }),
      p.operator.count({ where: { isActive: true, function: 'MOTORISTA' } }),
      p.operator.count({ where: { isActive: true, function: 'COBRADOR' } }),
      p.material.count({ where: { isActive: true } }),
      p.material.count({ where: { isActive: true, isPreventive: true } }),
      p.material.count({ where: { isActive: true, OR: [{ classCode: { startsWith: '2001' } }, { classCode: { startsWith: '2101' } }] } }),
      p.tool.count({ where: { isActive: true } }),
      p.tool.aggregate({ where: { isActive: true }, _sum: { requiredQty: true } }).then((r) => r._sum.requiredQty ?? 0),
      p.maintenancePlan.count({ where: { isActive: true } }),
      p.maintenancePackage.count({ where: { plan: { isActive: true } } }),
      p.maintenanceTask.count({ where: { package: { plan: { isActive: true } } } }),
      p.kit.count({ where: { isActive: true, packageId: { not: null } } }),
      p.kit.count({ where: { isActive: true, catalogItemId: { not: null } } }),
      p.failureCatalogItem.count({ where: { isActive: true } }),
      p.maintenanceTaskTool.count(),
      p.maintenanceTaskTool.groupBy({ by: ['taskId'] }).then((r) => r.length),
      p.technician.count({ where: { isActive: true } }),
      p.technician.count({ where: { isActive: true, isInspector: true } }),
      p.poolComponent.count(),
      p.workOrder.count({ where: { execution: 'THIRD_PARTY', status: { not: WorkOrderStatus.CANCELLED } } }),
      p.inspection.count(),
    ]);
    return {
      vehicles, vehiclesWithClass, drivers, conductors, materials, preventiveMaterials, reconditionedMaterials,
      tools, toolUnits, plans, packages, planTasks, preventiveKits, correctiveKits, catalogItems, taskTools,
      tasksWithTools, technicians, inspectors, serializedComponents, thirdPartyWorkOrders, inspections,
      computedAt: new Date().toISOString(),
    };
  }
}
