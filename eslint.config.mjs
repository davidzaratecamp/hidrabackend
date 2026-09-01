import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    // El código viejo se elimina al final de la reestructuración; no tiene
    // sentido corregir su estilo mientras tanto.
    ignores: ['node_modules/**', 'uploads/**', 'database/**', 'db/**', 'claude/**'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // Un argumento sin usar puede ser obligatorio por la firma que espera
      // Express (el manejador de errores necesita cuatro). Se marca con `_`.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-return-await': 'error',
      // No se activa `require-await`: marca como error las funciones async que
      // devuelven una promesa directamente (`return bcrypt.hash(...)`), que es
      // idiomático y correcto.
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
  },
];
