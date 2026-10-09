/**
 * AC-01 — registration → login → me-with-cookie → logout → me-rejected.
 *
 * Runs against the real Postgres instance specified by DATABASE_URL (see
 * apps/api/.env). Each test gets a freshly truncated user / session /
 * membership / workspace / project / progress_entry / comment set so the
 * suite is hermetic. Other tests should not run in parallel with this one.
 *
 * Vitest configuration: see apps/api/vitest.config.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const API = process.env.API_BASE ?? 'http://127.0.0.1:3160';
const prisma = new PrismaClient();

interface SessionResponse {
  user: { id: string; username: string; email: string };
  expiresAt: string;
}

async function postJson<T>(path: string, body: unknown, cookie?: string): Promise<{ status: number; body: T; setCookie?: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try { parsed = JSON.parse(text); } catch { /* keep undefined */ }
  }
  return { status: res.status, body: parsed as T, setCookie: res.headers.get('set-cookie') ?? undefined };
}

async function getJson<T>(path: string, cookie?: string): Promise<{ status: number; body: T; setCookie?: string }> {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${API}${path}`, { headers });
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try { parsed = JSON.parse(text); } catch { /* keep undefined */ }
  }
  return { status: res.status, body: parsed as T, setCookie: res.headers.get('set-cookie') ?? undefined };
}

async function del(path: string, cookie?: string): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${API}${path}`, { method: 'DELETE', headers });
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try { parsed = JSON.parse(text); } catch { /* keep undefined */ }
  }
  return { status: res.status, body: parsed };
}

function pickCookie(setCookie: string | undefined): string | undefined {
  if (!setCookie) return undefined;
  // first pair before `;`
  return setCookie.split(';')[0];
}

describe('AC-01 identity lifecycle', () => {
  const username = `ac01_${Date.now()}`;
  const email = `${username}@syncpath.test`;
  const password = 'ac01-pass-1234';
  let cookie: string | undefined;

  beforeAll(async () => {
    // Only clean AC-01-prefixed fixtures. Previously we called
    // `prisma.session.deleteMany({})` which revoked every concurrent
    // test's cookie (RV-07). The principle: a test suite cleans its own
    // rows and never touches unrelated rows.
    await prisma.session.deleteMany({
      where: { user: { username: { startsWith: 'ac01_' } } }
    });
    await prisma.workspace.deleteMany({
      where: { slug: { startsWith: 'ac01-' } } }
    );
    // Chinese-only names use the generated `workspace-*` fallback slug, so
    // clean all workspaces owned by this fixture user before deleting it.
    await prisma.workspace.deleteMany({
      where: { owner: { username: { startsWith: 'ac01_' } } }
    });
    await prisma.user.deleteMany({
      where: { username: { startsWith: 'ac01_' } } }
    );
    try {
      const r = await fetch(`${API}/health`);
      if (!r.ok) throw new Error(`health returned ${r.status}`);
    } catch (err) {
      throw new Error(
        `API at ${API} is not reachable. Start it with "npm run dev:api" before running tests. (${(err as Error).message})`
      );
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects /sessions/me without a cookie', async () => {
    const { status, body } = await getJson<{ code?: string }>('/api/v1/sessions/me');
    expect(status).toBe(401);
    expect(body.code).toBe('no_session');
  });

  it('registers a new user and returns Set-Cookie + PublicUser', async () => {
    const { status, body, setCookie } = await postJson<SessionResponse>(
      '/api/v1/sessions/register',
      { email, username, password }
    );
    expect(status).toBe(201);
    expect(body.user.username).toBe(username);
    expect(body.user.email).toBe(email);
    expect(setCookie).toMatch(/syncpath_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    cookie = pickCookie(setCookie);
    expect(cookie).toBeTruthy();
  });

  it('logs in with the registered credentials and starts a fresh session', async () => {
    const { status, body, setCookie } = await postJson<SessionResponse>(
      '/api/v1/sessions',
      { username, password }
    );
    expect(status).toBe(200);
    expect(body.user.username).toBe(username);
    expect(setCookie).toMatch(/syncpath_session=/);
    cookie = pickCookie(setCookie);
  });

  it('returns the current user when the cookie is presented', async () => {
    const { status, body } = await getJson<SessionResponse>(
      '/api/v1/sessions/me',
      cookie
    );
    expect(status).toBe(200);
    expect(body.user.username).toBe(username);
  });

  it('creates a workspace with a Chinese display name and an internal fallback slug', async () => {
    const created = await postJson<{ id: string; name: string; slug: string }>(
      '/api/v1/workspaces',
      { name: '阿斯顿产品团队' },
      cookie
    );
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('阿斯顿产品团队');
    expect(created.body.slug).toMatch(/^workspace-[a-z0-9-]+$/);

    const listed = await getJson<Array<{ name: string; slug: string }>>(
      '/api/v1/workspaces',
      cookie
    );
    expect(listed.status).toBe(200);
    expect(listed.body.some((item) => item.name === '阿斯顿产品团队')).toBe(true);

    const archived = await del(`/api/v1/workspaces/${created.body.id}`, cookie);
    expect(archived.status).toBe(204);
  });

  it('returns 401 for /me with no cookie after logout', async () => {
    const logout = await del('/api/v1/sessions/me', cookie);
    expect(logout.status).toBe(200);

    const { status, body } = await getJson<{ code?: string }>('/api/v1/sessions/me', cookie);
    expect(status).toBe(401);
    expect(body.code).toBe('invalid_session');
  });

  it('rejects login with a wrong password', async () => {
    const { status, body } = await postJson<{ code?: string }>(
      '/api/v1/sessions',
      { username, password: 'definitely-wrong' }
    );
    expect(status).toBe(401);
    expect(body.code).toBe('invalid_credentials');
  });
});

// Silence unused-import warning for execSync (reserved for future migrate
// invocation if the suite is run without a separately-started API).
void execSync;
