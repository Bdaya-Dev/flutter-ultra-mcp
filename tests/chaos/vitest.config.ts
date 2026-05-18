import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@flutter-ultra/mcp-runtime': resolve(__dirname, '../../shared/mcp-runtime/src'),
      '@flutter-ultra/state-store': resolve(__dirname, '../../shared/state-store/src'),
      '@flutter-ultra/vm-service-client': resolve(__dirname, '../../shared/vm-service-client/src'),
    },
  },
  test: {
    include: ['tests/chaos/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['default', 'junit'],
    outputFile: { junit: 'chaos-results.xml' },
    pool: 'threads',
    fileParallelism: false,
  },
});
