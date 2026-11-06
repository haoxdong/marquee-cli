import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'dist/**'],
    pool: 'forks',
    maxWorkers: '100%',
    env: { TZ: 'UTC' },
    globalSetup: ['./vitest.global-setup.ts'],
  },
});
