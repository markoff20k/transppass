import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { isoOf, makePeriod, monthShort, periodLabel, rangeLabel, todayIso } from '@/lib/period';
import { useI18n } from '@/i18n/i18n.context';

export interface PeriodPanelPreset {
  id: string;
  label: string;
  from: string;
  to: string;
}

export interface PeriodPanelComparison {
  /** Nome curto do período de comparação: "setembro", "3º tri 2026", "período anterior". */
  name: string;
  /** Datas exatas: "1 set – 30 set 2026". */
  range: string;
}

/**
 * O painel de escolha de período, o mesmo em todo o sistema: atalhos à
 * esquerda, a grade de meses e trimestres de um ano, o ano inteiro, um
 * intervalo livre e o rodapé dizendo o que foi escolhido e com que período
 * será comparado. Quem usa (o seletor das telas de consumo, os cartões do
 * Dashboard) decide os atalhos, a regra de validação e a comparação; o
 * painel só devolve as duas datas.
 */
export function PeriodPanel({
  id,
  from,
  to,
  presets,
  onChoose,
  onClose,
  validate,
  compare,
  className,
}: {
  id: string;
  /** Período vigente (AAAA-MM-DD, inclusivo). */
  from: string;
  to: string;
  presets: PeriodPanelPreset[];
  onChoose: (from: string, to: string) => void;
  onClose: () => void;
  /** Mensagem de erro para o intervalo digitado, ou null quando serve. */
  validate: (from: string, to: string) => string | null;
  compare: (from: string, to: string) => PeriodPanelComparison | null;
  className?: string;
}) {
  const { t } = useI18n();
  const today = todayIso();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(Number(from.slice(0, 4)));
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);

  const current = makePeriod(from, to);
  const error = validate(draftFrom, draftTo);
  const draft = error ? null : makePeriod(draftFrom, draftTo);
  const previewing = draft !== null && (draft.from !== current.from || draft.to !== current.to);
  const shown = previewing ? draft : current;
  const cmp = compare(shown.from, shown.to);

  // Mês, trimestre e ano chegam como datas cheias; makePeriod recua o fim até hoje quando é a unidade em curso.
  const pick = (f: string, tt: string) => {
    const p = makePeriod(f, tt);
    onChoose(p.from, p.to);
  };
  const monthStart = (m0: number) => isoOf(year, m0, 1);
  const quarterStart = (q: number) => isoOf(year, (q - 1) * 3, 1);
  const isMonth = (m0: number) => current.kind === 'month' && current.from === monthStart(m0);
  const isQuarter = (q: number) => current.kind === 'quarter' && current.from === quarterStart(q);
  const isYear = current.kind === 'year' && current.from === isoOf(year, 0, 1);
  const currentM0 = Number(today.slice(5, 7)) - 1;
  const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

  return (
    <div id={id} role="dialog" aria-modal="false" aria-label={t.period.choose} className={`period__panel${className ? ` ${className}` : ''}`}>
      <div className="period__panel-head">
        <span>{t.period.title}</span>
        <button type="button" className="period__close" aria-label={t.period.close} onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className="period__body">
        <div className="period__presets" role="group" aria-label={t.period.shortcuts}>
          {presets.map((pr, i) => {
            const active = pr.from === current.from && pr.to === current.to;
            return (
              <button key={pr.id} ref={i === 0 ? first : undefined} type="button" className={`period__preset${active ? ' is-active' : ''}`} aria-pressed={active} onClick={() => onChoose(pr.from, pr.to)}>
                <span>{pr.label}</span>
                <span className="period__preset-range">{rangeLabel(pr.from, pr.to)}</span>
                {active && <Check size={14} aria-hidden className="period__check" />}
              </button>
            );
          })}
        </div>

        <div className="period__cal">
          <div className="period__year">
            <button type="button" className="tp-btn tp-btn--ghost period__step" aria-label={t.period.prevYear} onClick={() => setYear((y) => y - 1)}>
              <ChevronLeft size={16} aria-hidden />
            </button>
            <button
              type="button"
              className={`period__year-label${isYear ? ' is-active' : ''}`}
              aria-pressed={isYear}
              disabled={isoOf(year, 0, 1) > today}
              onClick={() => pick(isoOf(year, 0, 1), isoOf(year, 11, 31))}
              title={fill(t.period.wholeYear, { y: year })}
            >
              {year}
            </button>
            <button type="button" className="tp-btn tp-btn--ghost period__step" aria-label={t.period.nextYear} disabled={year >= thisYear} onClick={() => setYear((y) => y + 1)}>
              <ChevronRight size={16} aria-hidden />
            </button>
          </div>
          <div className="period__months" role="group" aria-label={fill(t.period.monthsOf, { y: year })}>
            {Array.from({ length: 12 }, (_, m0) => (
              <button
                key={m0}
                type="button"
                className={`period__cell${isMonth(m0) ? ' is-active' : ''}${year === thisYear && m0 === currentM0 ? ' is-now' : ''}`}
                aria-pressed={isMonth(m0)}
                disabled={monthStart(m0) > today}
                onClick={() => pick(monthStart(m0), isoOf(year, m0 + 1, 0))}
              >
                {monthShort(m0)}
              </button>
            ))}
          </div>
          <div className="period__quarters" role="group" aria-label={fill(t.period.quartersOf, { y: year })}>
            {([1, 2, 3, 4] as const).map((q) => (
              <button
                key={q}
                type="button"
                className={`period__cell${isQuarter(q) ? ' is-active' : ''}`}
                aria-pressed={isQuarter(q)}
                disabled={quarterStart(q) > today}
                onClick={() => pick(quarterStart(q), isoOf(year, (q - 1) * 3 + 3, 0))}
              >
                {fill(t.period.quarter, { q })}
              </button>
            ))}
          </div>

          <form
            className="period__custom"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft) onChoose(draft.from, draft.to);
            }}
          >
            <span className="period__custom-title">{t.period.customTitle}</span>
            <label className="period__date">
              <span>{t.period.from}</span>
              <input type="date" className="tp-input" value={draftFrom} max={today} onChange={(e) => setDraftFrom(e.target.value)} aria-label={t.period.fromLabel} />
            </label>
            <label className="period__date">
              <span>{t.period.to}</span>
              <input type="date" className="tp-input" value={draftTo} max={today} onChange={(e) => setDraftTo(e.target.value)} aria-label={t.period.toLabel} />
            </label>
            <button type="submit" className="tp-btn tp-btn--primary tp-btn--sm" disabled={!previewing}>
              {t.period.apply}
            </button>
            {error && <span className="period__error" role="alert">{error}</span>}
          </form>
        </div>
      </div>

      <div className={`period__foot${previewing ? ' is-preview' : ''}`}>
        <span>
          <b>{periodLabel(shown)}</b> · {rangeLabel(shown.from, shown.to)} · {shown.days} {shown.days === 1 ? t.period.day : t.period.days}
        </span>
        {cmp && <span className="tp-muted">{fill(t.period.comparesWith, { name: cmp.name, range: cmp.range })}</span>}
      </div>
    </div>
  );
}
