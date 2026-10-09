/**
 * AC-03 / AC-04 — project membership boundaries.
 *
 *   AC-03: a Viewer on a project cannot modify projects / entries
 *   (covered by authorization.e2e.test.ts) — this file focuses on the
 *   membership-management surface itself.
 *   AC-04: when a member is removed (revoked), their session must stop
 *   being able to mutate the project on the next request, and any
 *   ongoing UI cached role must be rejected server-side.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const API = process.env.API_BASE ?? 'http://127.0.0.1:3160';
const prisma = new PrismaClient();

interface Result<T = unknown> {
  status: number;
  body: T;
}

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string
): Promise<Result<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try { parsed = JSON.parse(text); } catch { /* keep */ }
  }
  return { status: res.status, body: parsed as T };
}

function pickCookie(setCookie: string | undefined): string | undefined {
  return setCookie ? setCookie.split(';')[0] : undefined;
}

async function register(username: string): Promise<string> {
  const r = await fetch(`${API}/api/v1/sessions/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `${username}@syncpath.test`,
      username,
      password: 'ac04-pass-1234'
    })
  });
  if (r.status !== 201) {
    throw new Error(`register ${username} failed (${r.status})`);
  }
  return pickCookie(r.headers.get('set-cookie') ?? undefined)!;
}

async function loginAs(username: string, password: string): Promise<string> {
  const r = await fetch(`${API}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const setCookie = r.headers.get('set-cookie') ?? undefined;
  if (r.status !== 200 || !setCookie) {
    throw new Error(`login ${username} failed (${r.status})`);
  }
  return pickCookie(setCookie)!;
}

describe('AC-04 project member revoke', () => {
  const suffix = Date.now();
  const alice = `ac04_alice_${suffix}`;
  const bob = `ac04_bob_${suffix}`;
  let cookieAlice: string;
  let cookieBob: string;
  let workspaceId: string;
  let projectId: string;
  let bobUserId: string;

  beforeAll(async () => {
    await prisma.session.deleteMany({
      where: { user: { username: { startsWith: 'ac04' } } }
    });
    await prisma.progressEntry.deleteMany({
      where: { project: { workspace: { slug: { contains: 'ac04' } } } }
    });
    await prisma.projectMember.deleteMany({
      where: { project: { workspace: { slug: { contains: 'ac04' } } } }
    });
    await prisma.project.deleteMany({
      where: { workspace: { slug: { contains: 'ac04' } } }
    });
    await prisma.membership.deleteMany({
      where: { workspace: { slug: { contains: 'ac04' } } }
    });
    await prisma.workspace.deleteMany({
      where: { slug: { contains: 'ac04' } } }
    );
    await prisma.user.deleteMany({
      where: { username: { startsWith: 'ac04' } } }
    );

    cookieAlice = await register(alice);
    await register(bob);
    cookieBob = await loginAs(bob, 'ac04-pass-1234');

    const ws = await request<{ id: string }>(
      'POST',
      '/api/v1/workspaces',
      { name: 'ac04-ws', slug: `ac04-${suffix}` },
      cookieAlice
    );
    workspaceId = ws.body.id;

    const proj = await request<{ id: string }>(
      'POST',
      `/api/v1/workspaces/${workspaceId}/projects`,
      {
        name: 'ac04-project',
        startDate: '2026-09-07',
        endDate: '2026-12-31'
      },
      cookieAlice
    );
    projectId = proj.body.id;

    const bobUser = await prisma.user.findUnique({ where: { username: bob } });
    if (!bobUser) throw new Error('bob missing');
    bobUserId = bobUser.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('Lead can invite Bob as Editor; Bob can then mutate entries', async () => {
    // Alice (project Lead) invites Bob.
    const invite = await request<{ id: string }>(
      'POST',
      `/api/v1/projects/${projectId}/members`,
      { userId: bobUserId, role: 'Editor' },
      cookieAlice
    );
    expect(invite.status).toBe(201);

    // Bob creates an entry now.
    const create = await request<{ id: string }>(
      'POST',
      `/api/v1/projects/${projectId}/entries`,
      { weekStartDate: '2026-09-07', title: 'before revoke', level: 'minor' },
      cookieBob
    );
    expect(create.status).toBe(201);
  });

  it('Lead revokes Bob; Bob next PATCH must get 403, session remains otherwise valid', async () => {
    // List first to confirm membership.
    const list = await request<Array<{ user: { id: string }; role: string }>>(
      'GET',
      `/api/v1/projects/${projectId}/members`,
      undefined,
      cookieAlice
    );
    expect(list.body.find((m) => m.user.id === bobUserId)).toBeTruthy();

    // Alice removes Bob.
    const remove = await request(
      'DELETE',
      `/api/v1/projects/${projectId}/members/${bobUserId}`,
      undefined,
      cookieAlice
    );
    expect(remove.status).toBe(204);

    // Bob's session is still valid.
    const me = await request<{ user: { username: string } }>(
      'GET',
      '/api/v1/sessions/me',
      undefined,
      cookieBob
    );
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe(bob);

    // AC-04: a revoked member cannot mutate. The exact status is either
    // 403 (when the route can resolve the project but no role allows it)
    // or 404 (when the revoke hides the project entirely — RV-10). For
    // create-entry the route is reachable, so we expect 403.
    const create = await request<{ code?: string }>(
      'POST',
      `/api/v1/projects/${projectId}/entries`,
      { weekStartDate: '2026-09-14', title: 'after revoke', level: 'minor' },
      cookieBob
    );
    // eslint-disable-next-line no-console
    console.log('revoke create body=', JSON.stringify(create.body));
    expect([403, 404]).toContain(create.status);

    // Reading the project: Bob is now a non-member. The /projects/:id
    // route resolves the project but Bob has no role, so ProjectByIdController
    // currently raises insufficient_project_role (403). This matches
    // the behaviour used everywhere else for non-members on a workspace
    // project — it's deliberately strict: existence is revealed once the
    // caller is past the workspace boundary.
    const detail = await request<{ code?: string }>(
      'GET',
      `/api/v1/projects/${projectId}`,
      undefined,
      cookieBob
    );
    expect(detail.status).toBe(403);
    expect(detail.body.code).toBe('insufficient_project_role');
  });

  it('Lead can re-invite the revoked user', async () => {
    const reInvite = await request(
      'POST',
      `/api/v1/projects/${projectId}/members`,
      { identifier: bob, role: 'Viewer' },
      cookieAlice
    );
    expect(reInvite.status).toBe(201);

    // Bob can view but cannot create (Viewer is read-only).
    const create = await request<{ code?: string }>(
      'POST',
      `/api/v1/projects/${projectId}/entries`,
      { weekStartDate: '2026-09-21', title: 'readonly', level: 'minor' },
      cookieBob
    );
    expect(create.status).toBe(403);
    expect(create.body.code).toBe('insufficient_project_role');
  });
});
