import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronRight, Gauge, Hourglass, Inbox, Minus, PackageX, ShieldAlert } from 'lucide-react';
import {
  DASHBOARD_PERIODS,
  DEFAULT_DASHBOARD_PERIOD,
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
import { BusRender } from '@/components/bus/bus-render';
import { InfoTip } from '@/components/ui/info-tip';
import { BrandLoader } from '@/components/brand/brand-loader';
import { FleetLegend } from '@/components/fleet/fleet-legend';
import { familyOf, type Family } from '@/components/fleet/fleet-legend.utils';
import { BackFoot, BackHead, FlipButton, MaintenanceBack } from '@/components/fleet/fleet-card';
import { useFlip } from '@/components/fleet/use-flip';
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

/** Etapas do fluxo da garagem, na ordem em que um carro as atravessa. */
const STAGES: { key: StageKey; statuses: VehicleStatus[]; family: Family; to: string }[] = [
  { key: 'triage', statuses: ['AWAITING_TRIAGE'], family: 'waiting', to: '/triagem' },
  { key: 'field', statuses: ['FIELD_SERVICE'], family: 'waiting', to: '/socorro' },
  { key: 'queue', statuses: ['AWAITING_MAINTENANCE'], family: 'waiting', to: '/fila' },
  { key: 'shop', statuses: ['IN_MAINTENANCE'], family: 'working', to: '/os?status=IN_PROGRESS' },
  { key: 'part', statuses: ['AWAITING_PART'], family: 'stopped', to: '/estoque' },
  { key: 'release', statuses: ['IN_INSPECTION', 'IN_CLEANING'], family: 'working', to: '/os?status=RELEASING' },
];

export function DashboardPage() {
  const { t } = useI18n();
  const [days] = useDashboardPeriod();
  const periodLabel = t.dash.periodDays.replace('{n}', String(days));

  usePageHeader({
    eyebrow: t.dash.eyebrow,
    title: t.dash.title,
    description: t.dash.subtitle.replace('{n}', String(days)),
    actions: <PeriodControl />,
  });

  const { data, isPending, isError } = useQuery({
    queryKey: ['dashboard', days],
    queryFn: () => api.get<DashboardData>(`/dashboard?days=${days}`),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  if (isPending) return <DashboardSkeleton />;
  if (isError || !data) return <div className="tp-alert tp-alert--danger">{t.dash.error}</div>;

  const availabilityPct = Math.round(data.fleet.availabilityRate * 1000) / 10;
  const availabilityTone: Tone =
    availabilityPct >= AVAILABILITY_TARGET ? 'good' : availabilityPct >= AVAILABILITY_TARGET - 10 ? 'warn' : 'danger';

  // Rótulo no plural certo: o dicionário traz "singular|plural".
  const plural = (n: number, text: string) => {
    const [one, many] = text.split('|');
    return n === 1 ? one : (many ?? one);
  };
  const alerts = [
    { n: data.alerts.safetyEventsOpen, text: t.dash.safetyOpen, to: '/eventos', tone: 'danger' as const, icon: <ShieldAlert size={18} /> },
    { n: data.materials.overdueParts, text: t.dash.overdueParts, to: '/estoque', tone: 'danger' as const, icon: <PackageX size={18} /> },
    { n: data.workOrders.overdue, text: t.dash.overdueWo, to: '/os', tone: 'danger' as const, icon: <Hourglass size={18} /> },
    { n: data.alerts.pendingTriage, text: t.dash.pendingTriage, to: '/triagem', tone: 'warning' as const, icon: <Inbox size={18} /> },
    { n: data.alerts.degradedKm, text: t.dash.degradedKm, to: '/km', tone: 'warning' as const, icon: <Gauge size={18} /> },
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
            <div>
              <h3>{t.dash.flowTitle}</h3>
              <span className="chart__hint">{t.dash.flowHint}</span>
            </div>
            <ul className="dash-flow-legend" aria-label={t.dash.legendLabel}>
              <li className="dash-flow-legend__item dash-flow-legend__item--waiting">{t.dash.flowLegend.waiting}</li>
              <li className="dash-flow-legend__item dash-flow-legend__item--working">{t.dash.flowLegend.working}</li>
              <li className="dash-flow-legend__item dash-flow-legend__item--stopped">{t.dash.flowLegend.stopped}</li>
              <li className="dash-flow-legend__item dash-flow-legend__item--empty">{t.dash.flowLegend.empty}</li>
            </ul>
          </div>
          <GarageFlow byStatus={data.fleet.byStatus} />
          <StatusSummary byStatus={data.fleet.byStatus} total={data.fleet.total} />
        </div>

        <div className="dash-hero__kpis">
          <Kpi
            label={t.dash.mkbf}
            hint={`${t.dash.mkbfHint} · ${periodLabel}`}
            value={data.mkbf.period.mkbf === null ? '—' : `${formatNumber(data.mkbf.period.mkbf)} km`}
            tone="brand"
            spark={data.mkbf.series.map((p) => p.mkbf)}
            sparkColor="var(--chart-1)"
            note={
              data.mkbf.period.mkbf === null
                ? t.dash.noReturns
                : `${formatNumber(data.mkbf.period.kmTraveled)} km ÷ ${formatNumber(data.mkbf.period.unscheduledReturns)} ${t.dash.breakdowns}`
            }
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
          <div className="dash-alerts__head">
            <span className="dash-hero__alerts-title">
              <i className="dash-hero__alerts-dot" aria-hidden />
              {t.dash.attention}
              {alerts.length > 0 && <b>{alerts.reduce((sum, a) => sum + a.n, 0)}</b>}
            </span>
            {alerts.length > 0 && <span className="dash-alerts__hint">{t.dash.attentionHint}</span>}
          </div>
          <ul className="dash-alerts">
            {alerts.length === 0 ? (
              <li className="dash-alert dash-alert--ok">
                <Link to="/frota" className="dash-alert__link">
                  <span className="dash-alert__icon"><CheckCircle2 size={18} /></span>
                  <span className="dash-alert__body">
                    <span className="dash-alert__label">{t.dash.allClear}</span>
                  </span>
                  <ChevronRight size={16} className="dash-alert__go" aria-hidden />
                </Link>
              </li>
            ) : (
              alerts.map((a) => (
                <li key={a.text} className={`dash-alert dash-alert--${a.tone}`}>
                  <Link to={a.to} className="dash-alert__link">
                    <span className="dash-alert__icon">{a.icon}</span>
                    <span className="dash-alert__body">
                      <b className="dash-alert__n">{a.n}</b>
                      <span className="dash-alert__label">{plural(a.n, a.text)}</span>
                    </span>
                    <ChevronRight size={16} className="dash-alert__go" aria-hidden />
                  </Link>
                </li>
              ))
            )}
          </ul>
        </footer>
      </section>

      {/* ---- A frota, carro a carro ---- */}
      <FleetNow vehicles={data.vehicles} />

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
            <span className="chart__hint">{t.dash.availByHourHint.replace('{n}', String(days))}</span>
          </div>
          <AvailabilityByHourChart data={data.availabilityByHour} days={days} />
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
            <h3>{data.eventsBucket === 'week' ? t.dash.eventsPerWeek : t.dash.eventsPerDay}</h3>
            <span className="chart__hint">{(data.eventsBucket === 'week' ? t.dash.eventsPerWeekHint : t.dash.eventsPerDayHint).replace('{n}', String(days))}</span>
          </div>
          <EventsPerDayChart data={data.eventsPerDay} bucket={data.eventsBucket} />
        </div>

        <div className="tp-card dash-glass">
          <div className="tp-card__head">
            <div className="chart__title">
              <h3>{t.dash.recentEvents}</h3>
              <span className="chart__hint">{periodLabel}</span>
            </div>
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
            <span className="tp-tip__foot">{t.dash.stageOpen} {s.label} ↗</span>
          </InfoTip>
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

/**
 * A frota carro a carro, com a legenda das quatro famílias de estado no
 * cabeçalho. A legenda é também o filtro: passar o mouse realça a família,
 * clicar deixa só ela na grade (clicar de novo, ou em "Todos", volta).
 */
function FleetNow({ vehicles }: { vehicles: DashboardVehicle[] }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Family | null>(null);
  const [hovered, setHovered] = useState<Family | null>(null);

  const visible = selected ? vehicles.filter((v) => familyOf(v.status) === selected) : vehicles;
  const focus = hovered ?? selected;

  // Numa frota de centenas de carros, 400 ônibus iguais rodando não dizem nada:
  // eles viram um cartão com a soma, e a grade mostra quem está na garagem.
  const big = vehicles.length > 60;
  const collapseRunning = big && selected !== 'running';
  const running = vehicles.filter((v) => familyOf(v.status) === 'running');
  const shown = collapseRunning ? visible.filter((v) => familyOf(v.status) !== 'running') : visible;
  const inLine = running.filter((v) => v.status === 'IN_LINE').length;

  return (
    <section className="tp-card dash-glass dash-fleet">
      <div className="tp-card__head dash-fleet__head">
        <div>
          <h3>{t.dash.fleetNow}</h3>
          <span className="chart__hint">{big ? t.dash.fleetNowHintBig : t.dash.fleetNowHint}</span>
        </div>
        <FleetLegend statuses={vehicles.map((v) => v.status)} selected={selected} onSelect={setSelected} onHover={setHovered} />
        <Link to="/frota" className="tp-btn tp-btn--ghost tp-btn--sm">
          {t.dash.seeAll}
        </Link>
      </div>
      <div className="bus-grid" data-focus={focus ?? undefined}>
        {collapseRunning && running.length > 0 && (
          <Link to="/frota?status=IN_LINE" className="bus-card bus-card--running bus-card--summary">
            <BusRender vehicleClass="PADRON_13M" status="IN_LINE" width={260} title="Carros rodando" />
            <div className="bus-card__text">
              <div className="bus-card__row">
                <b className="bus-card__big">{running.length}</b>
                <span className={`tp-state tp-state--running`}>{t.dash.runningSummary}</span>
              </div>
              <span className="tp-muted">{inLine} {t.dash.inLineShort} · {running.length - inLine} {t.dash.inYardShort}</span>
            </div>
          </Link>
        )}
        {shown.map((v) => (
          <BusCard key={v.id} vehicle={v} />
        ))}
      </div>
      {shown.length === 0 && !collapseRunning && <p className="tp-muted dash-fleet__empty">{t.dash.legendEmpty}</p>}
    </section>
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
        <div className={`bus-card bus-card--${family} flip__face`} aria-hidden={f.flipped} inert={f.flipped}>
          <Link to={`/frota/${vehicle.id}`} className="flip__link" aria-label={`Abrir o carro ${vehicle.code}`} />
          <FlipButton code={vehicle.code} flip={f} corner />
          <BusRender vehicleClass={vehicle.vehicleClass} technology={vehicle.technology} status={vehicle.status} code={vehicle.code} width={260} />
          <div className="bus-card__text">
            <div className="bus-card__row">
              <b>{vehicle.code}</b>
              <span className="tp-muted">{vehicle.plate}</span>
            </div>
            <span className={`tp-state tp-state--${family}`}>{VEHICLE_STATUS_LABELS[vehicle.status]}</span>
            <span className="bus-card__reason" title={vehicle.reason ?? undefined}>{vehicle.reason ? `${reasonPhase(vehicle.status)}${vehicle.reason}` : ' '}</span>
            <span className="bus-card__since tp-muted">{vehicle.hoursInState !== null ? `há ${vehicle.hoursInState.toLocaleString('pt-BR')}h` : ' '}</span>
          </div>
        </div>
        <div className={`bus-card bus-card--${family} bus-card--back flip__face flip__face--back`} aria-hidden={!f.flipped} inert={!f.flipped}>
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

function DashboardSkeleton() {
  const { t } = useI18n();
  return (
    <div className="dash">
      <section className="dash-hero dash-glass skeleton" style={{ minHeight: 280, display: 'grid', placeItems: 'center' }}>
        <BrandLoader size={64} label={t.dash.loading.replace(/…$/, '')} />
      </section>
      <section className="tp-card skeleton" style={{ minHeight: 260 }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Período do histórico: na URL (?dias=90) para ser compartilhável, e lembrado
// no navegador para a pessoa não escolher de novo a cada visita.

const PERIOD_KEY = 'tp.dash.days';

function isPeriod(n: number): n is (typeof DASHBOARD_PERIODS)[number] {
  return (DASHBOARD_PERIODS as readonly number[]).includes(n);
}

function readPeriod(raw: string | null): number {
  const fromUrl = Number(raw);
  if (raw && isPeriod(fromUrl)) return fromUrl;
  try {
    const saved = Number(localStorage.getItem(PERIOD_KEY));
    if (isPeriod(saved)) return saved;
  } catch {
    /* sem storage */
  }
  return DEFAULT_DASHBOARD_PERIOD;
}

function useDashboardPeriod(): [number, (days: number) => void] {
  const [params, setParams] = useSearchParams();
  const days = readPeriod(params.get('dias'));
  const set = (d: number) => {
    try {
      localStorage.setItem(PERIOD_KEY, String(d));
    } catch {
      /* sem storage */
    }
    const next = new URLSearchParams(params);
    next.set('dias', String(d));
    setParams(next, { replace: true });
  };
  return [days, set];
}

function PeriodControl() {
  const { t } = useI18n();
  const [days, setDays] = useDashboardPeriod();
  return (
    <div className="tp-segmented" role="radiogroup" aria-label={t.dash.period}>
      {DASHBOARD_PERIODS.map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={d === days}
          className={`tp-segmented__item${d === days ? ' is-active' : ''}`}
          onClick={() => setDays(d)}
        >
          {t.dash.periodDays.replace('{n}', String(d))}
        </button>
      ))}
    </div>
  );
}
