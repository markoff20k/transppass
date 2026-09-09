import { z } from 'zod';
import type { VehicleStatus, VehicleTechnology } from '../fleet/vehicle.schemas.js';
import type { DowntimeByCause } from '../metrics/metrics.schemas.js';
import type { FailureEventSummary } from '../events/event.schemas.js';

/**
 * Dashboard — a tela que abre depois do login.
 *
 * Uma chamada só: o gestor quer a foto da garagem em um segundo, não seis
 * requisições encadeadas. Tudo aqui é derivado dos estados do processo, nada
 * é digitado — é o princípio do PRD (seção 1) aplicado à tela principal.
 */

export const dashboardQuerySchema = z.object({
  /** Meses de histórico para a série do MKBF. */
  months: z.coerce.number().int().min(3).max(24).default(6),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export interface MkbfPoint {
  /** Primeiro dia do mês, ISO. */
  month: string;
  kmTraveled: number;
  unscheduledReturns: number;
  mkbf: number | null;
}

export interface HourAvailability {
  hour: number;
  /** Fração de carros disponíveis naquela faixa, média dos últimos 7 dias. */
  rate: number;
}

export interface DayCount {
  date: string;
  count: number;
}

export interface DashboardVehicle {
  id: string;
  code: string;
  plate: string;
  technology: VehicleTechnology;
  status: VehicleStatus;
  /** Nome curto do que prende o carro, quando houver — a falha ou a OS. */
  reason: string | null;
  /** Horas desde que entrou no estado atual, quando o processo sabe. */
  hoursInState: number | null;
}

export interface DashboardData {
  generatedAt: string;

  fleet: {
    total: number;
    available: number;
    availabilityRate: number;
    byStatus: Record<VehicleStatus, number>;
    /** Delta da disponibilidade em pontos percentuais versus 7 dias atrás. */
    availabilityDelta: number | null;
  };

  mkbf: {
    current: number | null;
    series: MkbfPoint[];
  };

  availabilityByHour: HourAvailability[];
  downtimeByCause: DowntimeByCause[];
  totalDowntimeMinutes: number;
  eventsPerDay: DayCount[];

  queue: {
    waiting: number;
    inService: number;
    oldestWaitingHours: number | null;
  };

  workOrders: {
    open: number;
    overdue: number;
    averageDowntimeMinutes: number | null;
  };

  materials: {
    pending: number;
    overdueParts: number;
  };

  alerts: {
    degradedKm: number;
    pendingTriage: number;
    safetyEventsOpen: number;
  };

  recentEvents: FailureEventSummary[];
  vehicles: DashboardVehicle[];
}
