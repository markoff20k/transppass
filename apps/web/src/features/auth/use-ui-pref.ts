import { useCallback } from 'react';
import type { PublicUser } from '@app/shared';
import { api } from '@/lib/api-client';
import { useAuth } from './use-auth';

/**
 * Estado de interface guardado na conta: cartão recolhido, filtro escolhido,
 * tamanho de página. Fica em preferences.ui, um saco de chaves, e volta igual
 * depois de refresh, logoff ou em outro navegador.
 *
 * A troca é otimista (a tela muda na hora) e a gravação vai em lote: várias
 * chaves mudadas em sequência viram um PATCH só, meio segundo depois da
 * última. Se o servidor recusar, a tela segue com o valor novo até a próxima
 * carga, quando volta o que estava salvo.
 */
const DEBOUNCE_MS = 500;
let pending: Record<string, unknown> = {};
let timer: ReturnType<typeof setTimeout> | null = null;
let flushWith: ((ui: Record<string, unknown>) => void) | null = null;

function schedule(ui: Record<string, unknown>) {
  pending = ui;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const batch = pending;
    pending = {};
    api
      .patch<PublicUser>('/users/me/preferences', { ui: batch })
      .then((saved) => flushWith?.(saved.preferences.ui))
      .catch(() => {
        /* fica o valor otimista até a próxima carga */
      });
  }, DEBOUNCE_MS);
}

export function readUiPref<T>(user: PublicUser | null, key: string, fallback: T): T {
  const ui = user?.preferences.ui as Record<string, unknown> | undefined;
  const value = ui?.[key];
  return value === undefined ? fallback : (value as T);
}

export function useUiPref<T>(key: string, fallback: T): [T, (value: T) => void] {
  const { user, updateUser } = useAuth();
  const value = readUiPref(user, key, fallback);
  const set = useCallback(
    (next: T) => {
      if (!user) return;
      const ui = { ...(user.preferences.ui as Record<string, unknown>), [key]: next };
      updateUser({ ...user, preferences: { ...user.preferences, ui } });
      flushWith = (saved) =>
        updateUser({ ...user, preferences: { ...user.preferences, ui: { ...ui, ...saved } } });
      schedule(ui);
    },
    [user, key, updateUser],
  );
  return [value, set];
}
