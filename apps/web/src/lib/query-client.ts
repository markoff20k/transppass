import { MutationCache, QueryClient } from '@tanstack/react-query';
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
        // Nao insiste em erro do cliente: so falha de rede/servidor merece retry.
        if (error instanceof ApiError && error.body.statusCode < 500) return false;
        return failureCount < 2;
      },
    },
  },
});
