import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
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
  Sparkline,
} from '@/components/charts/charts';

/**
 * Dashboard — a tela que abre depois do login.
 *
 * Ordem de leitura: quatro números que resumem a garagem, depois o que precisa
 * de atenção, depois a frota carro a carro, depois as tendências. O gestor
 * decide nos primeiros três segundos; os gráficos explicam o porquê.
 */
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
  const alerts = [
    { n: data.alerts.safetyEventsOpen, text: t.dash.safetyOpen, to: '/eventos', tone: 'danger' as const },
    { n: data.materials.overdueParts, text: t.dash.overdueParts, to: '/estoque', tone: 'danger' as const },
    { n: data.alerts.pendingTriage, text: t.dash.pendingTriage, to: '/triagem', tone: 'warning' as const },
    { n: data.alerts.degradedKm, text: t.dash.degradedKm, to: '/km', tone: 'warning' as const },
  ].filter((a) => a.n > 0);

  return (
    <>
      {/* ---- Os quatro números ---- */}
      <section className="dash-kpis">
        <Kpi
          label={t.dash.availability}
          hint={t.dash.availabilityHint}
          value={`${availabilityPct.toLocaleString('pt-BR')}%`}
          tone={availabilityPct >= 85 ? 'good' : availabilityPct >= 75 ? 'warn' : 'danger'}
          delta={data.fleet.availabilityDelta}
          deltaSuffix=" pp"
          deltaLabel={t.dash.vs7d}
          spark={data.availabilityByHour.map((h) => h.rate * 100)}
          sparkColor="var(--chart-4)"
        />
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
              ? `+ ${data.queue.inService} em atendimento · mais antigo há ${data.queue.oldestWaitingHours}${t.dash.hours}`
              : `+ ${data.queue.inService} em atendimento`
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
                ? `média ${formatMinutes(data.workOrders.averageDowntimeMinutes)} por OS`
                : undefined
          }
        />
      </section>

      {/* ---- Atenção + frota ---- */}
      <section className="dash-row dash-row--fleet">
        <div className="tp-card dash-attention">
          <div className="tp-card__head">
            <h3>{t.dash.attention}</h3>
          </div>
          {alerts.length === 0 ? (
            <p className="tp-muted">{t.dash.allClear}</p>
          ) : (
            <ul className="attention-list">
              {alerts.map((a) => (
                <li key={a.text} className={`attention-item attention-item--${a.tone}`}>
                  <AlertTriangle size={16} />
                  <Link to={a.to}>
                    <b>{a.n}</b> {a.text}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className="tp-card__head" style={{ marginTop: 'var(--tp-space-2)' }}>
            <h3>{t.dash.fleetNow}</h3>
          </div>
          <StatusSummary byStatus={data.fleet.byStatus} total={data.fleet.total} />
        </div>

        <div className="tp-card dash-fleet">
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
        </div>
      </section>

      {/* ---- Tendências ---- */}
      <section className="dash-row dash-row--charts">
        <div className="tp-card">
          <div className="chart__title">
            <h3>{t.dash.mkbfTrend}</h3>
            <span className="chart__hint">{t.dash.mkbfTrendHint}</span>
          </div>
          <MkbfTrendChart data={data.mkbf.series} />
        </div>

        <div className="tp-card">
          <div className="chart__title">
            <h3>{t.dash.availByHour}</h3>
            <span className="chart__hint">{t.dash.availByHourHint}</span>
          </div>
          <AvailabilityByHourChart data={data.availabilityByHour} />
        </div>
      </section>

      <section className="dash-row dash-row--bottom">
        <div className="tp-card">
          <div className="chart__title">
            <h3>{t.dash.downtime}</h3>
            <span className="chart__hint">{t.dash.downtimeHint}</span>
          </div>
          <DowntimeDonut data={data.downtimeByCause} totalMinutes={data.totalDowntimeMinutes} />
        </div>

        <div className="tp-card">
          <div className="chart__title">
            <h3>{t.dash.eventsPerDay}</h3>
            <span className="chart__hint">{t.dash.eventsPerDayHint}</span>
          </div>
          <EventsPerDayChart data={data.eventsPerDay} />
        </div>

        <div className="tp-card">
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
                  <span className={`tp-badge ${badgeFor(e.status)}`}>{EVENT_STATUS_LABELS[e.status]}</span>
                  <span className="tp-muted">{formatDateTime(e.reportedAt)}</span>
                </div>
              </li>
            ))}
            {data.recentEvents.length === 0 && <li className="tp-muted">Nenhum evento registrado.</li>}
          </ul>
        </div>
      </section>

      <p className="tp-muted dash-updated">
        {t.dash.updated} {formatDateTime(data.generatedAt)}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------

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
  tone: 'good' | 'warn' | 'danger' | 'brand' | 'neutral';
  delta?: number | null;
  deltaSuffix?: string;
  deltaLabel?: string;
  note?: string;
  spark?: (number | null)[];
  sparkColor?: string;
}) {
  const DeltaIcon = delta === null || delta === undefined || delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  const deltaTone = delta === null || delta === undefined || delta === 0 ? 'neutral' : delta > 0 ? 'good' : 'danger';

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
      {delta !== undefined && delta !== null && (
        <span className={`dash-kpi__delta dash-kpi__delta--${deltaTone}`}>
          <DeltaIcon size={14} />
          {delta > 0 ? '+' : ''}
          {delta.toLocaleString('pt-BR')}
          {deltaSuffix}
          {deltaLabel && <em> {deltaLabel}</em>}
        </span>
      )}
      {note && <span className="tp-kpi__note">{note}</span>}
    </div>
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
    <>
      <section className="dash-kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="dash-kpi skeleton" style={{ minHeight: 118 }} />
        ))}
      </section>
      <section className="dash-row dash-row--fleet">
        <div className="tp-card skeleton" style={{ minHeight: 260 }} />
        <div className="tp-card skeleton" style={{ minHeight: 260 }} />
      </section>
      <p className="tp-muted">{t.dash.loading}</p>
    </>
  );
}
