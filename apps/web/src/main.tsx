import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/auth-provider';
import { ThemeProvider } from '@/features/theme/theme-provider';
import { queryClient } from '@/lib/query-client';
import { router } from '@/routes';
// Fontes empacotadas com o app: sem CDN, funcionam com a garagem offline.
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { I18nProvider } from '@/i18n/i18n-provider';

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
      <ThemeProvider>
        <I18nProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <RouterProvider router={router} />
            </AuthProvider>
          </QueryClientProvider>
        </I18nProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}

void bootstrap();
