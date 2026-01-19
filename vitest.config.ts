import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 5000,
    include: ['src/**/*.spec.ts'],
    exclude: ['node_modules', 'dist', 'server'],
  },
});

