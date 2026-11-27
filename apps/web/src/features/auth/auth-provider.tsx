import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthResponse, LoginInput, PublicUser } from '@app/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, SERVER_DOWN, SERVER_UNREACHABLE, api, onPasswordChangeRequired, onSessionExpired } from '@/lib/api-client';
import { tokenStorage } from '@/lib/token-storage';
import { AuthContext } from './auth.context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const queryClient = useQueryClient();

  // Sessao caiu (token expirado ou revogado), no meio do uso ou ja na abertura
  // com tokens velhos: o usuario sai da memoria, a rota protegida manda ao
  // login com o aviso e o cache nao vaza para o proximo.
  useEffect(
    () =>
      onSessionExpired(() => {
        setUser(null);
        setExpired(true);
        queryClient.clear();
      }),
    [queryClient],
  );

  // A API recusou algo por senha provisória: recarrega a conta (vem com a
  // flag) e a rota protegida leva ao primeiro acesso sem o usuário ver erro.
  useEffect(
    () =>
      onPasswordChangeRequired(() => {
        setUser((current) => (current && !current.mustChangePassword ? { ...current, mustChangePassword: true } : current));
        queryClient.cancelQueries();
        queryClient.clear();
      }),
    [queryClient],
  );

  // Outra aba do mesmo navegador saiu ou teve a sessão derrubada: esta aba
  // sai junto, em vez de ficar viva com o usuário na tela e tudo em 401.
  // Se outra aba entrou, esta recarrega a conta e segue sem pedir login.
  useEffect(
    () =>
      tokenStorage.subscribe((tokens) => {
        if (!tokens) {
          setUser((current) => {
            if (current) {
              setExpired(true);
              queryClient.clear();
            }
            return null;
          });
          return;
        }
        api
          .get<PublicUser>('/auth/me')
          .then((u) => {
            setExpired(false);
            setUser(u);
          })
          .catch(() => {});
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
      // Só o "não" da API derruba a sessão; servidor indisponível mantém os tokens para a próxima tentativa.
      .catch((err) => {
        if (!(err instanceof ApiError && (err.body.code === SERVER_UNREACHABLE || err.body.code === SERVER_DOWN))) tokenStorage.clear();
      })
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
