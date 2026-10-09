export const TEST_DATABASE_PATTERN = /^syncpath_test_[0-9]{13}_[a-f0-9]{12}$/;

export interface IntegrationEnvironment {
  databaseName: string;
  apiBase: string;
  port: number;
  token: string;
}

export function assertLocalDatabaseUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('A valid local PostgreSQL connection is required for integration tests.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Integration tests only support PostgreSQL on the local computer. Remote databases are refused.');
  }
  return url;
}

/** Runs before Vitest imports any test file or its destructive fixture hooks. */
export function assertIntegrationEnvironment(env: NodeJS.ProcessEnv): IntegrationEnvironment {
  const fail = (): never => { throw new Error('Unsafe integration-test target refused. Use npm test -w @syncpath/api to create a disposable database and isolated API.'); };
  if (env.RUN_INTEGRATION_TESTS !== '1' || !/^[a-f0-9]{64}$/.test(env.SYNCPATH_TEST_RUN_TOKEN ?? '')) fail();
  const databaseName = env.SYNCPATH_TEST_DATABASE ?? '';
  if (!TEST_DATABASE_PATTERN.test(databaseName)) fail();
  const database = assertLocalDatabaseUrl(env.DATABASE_URL ?? '');
  if (decodeURIComponent(database.pathname.slice(1)) !== databaseName || (database.searchParams.get('schema') ?? 'public') !== 'public') fail();
  let api: URL;
  try { api = new URL(env.API_BASE ?? ''); } catch { return fail(); }
  const port = Number(api.port);
  if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || api.pathname !== '/' ||
    api.username || api.password || api.search || api.hash || !Number.isInteger(port) || port <= 0 ||
    port === 3160 || port > 65535 || env.API_HOST !== '127.0.0.1' || Number(env.API_PORT) !== port) fail();
  return { databaseName, apiBase: api.origin, port, token: env.SYNCPATH_TEST_RUN_TOKEN! };
}

export async function verifyIntegrationProbe(
  target: IntegrationEnvironment,
  request: typeof fetch = fetch
): Promise<void> {
  const timeout = AbortSignal.timeout(2_000);
  const probe = await request(`${target.apiBase}/__integration_probe`, {
    headers: { 'x-syncpath-test-token': target.token }, signal: timeout
  });
  if (!probe.ok) throw new Error('The isolated test API could not be verified.');
  const identity = await probe.json() as { token?: string; database?: string };
  if (identity.token !== target.token || identity.database !== target.databaseName) {
    throw new Error('The API is not owned by this integration-test run. Test loading was refused.');
  }
  const health = await request(`${target.apiBase}/health`, { signal: AbortSignal.timeout(2_000) });
  const report = await health.json() as { status?: string; database?: string };
  if (!health.ok || report.status !== 'ok' || report.database !== 'up') throw new Error('The isolated test database is not ready.');
}

export function redactDatabaseUrls(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[database connection redacted]');
}
