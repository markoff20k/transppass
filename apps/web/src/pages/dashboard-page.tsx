import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Minus, RefreshCw, Repeat2, Search, Undo2 } from 'lucide-react';
import {
  DASHBOARD_PERIODS,
  DEFAULT_DASHBOARD_PERIOD,
  EVENT_STATUS_LABELS,
  VEHICLE_STATUS_LABELS,
  type VehicleStatus,
  type DashboardData,
  type DashboardVehicle,
  type DashboardDowntime,
  type DashboardEventsSeries,
  type DashboardRecentEvents,
} from '@app/shared';
import { VEHICLE_STATE_FAMILY } from '@app/design-kit';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime, formatMinutes, formatNumber } from '@/lib/format';
import { useI18n } from '@/i18n/i18n.context';
import { usePageHeader } from '@/components/shell/page-header.context';
import { BusRender } from '@/components/bus/bus-render';
import { InfoTip } from '@/components/ui/info-tip';
import { FleetLegend } from '@/components/fleet/fleet-legend';
import { familyOf, type Family } from '@/components/fleet/fleet-legend.utils';
import { BackFoot, BackHead, FlipButton, MaintenanceBack } from '@/components/fleet/fleet-card';
import { useFlip } from '@/components/fleet/use-flip';
import { NoticeBoard, TickerSwitch } from '@/components/dashboard/notice-board';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { SortableCards } from '@/components/ui/sortable-cards';
import { WidgetsCard } from '@/components/dashboard/widgets';
import { AvailabilityCard, ChartLoading, MkbfCard, useFallbackToast } from '@/components/dashboard/chart-cards';
import { ChartPeriodBar } from '@/components/charts/chart-period';
import { resolveChartPeriod, useChartPeriod } from '@/components/charts/use-chart-period';
import { RefreshVeil } from '@/components/ui/refresh-veil';
import { TopFailuresCard } from '@/components/dashboard/top-failures';
import { DashboardSkeleton } from '@/components/dashboard/dashboard-skeleton';
import { CustomRangeItem } from '@/components/charts/chart-period';
import { LiveBadge } from '@/components/ui/live-badge';
import { KpiAi } from '@/components/ui/flip-kpi';
import { rangeLabel, shiftDays, todayIso } from '@/lib/period';
import { useUiPref, useUiState } from '@/features/auth/use-ui-pref';
import { DowntimeDonut, EventsPerDayChart, RingGauge, Sparkline } from '@/components/charts/charts';

/**
 * Dashboard — a tela que abre depois do login.
 *
 * É um centro de comando, não um relatório: o painel de cima responde em três
 * segundos "quantos carros tenho, onde estão os que faltam e o que está preso";
 * o resto da tela explica o porquê com a frota carro a carro e as tendências.
 *
 * Meta de disponibilidade: ARBITRADO em 85% até o PCM fixar o valor (RF-38 fala
 * em meta sem numerá-la). Vale para a cor do anel e para a marca no arco.
 */
const AVAILABILITY_TARGET = 85;

type StageKey = 'triage' | 'field' | 'queue' | 'shop' | 'part' | 'release';

/** Etapas do fluxo da garagem, na ordem em que um carro as atravessa. */
const STAGES: { key: StageKey; statuses: VehicleStatus[]; family: Family; to: string }[] = [
  { key: 'triage', statuses: ['AWAITING_TRIAGE'], family: 'waiting', to: '/triagem' },
  { key: 'field', statuses: ['FIELD_SERVICE'], family: 'waiting', to: '/socorro' },
  { key: 'queue', statuses: ['AWAITING_MAINTENANCE'], family: 'waiting', to: '/fila' },
  { key: 'shop', statuses: ['IN_MAINTENANCE'], family: 'working', to: '/os?status=IN_PROGRESS' },
  { key: 'part', statuses: ['AWAITING_PART'], family: 'stopped', to: '/estoque' },
  {
    key: 'release',
    statuses: ['IN_INSPECTION', 'IN_CLEANING'],
    family: 'working',
    to: '/os?status=RELEASING',
  },
];

export function DashboardPage() {
  const { t } = useI18n();
  const [period] = useDashboardPeriod();
  const { days, back } = period;
  const periodLabel = periodName(period, t);

  usePageHeader({
    eyebrow: t.dash.eyebrow,
    title: t.dash.title,
    description:
      period.days === 1 || isCustom(period)
        ? t.dash.subtitleDay.replace('{p}', periodLabel)
        : t.dash.subtitle.replace('{n}', String(days)),
    actions: (
      <>
        <TickerSwitch />
        <PeriodControl />
      </>
    ),
  });

  const {
    data: fresh,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['dashboard', days, back, period.from ?? null, period.to ?? null],
    queryFn: () =>
      api.get<DashboardData>(
        isCustom(period)
          ? `/dashboard?from=${period.from}&to=${period.to}&months=12`
          : `/dashboard?days=${days}&back=${back}&months=12`,
      ),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  // Último dado bom (de qualquer período, no cache): se a consulta do período
  // novo falhar, o painel anterior continua na tela com o aviso, em vez de sumir.
  const queryClient = useQueryClient();
  const data =
    fresh ??
    queryClient
      .getQueriesData<DashboardData>({ queryKey: ['dashboard'] })
      .map(([, d]) => d)
      .find((d): d is DashboardData => Boolean(d));

  // Sem dado nenhum: erro com o motivo e um botão para tentar de novo. Com dado
  // na tela, uma atualização que falhou não apaga o painel — só avisa.
  const errorBlock = !data && isError ? (
      <div className="tp-alert tp-alert--danger dash-error" role="alert">
        <span>
          {t.dash.error} {describeError(error, t)}
        </span>
        <button
          type="button"
          className="tp-btn tp-btn--secondary tp-btn--sm"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCw size={14} className={isFetching ? 'is-spinning' : undefined} /> {t.dash.retry}
        </button>
      </div>
  ) : null;

  const staleNotice = isError ? (
    <div className="tp-alert tp-alert--warning dash-error" role="status">
      <span>
        {t.dash.staleError} {describeError(error, t)}
      </span>
      <button
        type="button"
        className="tp-btn tp-btn--secondary tp-btn--sm"
        onClick={() => void refetch()}
        disabled={isFetching}
      >
        <RefreshCw size={14} className={isFetching ? 'is-spinning' : undefined} /> {t.dash.retry}
      </button>
    </div>
  ) : null;

  const availabilityPct = Math.round((data?.fleet.availabilityRate ?? 0) * 1000) / 10;
  const availabilityTone: Tone =
    availabilityPct >= AVAILABILITY_TARGET
      ? 'good'
      : availabilityPct >= AVAILABILITY_TARGET - 10
        ? 'warn'
        : 'danger';

  return (
    <div className="dash">
      {staleNotice}
      {/* ---- Avisos e alertas: o que pede atenção, antes de qualquer número ---- */}
      <NoticeBoard />
      {/* ---- Centro de comando: fluxo, os três números e a frota; a pessoa arrasta para reordenar.
           Enquanto a consulta principal não chega, o esqueleto com a mesma geometria; os cards de
           baixo têm consultas próprias e carregam ao mesmo tempo. ---- */}
      {!data ? (
        (errorBlock ?? <DashboardSkeleton />)
      ) : (
      <SortableCards
        prefKey="dash.order"
        items={[
          {
            key: 'flow',
            render: (grip) => (
              <CollapsibleCard
                id="dash.flow"
                grip={grip}
                className="dash-hero dash-glass"
                label={t.dash.title}
                head={
                  <>
                    <div>
                      <h3>
                        {t.dash.flowTitle} <LiveBadge />
                      </h3>
                      <span className="chart__hint">{t.dash.flowHint}</span>
                    </div>
                    <ul className="dash-flow-legend" aria-label={t.dash.legendLabel}>
                      <li className="dash-flow-legend__item dash-flow-legend__item--waiting">
                        {t.dash.flowLegend.waiting}
                      </li>
                      <li className="dash-flow-legend__item dash-flow-legend__item--working">
                        {t.dash.flowLegend.working}
                      </li>
                      <li className="dash-flow-legend__item dash-flow-legend__item--stopped">
                        {t.dash.flowLegend.stopped}
                      </li>
                      <li className="dash-flow-legend__item dash-flow-legend__item--empty">
                        {t.dash.flowLegend.empty}
                      </li>
                    </ul>
                  </>
                }
              >
                <div className="dash-hero__grid">
                  <div className="dash-gauge">
                    <div className="dash-gauge__ring">
                      <RingGauge
                        value={availabilityPct}
                        target={AVAILABILITY_TARGET}
                        tone={availabilityTone}
                        label={t.dash.availability}
                      />
                      <div className="dash-gauge__center">
                        <strong className="dash-gauge__value">
                          {availabilityPct.toLocaleString('pt-BR')}
                          <small>%</small>
                        </strong>
                        <span className="dash-gauge__label">{t.dash.availability}</span>
                      </div>
                    </div>
                    <div className="dash-gauge__foot">
                      <span className="dash-gauge__ready">
                        <b>{data.fleet.available}</b> {t.dash.of} <b>{data.fleet.total}</b>{' '}
                        {t.dash.readyBuses}
                      </span>
                      <span className="dash-gauge__meta">
                        <Delta
                          value={data.fleet.availabilityDelta}
                          suffix=" pp"
                          label={t.dash.vs7d}
                        />
                        <span className="dash-gauge__target">
                          {t.dash.target} {AVAILABILITY_TARGET}%
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="dash-flow-wrap">
                    <GarageFlow byStatus={data.fleet.byStatus} />
                    <StatusSummary byStatus={data.fleet.byStatus} total={data.fleet.total} />
                  </div>
                </div>
              </CollapsibleCard>
            ),
          },
          {
            key: 'kpis',
            render: (grip) => (
              <CollapsibleCard
                id="dash.kpis"
                grip={grip}
                className="dash-kpis dash-glass"
                label={t.dash.kpisTitle}
                head={
                  <div>
                    <h3>
                      {t.dash.kpisTitle} <LiveBadge />
                    </h3>
                    <span className="chart__hint">{t.dash.kpisHint}</span>
                  </div>
                }
              >
                <div className="dash-kpis__grid">
                  <Kpi
                    label={t.dash.mkbf}
                    hint={`${t.dash.mkbfHint} · ${t.dash.last30}`}
                    value={
                      data.mkbf.last30.mkbf === null
                        ? '—'
                        : `${formatNumber(data.mkbf.last30.mkbf)} km`
                    }
                    tone="brand"
                    spark={data.mkbf.series.map((p) => p.mkbf)}
                    sparkColor="var(--chart-1)"
                    note={
                      data.mkbf.last30.mkbf === null
                        ? t.dash.noReturns
                        : `${formatNumber(data.mkbf.last30.kmTraveled)} km ÷ ${formatNumber(data.mkbf.last30.unscheduledReturns)} ${t.dash.breakdowns}`
                    }
                    back={<MkbfBack data={data} />}
                    backTo="/indicadores"
                    backLabel={t.dash.back.openIndicators}
                  />
                  <Kpi
                    label={t.dash.inQueue}
                    hint={t.dash.inQueueHint}
                    value={String(data.queue.waiting)}
                    tone={data.queue.waiting > 3 ? 'warn' : 'neutral'}
                    note={
                      data.queue.oldestWaitingHours !== null
                        ? `+ ${data.queue.inService} ${t.dash.inService} · ${t.dash.oldest} ${data.queue.oldestWaitingHours}${t.dash.hours}`
                        : `+ ${data.queue.inService} ${t.dash.inService}`
                    }
                    back={<QueueBack data={data} />}
                    backTo="/fila"
                    backLabel={t.dash.back.openQueue}
                  />
                  <Kpi
                    label={t.dash.openWo}
                    hint={t.dash.openWoHint}
                    value={String(data.workOrders.open)}
                    tone={data.workOrders.overdue > 0 ? 'danger' : 'neutral'}
                    note={[
                      data.workOrders.overdue > 0
                        ? `${data.workOrders.overdue} ${t.dash.overdue}`
                        : null,
                      `${data.workOrders.releasedToday} ${t.dash.releasedToday}`,
                      data.workOrders.averageDowntimeMinutes !== null
                        ? `${t.dash.avg} ${formatMinutes(data.workOrders.averageDowntimeMinutes)} ${t.dash.perWo}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    back={<WorkOrdersBack data={data} />}
                    backTo={
                      data.backs.workOrders.mostOverdue
                        ? `/os/${data.backs.workOrders.mostOverdue.id}`
                        : '/os'
                    }
                    backLabel={t.dash.back.openWo}
                  />
                </div>
              </CollapsibleCard>
            ),
          },
          { key: 'fleet', render: (grip) => <FleetNow vehicles={data.vehicles} grip={grip} /> },
          {
            key: 'widgets',
            render: (grip) => <WidgetsCard grip={grip} vehicles={data.vehicles} />,
          },
        ]}
      />
      )}

      {/* ---- Tendências ---- */}
      <section className="dash-row dash-row--charts">
        <MkbfCard />
        <AvailabilityCard />
      </section>

      <section className="dash-row dash-row--top">
        <TopFailuresCard />
      </section>

      <section className="dash-row dash-row--bottom">
        <DowntimeCard />
        <EventsCard />
        <RecentEventsCard />
      </section>

      {data && (
        <p className="tp-muted dash-updated">
          {t.dash.updated} {formatDateTime(data.generatedAt)}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Os três cards de baixo, cada um com o próprio período (salvo na conta), como
 * os gráficos de MKBF e disponibilidade: o véu na troca de filtro e o loader
 * da marca no primeiro carregamento.
 */
const BOTTOM_PRESETS = ['today', 'yesterday', 'last30', 'months12', 'custom'] as const;

function DowntimeCard() {
  const { t } = useI18n();
  const [period, setPeriod] = useChartPeriod('dash.period.downtime', 'last30');
  const { from, to } = resolveChartPeriod(period);
  const query = useQuery({
    queryKey: ['dashboard', 'downtime', from, to],
    queryFn: () => api.get<DashboardDowntime>(`/dashboard/downtime?from=${from}&to=${to}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const d = query.data;
  return (
    <div className="tp-card dash-glass">
      <div className="chart__title chart__title--tools">
        <div>
          <h3>{t.dash.downtime}</h3>
          <span className="chart__hint">{t.dash.downtimeHint} · {rangeLabel(from, to)}</span>
        </div>
        <ChartPeriodBar value={period} onChange={setPeriod} presets={BOTTOM_PRESETS} />
      </div>
      {d ? (
        <RefreshVeil active={query.isPlaceholderData} delay={0}>
          <DowntimeDonut data={d.downtimeByCause} totalMinutes={d.totalDowntimeMinutes} />
        </RefreshVeil>
      ) : (
        <ChartLoading />
      )}
    </div>
  );
}

function EventsCard() {
  const { t } = useI18n();
  const [period, setPeriod] = useChartPeriod('dash.period.events', 'last30');
  const { from, to } = resolveChartPeriod(period);
  const query = useQuery({
    queryKey: ['dashboard', 'events-series', from, to],
    queryFn: () => api.get<DashboardEventsSeries>(`/dashboard/events-series?from=${from}&to=${to}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const d = query.data;
  useFallbackToast(d?.fellBack ? `events:${d.requested.to}>${d.used.to}` : null, d?.requested.to ?? null, d?.used.to ?? null);
  // O título segue o eixo pedido (não o do dado anterior que está sob o véu).
  const bucket = from === to ? 'hour' : daysInRange(from, to) > 120 ? 'week' : 'day';
  return (
    <div className="tp-card dash-glass">
      <div className="chart__title chart__title--tools">
        <div>
          <h3>{bucket === 'hour' ? t.dash.eventsPerHour : bucket === 'week' ? t.dash.eventsPerWeek : t.dash.eventsPerDay}</h3>
          <span className="chart__hint">{t.dash.eventsHint.replace('{r}', rangeLabel(d?.used.from ?? from, d?.used.to ?? to))}</span>
        </div>
        <ChartPeriodBar value={period} onChange={setPeriod} presets={BOTTOM_PRESETS} />
      </div>
      {d ? (
        <RefreshVeil active={query.isPlaceholderData} delay={0}>
          <EventsPerDayChart data={d.points} bucket={d.bucket} />
        </RefreshVeil>
      ) : (
        <ChartLoading />
      )}
    </div>
  );
}

function RecentEventsCard() {
  const { t } = useI18n();
  const [period, setPeriod] = useChartPeriod('dash.period.recent', 'last30');
  const { from, to } = resolveChartPeriod(period);
  const query = useQuery({
    queryKey: ['dashboard', 'recent-events', from, to],
    queryFn: () => api.get<DashboardRecentEvents>(`/dashboard/recent-events?from=${from}&to=${to}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const d = query.data;
  const rows = d?.events;
  useFallbackToast(d?.fellBack ? `recent:${d.requested.to}>${d.used.to}` : null, d?.requested.to ?? null, d?.used.to ?? null);
  return (
    <div className="tp-card dash-glass">
      <div className="tp-card__head">
        <div className="chart__title">
          <h3>{t.dash.recentEvents}</h3>
          <span className="chart__hint">{rangeLabel(d?.used.from ?? from, d?.used.to ?? to)}</span>
        </div>
        <Link to="/eventos" className="tp-btn tp-btn--ghost tp-btn--sm">
          {t.dash.seeAll}
        </Link>
      </div>
      <ChartPeriodBar value={period} onChange={setPeriod} presets={BOTTOM_PRESETS} />
      {rows ? (
        <RefreshVeil active={query.isPlaceholderData} delay={0}>
          <ul className="recent-list">
            {rows.map((e) => (
              <li key={e.id}>
                <div className="recent-list__main">
                  <b>{e.vehicleCode}</b>
                  <span>{e.catalog?.description ?? e.reportedDescription ?? e.code}</span>
                </div>
                <div className="recent-list__meta">
                  <span className={`tp-badge tp-badge--status ${badgeFor(e.status)}`}>
                    {EVENT_STATUS_LABELS[e.status]}
                  </span>
                  <span className="tp-muted">{formatDateTime(e.reportedAt)}</span>
                </div>
              </li>
            ))}
            {rows.length === 0 && <li className="tp-muted">{t.dash.noEvents}</li>}
          </ul>
        </RefreshVeil>
      ) : (
        <ChartLoading />
      )}
    </div>
  );
}

type Tone = 'good' | 'warn' | 'danger' | 'brand' | 'neutral';

function Delta({
  value,
  suffix = '',
  label,
}: {
  value: number | null | undefined;
  suffix?: string;
  label?: string;
}) {
  if (value === null || value === undefined) return null;
  const Icon = value === 0 ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = value === 0 ? 'neutral' : value > 0 ? 'good' : 'danger';
  return (
    <span className={`dash-kpi__delta dash-kpi__delta--${tone}`}>
      <Icon size={14} />
      {value > 0 ? '+' : ''}
      {value.toLocaleString('pt-BR')}
      {suffix}
      {label && <em> {label}</em>}
    </span>
  );
}

function Kpi({
  label,
  hint,
  value,
  tone,
  delta,
  deltaSuffix = '',
  deltaLabel,
  note,
  spark,
  sparkColor,
  back,
  backTo,
  backLabel,
}: {
  label: string;
  hint?: string;
  value: string;
  tone: Tone;
  delta?: number | null;
  deltaSuffix?: string;
  deltaLabel?: string;
  note?: string;
  spark?: (number | null)[];
  sparkColor?: string;
  /** Verso do cartão: o porquê do número. Com ele, o cartão vira ao clicar. */
  back?: ReactNode;
  /** Tela onde o assunto do verso se resolve, e o texto do atalho. */
  backTo?: string;
  backLabel?: string;
}) {
  const { t } = useI18n();
  const [flipped, setFlipped] = useState(false);
  const front = (
    <>
      <div className="dash-kpi__head">
        <span className="tp-kpi__label">{label}</span>
        <span className="dash-kpi__head-right">
          {hint && <span className="dash-kpi__hint">{hint}</span>}
          {back && (
            <span className="dash-kpi__flip" aria-hidden title={t.dash.back.flip}>
              <Repeat2 size={11} />
            </span>
          )}
        </span>
      </div>
      <div className="dash-kpi__body">
        <strong className="dash-kpi__value">{value}</strong>
        {spark && <Sparkline values={spark} color={sparkColor} />}
      </div>
      <Delta value={delta} suffix={deltaSuffix} label={deltaLabel} />
      {note && <span className="tp-kpi__note">{note}</span>}
    </>
  );
  if (!back) return <div className={`dash-kpi dash-kpi--${tone}`}>{front}</div>;

  // Virada em 3D: frente e verso ocupam a mesma célula, o cartão tem a altura
  // do maior dos dois e gira no eixo vertical. Clique em qualquer ponto vira;
  // links do verso não viram de volta.
  const toggle = () => setFlipped((f) => !f);
  return (
    <div className={`dash-kpi dash-kpi--${tone} dash-kpi--flip${flipped ? ' is-flipped' : ''}`}>
      <div className="dash-kpi__inner">
        <div
          className="dash-kpi__face dash-kpi__face--front"
          role="button"
          tabIndex={flipped ? -1 : 0}
          aria-hidden={flipped}
          aria-label={`${label}. ${t.dash.back.flip}`}
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          }}
        >
          {front}
        </div>
        <div className="dash-kpi__face dash-kpi__face--back" aria-hidden={!flipped}>
          <div className="dash-kpi__head">
            <span className="tp-kpi__label">{label}</span>
            <span className="dash-kpi__back-actions">
              {backTo && (
                <Link
                  to={backTo}
                  className="kpi-back__open"
                  title={backLabel}
                  aria-label={backLabel}
                  tabIndex={flipped ? 0 : -1}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ArrowUpRight size={14} aria-hidden />
                </Link>
              )}
              <button
                type="button"
                className="dash-kpi__unflip"
                onClick={toggle}
                tabIndex={flipped ? 0 : -1}
                aria-label={t.dash.back.flipBack}
                title={t.dash.back.flipBack}
              >
                <Undo2 size={14} aria-hidden />
              </button>
            </span>
          </div>
          {back}
        </div>
      </div>
    </div>
  );
}

const plural = (n: number, text: string) => {
  const [one, many] = text.split('|');
  return n === 1 ? one : (many ?? one);
};

/** Uma linha do verso: rótulo à esquerda, valor à direita, barra opcional por baixo. */
function BackRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger' | 'warn' | 'neutral';
}) {
  return (
    <li className={`kpi-back__row${tone ? ` kpi-back__row--${tone}` : ''}`}>
      <span className="kpi-back__label">{label}</span>
      <span className="kpi-back__value">{value}</span>
    </li>
  );
}

function MkbfBack({ data }: { data: DashboardData }) {
  const { t } = useI18n();
  const b = data.backs.mkbf;
  const cur = data.mkbf.last30;
  const pct =
    b.previous.mkbf && cur.mkbf ? ((cur.mkbf - b.previous.mkbf) / b.previous.mkbf) * 100 : null;
  const pctText =
    pct === null ? '' : `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1).replace('.', ',')}%`;
  const top = b.topSystems[0];
  return (
    <>
      <KpiAi>
        {cur.mkbf === null
          ? t.dash.back.aiNoReturns
          : t.dash.back.aiMkbf.replace('{v}', formatNumber(cur.mkbf)) +
            (pctText ? t.dash.back.aiVs.replace('{p}', pctText) : '') +
            (top ? t.dash.back.aiTop.replace('{s}', top.name) : '') +
            (b.worstVehicle
              ? t.dash.back.aiWorst
                  .replace('{c}', b.worstVehicle.code)
                  .replace('{n}', String(b.worstVehicle.count))
              : '') +
            '.'}
      </KpiAi>
      <ul className="kpi-back__list">
        <BackRow
          label={t.dash.back.previous}
          value={b.previous.mkbf === null ? '—' : `${formatNumber(b.previous.mkbf)} km${pctText ? ` · ${pctText}` : ''}`}
          tone={pct === null ? undefined : pct >= 0 ? 'neutral' : 'danger'}
        />
        {top ? (
          <BackRow
            label={`${t.dash.back.topSystems}: ${top.name}`}
            value={`${top.count} ${plural(top.count, t.dash.back.times)}`}
          />
        ) : (
          <BackRow label={t.dash.back.topSystems} value={t.dash.back.noReturns} />
        )}
      </ul>
    </>
  );
}

function QueueBack({ data }: { data: DashboardData }) {
  const { t } = useI18n();
  const b = data.backs.queue;
  const fmtH = (h: number) => `${h.toFixed(1).replace('.', ',')}${t.dash.hours}`;
  const first = b.oldest[0];
  return (
    <>
      <KpiAi>
        {data.queue.waiting === 0
          ? t.dash.back.aiQueueEmpty.replace('{n}', String(data.queue.inService))
          : !first
            ? t.dash.back.aiQueueNoTime.replace('{n}', String(data.queue.waiting))
            : t.dash.back.aiQueue
              .replace('{n}', String(data.queue.waiting))
              .replace('{c}', first.code)
              .replace('{h}', fmtH(first.hours)) +
            (b.averageWaitHours !== null
              ? t.dash.back.aiAvg.replace('{h}', fmtH(b.averageWaitHours))
              : '') +
            '.'}
      </KpiAi>
      <ul className="kpi-back__list">
        {b.oldest.length === 0 ? (
          <BackRow
            label={t.dash.back.oldest}
            value={data.queue.waiting === 0 ? t.dash.back.emptyQueue : t.dash.back.noEntryTime}
          />
        ) : (
          b.oldest.slice(0, 1).map((q) => (
            <BackRow
              key={q.code}
              label={`${t.dash.back.oldest}: ${q.code}`}
              value={fmtH(q.hours)}
              tone={q.hours >= 12 ? 'danger' : undefined}
            />
          ))
        )}
        <BackRow
          label={`${t.dash.back.enteredToday} / ${t.dash.back.startedToday}`}
          value={`${b.enteredToday} / ${b.startedToday}`}
        />
      </ul>
    </>
  );
}

function WorkOrdersBack({ data }: { data: DashboardData }) {
  const { t } = useI18n();
  const b = data.backs.workOrders;
  const stages: { key: keyof typeof b.byStage; label: string; tone?: 'danger' | 'warn' }[] = [
    { key: 'waitingPart', label: t.dash.back.stageWaitingPart, tone: 'danger' },
    { key: 'open', label: t.dash.back.stageOpen, tone: 'warn' },
    { key: 'inProgress', label: t.dash.back.stageInProgress },
    { key: 'techClosed', label: t.dash.back.stageTechClosed },
    { key: 'inInspection', label: t.dash.back.stageInInspection },
    { key: 'inCleaning', label: t.dash.back.stageInCleaning },
  ];
  const shown = stages.filter((s) => b.byStage[s.key] > 0).slice(0, 2);
  const ai =
    t.dash.back.aiWo
      .replace('{n}', String(data.workOrders.open))
      .replace('{o}', String(data.workOrders.overdue))
      .replace('{p}', String(b.byStage.waitingPart)) +
    (b.mostOverdue
      ? t.dash.back.aiMostOverdue
          .replace('{code}', b.mostOverdue.code)
          .replace('{c}', b.mostOverdue.vehicleCode)
          .replace('{h}', `${b.mostOverdue.lateHours.toLocaleString('pt-BR')}${t.dash.hours}`)
      : '') +
    '.';
  return (
    <>
    <KpiAi>{ai}</KpiAi>
    <ul className="kpi-back__list">
      {shown.length === 0 && <BackRow label={t.dash.back.byStage} value="0" />}
      {shown.map((s) => (
        <BackRow key={s.key} label={s.label} value={String(b.byStage[s.key])} tone={s.tone} />
      ))}
    </ul>
    </>
  );
}

/**
 * O fluxo da garagem como um trilho: cada nó é uma etapa, o número dentro é
 * quantos carros estão nela agora. Nó apagado = etapa vazia; nó aceso = há
 * carro ali; "aguardando peça" pulsa porque é o único estado em que o carro
 * está parado sem ninguém trabalhando nele (RN-09).
 */
function GarageFlow({ byStatus }: { byStatus: Record<VehicleStatus, number> }) {
  const { t } = useI18n();
  const stages = STAGES.map((s) => ({
    ...s,
    label: t.dash.stages[s.key],
    n: s.statuses.reduce((sum, st) => sum + (byStatus[st] ?? 0), 0),
  }));

  return (
    <ol className="dash-flow" aria-label={t.dash.flowTitle}>
      {stages.map((s, i) => (
        <li
          key={s.key}
          className={`dash-flow__stage dash-flow__stage--${s.family}${s.n > 0 ? ' is-active' : ''}`}
        >
          {i > 0 && <i className="dash-flow__rail" aria-hidden />}
          <Link to={s.to} className="dash-flow__node" aria-label={`${s.label}: ${s.n}`}>
            <b>{s.n}</b>
          </Link>
          <span className="dash-flow__label">{s.label}</span>
          <InfoTip
            label={`${t.dash.whatIs} ${s.label}`}
            align={i === 0 ? 'start' : i === stages.length - 1 ? 'end' : 'center'}
            className="dash-flow__info"
          >
            <span className="tp-tip__title">
              <i className="tp-tip__dot" aria-hidden />
              {s.label}
              <b className="tp-tip__count">
                {s.n} {s.n === 1 ? t.dash.carNow : t.dash.carsNow}
              </b>
            </span>
            <span className="tp-tip__body">{t.dash.stageHelp[s.key]}</span>
            <span className="tp-tip__meta">
              {t.dash.stageStates}: {s.statuses.map((st) => VEHICLE_STATUS_LABELS[st]).join(' · ')}
              {' · '}
              {t.dash.flowFamily}: {t.dash[s.family]}
            </span>
            <span className="tp-tip__foot">
              {t.dash.stageOpen} {s.label} ↗
            </span>
          </InfoTip>
        </li>
      ))}
    </ol>
  );
}

function StatusSummary({
  byStatus,
  total,
}: {
  byStatus: Record<VehicleStatus, number>;
  total: number;
}) {
  const { t } = useI18n();
  const families = [
    { key: 'running', label: t.dash.running, cls: 'tp-state--running' },
    { key: 'waiting', label: t.dash.waiting, cls: 'tp-state--waiting' },
    { key: 'working', label: t.dash.working, cls: 'tp-state--working' },
    { key: 'stopped', label: t.dash.stopped, cls: 'tp-state--stopped' },
  ] as const;

  const counts = families.map((f) => ({
    ...f,
    n: Object.entries(byStatus)
      .filter(([status]) => VEHICLE_STATE_FAMILY[status] === f.key)
      .reduce((sum, [, n]) => sum + n, 0),
  }));

  return (
    <div className="status-summary">
      <div className="status-summary__bar">
        {counts.map((c) => (
          <i
            key={c.key}
            className={`status-summary__seg status-summary__seg--${c.key}`}
            style={{ width: `${total ? (c.n / total) * 100 : 0}%` }}
            title={`${c.label}: ${c.n}`}
          />
        ))}
      </div>
      <ul className="status-summary__legend">
        {counts.map((c) => (
          <li key={c.key}>
            <span className={`tp-state ${c.cls}`}>{c.label}</span>
            <b>{c.n}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A frota carro a carro, com a legenda das quatro famílias de estado no
 * cabeçalho. A legenda é também o filtro: passar o mouse realça a família,
 * clicar deixa só ela na grade (clicar de novo, ou em "Todos", volta).
 */
function FleetNow({ vehicles, grip }: { vehicles: DashboardVehicle[]; grip?: ReactNode }) {
  const { t } = useI18n();
  const [selected, setSelected] = useUiState<Family | null>('dashboard.fleetStatus', null);
  const [search, setSearch] = useUiState<string>('dashboard.fleetSearch', '');
  const [hovered, setHovered] = useState<Family | null>(null);

  // Busca pelo número do carro (ou placa): acha o carro onde ele estiver, rodando inclusive.
  const q = search.trim().toLowerCase();
  const matches = (v: DashboardVehicle) =>
    !q || v.code.toLowerCase().includes(q) || v.plate.toLowerCase().includes(q);
  const visible = (selected ? vehicles.filter((v) => familyOf(v.status) === selected) : vehicles).filter(matches);
  const focus = hovered ?? selected;

  // Numa frota de centenas de carros, 400 ônibus iguais rodando não dizem nada:
  // eles viram um cartão com a soma, e a grade mostra quem está na garagem.
  const big = vehicles.length > 60;
  const collapseRunning = big && selected !== 'running' && !q;
  const running = vehicles.filter((v) => familyOf(v.status) === 'running');
  const shown = collapseRunning ? visible.filter((v) => familyOf(v.status) !== 'running') : visible;
  const inLine = running.filter((v) => v.status === 'IN_LINE').length;

  return (
    <CollapsibleCard
      id="dash.fleet"
      grip={grip}
      className="tp-card dash-glass dash-fleet"
      headClassName="tp-card__head dash-fleet__head"
      label={t.dash.fleetNow}
      head={
        <>
          <div>
            <h3>
              {t.dash.fleetNow} <LiveBadge />
            </h3>
            <span className="chart__hint">
              {big ? t.dash.fleetNowHintBig : t.dash.fleetNowHint}
            </span>
          </div>
          <FleetLegend
            statuses={vehicles.map((v) => v.status)}
            selected={selected}
            onSelect={setSelected}
            onHover={setHovered}
          />
          <label className="tp-search dash-fleet__search">
            <Search size={15} aria-hidden />
            <input
              type="search"
              className="tp-input"
              placeholder={t.dash.searchCar}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t.dash.searchCar}
            />
          </label>
          <Link to="/frota" className="tp-btn tp-btn--ghost tp-btn--sm">
            {t.dash.seeAll}
          </Link>
        </>
      }
    >
      <div className="bus-grid" data-focus={focus ?? undefined}>
        {collapseRunning && running.length > 0 && (
          <Link to="/frota?status=IN_LINE" className="bus-card bus-card--running bus-card--summary">
            <BusRender
              vehicleClass="PADRON_13M"
              status="IN_LINE"
              width={260}
              title="Carros rodando"
            />
            <div className="bus-card__text">
              <div className="bus-card__row">
                <b className="bus-card__big">{running.length}</b>
                <span className={`tp-state tp-state--running`}>{t.dash.runningSummary}</span>
              </div>
              <span className="tp-muted">
                {inLine} {t.dash.inLineShort} · {running.length - inLine} {t.dash.inYardShort}
              </span>
            </div>
          </Link>
        )}
        {shown.map((v) => (
          <BusCard key={v.id} vehicle={v} />
        ))}
      </div>
      {shown.length === 0 && !collapseRunning && (
        <p className="tp-muted dash-fleet__empty">
          {q ? t.dash.searchEmpty.replace('{q}', search.trim()) : t.dash.legendEmpty}
        </p>
      )}
    </CollapsibleCard>
  );
}

/**
 * O motivo é a falha que trouxe o carro. Depois do serviço, a fase muda e o
 * texto precisa dizer isso: na inspeção o reparo está sendo conferido; na
 * limpeza o reparo já foi aprovado e o carro só espera o último portão.
 */
function reasonPhase(status: DashboardVehicle['status']): string {
  if (status === 'IN_INSPECTION') return 'Reparo em conferência · ';
  if (status === 'IN_CLEANING') return 'Reparo aprovado · ';
  return '';
}

/**
 * Card de um carro na garagem. A frente é o estado de relance; a chave vira o
 * card e mostra a manutenção (OS aberta e os números de 30 dias) sem sair do
 * Dashboard. Clicar no card continua abrindo o carro.
 */
function BusCard({ vehicle }: { vehicle: DashboardVehicle }) {
  const family = VEHICLE_STATE_FAMILY[vehicle.status] ?? 'waiting';
  const f = useFlip(vehicle.id);
  return (
    <article className={`bus-stage ${f.stageClass}`} onKeyDown={f.onKeyDown}>
      <div className="flip__inner" onTransitionEnd={f.onTransitionEnd}>
        <div
          className={`bus-card bus-card--${family} flip__face`}
          aria-hidden={f.flipped}
          inert={f.flipped}
        >
          <Link
            to={`/frota/${vehicle.id}`}
            className="flip__link"
            aria-label={`Abrir o carro ${vehicle.code}`}
          />
          <FlipButton code={vehicle.code} flip={f} corner />
          <BusRender
            vehicleClass={vehicle.vehicleClass}
            technology={vehicle.technology}
            status={vehicle.status}
            code={vehicle.code}
            width={260}
          />
          <div className="bus-card__text">
            <div className="bus-card__row">
              <b>{vehicle.code}</b>
              <span className="tp-muted">{vehicle.plate}</span>
            </div>
            <span className={`tp-state tp-state--${family}`}>
              {VEHICLE_STATUS_LABELS[vehicle.status]}
            </span>
            <span className="bus-card__reason" title={vehicle.reason ?? undefined}>
              {vehicle.reason ? `${reasonPhase(vehicle.status)}${vehicle.reason}` : ' '}
            </span>
            <span className="bus-card__since tp-muted">
              {vehicle.hoursInState !== null
                ? `há ${vehicle.hoursInState.toLocaleString('pt-BR')}h`
                : ' '}
            </span>
          </div>
        </div>
        <div
          className={`bus-card bus-card--${family} bus-card--back flip__face flip__face--back`}
          aria-hidden={!f.flipped}
          inert={!f.flipped}
        >
          <BackHead code={vehicle.code} flip={f} />
          <MaintenanceBack id={vehicle.id} enabled={f.flipped} compact />
          <BackFoot id={vehicle.id} />
        </div>
      </div>
    </article>
  );
}

function badgeFor(status: string): string {
  switch (status) {
    case 'CLOSED':
      return 'tp-badge--success';
    case 'IN_MAINTENANCE':
    case 'FIELD_SERVICE':
      return 'tp-badge--info';
    case 'DEFERRED':
    case 'CANCELLED':
      return '';
    default:
      return 'tp-badge--warning';
  }
}

/** Motivo curto do erro, para quem lê saber se é cota, servidor ou rede. */
function describeError(error: unknown, t: ReturnType<typeof useI18n>['t']): string {
  if (!(error instanceof ApiError)) return '';
  if (error.body.statusCode === 429) return t.dash.errorRate;
  if (error.body.statusCode >= 500) return t.dash.errorServer;
  return error.message ? `(${error.message})` : '';
}

// ---------------------------------------------------------------------------
// Período do histórico: na URL (?dias=90) para ser compartilhável, e lembrado
// no navegador para a pessoa não escolher de novo a cada visita.

function isPeriod(n: number): n is (typeof DASHBOARD_PERIODS)[number] {
  return (DASHBOARD_PERIODS as readonly number[]).includes(n);
}

/**
 * Período do Dashboard: um dia só (hoje, D-1, D-2) ou os últimos N dias.
 * A URL (compartilhável) vence quando traz um; senão vale o salvo na conta.
 */
export interface DashPeriod {
  days: number;
  /** 0 = até agora; 1 = ontem; 2 = anteontem (só com days = 1). */
  back: 0 | 1 | 2;
  /** Intervalo livre (dias civis); quando presente, vence days/back. */
  from?: string;
  to?: string;
}
const DAY_PRESETS: { key: string; period: DashPeriod }[] = [
  { key: 'hoje', period: { days: 1, back: 0 } },
  { key: 'd1', period: { days: 1, back: 1 } },
  { key: 'd2', period: { days: 1, back: 2 } },
];
const samePeriod = (a: DashPeriod, b: DashPeriod) =>
  a.days === b.days && a.back === b.back && !a.from && !b.from;
const isCustom = (p: DashPeriod) => Boolean(p.from && p.to);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function parsePeriod(
  dias: string | null,
  antes: string | null,
  de: string | null = null,
  ate: string | null = null,
): DashPeriod | null {
  if (de && ate && ISO_DAY.test(de) && ISO_DAY.test(ate) && de <= ate) {
    return { days: daysInRange(de, ate), back: 0, from: de, to: ate };
  }
  const d = Number(dias);
  const b = Number(antes ?? 0);
  if (!dias) return null;
  if (d === 1 && (b === 0 || b === 1 || b === 2)) return { days: 1, back: b as 0 | 1 | 2 };
  if (isPeriod(d)) return { days: d, back: 0 };
  return null;
}

function useDashboardPeriod(): [DashPeriod, (p: DashPeriod) => void] {
  const [params, setParams] = useSearchParams();
  const [saved, setSaved] = useUiPref<DashPeriod>('dash.period', {
    days: DEFAULT_DASHBOARD_PERIOD,
    back: 0,
  });
  const period =
    parsePeriod(params.get('dias'), params.get('antes'), params.get('de'), params.get('ate')) ??
    (isCustom(saved) || saved.days === 1 || isPeriod(saved.days)
      ? saved
      : { days: DEFAULT_DASHBOARD_PERIOD, back: 0 });
  const set = (p: DashPeriod) => {
    setSaved(p);
    const next = new URLSearchParams(params);
    for (const k of ['dias', 'antes', 'de', 'ate']) next.delete(k);
    if (isCustom(p)) {
      next.set('de', p.from as string);
      next.set('ate', p.to as string);
    } else {
      next.set('dias', String(p.days));
      if (p.back) next.set('antes', String(p.back));
    }
    setParams(next, { replace: true });
  };
  return [period, set];
}

/** "hoje", "ontem", "anteontem" ou "7 dias": o nome do período para dicas e rodapés. */
function periodName(p: DashPeriod, t: ReturnType<typeof useI18n>['t']): string {
  if (isCustom(p)) return rangeLabel(p.from as string, p.to as string);
  if (p.days === 1)
    return p.back === 0
      ? t.dash.dayPresets.todayName
      : p.back === 1
        ? t.dash.dayPresets.d1Name
        : t.dash.dayPresets.d2Name;
  return t.dash.periodDays.replace('{n}', String(p.days));
}

function PeriodControl() {
  const { t } = useI18n();
  const [period, setPeriod] = useDashboardPeriod();
  return (
    <div className="tp-segmented dash-period" role="radiogroup" aria-label={t.dash.period}>
      {DAY_PRESETS.map(({ key, period: p }) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={samePeriod(p, period)}
          className={`tp-segmented__item${samePeriod(p, period) ? ' is-active' : ''}`}
          title={periodName(p, t)}
          onClick={() => setPeriod(p)}
        >
          {t.dash.dayPresets[key as 'hoje' | 'd1' | 'd2']}
        </button>
      ))}
      <i className="dash-period__sep" aria-hidden />
      {DASHBOARD_PERIODS.map((d) => {
        const p: DashPeriod = { days: d, back: 0 };
        return (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={samePeriod(p, period)}
            className={`tp-segmented__item${samePeriod(p, period) ? ' is-active' : ''}`}
            onClick={() => setPeriod(p)}
          >
            {t.dash.periodDays.replace('{n}', String(d))}
          </button>
        );
      })}
      <CustomRangeItem
        active={isCustom(period)}
        label={
          isCustom(period)
            ? rangeLabel(period.from as string, period.to as string)
            : t.dash.periodCustom
        }
        from={
          isCustom(period)
            ? (period.from as string)
            : shiftDays(todayIso(), -(period.days - 1 + period.back))
        }
        to={isCustom(period) ? (period.to as string) : shiftDays(todayIso(), -period.back)}
        onApply={(from, to) => setPeriod({ days: daysInRange(from, to), back: 0, from, to })}
      />
    </div>
  );
}

function daysInRange(from: string, to: string): number {
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  );
}
