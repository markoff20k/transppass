import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast, type ToastItem } from '@/lib/toast';
import { useAuth } from '@/features/auth/use-auth';

/**
 * Pilha de toasts no canto inferior direito. Região `aria-live` para o leitor
 * de tela anunciar; passar o mouse pausa o relógio; Esc fecha o mais recente.
 */
export function Toaster() {
  const { user } = useAuth();
  const position = user?.preferences.toastPosition ?? 'bottom-right';
  const [list, setList] = useState<ToastItem[]>([]);
  useEffect(() => toast.subscribe(setList), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && list.length) toast.dismiss(list[list.length - 1]!.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [list]);

  return (
    <div className={`tp-toaster tp-toaster--${position}`} role="region" aria-label="Notificações">
      <div aria-live="polite" aria-atomic="false">
        {list.map((t) => <ToastCard key={t.id} item={t} />)}
      </div>
    </div>
  );
}

const ICON: Record<ToastItem['tone'], string> = {
  success: 'M5 12.5l4 4L19 7',
  error: 'M6 6l12 12M18 6L6 18',
  info: 'M12 8h.01M12 11v6',
  warning: 'M12 8v5M12 17h.01',
};

function ToastCard({ item }: { item: ToastItem }) {
  const [paused, setPaused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const remaining = useRef(item.duration);
  const started = useRef(Date.now());

  useEffect(() => {
    if (item.duration === 0 || paused) return;
    started.current = Date.now();
    const timer = setTimeout(() => setLeaving(true), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(400, remaining.current - (Date.now() - started.current));
    };
  }, [paused, item.duration]);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => toast.dismiss(item.id), 180);
    return () => clearTimeout(t);
  }, [leaving, item.id]);

  return (
    <div
      className={`tp-toast tp-toast--${item.tone}${leaving ? ' is-leaving' : ''}`}
      role={item.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className="tp-toast__icon" aria-hidden>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[item.tone]} /></svg>
      </span>
      <div className="tp-toast__body">
        <strong className="tp-toast__title">{item.title}</strong>
        {item.description && <span className="tp-toast__desc">{item.description}</span>}
        {item.action && <Link to={item.action.href} className="tp-toast__action" onClick={() => toast.dismiss(item.id)}>{item.action.label}</Link>}
      </div>
      <button type="button" className="tp-toast__close" aria-label="Fechar" onClick={() => setLeaving(true)}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      {item.duration > 0 && <i className="tp-toast__bar" style={{ animationDuration: `${item.duration}ms`, animationPlayState: paused ? 'paused' : 'running' }} />}
    </div>
  );
}
