import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ['**/tests/**/*.{test,spec}.{ts,tsx,js}', '**/src/**/*.{test,spec}.{ts,tsx,js}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.turbo/**'],
  },
});
