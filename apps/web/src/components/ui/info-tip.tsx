import { useId, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';

interface Props {
  /** Rótulo acessível do gatilho, ex.: "O que é Triagem". */
  label: string;
  /** Para onde o painel cresce em relação ao gatilho. */
  align?: 'start' | 'center' | 'end';
  className?: string;
  children: ReactNode;
}

/**
 * Gatilho "i" com painel explicativo. Abre no hover e no foco de teclado;
 * no toque (sem hover) o clique fixa e solta. Esc fecha. O painel é um
 * `role="tooltip"` ligado ao gatilho por aria-describedby.
 */
export function InfoTip({ label, align = 'center', className, children }: Props) {
  const id = useId();
  const [pinned, setPinned] = useState(false);
  return (
    <span
      className={`tp-tip tp-tip--${align}${pinned ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setPinned(false);
      }}
    >
      <button
        type="button"
        className="tp-tip__trigger"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={pinned}
        onClick={() => setPinned((p) => !p)}
        onBlur={() => setPinned(false)}
      >
        <Info size={11} strokeWidth={2.25} aria-hidden />
      </button>
      <span role="tooltip" id={id} className="tp-tip__panel">
        {children}
      </span>
    </span>
  );
}
