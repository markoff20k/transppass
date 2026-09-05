import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client';

export const queryClient = new QueryClient({
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
