import { z } from 'zod';
import { VehicleTechnology } from '../fleet/vehicle.schemas.js';

/**
 * Checklist diário de estado de conservação (Fluxos de Processo PCM, p.8 —
 * "Manutenção diária"): todo carro é conferido antes de sair; qualquer item
 * reprovado abre OS corretiva na hora, no código composto da falha. Os itens
 * são os da inspeção de saída que a Manutenção listou (faróis, limpadores,
 * iluminação, avarias, pneus, rampa/elevador, água e óleo, BTMS).
 */

export interface DailyCheckItemDef {
  key: string;
  label: string;
  hint: string;
  technologies: VehicleTechnology[];
  /** Código composto usado quando o item reprova (modo × subsistema). */
  failureModeCode: string;
  subsystemCode: string;
}

const BOTH: VehicleTechnology[] = [VehicleTechnology.DIESEL, VehicleTechnology.EBUS];

export const DAILY_CHECK_ITEMS: DailyCheckItemDef[] = [
  { key: 'FAROIS', label: 'Faróis e lanternas', hint: 'baixo, alto, setas, freio e ré acendem', technologies: BOTH, failureModeCode: 'IN', subsystemCode: '030-002' },
  { key: 'LIMPADORES', label: 'Limpadores e lavador', hint: 'palhetas íntegras, esguicho funciona', technologies: BOTH, failureModeCode: 'IN', subsystemCode: '174-012' },
  { key: 'ILUMINACAO', label: 'Iluminação interna e letreiro', hint: 'salão, degraus e itinerário acesos', technologies: BOTH, failureModeCode: 'AP', subsystemCode: '030-002' },
  { key: 'AVARIAS', label: 'Avarias de carroceria e vidros', hint: 'sem vidro trincado, lataria ou para-choque solto', technologies: BOTH, failureModeCode: 'QB', subsystemCode: '174-000' },
  { key: 'PNEUS', label: 'Pneus', hint: 'pressão, TWI (1,6 mm dianteiro / 1,3 mm traseiro) e sem avaria', technologies: BOTH, failureModeCode: 'BX', subsystemCode: '025-001' },
  { key: 'PORTAS_RAMPA', label: 'Portas e rampa/elevador', hint: 'abrem, fecham e o sensor atua; rampa sobe e desce', technologies: BOTH, failureModeCode: 'AF', subsystemCode: '174-010' },
  { key: 'NIVEIS', label: 'Níveis de água e óleo', hint: 'arrefecimento e lubrificante no nível; sem vazamento', technologies: BOTH, failureModeCode: 'BX', subsystemCode: '011-003' },
  { key: 'SALAO', label: 'Bancos, balaústres e lixeiras', hint: 'bancos fixos, balaústres firmes, lixeiras trocadas', technologies: BOTH, failureModeCode: 'QB', subsystemCode: '174-005' },
  { key: 'BTMS', label: 'Nível BTMS e carga da bateria', hint: 'líquido do BTMS no nível; carga concluída (2 a 3 h)', technologies: [VehicleTechnology.EBUS], failureModeCode: 'BX', subsystemCode: '030-001' },
];

export function dailyCheckItemsFor(technology: VehicleTechnology): DailyCheckItemDef[] {
  return DAILY_CHECK_ITEMS.filter((i) => i.technologies.includes(technology));
}

export const createDailyCheckSchema = z.object({
  vehicleId: z.string().uuid('Selecione o carro'),
  /** Motorista que conferiu/assinou, quando houver. */
  operatorId: z.string().uuid().optional(),
  odometerKm: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().int().min(0).optional()),
  note: z.string().trim().max(500).optional(),
  items: z.array(z.object({ key: z.string().min(1), ok: z.boolean(), note: z.string().trim().max(255).optional() })).min(1, 'Marque os itens'),
});
export type CreateDailyCheckInput = z.infer<typeof createDailyCheckSchema>;

export const dailyCheckQuerySchema = z.object({
  /** Dia local (YYYY-MM-DD). Padrão: hoje. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  vehicleId: z.string().uuid().optional(),
});
export type DailyCheckQuery = z.infer<typeof dailyCheckQuerySchema>;

export interface DailyCheckRow {
  id: string;
  vehicleId: string;
  vehicleCode: string;
  vehiclePlate: string;
  technology: VehicleTechnology;
  checkedAt: string;
  checkedByName: string | null;
  operatorName: string | null;
  odometerKm: number | null;
  result: 'OK' | 'NOK';
  nokItems: { key: string; label: string; note: string | null }[];
  note: string | null;
  /** Evento corretivo aberto pelo checklist, quando reprovou. */
  eventId: string | null;
  eventCode: string | null;
}

export interface DailyCheckSummary {
  date: string;
  fleet: number;
  checked: number;
  ok: number;
  nok: number;
  pending: number;
}
