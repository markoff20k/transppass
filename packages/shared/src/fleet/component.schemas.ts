import { z } from 'zod';
import { VehicleTechnology } from './vehicle.schemas.js';

/**
 * Kaizen — componentes rastreáveis com vida por km (compressor, turbina, bicos,
 * cubos, motor de partida…). Cada troca reinicia o relógio do componente; a vida
 * real nas trocas, comparada à esperada, é o que alimenta a análise de MKBF.
 * As vidas esperadas são ASSUMIDAS até a Manutenção fixar por modelo.
 */

export interface ComponentKindDef {
  label: string;
  /** Vida esperada em km (ASSUMIDA). */
  lifeKm: number;
  technologies: VehicleTechnology[];
}

export const COMPONENT_KINDS = {
  COMPRESSOR: { label: 'Compressor de ar', lifeKm: 300_000, technologies: [VehicleTechnology.DIESEL, VehicleTechnology.EBUS] },
  TURBINA: { label: 'Turbina', lifeKm: 350_000, technologies: [VehicleTechnology.DIESEL] },
  BICO_INJETOR: { label: 'Bicos injetores', lifeKm: 250_000, technologies: [VehicleTechnology.DIESEL] },
  CUBO_RODA: { label: 'Cubos de roda', lifeKm: 400_000, technologies: [VehicleTechnology.DIESEL, VehicleTechnology.EBUS] },
  MOTOR_PARTIDA: { label: 'Motor de partida', lifeKm: 300_000, technologies: [VehicleTechnology.DIESEL] },
  ALTERNADOR: { label: 'Alternador', lifeKm: 200_000, technologies: [VehicleTechnology.DIESEL] },
  BATERIA_TRACAO: { label: 'Baterias de tração', lifeKm: 600_000, technologies: [VehicleTechnology.EBUS] },
} as const satisfies Record<string, ComponentKindDef>;
export type ComponentKind = keyof typeof COMPONENT_KINDS;
export const COMPONENT_KIND_KEYS = Object.keys(COMPONENT_KINDS) as ComponentKind[];

export function componentKindsFor(technology: VehicleTechnology): ComponentKind[] {
  return COMPONENT_KIND_KEYS.filter((k) => (COMPONENT_KINDS[k].technologies as readonly VehicleTechnology[]).includes(technology));
}

/** Por que o componente anterior saiu (e este entrou). */
export const COMPONENT_CHANGE_REASONS = {
  FALHA: 'Falhou em serviço',
  PREVENTIVA: 'Troca preventiva (fim da vida)',
  GARANTIA: 'Troca em garantia',
  INICIAL: 'Carga inicial (sem anterior)',
} as const;
export type ComponentChangeReason = keyof typeof COMPONENT_CHANGE_REASONS;

/** Acima de 85% da vida esperada o componente entra na lista de atenção. */
export const COMPONENT_NEAR_LIFE_PCT = 85;

const optionalInt = () => z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().int().min(0).optional());

export const installComponentSchema = z.object({
  vehicleId: z.string().uuid('Escolha o carro'),
  kind: z.enum(COMPONENT_KIND_KEYS as [ComponentKind, ...ComponentKind[]]),
  serialNumber: z.string().trim().max(40).optional(),
  /** Km do carro na instalação; sem valor, usa o km atual. */
  installedAtKm: optionalInt(),
  installedAt: z.coerce.date().optional(),
  /** Sem valor, usa a vida esperada do tipo. */
  expectedLifeKm: optionalInt(),
  reason: z.enum(Object.keys(COMPONENT_CHANGE_REASONS) as [ComponentChangeReason, ...ComponentChangeReason[]]).default('FALHA'),
  note: z.string().trim().max(255).optional(),
});
export type InstallComponentInput = z.infer<typeof installComponentSchema>;

export type ComponentLifeStatus = 'OK' | 'NEAR' | 'OVER';

export interface ComponentRow {
  id: string;
  vehicleId: string;
  vehicleCode: string;
  technology: VehicleTechnology;
  kind: ComponentKind;
  kindLabel: string;
  serialNumber: string | null;
  installedAt: string;
  installedAtKm: number;
  expectedLifeKm: number;
  currentKm: number;
  usedKm: number;
  /** Percentual da vida esperada já consumido (pode passar de 100). */
  lifePct: number;
  remainingKm: number;
  /** Dias até o fim da vida, pela média diária do carro; null sem média. */
  daysToLife: number | null;
  status: ComponentLifeStatus;
  installReason: ComponentChangeReason;
  note: string | null;
  /** Quanto durou o componente anterior deste carro, em km; null sem histórico. */
  previousLifeKm: number | null;
}

export interface ComponentKindSummary {
  kind: ComponentKind;
  label: string;
  expectedLifeKm: number;
  active: number;
  over: number;
  near: number;
  /** Trocas registradas (componentes removidos). */
  removals: number;
  /** Das trocas, quantas foram por falha em serviço. */
  failures: number;
  /** Vida média real nas trocas, em km; null sem trocas. */
  avgLifeAtRemovalKm: number | null;
}

export interface ComponentsSummary {
  tracked: number;
  over: number;
  near: number;
  byKind: ComponentKindSummary[];
}
