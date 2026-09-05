import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  // O .env vive na raiz do monorepo, compartilhado com a API.
  const env = loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), '');

  return {
    plugins: [react()],
    envDir: fileURLToPath(new URL('../..', import.meta.url)),
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        // Em dev o front fala /api e o Vite encaminha: sem CORS, sem URL absoluta.
        '/api': {
          target: env.VITE_API_URL || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
