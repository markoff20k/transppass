import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatMonth, parseMonth, toMonth, useReferenceMonth } from '@/lib/month';

/** Navegação do mês de referência (?mes=AAAA-MM): anterior, próximo e "mês atual". */
export function MonthControl() {
  const [month, setMonth] = useReferenceMonth();
  const label = formatMonth(month);
  return (
    <div className="month-nav" role="group" aria-label="Mês de referência">
      <button
        type="button"
        className="tp-btn tp-btn--ghost month-nav__step"
        aria-label="Mês anterior"
        onClick={() => setMonth(toMonth(month.year, month.month - 1))}
      >
        <ChevronLeft size={18} aria-hidden />
      </button>
      <span className="month-nav__label" aria-live="polite">
        {label.charAt(0).toUpperCase() + label.slice(1)}
      </span>
      <button
        type="button"
        className="tp-btn tp-btn--ghost month-nav__step"
        aria-label="Próximo mês"
        disabled={month.isCurrent}
        onClick={() => setMonth(toMonth(month.year, month.month + 1))}
      >
        <ChevronRight size={18} aria-hidden />
      </button>
      {!month.isCurrent && (
        <button type="button" className="tp-btn tp-btn--ghost month-nav__now" onClick={() => setMonth(parseMonth(null))}>
          Mês atual
        </button>
      )}
    </div>
  );
}
