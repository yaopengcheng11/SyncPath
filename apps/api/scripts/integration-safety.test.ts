import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertIntegrationEnvironment, verifyIntegrationProbe } from './integration-safety';

function isolatedEnvironment(): NodeJS.ProcessEnv {
  return {
    RUN_INTEGRATION_TESTS: '1',
    SYNCPATH_TEST_RUN_TOKEN: 'a'.repeat(64),
    SYNCPATH_TEST_DATABASE: 'syncpath_test_1790737200000_abcdef123456',
    DATABASE_URL: 'postgresql://fixture@127.0.0.1:5432/syncpath_test_1790737200000_abcdef123456?schema=public',
    API_BASE: 'http://127.0.0.1:45678', API_HOST: '127.0.0.1', API_PORT: '45678'
  };
}

test('refuses default development targets before test hooks can run', () => {
  assert.throws(() => assertIntegrationEnvironment({ DATABASE_URL: 'postgresql://fixture@localhost:5432/syncpath_dev', API_BASE: 'http://127.0.0.1:3160' }));
  assert.throws(() => assertIntegrationEnvironment({ ...isolatedEnvironment(), DATABASE_URL: 'postgresql://fixture@localhost:5432/syncpath_dev' }));
  assert.throws(() => assertIntegrationEnvironment({ ...isolatedEnvironment(), API_BASE: 'http://127.0.0.1:3160', API_PORT: '3160' }));
});

test('refuses missing tokens, mismatched databases, and nonlocal targets', () => {
  for (const override of [
    { SYNCPATH_TEST_RUN_TOKEN: undefined },
    { SYNCPATH_TEST_DATABASE: 'syncpath_test_existing' },
    { DATABASE_URL: 'postgresql://fixture@database.example:5432/syncpath_test_1790737200000_abcdef123456' },
    { API_BASE: 'http://api.example:45678' },
    { API_PORT: '45679' },
    { RUN_INTEGRATION_TESTS: '0' }
  ]) assert.throws(() => assertIntegrationEnvironment({ ...isolatedEnvironment(), ...override }));
});

test('accepts only a consistent disposable local environment', () => {
  assert.deepEqual(assertIntegrationEnvironment(isolatedEnvironment()), {
    databaseName: 'syncpath_test_1790737200000_abcdef123456', apiBase: 'http://127.0.0.1:45678', port: 45678, token: 'a'.repeat(64)
  });
});

test('refuses an API with a different run token even when its health is good', async () => {
  const target = assertIntegrationEnvironment(isolatedEnvironment());
  const request = (async () => new Response(JSON.stringify({ token: 'b'.repeat(64), database: target.databaseName }))) as typeof fetch;
  await assert.rejects(verifyIntegrationProbe(target, request), /not owned/);
});

test('verifies the exact run and database before accepting the health probe', async () => {
  const target = assertIntegrationEnvironment(isolatedEnvironment());
  const request = (async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url).endsWith('__integration_probe')) {
      assert.equal((options?.headers as Record<string, string>)['x-syncpath-test-token'], target.token);
      return new Response(JSON.stringify({ token: target.token, database: target.databaseName }));
    }
    return new Response(JSON.stringify({ status: 'ok', database: 'up' }));
  }) as typeof fetch;
  await verifyIntegrationProbe(target, request);
});
