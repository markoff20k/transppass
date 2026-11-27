import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Minus, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
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
import { useUiPref, useUiState } from '@/features/auth/use-ui-pref';
import { toast } from '@/lib/toast';
import { InfoTip } from '@/components/ui/info-tip';
import { Modal } from '@/components/ui/modal';
import { RefreshVeil } from '@/components/ui/refresh-veil';
import { DowntimeDonut, EventsPerDayChart, WidgetSeriesChart } from '@/components/charts/charts';
import { AVAILABILITY_TARGET, AvailabilityBody, ChartLoading, MKBF_TARGET, MkbfBody, NoSeries } from './chart-cards';
import { TopFailuresBody } from './top-failures';
import { DowntimeCarsDrawer, formatHours } from './downtime-cars';
import { WidgetPeriodPicker, WidgetScopePicker, fmtDay, formatValue, resolveWidgetPeriod } from './widgets';
import { SortableList } from '@/components/ui/sortable-cards';
import { CardReading, IndicatorsReading } from './indicators-reading';
import { IaBot } from '@/features/ia/ia-mark';
import { useIa } from '@/features/ia/ia.context';

/** O painel de quem ainda não montou o seu: os dois grandes e os cinco que o cliente mais olha. */
const DEFAULT_INDICATORS: DashboardWidgetPref[] = [
  { id: 'w-mkbf', kind: 'mkbf', period: { preset: 'thisMonth' } },
  { id: 'w-availability', kind: 'availability', period: { preset: 'today' } },
  { id: 'w-breakdowns', kind: 'breakdowns', period: { preset: 'last30' } },
  { id: 'w-lostTrips', kind: 'lostTrips', period: { preset: 'thisMonth' } },
  { id: 'w-downtime', kind: 'downtime', period: { preset: 'last30' } },
  { id: 'w-rescues', kind: 'rescues', period: { preset: 'thisMonth' } },
  { id: 'w-woOpened', kind: 'woOpened', period: { preset: 'thisMonth' } },
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
  // Tipos marcados no modal de escolha: saem os desmarcados (todas as cópias, se houver repetido de
  // antes), ficam os marcados na ordem em que estão, e os novos entram no fim do grupo deles.
  const applyKinds = (kinds: WidgetKind[]) =>
    setWidgets((list) => {
      const keep = new Set(kinds);
      const seen = new Set<WidgetKind>();
      const kept = list.filter((w) => keep.has(w.kind) && !seen.has(w.kind) && seen.add(w.kind));
      const added = kinds
        .filter((k) => !seen.has(k))
        .map((kind) => ({ id: `${kind}-${Date.now().toString(36)}`, kind, period: { preset: isLarge(kind) ? 'thisMonth' : 'last30' } as WidgetPeriod }));
      return [...kept, ...added];
    });
  // "Restaurar padrão": indicadores, ordem das duas seções, períodos, escopos e cartões recolhidos.
  const [, setNowOrder] = useUiState<string[]>('dash.order.now', []);
  const [, setFlowCollapsed] = useUiPref<boolean>('collapsed.dash.flow', false);
  const [, setKpisCollapsed] = useUiPref<boolean>('collapsed.dash.kpis', false);
  const [, setRecentCollapsed] = useUiPref<boolean>('collapsed.dash.recent', false);
  const [, setFleetCollapsed] = useUiPref<boolean>('collapsed.dash.fleet', false);
  const resetAll = () => {
    setWidgets(DEFAULT_INDICATORS);
    setNowOrder([]);
    setFlowCollapsed(false);
    setKpisCollapsed(false);
    setRecentCollapsed(false);
    setFleetCollapsed(false);
    toast.success(t.dash.widgets.pick.resetDone);
  };
  const applyAll = (period: WidgetPeriod) => {
    setWidgets((list) => list.map((w) => ({ ...w, period })));
    toast.success(t.dash.widgets.appliedAll);
  };

  const large = widgets.filter((w) => isLarge(w.kind));
  const regular = widgets.filter((w) => !isLarge(w.kind));
  // Arrastar reordena só dentro do grupo (grandes entre grandes, normais entre normais): as
  // posições do grupo na lista são preenchidas na nova ordem, o resto fica onde está.
  const reorderWithin = (group: DashboardWidgetPref[], keys: string[]) =>
    setWidgets((list) => {
      const ids = new Set(group.map((g) => g.id));
      const byId = new Map(list.map((w) => [w.id, w]));
      const ordered = keys.map((k) => byId.get(k)).filter((w): w is DashboardWidgetPref => !!w);
      let i = 0;
      return list.map((w) => (ids.has(w.id) ? (ordered[i++] ?? w) : w));
    });
  const cardOf = (w: DashboardWidgetPref, i: number, isBig: boolean) => ({
    key: w.id,
    render: (grip: ReactNode) => (
      <IndicatorCard index={i} pref={w} vehicles={vehicles} large={isBig} grip={grip} onPeriod={(period) => update(w.id, { period })} onVehicle={(vehicleId) => update(w.id, { vehicleId })} onRemove={() => remove(w.id)} />
    ),
  });
  const [allPeriod, setAllPeriod] = useState<WidgetPeriod>({ preset: 'last30' });
  const [pickerOpen, setPickerOpen] = useState(false);
  // O seletor global marca o período que todos os cartões compartilham; se divergem, o último aplicado.
  const samePref = (a: WidgetPeriod, b: WidgetPeriod) => a.preset === b.preset && (a.preset !== 'custom' || (a.from === b.from && a.to === b.to));
  const shownAll = widgets.length > 0 && widgets.every((w) => samePref(w.period, widgets[0]!.period)) ? widgets[0]!.period : allPeriod;

  return (
    <section className="dash-section dash-section--indicators" aria-labelledby="dash-indicators">
      <header className="dash-section__head">
        <div>
          <h2 id="dash-indicators">{t.dash.sections.indicators}</h2>
        </div>
        <div className="dash-section__tools">
          {widgets.length > 1 && (
            <WidgetPeriodPicker
              value={shownAll}
              label={t.dash.widgets.applyAll}
              title={t.dash.widgets.applyAllHint}
              className="ind-apply"
              onChange={(p) => {
                setAllPeriod(p);
                applyAll(p);
              }}
            />
          )}
          <button type="button" className="dash-widgets__add" onClick={() => setPickerOpen(true)}>
            <SlidersHorizontal size={14} aria-hidden />
            <span>{t.dash.widgets.pick.title}</span>
          </button>
        </div>
      </header>

      <IndicatorsReading
        widgets={widgets}
        onPick={(kind) => document.querySelector(`.ind-card[data-kind="${kind}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
      />
      {pickerOpen && <IndicatorPicker current={widgets.map((w) => w.kind)} onClose={() => setPickerOpen(false)} onApply={applyKinds} onReset={resetAll} />}
      {widgets.length === 0 && <p className="dash-widgets__empty">{t.dash.widgets.empty}</p>}
      {large.length > 0 && (
        <div className="ind-grid ind-grid--large" data-count={large.length}>
          <SortableList grid order={large.map((w) => w.id)} onReorder={(keys) => reorderWithin(large, keys)} items={large.map((w, i) => cardOf(w, i, true))} />
        </div>
      )}
      {regular.length > 0 && (
        <div className="ind-grid">
          <SortableList grid order={regular.map((w) => w.id)} onReorder={(keys) => reorderWithin(regular, keys)} items={regular.map((w, i) => cardOf(w, i, false))} />
        </div>
      )}
    </section>
  );
}

/**
 * Modal "Escolher indicadores": a lista completa, um checkbox por indicador (marcado = está no
 * painel), em dois grupos conforme o tamanho do cartão. Repetir um indicador é impossível por
 * construção. "Aplicar" grava; "Cancelar" descarta. "Restaurar padrão" pede um segundo clique e
 * devolve o painel inteiro ao padrão do sistema.
 */
function IndicatorPicker({ current, onClose, onApply, onReset }: { current: WidgetKind[]; onClose: () => void; onApply: (kinds: WidgetKind[]) => void; onReset: () => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Set<WidgetKind>>(() => new Set(current));
  const [armed, setArmed] = useState(false);
  const toggle = (k: WidgetKind) =>
    setDraft((d) => {
      const next = new Set(d);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const dirty = draft.size !== new Set(current).size || current.some((k) => !draft.has(k));
  const groups = [
    { key: 'large', label: t.dash.widgets.pick.large, kinds: WIDGET_KINDS.filter((k) => isLarge(k)) },
    { key: 'regular', label: t.dash.widgets.pick.regular, kinds: WIDGET_KINDS.filter((k) => !isLarge(k)) },
  ];
  return (
    <Modal
      open
      onClose={onClose}
      title={t.dash.widgets.pick.title}
      description={t.dash.widgets.pick.hint}
      width={640}
      footer={
        <>
          <button
            type="button"
            className={`tp-btn tp-btn--ghost ind-pick__reset${armed ? ' is-armed' : ''}`}
            title={t.dash.widgets.pick.resetHint}
            onClick={() => {
              if (!armed) {
                setArmed(true);
                return;
              }
              onReset();
              onClose();
            }}
          >
            <RotateCcw size={14} aria-hidden /> {armed ? t.dash.widgets.pick.resetConfirm : t.dash.widgets.pick.reset}
          </button>
          <span className="ind-pick__spacer" />
          <button type="button" className="tp-btn tp-btn--secondary" onClick={onClose}>{t.dash.widgets.pick.cancel}</button>
          <button
            type="button"
            className="tp-btn tp-btn--primary"
            disabled={!dirty}
            onClick={() => {
              onApply(WIDGET_KINDS.filter((k) => draft.has(k)));
              onClose();
            }}
          >
            {t.dash.widgets.pick.apply}
          </button>
        </>
      }
    >
      <div className="ind-pick">
        {groups.map((g) => (
          <section key={g.key} className="ind-pick__group">
            <h3 className="ind-pick__group-title">{g.label}</h3>
            <ul className="ind-pick__list">
              {g.kinds.map((k) => (
                <li key={k}>
                  <label className={`ind-pick__item${draft.has(k) ? ' is-on' : ''}`}>
                    <input type="checkbox" checked={draft.has(k)} onChange={() => toggle(k)} />
                    <span className="ind-pick__text">
                      <b>{t.dash.widgets.kinds[k].label}</b>
                      <small>{t.dash.widgets.kinds[k].hint}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="ind-pick__count tp-muted">{t.dash.widgets.pick.count.replace('{n}', String(draft.size)).replace('{t}', String(WIDGET_KINDS.length))}</p>
      </div>
    </Modal>
  );
}

function IndicatorCard({
  index,
  pref,
  vehicles,
  large = false,
  grip,
  onPeriod,
  onVehicle,
  onRemove,
}: {
  index: number;
  pref: DashboardWidgetPref;
  vehicles: DashboardVehicle[];
  large?: boolean;
  /** Alça de arrastar, vinda da lista reordenável. */
  grip?: ReactNode;
  onPeriod: (p: WidgetPeriod) => void;
  onVehicle: (id: string | null) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const meta = t.dash.widgets.kinds[pref.kind];
  const iaOn = useIa().status?.enabled ?? false;
  const [iaOpen, setIaOpen] = useState(false);
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
  // O corpo segue o período PEDIDO assim que a pessoa troca (para o véu aparecer na hora em todo
  // cartão); só depois de a resposta chegar, se a API recuou, ele passa para o período mostrado de fato.
  const settled = w && !query.isPlaceholderData;
  const usedFrom = settled && w.fellBack ? w.used.from : from;
  const usedTo = settled && w.fellBack ? w.used.to : to;

  return (
    <article data-kind={pref.kind} className={`ind-card${large ? ' ind-card--large' : ''} widget--${deltaTone}${query.isFetching ? ' is-refreshing' : ''}${query.isPlaceholderData ? ' is-stale' : ''}`} aria-label={meta.label}>
      <div className="widget__head">
        <span className="widget__title">
          {grip}
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
        {iaOn && (
          <button type="button" className={`tp-btn tp-btn--ghost tp-btn--sm widget__ia${iaOpen ? ' is-on' : ''}`} onClick={() => setIaOpen((v) => !v)} aria-pressed={iaOpen} aria-label={t.dash.widgets.ia.cardButton} title={t.dash.widgets.ia.cardButton}>
            <IaBot size={20} />
          </button>
        )}
      </div>

      <div className="ind-card__headline">
        {query.isPending && !w ? <span className="skeleton widget__sk" /> : <strong className="ind-card__value">{value ?? '—'}</strong>}
        {!w?.neverHadData && <span className={`dash-kpi__delta dash-kpi__delta--${deltaTone}`}>
          {delta === null ? <Minus size={14} aria-hidden /> : delta > 0 ? <ArrowUpRight size={14} aria-hidden /> : delta < 0 ? <ArrowDownRight size={14} aria-hidden /> : <Minus size={14} aria-hidden />}
          {delta === null ? '' : `${delta > 0 ? '+' : ''}${delta.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% `}
          <em>{delta === null ? t.dash.widgets.noPrevious : t.dash.widgets.vsPrevious}</em>
        </span>}
        {target !== null && w && w.value !== null && (
          <span className={`tp-badge ${targetTone === 'good' ? 'tp-badge--success' : targetTone === 'danger' ? 'tp-badge--danger' : ''}`} title={t.dash.widgets.targetHint}>
            {t.dash.widgets.target.replace('{v}', formatValue(target, pref.kind === 'mkbf' ? 'km' : 'pct') ?? '')}
          </span>
        )}
      </div>
      <span className="tp-kpi__note ind-card__note">
        {w?.fellBack && <b className="widget__fallback">{t.dash.widgets.dataOf.replace('{d}', fmtDay(w.used.to))} · </b>}
        {w?.neverHadData ? t.dash.widgets.notStarted : w && w.value === null ? t.dash.widgets.noData : (w?.detail ?? meta.hint)}
      </span>

      <div className="ind-card__chart">
        {iaOn && iaOpen && <CardReading pref={pref} label={meta.label} onClose={() => setIaOpen(false)} />}
        {/* Todo gráfico tem loader: no primeiro carregamento (ChartLoading) e na troca de período ou
            escopo (o véu sobre o dado anterior). Os corpos com consulta própria já põem o seu véu. */}
        <RefreshVeil active={query.isPlaceholderData && !hasOwnVeil(pref.kind, vehicleId)} delay={0}>
          <Body pref={pref} w={w} from={usedFrom} to={usedTo} vehicleId={vehicleId} />
        </RefreshVeil>
      </div>
    </article>
  );
}

/** Corpos que buscam o próprio dado e já mostram o véu na troca (a série do widget não é o que eles desenham). */
function hasOwnVeil(kind: WidgetKind, vehicleId: string | null): boolean {
  if (kind === 'topFailures') return true;
  if ((kind === 'mkbf' || kind === 'availability' || kind === 'downtime') && !vehicleId) return true;
  return false;
}

/** O corpo de cada tipo: os grandes e os de corpo próprio têm o seu; o resto é a série genérica. */
function Body({ pref, w, from, to, vehicleId }: { pref: DashboardWidgetPref; w: DashboardWidget | undefined; from: string; to: string; vehicleId: string | null }) {
  const { t } = useI18n();
  const meta = t.dash.widgets.kinds[pref.kind];
  // Indicador que nunca teve dado: uma frase só, dizendo de onde o dado vai vir.
  if (w?.neverHadData) return <NoSeries text={t.dash.widgets.startsWith[pref.kind as keyof typeof t.dash.widgets.startsWith] ?? t.dash.widgets.startsWith.default} />;
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
  // Um dia só num indicador sem leitura por hora: a API manda os 7 dias até ele; a legenda avisa.
  const context = from === to && w.series.bucket === 'day' ? t.dash.widgets.seriesContext.replace('{d}', fmtDay(to)) : undefined;
  return <WidgetSeriesChart series={w.series} unit={w.unit} label={meta.label} format={(v) => formatValue(v, w.unit) ?? ''} note={context} />;
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
  if (d.totalDowntimeMinutes === 0) return <NoSeries />;
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
