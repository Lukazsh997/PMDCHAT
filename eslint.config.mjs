import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'apps/api/drizzle/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': 'off',
    },
  },
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: {
      globals: globals.node,
      // Mantém imports de classes usados pela injeção de dependência do NestJS.
      parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true },
    },
    rules: {
      // Fronteira entre módulos: um módulo só importa outro pelo seu index.ts.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^\\.\\./(?:\\.\\./)*(?:modules/)?(auth|users|audit|health|org|rbac|directory|conversations|messages|realtime|notifications|files|search|admin|settings)/(?!index\\.js$).+',
              message: 'Importe outro módulo apenas pelo seu index.ts (ex.: ../users/index.js).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/test/**/*.ts', 'apps/api/**/*.test.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['apps/web/public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // A VM é acessada por HTTP (sem certificado): essas APIs não existem nesse contexto.
      'no-restricted-properties': [
        'error',
        {
          object: 'crypto',
          property: 'randomUUID',
          message: 'Indisponível em HTTP. Use newClientId() de @/lib/format.',
        },
        {
          object: 'crypto',
          property: 'subtle',
          message: 'Indisponível em HTTP (fora de localhost).',
        },
      ],
    },
  },
);
