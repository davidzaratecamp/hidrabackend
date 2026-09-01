import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // `describe`/`it`/`expect` como globales: permite que las pruebas sigan
    // siendo CommonJS igual que el resto del código, sin mezclar sistemas de
    // módulos solo para importar el runner.
    globals: true,
    // Las pruebas de integración comparten la base: en paralelo se pisarían.
    fileParallelism: false,
    testTimeout: 20_000,
    setupFiles: ['tests/setup.js'],
  },
});
