import { VEHICLE_STATE_FAMILY } from '@app/design-kit';

export type Family = 'running' | 'waiting' | 'working' | 'stopped';
export const FAMILIES: Family[] = ['running', 'waiting', 'working', 'stopped'];

/** Família operacional de um estado de carro (padrão: esperando). */
export function familyOf(status: string): Family {
  return VEHICLE_STATE_FAMILY[status] ?? 'waiting';
}
