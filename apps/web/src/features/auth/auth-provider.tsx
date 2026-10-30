import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthResponse, LoginInput, PublicUser } from '@app/shared';
import { useQueryClient } from '@tanstack/react-query';
import { api, onSessionExpired } from '@/lib/api-client';
import { tokenStorage } from '@/lib/token-storage';
import { AuthContext } from './auth.context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const queryClient = useQueryClient();

  // Sessao caiu no meio do uso (token expirado ou revogado): o usuario sai da
  // memoria, a rota protegida manda ao login e o cache nao vaza para o proximo.
  useEffect(
    () =>
      onSessionExpired(() => {
        setUser((current) => {
          if (current) setExpired(true);
          return null;
        });
        queryClient.clear();
      }),
    [queryClient],
  );

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
    setExpired(false);
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
    setExpired(false);
    queryClient.clear();
  }, [queryClient]);

  const updateUser = useCallback((u: PublicUser) => setUser(u), []);

  const value = useMemo(
    () => ({ user, isLoading, expired, login, logout, updateUser }),
    [user, isLoading, expired, login, logout, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
