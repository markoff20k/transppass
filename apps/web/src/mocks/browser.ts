import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);

/**
 * Liga o modo mock. Só é chamado quando VITE_MOCK=true, e o import dos
 * handlers acontece dentro desta função para que nada do MSW entre no
 * bundle de produção.
 */
export async function startMockWorker(): Promise<void> {
  await worker.start({
    onUnhandledRequest: 'bypass',
    quiet: false,
  });
  console.warn(
    '%c[modo mock]%c dados em memória, sem banco. Recarregar a página descarta as alterações.',
    'background:#a35a00;color:#fff;padding:2px 6px;border-radius:3px',
    '',
  );
}
