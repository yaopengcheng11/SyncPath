/**
 * RV-08 — True concurrent update on the same revision must produce
 * exactly one success and one 409 revision_conflict.
 *
 * Construction (deterministic barrier):
 *   1. Two clients each fetch the same project at revision N.
 *   2. We `Promise.all` both PATCH calls without awaiting between them.
 *   3. The atomic CAS in service.update means at most one writer's
 *      `updateMany` matches the row at revision N.
 *   4. The losing client's draft is preserved (response is 409).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const API = process.env.API_BASE ?? 'http://127.0.0.1:3160';
const prisma = new PrismaClient();

async function postJson<T>(
  method: string,
  path: string,
  body: unknown,
  cookie?: string
): Promise<{ status: number; body: T }> {
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

async function register(username: string): Promise<void> {
  const r = await fetch(`${API}/api/v1/sessions/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `${username}@syncpath.test`,
      username,
      password: 'rv08-pass-1234'
    })
  });
  if (r.status !== 201) {
    throw new Error(`register ${username} failed (${r.status})`);
  }
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

describe('RV-08 atomic concurrent update', () => {
  const suffix = Date.now();
  const alice = `rv08_alice_${suffix}`;
  const bob = `rv08_bob_${suffix}`;
  let cookieAlice: string;
  let cookieBob: string;
  let workspaceId: string;
  let projectId: string;
  let initialRevision: number;

  beforeAll(async () => {
    await prisma.session.deleteMany({
      where: { user: { username: { startsWith: 'rv08_' } } }
    });
    await prisma.progressEntry.deleteMany({
      where: { project: { workspace: { slug: { startsWith: 'rv08-' } } } }
    });
    await prisma.projectMember.deleteMany({
      where: { project: { workspace: { slug: { startsWith: 'rv08-' } } } }
    });
    await prisma.project.deleteMany({
      where: { workspace: { slug: { startsWith: 'rv08-' } } }
    });
    await prisma.membership.deleteMany({
      where: { workspace: { slug: { startsWith: 'rv08-' } } }
    });
    await prisma.workspace.deleteMany({
      where: { slug: { startsWith: 'rv08-' } }
    });
    await prisma.user.deleteMany({
      where: { username: { startsWith: 'rv08_' } }
    });

    await register(alice);
    await register(bob);
    cookieAlice = await loginAs(alice, 'rv08-pass-1234');
    cookieBob = await loginAs(bob, 'rv08-pass-1234');

    const ws = await postJson<{ id: string }>(
      'POST',
      '/api/v1/workspaces',
      { name: 'rv08-ws', slug: `rv08-${suffix}` },
      cookieAlice
    );
    workspaceId = ws.body.id;

    // Add bob as Admin so the revision write is allowed for him too.
    const bobUser = await prisma.user.findUnique({ where: { username: bob } });
    if (!bobUser) throw new Error('bob missing');
    await prisma.membership.create({
      data: {
        id: `rv08-m-${suffix}`,
        workspaceId,
        userId: bobUser.id,
        role: 'Admin'
      }
    });

    const proj = await postJson<{ id: string; revision: number }>(
      'POST',
      `/api/v1/workspaces/${workspaceId}/projects`,
      {
        name: 'rv08-project',
        startDate: '2026-08-03',
        endDate: '2026-10-30'
      },
      cookieAlice
    );
    projectId = proj.body.id;
    initialRevision = proj.body.revision;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('two writers at the same revision → exactly one 200 and one 409', async () => {
    // Both clients observe the project at the same revision.
    expect(initialRevision).toBe(1);

    // Fire both PATCHes in parallel without waiting between them.
    const [a, b] = await Promise.all([
      postJson<{ name: string; code?: string }>(
        'PATCH',
        `/api/v1/projects/${projectId}`,
        { name: 'alice wins', expectedRevision: 1 },
        cookieAlice
      ),
      postJson<{ name: string; code?: string }>(
        'PATCH',
        `/api/v1/projects/${projectId}`,
        { name: 'bob wins', expectedRevision: 1 },
        cookieBob
      )
    ]);

    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([200, 409]);

    const winner = a.status === 200 ? a : b;
    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe('revision_conflict');

    // Final DB state matches the winner.
    const fetched = await postJson<{ name: string; revision: number }>(
      'GET',
      `/api/v1/projects/${projectId}`,
      undefined,
      cookieAlice
    );
    expect(fetched.body.name).toBe(winner.body.name);
    expect(fetched.body.revision).toBe(2);
  });
});
