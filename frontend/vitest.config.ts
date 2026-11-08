import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/__tests__/**/*.test.ts'],
    // Let ?raw CSS imports return the real stylesheet text (used by layout CSS contract tests).
    css: { include: [/\.css(\?raw)?$/] },
  },
});

