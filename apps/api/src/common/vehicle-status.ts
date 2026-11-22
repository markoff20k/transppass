import { EventStatus, QueueStatus, VehicleStatus, WorkOrderStatus, type Prisma, type PrismaClient } from '@prisma/client';

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
  [WorkOrderStatus.IN_INSPECTION]: VehicleStatus.IN_INSPECTION,
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

/** Estados de garagem: só valem com uma OS, uma quebra em aberto ou uma entrada na fila por trás. */
const GARAGE_STATUSES: VehicleStatus[] = [
  VehicleStatus.AWAITING_TRIAGE,
  VehicleStatus.FIELD_SERVICE,
  VehicleStatus.AWAITING_MAINTENANCE,
  ...IN_SHOP_STATUSES,
];

/** Alinha o status do carro ao status atual da OS. Chamar dentro da mesma transação. */
export async function syncVehicleWithWorkOrder(tx: Prisma.TransactionClient, workOrderId: string): Promise<void> {
  const wo = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { status: true, vehicleId: true } });
  if (!wo) return;
  const status = VEHICLE_STATUS_BY_WORK_ORDER[wo.status];
  if (!status) return;
  await tx.vehicle.update({ where: { id: wo.vehicleId }, data: { status } });
}

const OPEN_WO = { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] };
const OPEN_EVENT = { notIn: [EventStatus.CLOSED, EventStatus.CANCELLED, EventStatus.DEFERRED] };

/**
 * O estado que o processo diz que o carro tem, pela ordem de quem o segura:
 * a OS aberta mais recente; sem OS, a quebra em aberto (triagem, socorro,
 * recolhido para a fila); sem quebra, a entrada na fila. Sem nada disso, um
 * carro em estado de garagem é um órfão (registro apagado, montagem pela
 * metade) e volta ao pátio; "fora de operação" é administrativo e fica;
 * rodando e disponível ficam como estão.
 */
export function deriveVehicleStatus(v: {
  status: VehicleStatus;
  workOrders: { status: WorkOrderStatus }[];
  failureEvents: { status: EventStatus }[];
  queueEntries: { status: QueueStatus }[];
}): VehicleStatus {
  const wo = v.workOrders[0];
  if (wo) return VEHICLE_STATUS_BY_WORK_ORDER[wo.status] ?? v.status;
  const ev = v.failureEvents[0];
  if (ev) {
    if (ev.status === EventStatus.REGISTERED || ev.status === EventStatus.IN_TRIAGE) return VehicleStatus.AWAITING_TRIAGE;
    if (ev.status === EventStatus.FIELD_SERVICE) return VehicleStatus.FIELD_SERVICE;
    if (ev.status === EventStatus.RECALLED || ev.status === EventStatus.IN_MAINTENANCE) return VehicleStatus.AWAITING_MAINTENANCE;
  }
  const q = v.queueEntries[0];
  if (q) return q.status === QueueStatus.IN_SERVICE ? VehicleStatus.IN_MAINTENANCE : VehicleStatus.AWAITING_MAINTENANCE;
  if (GARAGE_STATUSES.includes(v.status)) return VehicleStatus.AVAILABLE;
  return v.status;
}

/**
 * Saneamento: alinha o status de cada carro ativo ao que o processo diz
 * (OS, quebra, fila). Corrige carros deixados em etapa da garagem por
 * registro apagado ou montagem interrompida, para o Dashboard, a Fila de
 * manutenção e a Frota contarem os mesmos carros. Devolve quantos mudaram.
 */
export async function reconcileVehicleStatuses(prisma: PrismaClient | Prisma.TransactionClient): Promise<{ changed: number; details: string[] }> {
  const rows = await prisma.vehicle.findMany({
    where: { isActive: true },
    select: {
      id: true,
      code: true,
      status: true,
      workOrders: { where: { status: OPEN_WO }, orderBy: { openedAt: 'desc' }, take: 1, select: { status: true } },
      failureEvents: { where: { status: OPEN_EVENT }, orderBy: { reportedAt: 'desc' }, take: 1, select: { status: true } },
      queueEntries: { where: { status: { in: [QueueStatus.WAITING, QueueStatus.IN_SERVICE] } }, orderBy: { enteredAt: 'desc' }, take: 1, select: { status: true } },
    },
  });
  const details: string[] = [];
  for (const v of rows) {
    const status = deriveVehicleStatus(v);
    if (status === v.status) continue;
    await prisma.vehicle.update({ where: { id: v.id }, data: { status } });
    details.push(`${v.code}: ${v.status} → ${status}`);
  }
  return { changed: details.length, details };
}
