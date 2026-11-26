import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Bot, Repeat2, Undo2 } from 'lucide-react';
import { useI18n } from '@/i18n/i18n.context';
import { IaName } from '@/features/ia/ia-mark';

/**
 * Cartão de KPI que vira: na frente o número, no verso o porquê — a leitura
 * da ia.Transppass em uma frase e duas ou três linhas de apoio. Mesmo efeito
 * dos cartões do Dashboard, no tile padrão do sistema (.tp-kpi): a frente dita
 * a altura, o verso ocupa a mesma caixa e gira no eixo vertical. O ícone de
 * virar é fixo, na linha do rótulo, e nunca fica sobre texto. Sem `back`, é um
 * tile comum.
 */
export function FlipKpi({
  className,
  label,
  icon,
  children,
  back,
  backTo,
  backLabel,
  onOpen,
}: {
  className?: string;
  label: string;
  /** Ícone antes do rótulo (combustível, energia). */
  icon?: ReactNode;
  children: ReactNode;
  back?: ReactNode;
  /** Tela onde o assunto do verso se resolve; ou uma ação na própria página. */
  backTo?: string;
  backLabel?: string;
  onOpen?: () => void;
}) {
  const { t } = useI18n();
  const [flipped, setFlipped] = useState(false);
  const cls = `tp-kpi${className ? ` ${className}` : ''}`;
  const title = (
    <span className="tp-kpi__label">
      {icon}
      {label}
    </span>
  );
  if (!back) {
    return (
      <div className={cls}>
        {title}
        {children}
      </div>
    );
  }
  const toggle = () => setFlipped((f) => !f);
  const openProps = {
    className: 'kpi-back__open',
    title: backLabel,
    'aria-label': backLabel,
    tabIndex: flipped ? 0 : -1,
  };
  return (
    <div className={`${cls} tp-kpi--flip${flipped ? ' is-flipped' : ''}`}>
      <div className="tp-kpi__inner">
        <div
          className="tp-kpi__face tp-kpi__face--front"
          role="button"
          tabIndex={flipped ? -1 : 0}
          aria-hidden={flipped}
          aria-label={`${label}. ${t.dash.back.flip}`}
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          }}
        >
          <span className="tp-kpi__head">
            {title}
            <span className="tp-kpi__flipmark" aria-hidden title={t.dash.back.flip}>
              <Repeat2 size={11} />
            </span>
          </span>
          {children}
        </div>
        <div className="tp-kpi__face tp-kpi__face--back" aria-hidden={!flipped}>
          <span className="tp-kpi__head">
            {title}
            <span className="tp-kpi__back-actions">
              {backTo ? (
                <Link to={backTo} {...openProps} onClick={(e) => e.stopPropagation()}>
                  <ArrowUpRight size={14} aria-hidden />
                </Link>
              ) : onOpen ? (
                <button
                  type="button"
                  {...openProps}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen();
                  }}
                >
                  <ArrowUpRight size={14} aria-hidden />
                </button>
              ) : null}
              <button
                type="button"
                className="tp-kpi__unflip"
                onClick={toggle}
                tabIndex={flipped ? 0 : -1}
                aria-label={t.dash.back.flipBack}
                title={t.dash.back.flipBack}
              >
                <Undo2 size={14} aria-hidden />
              </button>
            </span>
          </span>
          {back}
        </div>
      </div>
    </div>
  );
}

/**
 * A frase da ia.Transppass no verso: o que o número está dizendo, escrita a
 * partir do próprio dado da tela (nada é inventado), assinada pelo robô.
 */
export function KpiAi({ children }: { children: ReactNode }) {
  return (
    <p className="kpi-ai">
      <Bot size={12} aria-hidden />
      <span>
        <IaName /> {children}
      </span>
    </p>
  );
}

export interface BackRowItem {
  label: string;
  value: string;
  tone?: 'danger' | 'warn' | 'neutral';
}

/** As linhas de apoio do verso: rótulo à esquerda, valor à direita. */
export function BackRows({ rows }: { rows: BackRowItem[] }) {
  return (
    <ul className="kpi-back__list">
      {rows.map((r) => (
        <li key={r.label} className={`kpi-back__row${r.tone ? ` kpi-back__row--${r.tone}` : ''}`}>
          <span className="kpi-back__label">{r.label}</span>
          <span className="kpi-back__value">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** "+3,2%" / "−1,0%" entre dois valores; nulo quando não dá para comparar. */
export function pctChange(current: number | null, previous: number | null): string | null {
  if (current === null || previous === null || previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1).replace('.', ',')}%`;
}

/** "dd/mm" de uma data ISO. */
export const shortDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
