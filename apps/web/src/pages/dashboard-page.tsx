import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Database, Minus, RefreshCw, Repeat2, Search, Undo2 } from 'lucide-react';
import {
  EVENT_STATUS_LABELS,
  VEHICLE_STATUS_LABELS,
  type VehicleStatus,
  type DashboardData,
  type DashboardVehicle,
  type DashboardRecentEvents,
  VEHICLE_TECHNOLOGY_LABELS,
  VEHICLE_CLASS_LABELS,
} from '@app/shared';
import { VEHICLE_STATE_FAMILY } from '@app/design-kit';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime, formatNumber } from '@/lib/format';
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
import { IndicatorsSection } from '@/components/dashboard/indicators';
import { DayReading } from '@/components/dashboard/day-reading';
import { RefreshVeil } from '@/components/ui/refresh-veil';
import { DashboardSkeleton } from '@/components/dashboard/dashboard-skeleton';
import { LiveBadge } from '@/components/ui/live-badge';
import { KpiAi } from '@/components/ui/flip-kpi';
import { monthName, rangeLabel, todayIso } from '@/lib/period';
import { useUiState } from '@/features/auth/use-ui-pref';
import { RingGauge, Sparkline } from '@/components/charts/charts';

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

/** "17/11" de um dia ISO. */
const fmtDayIso = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function DashboardPage() {
  const { t } = useI18n();

  usePageHeader({
    eyebrow: t.dash.eyebrow,
    title: t.dash.title,
    description: t.dash.subtitle,
    actions: <TickerSwitch />,
  });

  // A foto da garagem: o "agora" não tem período. (days=30 só alimenta campos da API que a tela não usa mais.)
  const {
    data: fresh,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['dashboard', 'now'],
    queryFn: () => api.get<DashboardData>('/dashboard?days=30&months=12'),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  // Último dado bom no cache: se a atualização falhar, o painel anterior continua na tela com o aviso.
  const queryClient = useQueryClient();
  const data =
    fresh ??
    queryClient
      .getQueriesData<DashboardData>({ queryKey: ['dashboard', 'now'] })
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
  // MKBF do mês contra o mês anterior fechado, em %.
  const monthPct =
    data && data.mkbf.previousMonth.mkbf && data.mkbf.month.mkbf
      ? Math.round(((data.mkbf.month.mkbf - data.mkbf.previousMonth.mkbf) / data.mkbf.previousMonth.mkbf) * 1000) / 10
      : null;
  const monthLabel = (m: string) => monthName(Number(m.slice(5, 7)) - 1);

  return (
    <div className="dash">
      {staleNotice}

      {/* ---- Seção 1 — Agora: a garagem neste instante. Sem período: é a foto de agora, e os
           números do dia são do dia mais recente com dados (a API recua e a tela diz). ---- */}
      <section className="dash-section dash-section--now" aria-labelledby="dash-now">
        <header className="dash-section__head">
          <div>
            <h2 id="dash-now">
              {t.dash.sections.now} <LiveBadge />
            </h2>
            <span className="dash-section__hint">{t.dash.sections.nowHint}</span>
          </div>
          {data && <DataThrough data={data} />}
        </header>
        <DayReading />
        <NoticeBoard />
        {!data ? (
          (errorBlock ?? <DashboardSkeleton />)
        ) : (
        <SortableCards
          prefKey="dash.order.now"
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
                      label={t.dash.mkbfMonth}
                      hint={t.dash.mkbfMonthHint
                        .replace('{m}', monthLabel(data.mkbf.month.month))
                        .replace('{d}', fmtDayIso(data.mkbf.month.to))}
                      value={
                        data.mkbf.month.mkbf === null
                          ? '—'
                          : `${formatNumber(data.mkbf.month.mkbf)} km`
                      }
                      tone="brand"
                      spark={data.mkbf.series.map((p) => p.mkbf)}
                      sparkColor="var(--chart-1)"
                      delta={monthPct}
                      deltaSuffix="%"
                      deltaLabel={t.dash.vsPrevMonth.replace('{m}', monthLabel(data.mkbf.previousMonth.month))}
                      note={
                        data.mkbf.month.mkbf === null
                          ? t.dash.noReturns
                          : `${formatNumber(data.mkbf.month.kmTraveled)} km ÷ ${formatNumber(data.mkbf.month.unscheduledReturns)} ${t.dash.breakdowns}`
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
            { key: 'recent', render: (grip) => <RecentNow grip={grip} /> },
            { key: 'fleet', render: (grip) => <FleetNow vehicles={data.vehicles} grip={grip} /> },
          ]}
        />
        )}
      </section>

      {/* ---- Seção 2 — Indicadores por período: cada cartão com o seu. ---- */}
      <IndicatorsSection vehicles={data?.vehicles ?? []} />

      {data && (
        <p className="tp-muted dash-updated">
          {t.dash.updated} {formatDateTime(data.generatedAt)}
        </p>
      )}
    </div>
  );
}

/** Até quando a remessa do ERP-JB chegou: o dia de referência dos números "do dia" desta seção. */
function DataThrough({ data }: { data: DashboardData }) {
  const { t } = useI18n();
  const day = data.dataThrough.km ?? data.dataThrough.failures;
  if (!day) return null;
  const behind = day < todayIso();
  return (
    <span className={`dash-through${behind ? ' is-behind' : ''}`} title={t.dash.sections.dataThroughHint}>
      <Database size={12} aria-hidden /> {t.dash.sections.dataThrough.replace('{d}', fmtDayIso(day))}
    </span>
  );
}

/**
 * Últimos eventos, na seção "Agora": as seis fichas mais recentes de hoje — ou
 * do dia mais recente com evento, quando hoje ainda não tem nenhum (a API
 * recua e a tela diz qual dia está mostrando).
 */
function RecentNow({ grip }: { grip?: ReactNode }) {
  const { t } = useI18n();
  const today = todayIso();
  const query = useQuery({
    queryKey: ['dashboard', 'recent-events', today, today],
    queryFn: () => api.get<DashboardRecentEvents>(`/dashboard/recent-events?from=${today}&to=${today}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const d = query.data;
  const rows = d?.events ?? [];
  return (
    <CollapsibleCard
      id="dash.recent"
      grip={grip}
      className="tp-card dash-glass dash-recent"
      headClassName="tp-card__head dash-recent__head"
      label={t.dash.recentEvents}
      head={
        <>
          <div>
            <h3>
              {t.dash.recentEvents} <LiveBadge />
            </h3>
            <span className="chart__hint">
              {d?.fellBack ? t.dash.recentFellBack.replace('{d}', rangeLabel(d.used.from, d.used.to)) : t.dash.recentHint}
            </span>
          </div>
          <Link to="/eventos" className="tp-btn tp-btn--ghost tp-btn--sm">
            {t.dash.seeAll}
          </Link>
        </>
      }
    >
      {d ? (
        <RefreshVeil active={query.isPlaceholderData} delay={0}>
          {rows.length === 0 ? (
            <p className="tp-muted dash-recent__empty">{t.dash.noEvents}</p>
          ) : (
            <ul className="recent-now">
              {rows.map((e) => (
                <li key={e.id} className="recent-now__item">
                  <span className="recent-now__top">
                    <Link to={`/frota/${e.vehicleId}`} className="recent-now__car">{e.vehicleCode}</Link>
                    <span className={`tp-badge tp-badge--status ${badgeFor(e.status)}`}>{EVENT_STATUS_LABELS[e.status]}</span>
                  </span>
                  <span className="recent-now__desc" title={e.catalog?.description ?? e.reportedDescription ?? e.code}>
                    {e.catalog?.description ?? e.reportedDescription ?? e.code}
                  </span>
                  <span className="recent-now__when tp-muted">
                    {e.lineCode ? `${t.dash.line} ${e.lineCode} · ` : ''}
                    {formatDateTime(e.reportedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </RefreshVeil>
      ) : (
        <div className="recent-now" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="recent-now__item">
              <i className="skel skel--bar" style={{ width: '45%', height: 12 }} />
              <i className="skel skel--bar" style={{ width: '90%', height: 10 }} />
            </div>
          ))}
        </div>
      )}
    </CollapsibleCard>
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
  const cur = data.mkbf.month;
  const prev = data.mkbf.previousMonth;
  const monthLabel = (m: string) => monthName(Number(m.slice(5, 7)) - 1);
  const pct = prev.mkbf && cur.mkbf ? ((cur.mkbf - prev.mkbf) / prev.mkbf) * 100 : null;
  const pctText =
    pct === null ? '' : `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1).replace('.', ',')}%`;
  const top = b.topSystems[0];
  return (
    <>
      <KpiAi>
        {cur.mkbf === null
          ? t.dash.back.aiNoReturns
          : t.dash.back.aiMkbfMonth
              .replace('{v}', formatNumber(cur.mkbf))
              .replace('{m}', monthLabel(cur.month))
              .replace('{d}', fmtDayIso(cur.to)) +
            (pctText ? t.dash.back.aiVsMonth.replace('{p}', pctText).replace('{pm}', monthLabel(prev.month)) : '') +
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
          label={t.dash.back.previousMonth.replace('{m}', monthLabel(prev.month))}
          value={prev.mkbf === null ? '—' : `${formatNumber(prev.mkbf)} km${pctText ? ` · ${pctText}` : ''}`}
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
          {/* Item 3: a ilustração encolhe para a identificação caber na frente do cartão. */}
          <div className="bus-card__id">
            <span className="bus-card__pic">
              <BusRender
                vehicleClass={vehicle.vehicleClass}
                technology={vehicle.technology}
                status={vehicle.status}
                code={vehicle.code}
                width={120}
              />
            </span>
            <span className="bus-card__ident">
              <span className="bus-card__row">
                <b>{vehicle.code}</b>
                <span className="tp-muted">{vehicle.plate}</span>
              </span>
            </span>
          </div>
          <div className="bus-card__text">
            <span className="bus-card__model" title={vehicle.model ?? undefined}>
              {vehicle.model ?? 'modelo não informado'}
              {vehicle.modelYear ? ` · ${vehicle.modelYear}` : ''}
            </span>
            <span className="bus-card__tech">
              {VEHICLE_TECHNOLOGY_LABELS[vehicle.technology]}
              {vehicle.vehicleClass ? ` · ${VEHICLE_CLASS_LABELS[vehicle.vehicleClass]}` : ''}
              {vehicle.lot ? ` · lote ${vehicle.lot}` : ''}
            </span>
            <span className="bus-card__line">{vehicle.line ? `Linha ${vehicle.line}` : 'sem linha recente'}</span>
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
