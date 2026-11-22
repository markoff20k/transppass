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

  /** Verso dos três cartões do painel: o porquê do número da frente. */
  backs: DashboardBacks;

  recentEvents: FailureEventSummary[];
  vehicles: DashboardVehicle[];
}

export interface DashboardBacks {
  mkbf: {
    /** Mesmo tamanho de janela, logo antes do período. */
    previous: { kmTraveled: number; unscheduledReturns: number; mkbf: number | null };
    /** Até três sistemas com mais quebras no período (nome do catálogo ou grupo do CCO). */
    topSystems: { name: string; count: number }[];
    worstVehicle: { code: string; count: number } | null;
  };
  queue: {
    /** Até três carros há mais tempo na fila. */
    oldest: { code: string; hours: number }[];
    /** Espera média (h) de quem começou o serviço no período. */
    averageWaitHours: number | null;
    enteredToday: number;
    startedToday: number;
  };
  workOrders: {
    byStage: { open: number; inProgress: number; waitingPart: number; techClosed: number; inInspection: number; inCleaning: number };
    mostOverdue: { id: string; code: string; vehicleCode: string; lateHours: number } | null;
  };
}

// ---------------------------------------------------------------------------
// Avisos e alertas — o cartão de cima do Dashboard.
//
// Uma lista só, já ordenada por gravidade, com tudo o que pede atenção agora:
// o que está preso na garagem (segurança, peça, OS, triagem, fila, preventiva),
// até quando os dados do ERP-JB chegaram, o que a planilha de consumo deixou
// de registrar, a caixa de notificações de quem está olhando e as leituras do
// quadro de indicadores que pioraram. Nada é digitado: cada item nasce de um
// estado do sistema e abre a tela onde se resolve.
// ---------------------------------------------------------------------------

export const NOTICE_SEVERITIES = ['critical', 'warning', 'info', 'good'] as const;
export type NoticeSeverity = (typeof NOTICE_SEVERITIES)[number];

export type NoticeKind =
  | 'rescue'
  | 'triage'
  | 'safety'
  | 'workorders'
  | 'parts'
  | 'queue'
  | 'replacement'
  | 'preventive'
  | 'inspection'
  | 'release';

/**
 * Uma linha do letreiro do Dashboard: um fato real em andamento no sistema
 * ("carro 81-123 quebrado na linha 8012 há 52 min, aguardando reboque"),
 * com a área responsável na frente e o caminho para a tela onde se resolve.
 */
export interface DashboardNotice {
  id: string;
  severity: NoticeSeverity;
  kind: NoticeKind;
  /** Área responsável, como aparece entre colchetes: "Socorro", "Oficina", "Almoxarifado". */
  area: string;
  /** A frase do letreiro, já com o tempo decorrido ("há 52 min"). */
  title: string;
  /** Detalhe a mais, mostrado ao parar o mouse. */
  text: string;
  /** Rota no app onde o assunto se resolve; null quando é só para saber. */
  to: string | null;
  /** Quando começou, ou a data a que se refere (ISO). */
  at: string | null;
  /** Prefixo do carro envolvido, quando há um. */
  vehicleCode: string | null;
}

export interface DashboardNotices {
  generatedAt: string;
  items: DashboardNotice[];
  counts: Record<NoticeSeverity, number>;
  /** Até quando cada planilha do ERP-JB chegou (ISO yyyy-mm-dd), null sem dado. */
  dataThrough: { km: string | null; consumption: string | null; failures: string | null; lineDays: string | null };
}
