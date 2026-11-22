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
  /**
   * Avisa quando OUTRA aba mexeu nos tokens: entrou (tokens novos), saiu ou
   * teve a sessão derrubada (tokens limpos). O evento "storage" só dispara
   * nas abas que não fizeram a mudança.
   */
  subscribe(listener: (tokens: AuthTokens | null) => void): () => void {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY && e.key !== null) return;
      listener(tokenStorage.get());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  },
};
