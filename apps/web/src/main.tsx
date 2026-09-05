import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/auth-provider';
import { queryClient } from '@/lib/query-client';
import { router } from '@/routes';
import './styles.css';

/**
 * No modo mock o MSW precisa estar interceptando ANTES do primeiro render:
 * o AuthProvider dispara /auth/me na montagem, e essa chamada não pode
 * escapar para a rede. O import é dinâmico para que o MSW fique fora do
 * bundle de produção.
 */
async function bootstrap() {
  if (import.meta.env.VITE_MOCK === 'true') {
    const { startMockWorker } = await import('./mocks/browser');
    await startMockWorker();
  }

  const container = document.getElementById('root');
  if (!container) throw new Error('Elemento #root nao encontrado');

  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void bootstrap();
