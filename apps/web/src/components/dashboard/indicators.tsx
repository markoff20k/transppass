import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Minus, Plus, X } from 'lucide-react';
import {
  WIDGET_KINDS,
  WIDGET_LARGE_KINDS,
  type DashboardDowntime,
  type DashboardVehicle,
  type DashboardWidget,
  type DashboardWidgetPref,
  type DowntimeCause,
  type WidgetKind,
  type WidgetPeriod,
} from '@app/shared';
import { api } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';
import { rangeLabel } from '@/lib/period';
import { useI18n } from '@/i18n/i18n.context';
import { useUiState } from '@/features/auth/use-ui-pref';
import { toast } from '@/lib/toast';
import { InfoTip } from '@/components/ui/info-tip';
import { RefreshVeil } from '@/components/ui/refresh-veil';
import { DowntimeDonut, EventsPerDayChart, WidgetSeriesChart } from '@/components/charts/charts';
import { AVAILABILITY_TARGET, AvailabilityBody, ChartLoading, MKBF_TARGET, MkbfBody, NoSeries } from './chart-cards';
import { TopFailuresBody } from './top-failures';
import { DowntimeCarsDrawer, formatHours } from './downtime-cars';
import { WidgetPeriodPicker, WidgetScopePicker, fmtDay, formatValue, resolveWidgetPeriod } from './widgets';

/** O painel de quem ainda não montou o seu: os dois grandes e os cinco que o cliente mais olha. */
const DEFAULT_INDICATORS: DashboardWidgetPref[] = [
  { id: 'w-mkbf', kind: 'mkbf', period: { preset: 'thisMonth' } },
  { id: 'w-availability', kind: 'availability', period: { preset: 'today' } },
  { id: 'w-breakdowns', kind: 'breakdowns', period: { preset: 'last30' } },
  { id: 'w-lostTrips', kind: 'lostTrips', period: { preset: 'thisMonth' } },
  { id: 'w-downtime', kind: 'downtime', period: { preset: 'last30' } },
  { id: 'w-rescues', kind: 'rescues', period: { preset: 'thisMonth' } },
  { id: 'w-topFailures', kind: 'topFailures', period: { preset: 'last30' } },
];

const isLarge = (kind: WidgetKind) => WIDGET_LARGE_KINDS.includes(kind);

/**
 * Seção 2 do Dashboard — Indicadores por período.
 *
 * Tudo é widget e todo widget tem gráfico: número, variação contra o período
 * igual logo antes, meta quando há, e a série do período no mesmo cartão.
 * MKBF e Disponibilidade são os cartões grandes, sempre na primeira linha,
 * dois por linha; os demais vêm abaixo, três por linha — nunca se misturam
 * tamanhos numa mesma linha. Período e escopo por cartão, "aplicar a todos"
 * como atalho, e a lista fica salva na conta.
 */
export function IndicatorsSection({ vehicles }: { vehicles: DashboardVehicle[] }) {
  const { t } = useI18n();
  // Quem já tinha montado o painel antigo começa dele, mais o ranking de falhas que era um cartão à parte.
  const [legacy] = useUiState<DashboardWidgetPref[] | null>('dash.widgets', null);
  const seed = useMemo(() => {
    if (!legacy || legacy.length === 0) return DEFAULT_INDICATORS;
    const missing = DEFAULT_INDICATORS.filter((d) => d.kind === 'topFailures' && !legacy.some((w) => w.kind === d.kind));
    return [...legacy, ...missing];
  }, [legacy]);
  const [widgets, setWidgets] = useUiState<DashboardWidgetPref[]>('dash.indicators', seed);
  const update = (id: string, patch: Partial<DashboardWidgetPref>) =>
    setWidgets((list) => list.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const remove = (id: string) => setWidgets((list) => list.filter((w) => w.id !== id));
  const add = (kind: WidgetKind) =>
    setWidgets((list) => [...list, { id: `${kind}-${Date.now().toString(36)}`, kind, period: { preset: isLarge(kind) ? 'thisMonth' : 'last30' } }]);
  const applyAll = (period: WidgetPeriod) => {
    setWidgets((list) => list.map((w) => ({ ...w, period })));
    toast.success(t.dash.widgets.appliedAll);
  };

  const large = widgets.filter((w) => isLarge(w.kind));
  const regular = widgets.filter((w) => !isLarge(w.kind));
  const [allPeriod, setAllPeriod] = useState<WidgetPeriod>({ preset: 'last30' });

  return (
    <section className="dash-section dash-section--indicators" aria-labelledby="dash-indicators">
      <header className="dash-section__head">
        <div>
          <h2 id="dash-indicators">{t.dash.sections.indicators}</h2>
          <span className="dash-section__hint">{t.dash.sections.indicatorsHint}</span>
        </div>
        <div className="dash-section__tools">
          {widgets.length > 1 && (
            <WidgetPeriodPicker
              value={allPeriod}
              label={t.dash.widgets.applyAll}
              title={t.dash.widgets.applyAllHint}
              className="ind-apply"
              onChange={(p) => {
                setAllPeriod(p);
                applyAll(p);
              }}
            />
          )}
          <AddWidget onAdd={add} />
        </div>
      </header>

      {widgets.length === 0 && <p className="dash-widgets__empty">{t.dash.widgets.empty}</p>}
      {large.length > 0 && (
        <div className="ind-grid ind-grid--large" data-count={large.length}>
          {large.map((w, i) => (
            <IndicatorCard key={w.id} index={i} pref={w} vehicles={vehicles} large onPeriod={(period) => update(w.id, { period })} onVehicle={(vehicleId) => update(w.id, { vehicleId })} onRemove={() => remove(w.id)} />
          ))}
        </div>
      )}
      {regular.length > 0 && (
        <div className="ind-grid">
          {regular.map((w, i) => (
            <IndicatorCard key={w.id} index={i} pref={w} vehicles={vehicles} onPeriod={(period) => update(w.id, { period })} onVehicle={(vehicleId) => update(w.id, { vehicleId })} onRemove={() => remove(w.id)} />
          ))}
        </div>
      )}
    </section>
  );
}

/** "Adicionar indicador": uma lista com todos os indicadores; escolher já põe o cartão no fim do grupo dele. */
function AddWidget({ onAdd }: { onAdd: (kind: WidgetKind) => void }) {
  const { t } = useI18n();
  return (
    <label className="dash-widgets__add">
      <Plus size={14} aria-hidden />
      <span>{t.dash.widgets.add}</span>
      <select
        className="dash-widgets__add-select"
        aria-label={t.dash.widgets.add}
        value=""
        onChange={(e) => {
          if (e.target.value) onAdd(e.target.value as WidgetKind);
        }}
      >
        <option value="">{t.dash.widgets.add}</option>
        {WIDGET_KINDS.map((k) => (
          <option key={k} value={k}>
            {t.dash.widgets.kinds[k].label}
          </option>
        ))}
      </select>
    </label>
  );
}

function IndicatorCard({
  index,
  pref,
  vehicles,
  large = false,
  onPeriod,
  onVehicle,
  onRemove,
}: {
  index: number;
  pref: DashboardWidgetPref;
  vehicles: DashboardVehicle[];
  large?: boolean;
  onPeriod: (p: WidgetPeriod) => void;
  onVehicle: (id: string | null) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const meta = t.dash.widgets.kinds[pref.kind];
  const { from, to } = resolveWidgetPeriod(pref.period);
  const vehicleId = pref.vehicleId ?? null;
  const query = useQuery({
    queryKey: ['dashboard', 'widget', pref.kind, from, to, vehicleId],
    queryFn: () => api.get<DashboardWidget>(`/dashboard/widget?kind=${pref.kind}&from=${from}&to=${to}${vehicleId ? `&vehicleId=${vehicleId}` : ''}`),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  const w = query.data;
  // Período sem dado: a API recuou para o dia mais recente com dado; avisa uma vez por recuo.
  const toasted = useRef<string | null>(null);
  useEffect(() => {
    if (!w?.fellBack) return;
    const key = `${w.kind}:${w.to}>${w.used.to}`;
    if (toasted.current === key) return;
    toasted.current = key;
    toast.warning(t.dash.widgets.noDataFor.replace('{d}', fmtDay(w.to)).replace('{k}', meta.label), {
      description: t.dash.widgets.showing.replace('{d}', fmtDay(w.used.to)),
    });
  }, [w, t, meta.label]);

  const value = w ? formatValue(w.value, w.unit) : null;
  const delta = w && w.value !== null && w.previous !== null && w.previous !== 0 ? ((w.value - w.previous) / Math.abs(w.previous)) * 100 : null;
  const deltaTone = delta === null ? 'neutral' : Math.abs(delta) < 0.05 ? 'neutral' : delta > 0 === (w?.higherIsBetter ?? true) ? 'good' : 'danger';
  const target = pref.kind === 'mkbf' ? MKBF_TARGET : pref.kind === 'availability' ? AVAILABILITY_TARGET : null;
  const targetTone = target !== null && w?.value !== null && w?.value !== undefined ? (w.value >= target ? 'good' : 'danger') : 'neutral';
  // A série vale para o período que a API mostrou de fato (recuado ou não).
  const usedFrom = w?.used.from ?? from;
  const usedTo = w?.used.to ?? to;

  return (
    <article className={`ind-card${large ? ' ind-card--large' : ''} widget--${deltaTone}${query.isFetching ? ' is-refreshing' : ''}`} aria-label={meta.label}>
      <div className="widget__head">
        <span className="widget__title">
          <span className="tp-kpi__label" title={meta.hint}>{meta.label}</span>
          {/* Item 2: objetivo e fórmula do indicador, no mesmo (i) das etapas do Fluxo da garagem. */}
          <InfoTip label={`${t.dash.widgets.about.title}: ${meta.label}`} align={index % 3 === 0 ? 'start' : index % 3 === 2 ? 'end' : 'center'} className="widget__info">
            <span className="tp-tip__title"><i className="tp-tip__dot" aria-hidden />{meta.label}</span>
            <span className="tp-tip__body"><b>{t.dash.widgets.about.goal}:</b> {t.dash.widgets.about[pref.kind].goal}</span>
            <span className="tp-tip__body"><b>{t.dash.widgets.about.formula}:</b> {t.dash.widgets.about[pref.kind].formula}</span>
          </InfoTip>
        </span>
        <span className="ind-card__range tp-muted" title={rangeLabel(usedFrom, usedTo)}>{rangeLabel(usedFrom, usedTo)}</span>
        <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm widget__remove" onClick={onRemove} aria-label={t.dash.widgets.remove} title={t.dash.widgets.remove}>
          <X size={14} aria-hidden />
        </button>
      </div>
      <div className="widget__filters">
        <WidgetScopePicker value={vehicleId} vehicles={vehicles} onChange={onVehicle} />
        <WidgetPeriodPicker value={pref.period} onChange={onPeriod} />
      </div>

      <div className="ind-card__headline">
        {query.isPending && !w ? <span className="skeleton widget__sk" /> : <strong className="ind-card__value">{value ?? '—'}</strong>}
        <span className={`dash-kpi__delta dash-kpi__delta--${deltaTone}`}>
          {delta === null ? <Minus size={14} aria-hidden /> : delta > 0 ? <ArrowUpRight size={14} aria-hidden /> : delta < 0 ? <ArrowDownRight size={14} aria-hidden /> : <Minus size={14} aria-hidden />}
          {delta === null ? '' : `${delta > 0 ? '+' : ''}${delta.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% `}
          <em>{delta === null ? t.dash.widgets.noPrevious : t.dash.widgets.vsPrevious}</em>
        </span>
        {target !== null && (
          <span className={`ind-card__target is-${targetTone}`} title={t.dash.widgets.targetHint}>
            {t.dash.widgets.target.replace('{v}', formatValue(target, pref.kind === 'mkbf' ? 'km' : 'pct') ?? '')}
          </span>
        )}
      </div>
      <span className="tp-kpi__note ind-card__note">
        {w?.fellBack && <b className="widget__fallback">{t.dash.widgets.dataOf.replace('{d}', fmtDay(w.used.to))} · </b>}
        {w && w.value === null ? t.dash.widgets.noData : (w?.detail ?? meta.hint)}
      </span>

      <div className="ind-card__chart">
        <Body pref={pref} w={w} from={usedFrom} to={usedTo} vehicleId={vehicleId} />
      </div>
    </article>
  );
}

/** O corpo de cada tipo: os grandes e os de corpo próprio têm o seu; o resto é a série genérica. */
function Body({ pref, w, from, to, vehicleId }: { pref: DashboardWidgetPref; w: DashboardWidget | undefined; from: string; to: string; vehicleId: string | null }) {
  const { t } = useI18n();
  const meta = t.dash.widgets.kinds[pref.kind];
  switch (pref.kind) {
    case 'mkbf':
      return <MkbfBody from={from} to={to} vehicleId={vehicleId} series={w?.series ?? null} />;
    case 'availability':
      return <AvailabilityBody from={from} to={to} vehicleId={vehicleId} series={w?.series ?? null} />;
    case 'topFailures':
      return <TopFailuresBody from={from} to={to} />;
    case 'downtime':
      if (!vehicleId) return <DowntimeBody from={from} to={to} />;
      break;
    case 'breakdowns':
      // Quebras: as barras com a média móvel, como o gráfico que o cliente já conhecia (por hora, dia); por mês, a série genérica.
      if (w?.series && w.series.bucket !== 'month') {
        return (
          <EventsPerDayChart
            data={w.series.points.map((p) => ({ date: w.series!.bucket === 'hour' ? `${from}T${p.key}` : p.key, count: p.value ?? 0 }))}
            bucket={w.series.bucket === 'hour' ? 'hour' : 'day'}
          />
        );
      }
      break;
  }
  if (!w) return <ChartLoading />;
  if (!w.series || w.series.points.every((p) => p.value === null)) return <NoSeries />;
  return <WidgetSeriesChart series={w.series} unit={w.unit} label={meta.label} format={(v) => formatValue(v, w.unit) ?? ''} />;
}

/**
 * Tempo parado: a rosca por etapa (o que segurou o carro) com a média por
 * carro parado e, por clique, os carros com as horas de cada um (item 4).
 */
function DowntimeBody({ from, to }: { from: string; to: string }) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ['dashboard', 'downtime', from, to],
    queryFn: () => api.get<DashboardDowntime>(`/dashboard/downtime?from=${from}&to=${to}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const d = query.data;
  const [drill, setDrill] = useState<{ cause: DowntimeCause | null } | null>(null);
  const perCar = d ? Object.fromEntries(d.perCause.map((p) => [p.cause, { vehicles: p.vehicles, avgMinutes: p.avgMinutesPerVehicle }])) : undefined;
  if (!d) return <ChartLoading />;
  return (
    <>
      <RefreshVeil active={query.isPlaceholderData} delay={0}>
        <DowntimeDonut
          data={d.downtimeByCause}
          totalMinutes={d.totalDowntimeMinutes}
          perCar={perCar}
          onPick={(cause) => setDrill({ cause })}
          center={
            d.avgMinutesPerVehicle !== null ? (
              <>
                <span className="donut__big">{formatHours(d.avgMinutesPerVehicle)}</span>
                <span className="donut__small">{t.dash.downtimePerCar}</span>
              </>
            ) : undefined
          }
        />
      </RefreshVeil>
      {d.vehicleCount > 0 && (
        <div className="ind-card__foot">
          <span className="tp-muted">
            {formatHours(d.totalDowntimeMinutes)} {t.dash.downtimeTotalOf} {formatNumber(d.vehicleCount)} {t.dash.downtimeCars}
          </span>
          <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={() => setDrill({ cause: null })}>
            {t.dash.downtimeSeeCars}
          </button>
        </div>
      )}
      {drill && <DowntimeCarsDrawer data={d} cause={drill.cause} onCause={(cause) => setDrill({ cause })} onClose={() => setDrill(null)} rangeText={rangeLabel(from, to)} />}
    </>
  );
}
