import { z } from 'zod';
import type { VehicleClass, VehicleStatus, VehicleTechnology } from '../fleet/vehicle.schemas.js';
import type { DowntimeByCause } from '../metrics/metrics.schemas.js';
import type { FailureEventSummary } from '../events/event.schemas.js';

/**
 * Dashboard — a tela que abre depois do login.
 *
 * Uma chamada só: o gestor quer a foto da garagem em um segundo, não seis
 * requisições encadeadas. Tudo aqui é derivado dos estados do processo, nada
 * é digitado — é o princípio do PRD (seção 1) aplicado à tela principal.
 */

/** Janelas de histórico que o Dashboard oferece, em dias. */
export const DASHBOARD_PERIODS = [7, 30, 90, 180, 365] as const;
export type DashboardPeriodDays = (typeof DASHBOARD_PERIODS)[number];
export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriodDays = 30;

export const dashboardQuerySchema = z.object({
  /** Janela do histórico (MKBF do período, quebras, tempo parado, eventos). */
  days: z.coerce
    .number()
    .int()
    .refine((d) => (DASHBOARD_PERIODS as readonly number[]).includes(d), 'Período inválido')
    .default(DEFAULT_DASHBOARD_PERIOD),
  /** Meses da série mensal do MKBF; por padrão cobre o período com folga. */
  months: z.coerce.number().int().min(3).max(24).optional(),
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
  /** Fração de carros disponíveis naquela faixa, média do período escolhido. */
  rate: number;
  /** A mesma fração hoje, nessa faixa; null para as horas que ainda não chegaram. */
  today: number | null;
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
  vehicleClass: VehicleClass | null;
  status: VehicleStatus;
  /** Nome curto do que prende o carro, quando houver — a falha ou a OS. */
  reason: string | null;
  /** Horas desde que entrou no estado atual, quando o processo sabe. */
  hoursInState: number | null;
}

export interface DashboardData {
  generatedAt: string;

  /** Janela do histórico pedida (o "agora" da garagem não depende dela). */
  period: { days: number; from: string; to: string };

  fleet: {
    total: number;
    available: number;
    availabilityRate: number;
    byStatus: Record<VehicleStatus, number>;
    /** Delta da disponibilidade em pontos percentuais versus 7 dias atrás. */
    availabilityDelta: number | null;
  };

  mkbf: {
    /** MKBF do mês corrente (último ponto da série). */
    current: number | null;
    series: MkbfPoint[];
    /** MKBF da janela escolhida: km rodados ÷ retornos não programados. */
    period: { kmTraveled: number; unscheduledReturns: number; mkbf: number | null };
  };

  availabilityByHour: HourAvailability[];
  downtimeByCause: DowntimeByCause[];
  totalDowntimeMinutes: number;
  eventsPerDay: DayCount[];
  /** Até 120 dias cada ponto é um dia; acima disso, uma semana. */
  eventsBucket: 'day' | 'week';

  queue: {
    waiting: number;
    inService: number;
    oldestWaitingHours: number | null;
  };

  workOrders: {
    open: number;
    overdue: number;
    /** Liberadas na janela escolhida. */
    releasedInPeriod: number;
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
