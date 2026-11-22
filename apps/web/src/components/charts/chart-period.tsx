import { useEffect, useId, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { CHART_PERIOD_PRESETS, type ChartPeriod, type ChartPeriodPreset } from '@app/shared';
import { rangeLabel, todayIso } from '@/lib/period';
import { useI18n } from '@/i18n/i18n.context';
import { resolveChartPeriod } from './use-chart-period';

/**
 * Item "Personalizado" de um controle segmentado: o botão e o painel pequeno
 * com de/até e Aplicar. Escolhido, o botão mostra o intervalo. Fecha com Esc
 * ou clique fora. Usado na barra dos gráficos e no período do topo do Dashboard.
 */
export function CustomRangeItem({
  active,
  label,
  from: initialFrom,
  to: initialTo,
  onApply,
}: {
  active: boolean;
  label: string;
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  const today = todayIso();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  useEffect(() => {
    if (!open) return;
    setFrom(initialFrom);
    setTo(initialTo);
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const valid = from <= to && to <= today;
  const changed = valid && (!active || from !== initialFrom || to !== initialTo);

  return (
    <span ref={root} className={`chart-period${open ? ' is-open' : ''}`}>
      <button
        type="button"
        role="radio"
        aria-checked={active}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={`tp-segmented__item${active ? ' is-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <form
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-label={t.dash.chartPeriod.custom}
          className="period__panel chart-period__panel"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onApply(from, to);
            setOpen(false);
          }}
        >
          <div className="period__custom chart-period__custom">
            <span className="period__custom-title">{t.dash.chartPeriod.customTitle}</span>
            <label className="period__date">
              <span>{t.dash.chartPeriod.from}</span>
              <input
                type="date"
                className="tp-input"
                value={from}
                max={today}
                onChange={(e) => setFrom(e.target.value)}
                aria-label={t.dash.chartPeriod.from}
              />
            </label>
            <label className="period__date">
              <span>{t.dash.chartPeriod.to}</span>
              <input
                type="date"
                className="tp-input"
                value={to}
                max={today}
                onChange={(e) => setTo(e.target.value)}
                aria-label={t.dash.chartPeriod.to}
              />
            </label>
            <button type="submit" className="tp-btn tp-btn--primary tp-btn--sm" disabled={!changed}>
              <Check size={14} aria-hidden /> {t.dash.chartPeriod.apply}
            </button>
          </div>
        </form>
      )}
    </span>
  );
}

/**
 * Barra de atalhos do gráfico: Hoje · Ontem · 30 dias · 12 meses · Personalizado,
 * no controle segmentado do sistema.
 */
export function ChartPeriodBar({
  value,
  onChange,
  presets = CHART_PERIOD_PRESETS,
}: {
  value: ChartPeriod;
  onChange: (p: ChartPeriod) => void;
  presets?: readonly ChartPeriodPreset[];
}) {
  const { t } = useI18n();
  const current = resolveChartPeriod(value);
  return (
    <span
      className="tp-segmented chart-period__seg"
      role="radiogroup"
      aria-label={t.dash.chartPeriod.label}
    >
      {presets.map((preset) =>
        preset === 'custom' ? (
          <CustomRangeItem
            key={preset}
            active={value.preset === 'custom'}
            label={
              value.preset === 'custom'
                ? rangeLabel(current.from, current.to)
                : t.dash.chartPeriod.custom
            }
            from={current.from}
            to={current.to}
            onApply={(from, to) => onChange({ preset: 'custom', from, to })}
          />
        ) : (
          <button
            key={preset}
            type="button"
            role="radio"
            aria-checked={value.preset === preset}
            className={`tp-segmented__item${value.preset === preset ? ' is-active' : ''}`}
            onClick={() => onChange({ preset })}
          >
            {t.dash.chartPeriod[preset]}
          </button>
        ),
      )}
    </span>
  );
}
