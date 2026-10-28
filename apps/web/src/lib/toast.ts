/**
 * Toasts — a voz curta do sistema.
 *
 * Um store minúsculo fora do React: qualquer mutação (via MutationCache) ou
 * página chama `toast.success('Evento registrado')` e o <Toaster/> do shell
 * mostra. Sem contexto, sem provider: o que acontece no servidor precisa
 * aparecer mesmo quando a tela que disparou já trocou.
 */
export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  /** ms; 0 = fica até fechar */
  duration: number;
  action?: { label: string; href: string };
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(items);
}

function push(tone: ToastTone, title: string, opts: { description?: string; duration?: number; action?: ToastItem['action'] } = {}): number {
  const id = ++seq;
  const duration = opts.duration ?? (tone === 'error' ? 7000 : 4200);
  // A mesma mensagem duas vezes seguidas não vira duas pílulas.
  items = [...items.filter((t) => !(t.title === title && t.tone === tone)), { id, tone, title, description: opts.description, duration, action: opts.action }].slice(-4);
  emit();
  return id;
}

export const toast = {
  success: (title: string, opts?: { description?: string; duration?: number; action?: ToastItem['action'] }) => push('success', title, opts),
  error: (title: string, opts?: { description?: string; duration?: number }) => push('error', title, opts),
  info: (title: string, opts?: { description?: string; duration?: number; action?: ToastItem['action'] }) => push('info', title, opts),
  warning: (title: string, opts?: { description?: string; duration?: number }) => push('warning', title, opts),
  dismiss: (id: number) => {
    items = items.filter((t) => t.id !== id);
    emit();
  },
  subscribe: (l: Listener) => {
    listeners.add(l);
    l(items);
    return () => {
      listeners.delete(l);
    };
  },
};
