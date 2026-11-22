import { useCallback } from 'react';
import type { PublicUser } from '@app/shared';
import { api } from '@/lib/api-client';
import { useAuth } from './use-auth';

/**
 * Estado de interface guardado na conta: cartão recolhido, filtro escolhido,
 * busca digitada, aba, tamanho de página. Fica em preferences.ui, um saco de
 * chaves por pessoa, e volta igual depois de refresh, logoff ou em outro
 * navegador.
 *
 * Como funciona:
 *  - a troca é otimista: a tela muda na hora, pelo usuário em memória;
 *  - a gravação vai em lote: várias chaves mudadas em sequência (busca,
 *    filtro, página) viram um PATCH só, meio segundo depois da última;
 *  - o último valor conhecido fica num mapa deste módulo, por pessoa, para
 *    duas trocas no mesmo instante não se atropelarem;
 *  - se o servidor recusar, a tela segue com o valor novo até a próxima
 *    carga, quando volta o que estava salvo.
 *
 * Chaves: "<tela>.<campo>" ("os.search", "frota.status", "pageSize.eventos",
 * "collapsed.dash.flow"). Só estado que a pessoa quer reencontrar: filtros,
 * buscas, ordenação, aba, visão, tamanho de página, cartão recolhido. Nunca
 * modal aberto, formulário em edição ou rascunho.
 */
const DEBOUNCE_MS = 500;

type Ui = Record<string, unknown>;
let latest: { userId: string; ui: Ui } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function current(user: PublicUser): Ui {
  if (latest && latest.userId === user.id) return latest.ui;
  return (user.preferences.ui as Ui) ?? {};
}

function schedule(user: PublicUser, ui: Ui) {
  latest = { userId: user.id, ui };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const snapshot = latest;
    if (!snapshot) return;
    api
      .patch<PublicUser>('/users/me/preferences', { ui: snapshot.ui })
      .then((saved) => {
        // O que outra aba gravou no meio entra; o que esta aba mudou depois do envio vence.
        latest = {
          userId: saved.id,
          ui: {
            ...(saved.preferences.ui as Ui),
            ...(latest?.userId === saved.id ? latest.ui : {}),
          },
        };
      })
      .catch(() => {
        /* fica o valor otimista até a próxima carga */
      });
  }, DEBOUNCE_MS);
}

export function readUiPref<T>(user: PublicUser | null, key: string, fallback: T): T {
  if (!user) return fallback;
  const value = current(user)[key];
  return value === undefined ? fallback : (value as T);
}

/**
 * Como useState, mas o valor fica salvo na conta. Aceita atualização por
 * função (`set((v) => !v)`), como o useState.
 */
export function useUiPref<T>(key: string, fallback: T): [T, (value: T | ((prev: T) => T)) => void] {
  const { user, updateUser } = useAuth();
  const value = readUiPref(user, key, fallback);
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      if (!user) return;
      const ui = current(user);
      const prev = (ui[key] === undefined ? fallback : ui[key]) as T;
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      if (Object.is(resolved, prev)) return;
      const nextUi = { ...ui, [key]: resolved };
      updateUser({ ...user, preferences: { ...user.preferences, ui: nextUi } });
      schedule(user, nextUi);
    },
    [user, key, fallback, updateUser],
  );
  return [value, set];
}

/** Nome mais direto para o uso em filtros e buscas das telas. */
export const useUiState = useUiPref;
