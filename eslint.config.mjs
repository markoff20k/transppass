import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * Config única para o monorepo. As regras de tipagem rodam sem project service
 * (`projectService: false` implícito) para manter o lint rápido — o rigor de
 * tipos já vem do `npm run typecheck`, que roda o tsc de verdade.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.tsbuildinfo', 'packages/shared/dist/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },

  // Backend: o Nest resolve dependências pelos metadados de decorator emitidos
  // pelo tsc, e `import type` apaga esse metadado — converter o tipo de um
  // parâmetro de construtor quebraria a injeção em tempo de execução.
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      'no-console': 'off',
    },
  },

  // Frontend: regras dos hooks e do fast refresh.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly', localStorage: 'readonly', fetch: 'readonly' },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
);
