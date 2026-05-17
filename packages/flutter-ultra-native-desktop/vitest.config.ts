import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // J's tests live under src/**; the distro-detect test lives under tests/.
    // Include both so the matrix stays unified.
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
