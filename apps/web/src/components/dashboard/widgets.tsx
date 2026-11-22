import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ArrowDownRight,
  ArrowUpRight,
  Bus,
  CalendarDays,
  Check,
  ChevronDown,
  Minus,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  WIDGET_KINDS,
  type DashboardVehicle,
  type DashboardWidget,
  type DashboardWidgetPref,
  type WidgetKind,
  type WidgetPeriod,
  type WidgetPeriodPreset,
} from '@app/shared';
import { api } from '@/lib/api-client';
import { formatMinutes, formatNumber } from '@/lib/format';
import { isoOf, makePeriod, rangeLabel, shiftDays, todayIso } from '@/lib/period';
import { useI18n } from '@/i18n/i18n.context';
import { useUiState } from '@/features/auth/use-ui-pref';
import { toast } from '@/lib/toast';
import { CollapsibleCard } from '@/components/ui/collapsible-card';

const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Painel inicial de quem ainda não montou o seu. */
const DEFAULT_WIDGETS: DashboardWidgetPref[] = [
  { id: 'w-mkbf', kind: 'mkbf', period: { preset: 'last30' } },
  { id: 'w-breakdowns', kind: 'breakdowns', period: { preset: 'yesterday' } },
  { id: 'w-availability', kind: 'availability', period: { preset: 'today' } },
  { id: 'w-lostTrips', kind: 'lostTrips', period: { preset: 'yesterday' } },
  { id: 'w-downtime', kind: 'downtime', period: { preset: 'last30' } },
  { id: 'w-rescues', kind: 'rescues', period: { preset: 'today' } },
];

const PRESETS: WidgetPeriodPreset[] = [
  'today',
  'yesterday',
  'd2',
  'last7',
  'last30',
  'thisMonth',
  'lastMonth',
];

/** Datas (AAAA-MM-DD) de um período de widget, sempre em relação a hoje. */
function resolveWidgetPeriod(p: WidgetPeriod): { from: string; to: string } {
  const today = todayIso();
  const [y, m] = today.split('-').map(Number) as [number, number];
  const m0 = m - 1;
  switch (p.preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: shiftDays(today, -1), to: shiftDays(today, -1) };
    case 'd2':
      return { from: shiftDays(today, -2), to: shiftDays(today, -2) };
    case 'last7':
      return { from: shiftDays(today, -6), to: today };
    case 'last30':
      return { from: shiftDays(today, -29), to: today };
    case 'thisMonth':
      return { from: isoOf(y, m0, 1), to: today };
    case 'lastMonth':
      return { from: isoOf(y, m0 - 1, 1), to: isoOf(y, m0, 0) };
    case 'custom': {
      const to = p.to && p.to <= today ? p.to : today;
      const from = p.from && p.from <= to ? p.from : to;
      return { from, to };
    }
  }
}

/** Seção "Indicadores": cada cartão é um widget com o próprio período; a lista fica salva na conta. */
export function WidgetsCard({
  grip,
  vehicles,
}: {
  grip?: ReactNode;
  vehicles: DashboardVehicle[];
}) {
  const { t } = useI18n();
  const [widgets, setWidgets] = useUiState<DashboardWidgetPref[]>('dash.widgets', DEFAULT_WIDGETS);
  const update = (id: string, patch: Partial<DashboardWidgetPref>) =>
    setWidgets((list) => list.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const remove = (id: string) => setWidgets((list) => list.filter((w) => w.id !== id));
  const add = (kind: WidgetKind) =>
    setWidgets((list) => [
      ...list,
      { id: `${kind}-${Date.now().toString(36)}`, kind, period: { preset: 'yesterday' } },
    ]);

  return (
    <CollapsibleCard
      id="dash.widgets"
      grip={grip}
      className="dash-widgets dash-glass"
      label={t.dash.widgets.title}
      head={
        <>
          <div>
            <h3>{t.dash.widgets.title}</h3>
            <span className="chart__hint">{t.dash.widgets.hint}</span>
          </div>
          <AddWidget onAdd={add} />
        </>
      }
    >
      {widgets.length === 0 ? (
        <p className="dash-widgets__empty">{t.dash.widgets.empty}</p>
      ) : (
        <div className="dash-widgets__grid">
          {widgets.map((w) => (
            <Widget
              key={w.id}
              pref={w}
              vehicles={vehicles}
              onPeriod={(period) => update(w.id, { period })}
              onVehicle={(vehicleId) => update(w.id, { vehicleId })}
              onRemove={() => remove(w.id)}
            />
          ))}
        </div>
      )}
    </CollapsibleCard>
  );
}

/** "Adicionar indicador": uma lista com todos os indicadores; escolher já põe o cartão no fim. */
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

function Widget({
  pref,
  vehicles,
  onPeriod,
  onVehicle,
  onRemove,
}: {
  pref: DashboardWidgetPref;
  vehicles: DashboardVehicle[];
  onPeriod: (p: WidgetPeriod) => void;
  onVehicle: (id: string | null) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const meta = t.dash.widgets.kinds[pref.kind];
  const { from, to } = resolveWidgetPeriod(pref.period);
  const query = useQuery({
    queryKey: ['dashboard', 'widget', pref.kind, from, to, pref.vehicleId ?? null],
    queryFn: () =>
      api.get<DashboardWidget>(
        `/dashboard/widget?kind=${pref.kind}&from=${from}&to=${to}${pref.vehicleId ? `&vehicleId=${pref.vehicleId}` : ''}`,
      ),
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
    toast.warning(
      t.dash.widgets.noDataFor.replace('{d}', fmtDay(w.to)).replace('{k}', meta.label),
      {
        description: t.dash.widgets.showing.replace('{d}', fmtDay(w.used.to)),
      },
    );
  }, [w, t, meta.label]);
  const value = w ? formatValue(w.value, w.unit) : null;
  const delta =
    w && w.value !== null && w.previous !== null && w.previous !== 0
      ? ((w.value - w.previous) / Math.abs(w.previous)) * 100
      : null;
  const deltaTone =
    delta === null
      ? 'neutral'
      : Math.abs(delta) < 0.05
        ? 'neutral'
        : delta > 0 === (w?.higherIsBetter ?? true)
          ? 'good'
          : 'danger';

  return (
    <article
      className={`dash-kpi widget widget--${deltaTone}${query.isFetching ? ' is-refreshing' : ''}`}
      aria-label={meta.label}
    >
      <div className="widget__head">
        <span className="tp-kpi__label" title={meta.hint}>
          {meta.label}
        </span>
        <button
          type="button"
          className="tp-btn tp-btn--ghost tp-btn--sm widget__remove"
          onClick={onRemove}
          aria-label={t.dash.widgets.remove}
          title={t.dash.widgets.remove}
        >
          <X size={14} aria-hidden />
        </button>
      </div>
      <div className="widget__filters">
        <WidgetScopePicker
          value={pref.vehicleId ?? null}
          vehicles={vehicles}
          onChange={onVehicle}
        />
        <WidgetPeriodPicker value={pref.period} onChange={onPeriod} />
      </div>
      <div className="widget__body">
        {query.isPending && !w ? (
          <span className="skeleton widget__sk" />
        ) : (
          <strong className="dash-kpi__value">{value ?? '—'}</strong>
        )}
      </div>
      <span className={`dash-kpi__delta dash-kpi__delta--${deltaTone}`}>
        {delta === null ? (
          <Minus size={14} aria-hidden />
        ) : delta > 0 ? (
          <ArrowUpRight size={14} aria-hidden />
        ) : delta < 0 ? (
          <ArrowDownRight size={14} aria-hidden />
        ) : (
          <Minus size={14} aria-hidden />
        )}
        {delta === null
          ? ''
          : `${delta > 0 ? '+' : ''}${delta.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% `}
        <em>{delta === null ? t.dash.widgets.noPrevious : t.dash.widgets.vsPrevious}</em>
      </span>
      <span className="tp-kpi__note">
        {w?.fellBack && (
          <b className="widget__fallback">
            {t.dash.widgets.dataOf.replace('{d}', fmtDay(w.used.to))} ·{' '}
          </b>
        )}
        {w && w.value === null ? t.dash.widgets.noData : (w?.detail ?? meta.hint)}
      </span>
    </article>
  );
}

function formatValue(value: number | null, unit: DashboardWidget['unit']): string | null {
  if (value === null) return null;
  switch (unit) {
    case 'km':
      return `${formatNumber(Math.round(value))} km`;
    case 'count':
      return formatNumber(Math.round(value));
    case 'pct':
      return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    case 'minutes':
      return formatMinutes(Math.round(value));
    case 'kml':
      return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km/l`;
    case 'kmkwh':
      return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km/kWh`;
  }
}

/**
 * Seletor de período do widget: a mesma linguagem do seletor das telas de
 * consumo, em tamanho de cartão. A pílula mostra o nome do período; o painel
 * traz os atalhos (Hoje, Ontem, Anteontem, 7 dias, 30 dias, este mês, mês
 * passado) e um intervalo livre. Fecha com Esc ou clique fora.
 */
function WidgetPeriodPicker({
  value,
  onChange,
}: {
  value: WidgetPeriod;
  onChange: (p: WidgetPeriod) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { from, to } = resolveWidgetPeriod(value);
  const label =
    value.preset === 'custom' ? rangeLabel(from, to) : t.dash.widgets.period[value.preset];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (p: WidgetPeriod) => {
    onChange(p);
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <span ref={root} className={`wperiod${open ? ' is-open' : ''}`}>
      <button
        ref={trigger}
        type="button"
        className="wperiod__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={`${label} · ${rangeLabel(from, to)}`}
        onClick={() => setOpen((o) => !o)}
      >
        <CalendarDays size={13} aria-hidden className="wperiod__icon" />
        <span className="wperiod__label">{label}</span>
        <ChevronDown size={12} aria-hidden className="wperiod__chevron" />
      </button>
      {open && <WidgetPeriodPanel id={panelId} value={value} onChoose={choose} />}
    </span>
  );
}

function WidgetPeriodPanel({
  id,
  value,
  onChoose,
}: {
  id: string;
  value: WidgetPeriod;
  onChoose: (p: WidgetPeriod) => void;
}) {
  const { t } = useI18n();
  const today = todayIso();
  const current = resolveWidgetPeriod(value);
  const [from, setFrom] = useState(current.from);
  const [to, setTo] = useState(current.to);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const valid = from <= to && to <= today;
  const draft = valid ? makePeriod(from, to) : null;
  const changed =
    draft !== null &&
    (draft.from !== current.from || draft.to !== current.to || value.preset !== 'custom');

  return (
    <div
      id={id}
      role="dialog"
      aria-modal="false"
      aria-label={t.dash.widgets.period.choose}
      className="period__panel wperiod__panel"
    >
      <div
        className="period__presets wperiod__presets"
        role="group"
        aria-label={t.dash.widgets.period.shortcuts}
      >
        {PRESETS.map((preset, i) => {
          const r = resolveWidgetPeriod({ preset });
          const active = value.preset === preset;
          return (
            <button
              key={preset}
              ref={i === 0 ? first : undefined}
              type="button"
              className={`period__preset${active ? ' is-active' : ''}`}
              aria-pressed={active}
              onClick={() => onChoose({ preset })}
            >
              <span>{t.dash.widgets.period[preset]}</span>
              <span className="period__preset-range">
                {r.from === r.to ? rangeLabel(r.from, r.to) : rangeLabel(r.from, r.to)}
              </span>
              {active && <Check size={14} aria-hidden className="period__check" />}
            </button>
          );
        })}
      </div>
      <form
        className="period__custom wperiod__custom"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft) onChoose({ preset: 'custom', from: draft.from, to: draft.to });
        }}
      >
        <span className="period__custom-title">{t.dash.widgets.period.customTitle}</span>
        <label className="period__date">
          <span>{t.dash.widgets.period.from}</span>
          <input
            type="date"
            className="tp-input"
            value={from}
            max={today}
            onChange={(e) => setFrom(e.target.value)}
            aria-label={t.dash.widgets.period.from}
          />
        </label>
        <label className="period__date">
          <span>{t.dash.widgets.period.to}</span>
          <input
            type="date"
            className="tp-input"
            value={to}
            max={today}
            onChange={(e) => setTo(e.target.value)}
            aria-label={t.dash.widgets.period.to}
          />
        </label>
        <button type="submit" className="tp-btn tp-btn--primary tp-btn--sm" disabled={!changed}>
          {t.dash.widgets.period.apply}
        </button>
      </form>
    </div>
  );
}

/**
 * Escopo do widget: a frota inteira ou um carro só. A pílula mostra "Frota"
 * ou o prefixo; o painel tem "Toda a frota" e uma busca por prefixo ou placa
 * sobre a frota que o Dashboard já carregou.
 */
function WidgetScopePicker({
  value,
  vehicles,
  onChange,
}: {
  value: string | null;
  vehicles: DashboardVehicle[];
  onChange: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const selected = value ? (vehicles.find((v) => v.id === value) ?? null) : null;

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (id: string | null) => {
    onChange(id);
    setOpen(false);
    setQuery('');
    trigger.current?.focus();
  };
  const q = query.trim().toLowerCase();
  const results = (
    q
      ? vehicles.filter(
          (v) => v.code.toLowerCase().includes(q) || v.plate.toLowerCase().includes(q),
        )
      : vehicles
  ).slice(0, 8);

  return (
    <span ref={root} className={`wperiod wscope${open ? ' is-open' : ''}`}>
      <button
        ref={trigger}
        type="button"
        className={`wperiod__trigger${selected ? ' is-vehicle' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={
          selected
            ? `${t.dash.widgets.scope.vehicle} ${selected.code} · ${selected.plate}`
            : t.dash.widgets.scope.fleetHint
        }
        onClick={() => setOpen((o) => !o)}
      >
        <Bus size={13} aria-hidden className="wperiod__icon" />
        <span className="wperiod__label">
          {selected ? selected.code : t.dash.widgets.scope.fleet}
        </span>
        <ChevronDown size={12} aria-hidden className="wperiod__chevron" />
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-label={t.dash.widgets.scope.choose}
          className="period__panel wperiod__panel wscope__panel"
        >
          <label className="wscope__search">
            <Search size={14} aria-hidden />
            <input
              ref={input}
              type="text"
              autoComplete="off"
              className="tp-input"
              placeholder={t.dash.widgets.scope.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t.dash.widgets.scope.search}
            />
          </label>
          <div className="period__presets wperiod__presets" role="group">
            <button
              type="button"
              className={`period__preset${value === null ? ' is-active' : ''}`}
              aria-pressed={value === null}
              onClick={() => choose(null)}
            >
              <span>{t.dash.widgets.scope.all}</span>
              <span className="period__preset-range">
                {vehicles.length} {t.dash.widgets.scope.buses}
              </span>
              {value === null && <Check size={14} aria-hidden className="period__check" />}
            </button>
            {results.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`period__preset${value === v.id ? ' is-active' : ''}`}
                aria-pressed={value === v.id}
                onClick={() => choose(v.id)}
              >
                <span>{v.code}</span>
                <span className="period__preset-range">{v.plate}</span>
                {value === v.id && <Check size={14} aria-hidden className="period__check" />}
              </button>
            ))}
            {results.length === 0 && (
              <span className="wscope__none">{t.dash.widgets.scope.none}</span>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
