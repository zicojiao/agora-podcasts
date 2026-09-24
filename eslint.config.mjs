import coreWebVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  ...coreWebVitals,
  {
    // Bind the TypeScript parser explicitly. Without this the .mts verification script is
    // parsed by espree, and the TS-only rules crash walking a non-TS AST.
    files: ['**/*.ts', '**/*.mts', '**/*.tsx'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // Syncing external SDK state (Agora RTC/RTM, AudioWorklet ports) into React state
      // inside an effect is intentional here; the rule flags every synchronous setState
      // in an effect body, including the lifecycle-ownership patterns this app relies on.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  { ignores: ['.next/**', 'node_modules/**', 'public/**'] },
];

export default config;
