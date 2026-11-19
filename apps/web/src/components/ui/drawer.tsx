import { useContext, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMutation } from '@tanstack/react-query';
import { AppWindow, PanelRight, X } from 'lucide-react';
import type { PanelLayout, PublicUser } from '@app/shared';
import { api } from '@/lib/api-client';
import { AuthContext } from '@/features/auth/auth.context';
import { useI18n } from '@/i18n/i18n.context';

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
 * Painel de edição.
 *
 * Editar um registro de tabela abre este painel sobre a tela — a tabela fica
 * onde está e o contexto não se perde. Por padrão ele encosta à direita; quem
 * prefere a janela clássica troca no próprio cabeçalho para o modo central, e
 * a escolha fica na conta (segue a pessoa de uma máquina a outra). O mesmo
 * elemento muda só de classe, então o que já foi digitado não se perde.
 * Fecha no Esc, no véu e no botão; o foco entra no painel e volta ao gatilho.
 */
export function Drawer({ open, onClose, title, eyebrow, description, footer, wide, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const { t } = useI18n();
  const [layout, setLayout] = usePanelLayout();
  const centered = layout === 'center';

  useEffect(() => {
    if (!open) return;

    restoreRef.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';

    // Primeiro campo ou o botão de fechar recebe o foco.
    const first = panelRef.current?.querySelector<HTMLElement>(
      'input, select, textarea, button:not(.tp-drawer__close):not(.tp-drawer__layout-btn)',
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
      <div className={`tp-drawer-scrim${centered ? ' tp-drawer-scrim--center' : ''}`} onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        className={`tp-drawer${wide ? ' tp-drawer--wide' : ''}${centered ? ' tp-drawer--center' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tp-drawer-title"
        data-layout={layout}
      >
        <header className="tp-drawer__head">
          <div style={{ minWidth: 0 }}>
            {eyebrow && <span className="tp-drawer__eyebrow">{eyebrow}</span>}
            <h2 id="tp-drawer-title" className="tp-drawer__title">
              {title}
            </h2>
            {description && <p className="tp-drawer__desc">{description}</p>}
          </div>
          <div className="tp-drawer__tools">
            <div className="tp-drawer__layout" role="group" aria-label={t.panel.layout}>
              <button
                type="button"
                className={`tp-drawer__layout-btn${centered ? '' : ' is-active'}`}
                aria-pressed={!centered}
                title={t.panel.side}
                aria-label={t.panel.side}
                onClick={() => setLayout('side')}
              >
                <PanelRight size={15} />
              </button>
              <button
                type="button"
                className={`tp-drawer__layout-btn${centered ? ' is-active' : ''}`}
                aria-pressed={centered}
                title={t.panel.center}
                aria-label={t.panel.center}
                onClick={() => setLayout('center')}
              >
                <AppWindow size={15} />
              </button>
            </div>
            <button type="button" className="tp-drawer__close" onClick={onClose} aria-label={t.panel.close} title={t.panel.close}>
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="tp-drawer__body">{children}</div>
        {footer && <footer className="tp-drawer__foot">{footer}</footer>}
      </div>
    </>,
    document.body,
  );
}

/**
 * Preferência de posição do painel. Lê da conta; ao trocar, aplica na hora
 * (otimista) e grava em segundo plano — se a gravação falhar, volta.
 */
function usePanelLayout(): [PanelLayout, (next: PanelLayout) => void] {
  const auth = useContext(AuthContext);
  const { t } = useI18n();
  const user = auth?.user ?? null;
  const layout: PanelLayout = user?.preferences.panelLayout ?? 'side';

  const save = useMutation({
    mutationFn: (panelLayout: PanelLayout) => api.patch<PublicUser>('/users/me/preferences', { panelLayout }),
    meta: { success: t.panel.saved },
    onSuccess: (u) => auth?.updateUser(u),
    onError: () => {
      if (user) auth?.updateUser(user);
    },
  });

  const setLayout = (next: PanelLayout) => {
    if (next === layout) return;
    if (user) auth?.updateUser({ ...user, preferences: { ...user.preferences, panelLayout: next } });
    save.mutate(next);
  };

  return [layout, setLayout];
}
