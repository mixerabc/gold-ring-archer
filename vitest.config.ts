import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * One test runner for the whole monorepo. Tests live next to the code they
 * cover (shared physics/rules, client camera & UI logic, server validation).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared/src', import.meta.url)),
      '@client': fileURLToPath(new URL('./client/src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: [
      'shared/src/**/*.test.ts',
      'client/src/**/*.test.ts',
      'server/src/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    reporters: ['default'],
    testTimeout: 20000,
  },
});
