import { MutationCache, QueryClient } from '@tanstack/react-query';
import { PASSWORD_CHANGE_REQUIRED } from '@app/shared';
import { ApiError } from './api-client';
import { toast } from './toast';

/**
 * Cada mutação diz em `meta` o que contar ao usuário quando der certo. Erro
 * sempre vira toast com a mensagem da API — a tela pode mostrar o detalhe no
 * lugar, mas ninguém fica sem saber que o clique não pegou.
 */
declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** Mensagem de sucesso; função quando depende do resultado. `null` cala. */
      success?: string | ((data: unknown, variables: unknown) => string | null);
      description?: string;
      /** Não mostrar toast de erro (a tela já trata o erro inline de forma completa). */
      silentError?: boolean;
    };
  }
}

const mutationCache = new MutationCache({
  onSuccess: (data, variables, _ctx, mutation) => {
    const s = mutation.meta?.success;
    const title = typeof s === 'function' ? s(data, variables) : s;
    if (title) toast.success(title, { description: mutation.meta?.description });
  },
  onError: (error, _v, _c, mutation) => {
    if (mutation.meta?.silentError) return;
    // Senha provisória: o AuthProvider já leva ao primeiro acesso; não há o que "concluir".
    if (error instanceof ApiError && error.body.code === PASSWORD_CHANGE_REQUIRED) return;
    const msg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Não foi possível concluir.';
    toast.error('Não foi possível concluir', { description: msg });
  },
});

export const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Nao insiste em erro do cliente: so falha de rede/servidor (e a cota
        // de requisicoes, 429, que passa sozinha) merece retry.
        if (error instanceof ApiError && error.body.statusCode < 500 && error.body.statusCode !== 429) return false;
        return failureCount < 3;
      },
      retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
    },
  },
});
