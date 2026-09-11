import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Minus } from 'lucide-react';
import {
  EVENT_STATUS_LABELS,
  VEHICLE_STATUS_LABELS,
  type VehicleStatus,
  type DashboardData,
  type DashboardVehicle,
} from '@app/shared';
import { VEHICLE_STATE_FAMILY } from '@app/design-kit';
import { api } from '@/lib/api-client';
import { formatDateTime, formatMinutes, formatNumber } from '@/lib/format';
import { useI18n } from '@/i18n/i18n.context';
import { usePageHeader } from '@/components/shell/page-header.context';
import { BusIllustration } from '@/components/bus/bus-illustration';
import {
  AvailabilityByHourChart,
  DowntimeDonut,
  EventsPerDayChart,
  MkbfTrendChart,
  RingGauge,
  Sparkline,
} from '@/components/charts/charts';

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
type Family = 'running' | 'waiting' | 'working' | 'stopped';

/** Etapas do fluxo da garagem, na ordem em que um carro as atravessa. */
const STAGES: { key: StageKey; statuses: VehicleStatus[]; family: Family; to: string }[] = [
  { key: 'triage', statuses: ['AWAITING_TRIAGE'], family: 'waiting', to: '/triagem' },
  { key: 'field', statuses: ['FIELD_SERVICE'], family: 'waiting', to: '/socorro' },
  { key: 'queue', statuses: ['AWAITING_MAINTENANCE'], family: 'waiting', to: '/fila' },
  { key: 'shop', statuses: ['IN_MAINTENANCE'], family: 'working', to: '/os' },
  { key: 'part', statuses: ['AWAITING_PART'], family: 'stopped', to: '/estoque' },
  { key: 'release', statuses: ['IN_INSPECTION', 'IN_CLEANING'], family: 'working', to: '/os' },
];

export function DashboardPage() {
  const { t } = useI18n();

  usePageHeader({
    eyebrow: t.dash.eyebrow,
    title: t.dash.title,
    description: t.dash.subtitle,
  });

  const { data, isPending, isError } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/dashboard'),
    refetchInterval: 60_000,
  });

  if (isPending) return <DashboardSkeleton />;
  if (isError || !data) return <div className="tp-alert tp-alert--danger">{t.dash.error}</div>;

  const availabilityPct = Math.round(data.fleet.availabilityRate * 1000) / 10;
  const availabilityTone: Tone =
    availabilityPct >= AVAILABILITY_TARGET ? 'good' : availabilityPct >= AVAILABILITY_TARGET - 10 ? 'warn' : 'danger';

  const alerts = [
    { n: data.alerts.safetyEventsOpen, text: t.dash.safetyOpen, to: '/eventos', tone: 'danger' as const },
    { n: data.materials.overdueParts, text: t.dash.overdueParts, to: '/estoque', tone: 'danger' as const },
    { n: data.workOrders.overdue, text: t.dash.overdueWo, to: '/os', tone: 'danger' as const },
    { n: data.alerts.pendingTriage, text: t.dash.pendingTriage, to: '/triagem', tone: 'warning' as const },
    { n: data.alerts.degradedKm, text: t.dash.degradedKm, to: '/km', tone: 'warning' as const },
  ].filter((a) => a.n > 0);

  return (
    <div className="dash">
      {/* ---- Centro de comando: anel, fluxo e os três números ---- */}
      <section className="dash-hero dash-glass" aria-label={t.dash.title}>
        <div className="dash-gauge">
          <div className="dash-gauge__ring">
            <RingGauge value={availabilityPct} target={AVAILABILITY_TARGET} tone={availabilityTone} label={t.dash.availability} />
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
              <b>{data.fleet.available}</b> {t.dash.of} <b>{data.fleet.total}</b> {t.dash.readyBuses}
            </span>
            <span className="dash-gauge__meta">
              <Delta value={data.fleet.availabilityDelta} suffix=" pp" label={t.dash.vs7d} />
              <span className="dash-gauge__target">
                {t.dash.target} {AVAILABILITY_TARGET}%
              </span>
            </span>
          </div>
        </div>

        <div className="dash-flow-wrap">
          <div className="dash-flow-wrap__head">
            <h3>{t.dash.flowTitle}</h3>
            <span className="chart__hint">{t.dash.flowHint}</span>
          </div>
          <GarageFlow byStatus={data.fleet.byStatus} />
          <StatusSummary byStatus={data.fleet.byStatus} total={data.fleet.total} />
        </div>

        <div className="dash-hero__kpis">
          <Kpi
            label={t.dash.mkbf}
            hint={t.dash.mkbfHint}
            value={data.mkbf.current === null ? '—' : `${formatNumber(data.mkbf.current)} km`}
            tone="brand"
            spark={data.mkbf.series.map((p) => p.mkbf)}
            sparkColor="var(--chart-1)"
            note={data.mkbf.current === null ? t.dash.noReturns : undefined}
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
          />
          <Kpi
            label={t.dash.openWo}
            hint={t.dash.openWoHint}
            value={String(data.workOrders.open)}
            tone={data.workOrders.overdue > 0 ? 'danger' : 'neutral'}
            note={
              data.workOrders.overdue > 0
                ? `${data.workOrders.overdue} ${t.dash.overdue}`
                : data.workOrders.averageDowntimeMinutes !== null
                  ? `${t.dash.avg} ${formatMinutes(data.workOrders.averageDowntimeMinutes)} ${t.dash.perWo}`
                  : undefined
            }
          />
        </div>

        {/* ---- Faixa de alerta: o que precisa de atenção, dentro do instrumento ---- */}
        <footer
          className={`dash-hero__alerts${alerts.some((a) => a.tone === 'danger') ? ' has-critical' : alerts.length ? ' has-warning' : ' is-clear'}`}
          aria-label={t.dash.attention}
        >
          <span className="dash-hero__alerts-title">
            <i className="dash-hero__alerts-dot" aria-hidden />
            {t.dash.attention}
            {alerts.length > 0 && <b>{alerts.reduce((sum, a) => sum + a.n, 0)}</b>}
          </span>
          <ul className="attention-list attention-list--row">
            {alerts.length === 0 ? (
              <li className="attention-item attention-item--ok">
                <CheckCircle2 size={14} />
                <Link to="/frota">{t.dash.allClear}</Link>
              </li>
            ) : (
              alerts.map((a) => (
                <li key={a.text} className={`attention-item attention-item--${a.tone}`}>
                  <AlertTriangle size={14} />
                  <Link to={a.to}>
                    <b>{a.n}</b> {a.text}
                  </Link>
                </li>
              ))
            )}
          </ul>
        </footer>
      </section>

      {/* ---- A frota, carro a carro ---- */}
      <section className="tp-card dash-glass dash-fleet">
        <div className="tp-card__head">
          <div>
            <h3>{t.dash.fleetNow}</h3>
            <span className="chart__hint">{t.dash.fleetNowHint}</span>
          </div>
          <Link to="/frota" className="tp-btn tp-btn--ghost tp-btn--sm">
            {t.dash.seeAll}
          </Link>
        </div>
        <div className="bus-grid">
          {data.vehicles.map((v) => (
            <BusCard key={v.id} vehicle={v} />
          ))}
        </div>
      </section>

      {/* ---- Tendências ---- */}
      <section className="dash-row dash-row--charts">
        <div className="tp-card dash-glass">
          <div className="chart__title">
            <h3>{t.dash.mkbfTrend}</h3>
            <span className="chart__hint">{t.dash.mkbfTrendHint}</span>
          </div>
          <MkbfTrendChart data={data.mkbf.series} />
        </div>

        <div className="tp-card dash-glass">
          <div className="chart__title">
            <h3>{t.dash.availByHour}</h3>
            <span className="chart__hint">{t.dash.availByHourHint}</span>
          </div>
          <AvailabilityByHourChart data={data.availabilityByHour} />
        </div>
      </section>

      <section className="dash-row dash-row--bottom">
        <div className="tp-card dash-glass">
          <div className="chart__title">
            <h3>{t.dash.downtime}</h3>
            <span className="chart__hint">{t.dash.downtimeHint}</span>
          </div>
          <DowntimeDonut data={data.downtimeByCause} totalMinutes={data.totalDowntimeMinutes} />
        </div>

        <div className="tp-card dash-glass">
          <div className="chart__title">
            <h3>{t.dash.eventsPerDay}</h3>
            <span className="chart__hint">{t.dash.eventsPerDayHint}</span>
          </div>
          <EventsPerDayChart data={data.eventsPerDay} />
        </div>

        <div className="tp-card dash-glass">
          <div className="tp-card__head">
            <h3>{t.dash.recentEvents}</h3>
            <Link to="/eventos" className="tp-btn tp-btn--ghost tp-btn--sm">
              {t.dash.seeAll}
            </Link>
          </div>
          <ul className="recent-list">
            {data.recentEvents.map((e) => (
              <li key={e.id}>
                <div className="recent-list__main">
                  <b>{e.vehicleCode}</b>
                  <span>{e.catalog?.description ?? e.reportedDescription ?? e.code}</span>
                </div>
                <div className="recent-list__meta">
                  <span className={`tp-badge tp-badge--status ${badgeFor(e.status)}`}>{EVENT_STATUS_LABELS[e.status]}</span>
                  <span className="tp-muted">{formatDateTime(e.reportedAt)}</span>
                </div>
              </li>
            ))}
            {data.recentEvents.length === 0 && <li className="tp-muted">{t.dash.noEvents}</li>}
          </ul>
        </div>
      </section>

      <p className="tp-muted dash-updated">
        {t.dash.updated} {formatDateTime(data.generatedAt)}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

type Tone = 'good' | 'warn' | 'danger' | 'brand' | 'neutral';

function Delta({ value, suffix = '', label }: { value: number | null | undefined; suffix?: string; label?: string }) {
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
}) {
  return (
    <div className={`dash-kpi dash-kpi--${tone}`}>
      <div className="dash-kpi__head">
        <span className="tp-kpi__label">{label}</span>
        {hint && <span className="dash-kpi__hint">{hint}</span>}
      </div>
      <div className="dash-kpi__body">
        <strong className="dash-kpi__value">{value}</strong>
        {spark && <Sparkline values={spark} color={sparkColor} />}
      </div>
      <Delta value={delta} suffix={deltaSuffix} label={deltaLabel} />
      {note && <span className="tp-kpi__note">{note}</span>}
    </div>
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
        <li key={s.key} className={`dash-flow__stage dash-flow__stage--${s.family}${s.n > 0 ? ' is-active' : ''}`}>
          {i > 0 && <i className="dash-flow__rail" aria-hidden />}
          <Link to={s.to} className="dash-flow__node" aria-label={`${s.label}: ${s.n}`}>
            <b>{s.n}</b>
          </Link>
          <span className="dash-flow__label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

function StatusSummary({ byStatus, total }: { byStatus: Record<VehicleStatus, number>; total: number }) {
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

function BusCard({ vehicle }: { vehicle: DashboardVehicle }) {
  const family = VEHICLE_STATE_FAMILY[vehicle.status] ?? 'waiting';
  return (
    <Link to={`/frota?search=${vehicle.code}`} className={`bus-card bus-card--${family}`}>
      <BusIllustration status={vehicle.status} code={vehicle.code} width={200} />
      <div className="bus-card__text">
        <div className="bus-card__row">
          <b>{vehicle.code}</b>
          <span className="tp-muted">{vehicle.plate}</span>
        </div>
        <span className={`tp-state tp-state--${family}`}>{VEHICLE_STATUS_LABELS[vehicle.status]}</span>
        {vehicle.reason && <span className="bus-card__reason">{vehicle.reason}</span>}
        {vehicle.hoursInState !== null && (
          <span className="tp-muted">há {vehicle.hoursInState.toLocaleString('pt-BR')}h</span>
        )}
      </div>
    </Link>
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

function DashboardSkeleton() {
  const { t } = useI18n();
  return (
    <div className="dash">
      <section className="dash-hero dash-glass skeleton" style={{ minHeight: 280 }} />
      <section className="tp-card skeleton" style={{ minHeight: 260 }} />
      <p className="tp-muted">{t.dash.loading}</p>
    </div>
  );
}
