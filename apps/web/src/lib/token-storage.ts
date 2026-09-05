import type { AuthTokens } from '@app/shared';

const KEY = 'app.auth.tokens';

/**
 * Ponto unico de acesso aos tokens. Trocar por cookie httpOnly
 * mais adiante significa mexer so neste arquivo.
 */
export const tokenStorage = {
  get(): AuthTokens | null {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as AuthTokens) : null;
    } catch {
      return null;
    }
  },
  set(tokens: AuthTokens): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(tokens));
    } catch {
      /* modo privado / storage bloqueado */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nada a fazer */
    }
  },
};
