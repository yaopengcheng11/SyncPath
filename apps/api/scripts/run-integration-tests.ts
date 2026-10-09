import { PrismaClient } from '@prisma/client';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { assertIntegrationEnvironment, assertLocalDatabaseUrl, redactDatabaseUrls, TEST_DATABASE_PATTERN, verifyIntegrationProbe } from './integration-safety';

const apiRoot = resolve(__dirname, '..');
const children = new Set<ChildProcess>();
const interrupted = new AbortController();
let receivedSignal = false;

function killOwnedChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}

async function stopOwnedChildren(): Promise<void> {
  await Promise.all([...children].map(async (child) => {
    if (child.exitCode !== null) return;
    killOwnedChild(child, 'SIGTERM');
    await Promise.race([new Promise<void>((done) => child.once('exit', () => done())), delay(3_000)]);
    if (child.exitCode === null && child.signalCode === null) {
      killOwnedChild(child, 'SIGKILL');
      await Promise.race([new Promise<void>((done) => child.once('exit', () => done())), delay(2_000)]);
    }
  }));
}

function throwIfInterrupted(): void {
  if (interrupted.signal.aborted) throw new Error('Integration tests interrupted; removing the disposable environment.');
}

function startChild(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  throwIfInterrupted();
  const child = spawn(process.execPath, args, { cwd: apiRoot, env, stdio: 'inherit', detached: process.platform !== 'win32' });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

async function runChild(args: string[], env: NodeJS.ProcessEnv, timeoutMs?: number): Promise<void> {
  const child = startChild(args, env);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((done, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? done() : reject(new Error(`Integration command failed (${signal ?? `exit ${code}`}).`)));
      if (timeoutMs) timeout = setTimeout(() => { killOwnedChild(child, 'SIGTERM'); reject(new Error('Integration command exceeded its time limit.')); }, timeoutMs);
    });
    throwIfInterrupted();
  } finally { if (timeout) clearTimeout(timeout); }
}

function readConfiguredDatabase(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  let contents = '';
  try { contents = readFileSync(resolve(apiRoot, '.env'), 'utf8'); } catch { /* explicit environment is supported without a file */ }
  const line = contents.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.+)$/m)?.[1]?.trim();
  if (!line) throw new Error('Set DATABASE_URL for local PostgreSQL before running integration tests.');
  const value = line.startsWith('"') || line.startsWith("'") ? line.slice(1, line.indexOf(line[0], 1)) : line.replace(/\s+#.*$/, '').trim();
  if (!value || value.includes('${')) throw new Error('Set an explicit DATABASE_URL for local PostgreSQL before running integration tests.');
  return value;
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate an isolated test port.');
  const port = address.port;
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  return port === 3160 ? availablePort() : port;
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const watch = args.includes('--watch');
  if (args.some((arg) => arg !== '--watch')) throw new Error('The integration runner only accepts --watch; test configuration cannot bypass safety checks.');
  const configured = assertLocalDatabaseUrl(readConfiguredDatabase());
  const adminUrl = assertLocalDatabaseUrl(process.env.INTEGRATION_ADMIN_DATABASE_URL ?? configured.toString());
  adminUrl.pathname = '/postgres';
  adminUrl.searchParams.set('schema', 'public');
  const databaseName = `syncpath_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
  // No user-supplied database name can reach raw CREATE/DROP identifiers.
  if (!TEST_DATABASE_PATTERN.test(databaseName)) throw new Error('Could not generate a safe disposable database name.');
  const testUrl = new URL(adminUrl);
  testUrl.pathname = `/${databaseName}`;
  const port = await availablePort();
  const token = randomBytes(32).toString('hex');
  const env: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: 'test', DATABASE_URL: testUrl.toString(), API_BASE: `http://127.0.0.1:${port}`,
    API_HOST: '127.0.0.1', API_PORT: String(port), COOKIE_SECURE: 'false', SESSION_SECRET: randomBytes(32).toString('hex'),
    RUN_INTEGRATION_TESTS: '1', SYNCPATH_TEST_DATABASE: databaseName, SYNCPATH_TEST_RUN_TOKEN: token
  };
  delete env.INTEGRATION_ADMIN_DATABASE_URL;
  delete env.DIRECT_URL;
  delete env.SHADOW_DATABASE_URL;
  const target = assertIntegrationEnvironment(env);
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  let created = false;
  const onSignal = (): void => {
    receivedSignal = true;
    interrupted.abort();
    for (const child of children) killOwnedChild(child, 'SIGTERM');
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    throwIfInterrupted();
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    created = true;
    console.log(`Created disposable database ${databaseName}; isolated API port ${port}.`);
    await runChild([require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve(apiRoot, 'prisma/schema.prisma')], env, 60_000);
    const api = startChild(['--import', require.resolve('tsx'), resolve(apiRoot, 'scripts/test-bootstrap.ts')], env);
    api.once('error', () => { /* readiness below reports a safe startup failure */ });
    const readyDeadline = Date.now() + 30_000;
    while (true) {
      throwIfInterrupted();
      if (api.exitCode !== null || api.signalCode !== null) throw new Error('The isolated API exited before becoming ready.');
      try { await verifyIntegrationProbe(target); break; } catch {
        if (Date.now() >= readyDeadline) throw new Error('The isolated test API did not become ready within 30 seconds.');
        await delay(200);
      }
    }
    console.log('Verified isolated API and disposable database. Running integration tests.');
    await runChild([require.resolve('vitest/vitest.mjs'), watch ? '--watch' : 'run', '--config', resolve(apiRoot, 'vitest.config.ts')], env, watch ? undefined : 300_000);
  } finally {
    await stopOwnedChildren();
    try {
      if (created) {
        await admin.$queryRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${databaseName} AND pid <> pg_backend_pid()`;
        await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
        console.log(`Removed disposable database ${databaseName}; stopped isolated test processes.`);
      }
    } finally {
      await admin.$disconnect();
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    }
  }
}

void run().catch((error: unknown) => {
  console.error(redactDatabaseUrls(error instanceof Error ? error.message : 'Integration tests failed.'));
  process.exitCode = receivedSignal ? 130 : 1;
});
