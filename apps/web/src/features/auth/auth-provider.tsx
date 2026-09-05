import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthResponse, LoginInput, PublicUser } from '@app/shared';
import { api } from '@/lib/api-client';
import { tokenStorage } from '@/lib/token-storage';
import { AuthContext } from './auth.context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Na carga inicial, valida o token guardado contra a API.
  useEffect(() => {
    if (!tokenStorage.get()) {
      setIsLoading(false);
      return;
    }
    api
      .get<PublicUser>('/auth/me')
      .then(setUser)
      .catch(() => tokenStorage.clear())
      .finally(() => setIsLoading(false));
  }, []);

  const handleAuth = useCallback((res: AuthResponse) => {
    tokenStorage.set(res.tokens);
    setUser(res.user);
  }, []);

  const login = useCallback(
    async (input: LoginInput) => {
      handleAuth(await api.post<AuthResponse>('/auth/login', input, { skipAuth: true }));
    },
    [handleAuth],
  );

  const logout = useCallback(async () => {
    const refreshToken = tokenStorage.get()?.refreshToken;
    if (refreshToken) {
      await api.post('/auth/logout', { refreshToken }, { skipAuth: true }).catch(() => {});
    }
    tokenStorage.clear();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, login, logout }),
    [user, isLoading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
