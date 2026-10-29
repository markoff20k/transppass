/**
 * Tom do badge de estado. O estado "neutro" (aberta, solicitado, cancelada)
 * fica na pílula suave; os estados que pedem o olho (em execução, parada por
 * peça, nos portões, liberada) ganham preenchimento sólido.
 */
import type { MaterialRequestStatus, WorkOrderStatus } from '@app/shared';

export function workOrderStatusTone(status: WorkOrderStatus | string): string {
  switch (status) {
    case 'IN_PROGRESS':
      return 'tp-badge--info';
    case 'WAITING_PART':
      return 'tp-badge--warning';
    case 'TECH_CLOSED':
    case 'IN_INSPECTION':
    case 'IN_CLEANING':
      return 'tp-badge--brand';
    case 'RELEASED':
      return 'tp-badge--success';
    default:
      return '';
  }
}

export function materialRequestStatusTone(status: MaterialRequestStatus | string): string {
  switch (status) {
    case 'SEPARATED':
      return 'tp-badge--info';
    case 'DELIVERED':
      return 'tp-badge--success';
    case 'WAITING_PART':
      return 'tp-badge--warning';
    default:
      return '';
  }
}
