import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useI18n } from '@/i18n/i18n.context';
import { useUiPref } from '@/features/auth/use-ui-pref';

/**
 * Cartão que recolhe e expande pelo botão no canto do cabeçalho. O estado
 * fica salvo na conta (preferences.ui), por isso volta igual depois de
 * refresh, logoff ou em outro navegador. Recolhido, só o cabeçalho fica, com
 * o que ele carrega (título, legenda, filtros); o corpo some com animação de
 * altura e sai da ordem de tabulação.
 */
export function CollapsibleCard({
  id,
  className,
  headClassName,
  head,
  grip,
  label,
  children,
}: {
  /** Chave única da preferência, ex.: "dash.flow". */
  id: string;
  className?: string;
  headClassName?: string;
  head: ReactNode;
  /** Alça de arrastar (vem do SortableCards), antes do título. */
  grip?: ReactNode;
  label?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useUiPref<boolean>(`collapsed.${id}`, false);
  const title = collapsed ? t.dash.expand : t.dash.collapse;
  // Durante a animação de altura o corpo precisa de overflow: hidden; depois,
  // aberto, fica livre, para menus e painéis do conteúdo passarem da borda.
  const [animating, setAnimating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggle = () => {
    setAnimating(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAnimating(false), 360);
    setCollapsed(!collapsed);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <section
      className={`ccard${className ? ` ${className}` : ''}${collapsed ? ' is-collapsed' : ''}${animating ? ' is-animating' : ''}`}
      aria-label={label}
    >
      <div className={`ccard__head${headClassName ? ` ${headClassName}` : ''}`}>
        {grip}
        {head}
        <button
          type="button"
          className="tp-btn tp-btn--ghost tp-btn--sm ccard__toggle"
          aria-expanded={!collapsed}
          onClick={toggle}
          title={title}
          aria-label={title}
        >
          <ChevronDown size={16} aria-hidden />
        </button>
      </div>
      <div className="ccard__body" aria-hidden={collapsed}>
        <div className="ccard__inner" inert={collapsed || undefined}>
          {children}
        </div>
      </div>
    </section>
  );
}
