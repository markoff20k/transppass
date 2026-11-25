import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  canStepForward,
  comparisonOf,
  isDefaultPeriod,
  isoOf,
  makePeriod,
  monthPeriod,
  monthShort,
  periodLabel,
  periodPresets,
  quarterPeriod,
  rangeLabel,
  samePeriod,
  stepPeriod,
  todayIso,
  usePeriod,
  validateRange,
  yearPeriod,
  type Period,
} from '@/lib/period';

/**
 * Seletor de período das telas de consumo.
 *
 * No cabeçalho: setas que andam na unidade do período (um mês, um trimestre,
 * um ano, ou os mesmos N dias) e o botão com o nome e as datas exatas, que
 * abre o painel. No painel: atalhos, a grade de meses e trimestres de um ano,
 * um intervalo livre, e o rodapé dizendo com que período a comparação será
 * feita — para "vs setembro" nunca ser uma surpresa.
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
          <PeriodPanel id={panelId} period={period} onChoose={choose} onClose={close} />
        </>
      )}
    </div>
  );
}

function PeriodPanel({ id, period, onChoose, onClose }: { id: string; period: Period; onChoose: (p: Period) => void; onClose: () => void }) {
  const today = todayIso();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(Number(period.from.slice(0, 4)));
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);

  const presets = periodPresets();
  const error = validateRange(from, to);
  const draft = error ? null : makePeriod(from, to);
  const previewing = draft !== null && !samePeriod(draft, period);
  const shown = previewing ? draft : period;
  const cmp = comparisonOf(shown);

  const monthStart = (m0: number) => isoOf(year, m0, 1);
  const quarterStart = (q: number) => isoOf(year, (q - 1) * 3, 1);
  const isMonth = (m0: number) => period.kind === 'month' && period.from === monthStart(m0);
  const isQuarter = (q: number) => period.kind === 'quarter' && period.from === quarterStart(q);
  const isYear = period.kind === 'year' && period.from === isoOf(year, 0, 1);
  const currentM0 = Number(today.slice(5, 7)) - 1;

  return (
    <div id={id} role="dialog" aria-modal="false" aria-label="Escolher período" className="period__panel">
      <div className="period__panel-head">
        <span>Período de análise</span>
        <button type="button" className="period__close" aria-label="Fechar" onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className="period__body">
        <div className="period__presets" role="group" aria-label="Atalhos">
          {presets.map((pr, i) => {
            const p = pr.make();
            const active = samePeriod(p, period);
            return (
              <button key={pr.id} ref={i === 0 ? first : undefined} type="button" className={`period__preset${active ? ' is-active' : ''}`} aria-pressed={active} onClick={() => onChoose(p)}>
                <span>{pr.label}</span>
                <span className="period__preset-range">{rangeLabel(p.from, p.to)}</span>
                {active && <Check size={14} aria-hidden className="period__check" />}
              </button>
            );
          })}
        </div>

        <div className="period__cal">
          <div className="period__year">
            <button type="button" className="tp-btn tp-btn--ghost period__step" aria-label="Ano anterior" onClick={() => setYear((y) => y - 1)}>
              <ChevronLeft size={16} aria-hidden />
            </button>
            <button type="button" className={`period__year-label${isYear ? ' is-active' : ''}`} aria-pressed={isYear} disabled={isoOf(year, 0, 1) > today} onClick={() => onChoose(yearPeriod(year))} title={`Ano inteiro de ${year}`}>
              {year}
            </button>
            <button type="button" className="tp-btn tp-btn--ghost period__step" aria-label="Próximo ano" disabled={year >= thisYear} onClick={() => setYear((y) => y + 1)}>
              <ChevronRight size={16} aria-hidden />
            </button>
          </div>
          <div className="period__months" role="group" aria-label={`Meses de ${year}`}>
            {Array.from({ length: 12 }, (_, m0) => (
              <button
                key={m0}
                type="button"
                className={`period__cell${isMonth(m0) ? ' is-active' : ''}${year === thisYear && m0 === currentM0 ? ' is-now' : ''}`}
                aria-pressed={isMonth(m0)}
                disabled={monthStart(m0) > today}
                onClick={() => onChoose(monthPeriod(year, m0))}
              >
                {monthShort(m0)}
              </button>
            ))}
          </div>
          <div className="period__quarters" role="group" aria-label={`Trimestres de ${year}`}>
            {([1, 2, 3, 4] as const).map((q) => (
              <button key={q} type="button" className={`period__cell${isQuarter(q) ? ' is-active' : ''}`} aria-pressed={isQuarter(q)} disabled={quarterStart(q) > today} onClick={() => onChoose(quarterPeriod(year, q))}>
                {q}º tri
              </button>
            ))}
          </div>

          <form
            className="period__custom"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft) onChoose(draft);
            }}
          >
            <span className="period__custom-title">Intervalo livre</span>
            <label className="period__date">
              <span>de</span>
              <input type="date" className="tp-input" value={from} max={today} onChange={(e) => setFrom(e.target.value)} aria-label="Data inicial" />
            </label>
            <label className="period__date">
              <span>até</span>
              <input type="date" className="tp-input" value={to} max={today} onChange={(e) => setTo(e.target.value)} aria-label="Data final" />
            </label>
            <button type="submit" className="tp-btn tp-btn--primary tp-btn--sm" disabled={!previewing}>
              Aplicar
            </button>
            {error && <span className="period__error" role="alert">{error}</span>}
          </form>
        </div>
      </div>

      <div className={`period__foot${previewing ? ' is-preview' : ''}`}>
        <span>
          <b>{periodLabel(shown)}</b> · {rangeLabel(shown.from, shown.to)} · {shown.days} {shown.days === 1 ? 'dia' : 'dias'}
        </span>
        <span className="tp-muted">compara com {cmp.name}: {cmp.range}</span>
      </div>
    </div>
  );
}
