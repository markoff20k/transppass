import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bus, CalendarDays, Check, ChevronDown, Search } from 'lucide-react';
import { consumptionSpanDays } from '@app/shared';
import type { DashboardVehicle, DashboardWidget, WidgetPeriod, WidgetPeriodPreset } from '@app/shared';
import { formatMinutes, formatNumber } from '@/lib/format';
import { isoOf, makePeriod, periodLabel, rangeLabel, shiftDays, todayIso } from '@/lib/period';
import { PeriodPanel, type PeriodPanelPreset } from '@/components/ui/period-panel';
import { useI18n } from '@/i18n/i18n.context';

export const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export const PRESETS: WidgetPeriodPreset[] = [
  'today',
  'yesterday',
  'd2',
  'last7',
  'last30',
  'last90',
  'thisMonth',
  'lastMonth',
  'thisQuarter',
  'thisYear',
];

/** Intervalo livre mais longo que um cartão aceita: um ano, que já vai por mês no gráfico. */
const WIDGET_MAX_DAYS = 366;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

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
    case 'last90':
      return { from: shiftDays(today, -89), to: today };
    case 'thisMonth':
      return { from: isoOf(y, m0, 1), to: today };
    case 'lastMonth':
      return { from: isoOf(y, m0 - 1, 1), to: isoOf(y, m0, 0) };
    case 'thisQuarter':
      return { from: isoOf(y, Math.floor(m0 / 3) * 3, 1), to: today };
    case 'thisYear':
      return { from: isoOf(y, 0, 1), to: today };
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
 * Seletor de período do widget: o gatilho é pequeno, do tamanho do cartão, e
 * o painel é o mesmo `PeriodPanel` das telas de consumo (atalhos, meses,
 * trimestres, ano, intervalo livre, rodapé com a comparação). O painel vai
 * para o <body> por portal: não é cortado pela borda do cartão, escolhe se
 * abre para baixo ou para cima conforme o espaço, e no celular vira folha
 * inferior. Escolhas que coincidem com um atalho ficam gravadas como atalho
 * (o cartão segue "andando" com o calendário); mês, trimestre e ano fechados
 * ficam como intervalo com datas. Com `label`, o gatilho mostra esse texto em
 * vez do período (o "aplicar a todos" da seção).
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
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; left?: number } | null>(null);
  const panelId = useId();
  const { from, to } = resolveWidgetPeriod(value);
  const shownLabel =
    value.preset === 'custom' ? periodLabel(makePeriod(from, to)) : t.dash.widgets.period[value.preset];
  const presets: PeriodPanelPreset[] = PRESETS.map((preset) => {
    const r = resolveWidgetPeriod({ preset });
    return { id: preset, label: t.dash.widgets.period[preset], from: r.from, to: r.to };
  });
  // Duas datas que batem com um atalho viram o atalho; o resto é intervalo livre.
  const toWidgetPeriod = (f: string, tt: string): WidgetPeriod => {
    const hit = presets.find((pr) => pr.from === f && pr.to === tt);
    return hit ? { preset: hit.id as WidgetPeriodPreset } : { preset: 'custom', from: f, to: tt };
  };
  const validate = (f: string, tt: string): string | null => {
    if (!ISO_DAY.test(f) || !ISO_DAY.test(tt)) return t.period.errors.both;
    if (tt > todayIso()) return t.period.errors.future;
    if (f > tt) return t.period.errors.order;
    if (consumptionSpanDays(f, tt) > WIDGET_MAX_DAYS) return t.dash.widgets.period.tooLong;
    return null;
  };
  // A mesma janela que a API compara: os N dias imediatamente anteriores.
  const compare = (f: string, tt: string) => {
    const n = consumptionSpanDays(f, tt);
    return { name: t.dash.widgets.period.previous, range: rangeLabel(shiftDays(f, -n), shiftDays(f, -1)) };
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (root.current && !root.current.contains(target) && !pop.current?.contains(target)) setOpen(false);
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

  // Posição do painel: alinhado à esquerda do gatilho, dentro da janela; abre
  // para cima quando não cabe embaixo. No celular o CSS o leva ao rodapé.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = trigger.current?.getBoundingClientRect();
      if (!r) return;
      if (window.matchMedia('(max-width: 760px)').matches) {
        setPos({});
        return;
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(640, vw - 32);
      const left = Math.max(16, Math.min(r.left, vw - width - 16));
      const height = pop.current?.offsetHeight ?? 460;
      // Embaixo quando cabe; em cima quando só cabe em cima; senão desce o quanto der, mesmo
      // cobrindo o gatilho, e nunca sai da janela.
      const top = vh - r.bottom - 8 >= height ? r.bottom + 6 : r.top - 8 >= height ? r.top - 6 - height : Math.max(16, vh - height - 16);
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = (p: WidgetPeriod) => {
    onChange(p);
    close();
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
        title={title ?? `${shownLabel} · ${rangeLabel(from, to)}`}
        onClick={() => setOpen((o) => !o)}
      >
        <CalendarDays size={13} aria-hidden className="wperiod__icon" />
        <span className="wperiod__label">{label ?? shownLabel}</span>
        <ChevronDown size={12} aria-hidden className="wperiod__chevron" />
      </button>
      {open &&
        createPortal(
          <>
            <div className="period__backdrop" onClick={close} aria-hidden />
            <div ref={pop} className="wperiod__pop" style={pos ?? undefined}>
              <PeriodPanel
                id={panelId}
                from={from}
                to={to}
                presets={presets}
                onChoose={(f, tt) => choose(toWidgetPeriod(f, tt))}
                onClose={close}
                validate={validate}
                compare={compare}
                className="wperiod__panel"
              />
            </div>
          </>,
          document.body,
        )}
    </span>
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
