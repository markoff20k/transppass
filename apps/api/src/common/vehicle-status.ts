import { VehicleStatus, WorkOrderStatus, type Prisma } from '@prisma/client';

/**
 * O status do carro na garagem é um espelho do status da OS que o segura.
 * Uma única tabela de-para, usada em toda transição de OS, para o Dashboard
 * (fluxo, cartões e frota) nunca contar o mesmo carro em duas etapas.
 */
export const VEHICLE_STATUS_BY_WORK_ORDER: Partial<Record<WorkOrderStatus, VehicleStatus>> = {
  [WorkOrderStatus.OPEN]: VehicleStatus.AWAITING_MAINTENANCE,
  [WorkOrderStatus.IN_PROGRESS]: VehicleStatus.IN_MAINTENANCE,
  [WorkOrderStatus.WAITING_PART]: VehicleStatus.AWAITING_PART,
  [WorkOrderStatus.TECH_CLOSED]: VehicleStatus.IN_INSPECTION,
  [WorkOrderStatus.IN_CLEANING]: VehicleStatus.IN_CLEANING,
  [WorkOrderStatus.RELEASED]: VehicleStatus.AVAILABLE,
};

/** Estados em que o carro está dentro da oficina (execução, peça, inspeção, limpeza). */
export const IN_SHOP_STATUSES: VehicleStatus[] = [
  VehicleStatus.IN_MAINTENANCE,
  VehicleStatus.AWAITING_PART,
  VehicleStatus.IN_INSPECTION,
  VehicleStatus.IN_CLEANING,
];

/** Alinha o status do carro ao status atual da OS. Chamar dentro da mesma transação. */
export async function syncVehicleWithWorkOrder(tx: Prisma.TransactionClient, workOrderId: string): Promise<void> {
  const wo = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { status: true, vehicleId: true } });
  if (!wo) return;
  const status = VEHICLE_STATUS_BY_WORK_ORDER[wo.status];
  if (!status) return;
  await tx.vehicle.update({ where: { id: wo.vehicleId }, data: { status } });
}
