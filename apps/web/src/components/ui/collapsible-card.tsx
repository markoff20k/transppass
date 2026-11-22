import type { ReactNode } from 'react';
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
  label,
  children,
}: {
  /** Chave única da preferência, ex.: "dash.flow". */
  id: string;
  className?: string;
  headClassName?: string;
  head: ReactNode;
  label?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useUiPref<boolean>(`collapsed.${id}`, false);
  const title = collapsed ? t.dash.expand : t.dash.collapse;
  return (
    <section
      className={`ccard${className ? ` ${className}` : ''}${collapsed ? ' is-collapsed' : ''}`}
      aria-label={label}
    >
      <div className={`ccard__head${headClassName ? ` ${headClassName}` : ''}`}>
        {head}
        <button
          type="button"
          className="ccard__toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
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
