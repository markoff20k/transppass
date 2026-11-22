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
    .refine((d) => d === 1 || (DASHBOARD_PERIODS as readonly number[]).includes(d), 'Período inválido')
    .default(DEFAULT_DASHBOARD_PERIOD),
  /** Quantos dias atrás a janela termina: 0 = até agora, 1 = ontem (D-1), 2 = anteontem (D-2). */
  back: z.coerce.number().int().min(0).max(2).default(0),
  /** Intervalo livre (dias civis AAAA-MM-DD); quando vem, vence days/back. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
    /** MKBF dos últimos 30 dias até agora: o número do cartão "Indicadores de agora", que não segue o período. */
    last30: { kmTraveled: number; unscheduledReturns: number; mkbf: number | null };
  };

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
    /** Liberadas hoje (o cartão "Indicadores de agora" não segue o período). */
    releasedToday: number;
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

  vehicles: DashboardVehicle[];
}

export interface DashboardBacks {
  mkbf: {
    /** Os 30 dias logo antes dos últimos 30 (o cartão não segue o período). */
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

// ---------------------------------------------------------------------------
// Widgets do Dashboard: um indicador, um período, um número. A lista de widgets
// de cada pessoa (e o período de cada um) fica em preferences.ui["dash.widgets"].
// ---------------------------------------------------------------------------

export const WIDGET_KINDS = [
  'mkbf',
  'breakdowns',
  'km',
  'availability',
  'lostTrips',
  'tripsDone',
  'downtime',
  'woReleased',
  'woOpened',
  'rescues',
  'fieldResolution',
  'triageSla',
  'rework',
  'consumptionDiesel',
  'consumptionEbus',
] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const widgetQuerySchema = z.object({
  kind: z.enum(WIDGET_KINDS),
  /** Dias civis (AAAA-MM-DD), inclusivos, no fuso de São Paulo. */
  from: z.string().regex(ISO_DAY),
  to: z.string().regex(ISO_DAY),
  /** Um carro só; sem ele, a frota inteira. */
  vehicleId: z.string().uuid().optional(),
});
export type WidgetQuery = z.infer<typeof widgetQuerySchema>;

export type WidgetUnit = 'km' | 'count' | 'pct' | 'minutes' | 'kml' | 'kmkwh';

export interface DashboardWidget {
  kind: WidgetKind;
  from: string;
  to: string;
  value: number | null;
  /** Mesmo indicador no período igual logo antes, para a variação. */
  previous: number | null;
  unit: WidgetUnit;
  /** A conta por trás do número ("2.107.112 km ÷ 575 quebras"). */
  detail: string | null;
  /** Quanto maior, melhor? Decide a cor da variação. */
  higherIsBetter: boolean;
  /** Prefixo do carro, quando o widget é de um carro só. */
  vehicleCode: string | null;
  /** O período mostrado de fato: igual ao pedido, ou recuado até o dia mais recente com dado. */
  used: { from: string; to: string };
  fellBack: boolean;
}

export const WIDGET_PERIOD_PRESETS = ['today', 'yesterday', 'd2', 'last7', 'last30', 'thisMonth', 'lastMonth', 'custom'] as const;
export type WidgetPeriodPreset = (typeof WIDGET_PERIOD_PRESETS)[number];

export interface WidgetPeriod {
  preset: WidgetPeriodPreset;
  /** Só em "custom": dias civis AAAA-MM-DD. */
  from?: string;
  to?: string;
}

export interface DashboardWidgetPref {
  id: string;
  kind: WidgetKind;
  period: WidgetPeriod;
  /** Carro específico; null ou ausente = frota inteira. */
  vehicleId?: string | null;
}

// ---------------------------------------------------------------------------
// Período dos gráficos do Dashboard (MKBF e disponibilidade por faixa horária):
// atalhos Hoje / Ontem / 30 dias / 12 meses / personalizado. Quando o período
// pedido não tem dado, a API recua para o dia mais próximo com dado e avisa.
// ---------------------------------------------------------------------------

export const CHART_PERIOD_PRESETS = ['today', 'yesterday', 'last30', 'months12', 'custom'] as const;
export type ChartPeriodPreset = (typeof CHART_PERIOD_PRESETS)[number];

export interface ChartPeriod {
  preset: ChartPeriodPreset;
  /** Só em "custom": dias civis AAAA-MM-DD. */
  from?: string;
  to?: string;
}

export const mkbfSeriesQuerySchema = z.object({
  from: z.string().regex(ISO_DAY),
  to: z.string().regex(ISO_DAY),
  /** Um ponto por hora (um dia só), por dia (períodos curtos) ou por mês. */
  bucket: z.enum(['hour', 'day', 'month']).default('day'),
});
export type MkbfSeriesQuery = z.infer<typeof mkbfSeriesQuerySchema>;

export interface MkbfSeriesPoint {
  /** Hora ("00".."23"), dia (AAAA-MM-DD) ou mês (AAAA-MM). */
  key: string;
  kmTraveled: number;
  unscheduledReturns: number;
  /** MKBF do próprio ponto; nulo sem quebra. */
  mkbf: number | null;
  /** MKBF acumulado do início do período até este ponto. */
  mkbfToDate: number | null;
}

export interface MkbfSeries {
  bucket: 'hour' | 'day' | 'month';
  points: MkbfSeriesPoint[];
  /** Só por hora: o MKBF do dia inteiro (km do dia ÷ quebras do dia). */
  dayTotal: { kmTraveled: number; unscheduledReturns: number; mkbf: number | null } | null;
  requested: { from: string; to: string };
  /** O que foi mostrado de fato: igual ao pedido, ou recuado até o último dia com dado. */
  used: { from: string; to: string };
  fellBack: boolean;
}

export const availabilityHoursQuerySchema = z.object({
  /** Dia da curva "hoje"; sem ele, só a média. */
  day: z.string().regex(ISO_DAY).optional(),
  /** Janela da média, dias civis inclusivos. */
  from: z.string().regex(ISO_DAY),
  to: z.string().regex(ISO_DAY),
});
export type AvailabilityHoursQuery = z.infer<typeof availabilityHoursQuerySchema>;

export interface AvailabilityHours {
  /** rate = média da janela; today = curva do dia pedido (nulo nas horas futuras ou sem dia). */
  hours: HourAvailability[];
  /** Dia mostrado na curva, já com o recuo aplicado; nulo quando só há média. */
  day: string | null;
  requestedDay: string | null;
  fellBack: boolean;
  /** Dias que entraram na média. */
  days: number;
}

export const availabilityDaysQuerySchema = z.object({
  from: z.string().regex(ISO_DAY),
  to: z.string().regex(ISO_DAY),
});
export type AvailabilityDaysQuery = z.infer<typeof availabilityDaysQuerySchema>;

export interface AvailabilityDayPoint {
  date: string;
  /** Fração média de carros disponíveis no dia (24 amostras, uma por hora). */
  rate: number;
}

/** Disponibilidade dia a dia num intervalo: o eixo do gráfico quando o período tem vários dias. */
export interface AvailabilityDays {
  points: AvailabilityDayPoint[];
  from: string;
  to: string;
}

// --- Cards de baixo do Dashboard, cada um com o próprio período ---------------

/** Quebras por hora (um dia), por dia (até 120 dias) ou por semana. Na hora, `date` = "AAAA-MM-DDTHH". */
export interface DashboardEventsSeries {
  points: DayCount[];
  bucket: 'hour' | 'day' | 'week';
  from: string;
  to: string;
  requested: { from: string; to: string };
  /** O que foi mostrado de fato: igual ao pedido, ou recuado até o último dia com quebra. */
  used: { from: string; to: string };
  fellBack: boolean;
}

/** Últimos eventos de um período, com o mesmo recuo quando o período não tem nenhum. */
export interface DashboardRecentEvents {
  events: import('../events/event.schemas.js').FailureEventSummary[];
  requested: { from: string; to: string };
  used: { from: string; to: string };
  fellBack: boolean;
}

/** Tempo parado das OS liberadas no período, por etapa. */
export interface DashboardDowntime {
  downtimeByCause: DowntimeByCause[];
  totalDowntimeMinutes: number;
  from: string;
  to: string;
}

// --- Top 10 falhas -------------------------------------------------------------

export const TOP_FAILURES_BY = ['cco', 'code'] as const;
export type TopFailuresBy = (typeof TOP_FAILURES_BY)[number];

export const topFailuresQuerySchema = z.object({
  from: z.string().regex(ISO_DAY),
  to: z.string().regex(ISO_DAY),
  /** cco = defeito apontado pelo CCO; code = código composto (modo × subsistema). */
  by: z.enum(TOP_FAILURES_BY).default('cco'),
});
export type TopFailuresQuery = z.infer<typeof topFailuresQuerySchema>;

export interface TopFailureItem {
  /** Chave do filtro em Eventos: o defeito do CCO, ou o código "IN-022-000". */
  key: string;
  label: string;
  /** Só na visão por código: o código composto, para o chip, e o modo de falha como detalhe. */
  code: string | null;
  detail: string | null;
  count: number;
  /** Fatia do total de quebras do período (0–1). */
  share: number;
  /** Carros distintos com essa falha no período. */
  vehicles: number;
  /** Quebras da mesma falha no período anterior, de mesmo tamanho. */
  previous: number;
}

export interface TopFailures {
  by: TopFailuresBy;
  items: TopFailureItem[];
  /** Quebras (retornos não programados) no período. */
  total: number;
  /** Quebras sem defeito ou sem código: fora do ranking, para o total fechar. */
  unclassified: number;
  previousRange: { from: string; to: string };
  requested: { from: string; to: string };
  used: { from: string; to: string };
  fellBack: boolean;
}
