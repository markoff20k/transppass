import { useEffect, useId, useRef, useState } from 'react';
import { Bus, CalendarDays, Check, ChevronDown, Search } from 'lucide-react';
import type { DashboardVehicle, DashboardWidget, WidgetPeriod, WidgetPeriodPreset } from '@app/shared';
import { formatMinutes, formatNumber } from '@/lib/format';
import { isoOf, makePeriod, rangeLabel, shiftDays, todayIso } from '@/lib/period';
import { useI18n } from '@/i18n/i18n.context';

export const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export const PRESETS: WidgetPeriodPreset[] = [
  'today',
  'yesterday',
  'd2',
  'last7',
  'last30',
  'thisMonth',
  'lastMonth',
];

/** Datas (AAAA-MM-DD) de um período de widget, sempre em relação a hoje. */
export function resolveWidgetPeriod(p: WidgetPeriod): { from: string; to: string } {
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

/** O número do widget na unidade dele: "3.890 km", "92,4%", "6h26", "2,31 km/l". */
export function formatValue(value: number | null, unit: DashboardWidget['unit']): string | null {
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
 * passado) e um intervalo livre. Fecha com Esc ou clique fora. Com `label`,
 * a pílula mostra esse texto em vez do período (o "aplicar a todos" da seção).
 */
export function WidgetPeriodPicker({
  value,
  onChange,
  label,
  title,
  className,
}: {
  value: WidgetPeriod;
  onChange: (p: WidgetPeriod) => void;
  label?: string;
  title?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { from, to } = resolveWidgetPeriod(value);
  const periodLabel =
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
    <span ref={root} className={`wperiod${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
      <button
        ref={trigger}
        type="button"
        className="wperiod__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={title ?? `${periodLabel} · ${rangeLabel(from, to)}`}
        onClick={() => setOpen((o) => !o)}
      >
        <CalendarDays size={13} aria-hidden className="wperiod__icon" />
        <span className="wperiod__label">{label ?? periodLabel}</span>
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
              <span className="period__preset-range">{rangeLabel(r.from, r.to)}</span>
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
export function WidgetScopePicker({
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
