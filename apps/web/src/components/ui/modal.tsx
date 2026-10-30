import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  footer?: ReactNode;
  /** Largura máxima do cartão; padrão 560 px. */
  width?: number;
  children: ReactNode;
}

/**
 * Caixa de diálogo central para decisões curtas (escolher atalhos, confirmar).
 * Fecha no Esc, no véu e no X; o foco entra no diálogo e volta ao gatilho.
 * Para edição longa de um registro, o Drawer continua sendo o lugar.
 */
export function Modal({ open, onClose, title, description, footer, width = 560, children }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    const first = boxRef.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.tp-modal__close)');
    (first ?? boxRef.current?.querySelector<HTMLElement>('.tp-modal__close'))?.focus();
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
    <div className="tp-modal-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={boxRef} className="tp-modal" role="dialog" aria-modal="true" aria-labelledby="tp-modal-title" style={{ maxWidth: width }}>
        <header className="tp-modal__head">
          <div>
            <h2 id="tp-modal-title" className="tp-modal__title">{title}</h2>
            {description && <p className="tp-modal__desc">{description}</p>}
          </div>
          <button type="button" className="tp-modal__close" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>
        <div className="tp-modal__body">{children}</div>
        {footer && <footer className="tp-modal__foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
