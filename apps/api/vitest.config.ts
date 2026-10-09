import { defineConfig } from 'vitest/config';
import { assertIntegrationEnvironment, verifyIntegrationProbe } from './scripts/integration-safety';

export default defineConfig(async () => {
  const target = assertIntegrationEnvironment(process.env);
  await verifyIntegrationProbe(target);
  return {
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // AC tests share a database; serialise to avoid cross-test interference.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true }
    },
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules', 'dist']
  }
  };
});
