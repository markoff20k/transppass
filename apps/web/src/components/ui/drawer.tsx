import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  description?: string;
  footer?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}

/**
 * Painel lateral de edição.
 *
 * Editar um registro de tabela abre este painel à direita, sobre a tela —
 * a tabela fica onde está e o contexto não se perde. Fecha no Esc, no véu e
 * no botão; o foco vai para o painel ao abrir e volta ao gatilho ao fechar.
 */
export function Drawer({ open, onClose, title, eyebrow, description, footer, wide, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreRef.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';

    // Primeiro campo ou o botão de fechar recebe o foco.
    const first = panelRef.current?.querySelector<HTMLElement>(
      'input, select, textarea, button:not(.tp-drawer__close)',
    );
    (first ?? panelRef.current?.querySelector<HTMLElement>('.tp-drawer__close'))?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="tp-drawer-scrim" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        className={`tp-drawer${wide ? ' tp-drawer--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tp-drawer-title"
      >
        <header className="tp-drawer__head">
          <div style={{ minWidth: 0 }}>
            {eyebrow && <span className="tp-drawer__eyebrow">{eyebrow}</span>}
            <h2 id="tp-drawer-title" className="tp-drawer__title">
              {title}
            </h2>
            {description && <p className="tp-drawer__desc">{description}</p>}
          </div>
          <button type="button" className="tp-drawer__close" onClick={onClose} aria-label="Fechar painel">
            <X size={18} />
          </button>
        </header>
        <div className="tp-drawer__body">{children}</div>
        {footer && <footer className="tp-drawer__foot">{footer}</footer>}
      </div>
    </>,
    document.body,
  );
}
