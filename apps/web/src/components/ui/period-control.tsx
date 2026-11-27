import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  canStepForward,
  comparisonOf,
  isDefaultPeriod,
  makePeriod,
  periodLabel,
  periodPresets,
  rangeLabel,
  stepPeriod,
  usePeriod,
  validateRange,
  type Period,
} from '@/lib/period';
import { PeriodPanel, type PeriodPanelPreset } from './period-panel';

/**
 * Seletor de período das telas de consumo.
 *
 * No cabeçalho: setas que andam na unidade do período (um mês, um trimestre,
 * um ano, ou os mesmos N dias) e o botão com o nome e as datas exatas, que
 * abre o painel. O painel é o `PeriodPanel` comum a todo o sistema; aqui
 * entram os atalhos de consumo, o limite de 13 meses e a comparação que a
 * API usa — para "vs setembro" nunca ser uma surpresa.
 */
export function PeriodControl() {
  const [period, setPeriod] = usePeriod();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

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

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = (p: Period) => {
    setPeriod(p);
    close();
  };
  const presets: PeriodPanelPreset[] = periodPresets().map((pr) => {
    const p = pr.make();
    return { id: pr.id, label: pr.label, from: p.from, to: p.to };
  });

  return (
    <div ref={root} className={`period${open ? ' is-open' : ''}`}>
      <button type="button" className="tp-btn tp-btn--ghost period__step" aria-label="Período anterior" onClick={() => setPeriod(stepPeriod(period, -1))}>
        <ChevronLeft size={18} aria-hidden />
      </button>
      <button ref={trigger} type="button" className="period__trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen((o) => !o)}>
        <CalendarDays size={15} aria-hidden className="period__icon" />
        <span className="period__text">
          <span className="period__label">
            {periodLabel(period)}
            {period.isCurrent && <small>até hoje</small>}
          </span>
          <span className="period__range">
            {rangeLabel(period.from, period.to)} · {period.days} {period.days === 1 ? 'dia' : 'dias'}
          </span>
        </span>
        <ChevronDown size={14} aria-hidden className="period__chevron" />
      </button>
      <button type="button" className="tp-btn tp-btn--ghost period__step" aria-label="Próximo período" disabled={!canStepForward(period)} onClick={() => setPeriod(stepPeriod(period, 1))}>
        <ChevronRight size={18} aria-hidden />
      </button>
      {!isDefaultPeriod(period) && (
        <button type="button" className="tp-btn tp-btn--ghost period__now" onClick={() => choose(periodPresets()[0]!.make())}>
          Este mês
        </button>
      )}
      {open && (
        <>
          <div className="period__backdrop" onClick={close} aria-hidden />
          <PeriodPanel
            id={panelId}
            from={period.from}
            to={period.to}
            presets={presets}
            onChoose={(f, t) => choose(makePeriod(f, t))}
            onClose={close}
            validate={validateRange}
            compare={(f, t) => comparisonOf(makePeriod(f, t))}
          />
        </>
      )}
    </div>
  );
}

