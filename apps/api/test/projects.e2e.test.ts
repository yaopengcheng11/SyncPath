/**
 * AC-09 — Optimistic-lock conflict on project update.
 *
 *   - Two clients fetch the same project at revision N.
 *   - One patches with expectedRevision=N and succeeds (revision → N+1).
 *   - The other patches with stale expectedRevision=N → 409 revision_conflict.
 *   - The losing client's draft is preserved (does not auto-overwrite).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const API = process.env.API_BASE ?? 'http://127.0.0.1:3160';
const prisma = new PrismaClient();

interface FetchResult<T = unknown> {
  status: number;
  body: T;
  setCookie?: string;
  rawText: string;
}

async function fetchJson<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string
): Promise<FetchResult<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, init);
  const rawText = await res.text();
  let parsed: unknown = undefined;
  if (rawText) {
    try { parsed = JSON.parse(rawText); } catch { /* leave */ }
  }
  return {
    status: res.status,
    body: parsed as T,
    setCookie: res.headers.get('set-cookie') ?? undefined,
    rawText
  };
}

function pickCookie(setCookie: string | undefined): string | undefined {
  return setCookie ? setCookie.split(';')[0] : undefined;
}

async function loginAs(username: string, password: string): Promise<string> {
  const { status, setCookie } = await fetchJson<{ user: { username: string } }>(
    'POST',
    '/api/v1/sessions',
    { username, password }
  );
  if (status !== 200 || !setCookie) {
    throw new Error(`login as ${username} failed (status=${status})`);
  }
  return pickCookie(setCookie)!;
}

async function register(username: string): Promise<string> {
  const r = await fetchJson(
    'POST',
    '/api/v1/sessions/register',
    {
      email: `${username}@syncpath.test`,
      username,
      password: 'ac09-pass-1234'
    }
  );
  if (r.status !== 201) {
    throw new Error(`register ${username} failed (${r.status}): ${r.rawText}`);
  }
  return pickCookie(r.setCookie!)!;
}

describe('AC-09 optimistic lock on project update', () => {
  const suffix = Date.now();
  const alice = `ac09_alice_${suffix}`;
  const bob = `ac09_bob_${suffix}`;
  let cookieAlice: string;
  let cookieBob: string;
  let workspaceId: string;
  let projectId: string;

  beforeAll(async () => {
    // FK-safe cleanup
    await prisma.progressEntry.deleteMany({
      where: { project: { workspace: { slug: { startsWith: 'ac09-' } } } }
    });
    await prisma.projectMember.deleteMany({
      where: { project: { workspace: { slug: { startsWith: 'ac09-' } } } }
    });
    await prisma.project.deleteMany({
      where: { workspace: { slug: { startsWith: 'ac09-' } } }
    });
    await prisma.membership.deleteMany({
      where: { workspace: { slug: { startsWith: 'ac09-' } } }
    });
    await prisma.workspace.deleteMany({
      where: { slug: { startsWith: 'ac09-' } }
    });
    await prisma.session.deleteMany({
      where: { user: { username: { startsWith: 'ac09_' } } }
    });
    await prisma.user.deleteMany({
      where: { username: { startsWith: 'ac09_' } }
    });

    cookieAlice = await register(alice);
    cookieBob = await register(bob);

    const ws = await fetchJson<{ id: string }>(
      'POST',
      '/api/v1/workspaces',
      { name: 'ac09-ws', slug: `ac09-${suffix}` },
      cookieAlice
    );
    if (ws.status !== 201) {
      throw new Error(`create workspace failed: ${ws.rawText}`);
    }
    workspaceId = ws.body.id;

    // Promote bob to a workspace Admin so he can also patch projects.
    const bobUser = await prisma.user.findUnique({ where: { username: bob } });
    if (!bobUser) throw new Error('bob not found');
    await prisma.membership.create({
      data: {
        id: `ac09-m-bob-${suffix}`,
        workspaceId,
        userId: bobUser.id,
        role: 'Admin'
      }
    });

    const proj = await fetchJson<{ id: string }>(
      'POST',
      `/api/v1/workspaces/${workspaceId}/projects`,
      {
        name: 'ac09-project',
        startDate: '2026-07-06',
        endDate: '2026-09-30'
      },
      cookieAlice
    );
    projectId = proj.body.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('first editor wins, second editor gets 409 revision_conflict', async () => {
    // Both clients pretend to be looking at the same project at the same
    // revision. We use the entry-level revision via expectedRevision = 1.
    const alicePatch = await fetchJson<{ id: string; name: string }>(
      'PATCH',
      `/api/v1/projects/${projectId}`,
      { name: 'ac09-renamed-alice', expectedRevision: 1 },
      cookieAlice
    );
    expect(alicePatch.status).toBe(200);
    expect(alicePatch.body.name).toBe('ac09-renamed-alice');

    const bobPatch = await fetchJson<{ code?: string }>(
      'PATCH',
      `/api/v1/projects/${projectId}`,
      { name: 'ac09-renamed-bob', expectedRevision: 1 },
      cookieBob
    );
    expect(bobPatch.status).toBe(409);
    expect(bobPatch.body.code).toBe('revision_conflict');

    // The losing draft is NOT silently applied: the project name in the
    // DB should still be the one alice wrote.
    const fetched = await fetchJson<{ name: string }>(
      'GET',
      `/api/v1/projects/${projectId}`,
      undefined,
      cookieAlice
    );
    expect(fetched.body.name).toBe('ac09-renamed-alice');
  });

  it('progress entry updates also use expectedRevision', async () => {
    // Seed an entry under the project.
    const entry = await fetchJson<{ id: string; revision: number }>(
      'POST',
      `/api/v1/projects/${projectId}/entries`,
      { weekStartDate: '2026-07-06', title: 'ac09-entry', level: 'minor' },
      cookieAlice
    );
    expect(entry.status).toBe(201);
    expect(entry.body.revision).toBe(1);

    // First editor updates with the right revision.
    const first = await fetchJson<{ revision: number }>(
      'PATCH',
      `/api/v1/entries/${entry.body.id}`,
      { title: 'ac09-entry (alice)', expectedRevision: 1 },
      cookieAlice
    );
    expect(first.status).toBe(200);
    expect(first.body.revision).toBe(2);

    // Date-only updates must round-trip without a local-timezone shift. This
    // is the API path used by the timeline's left/right keyboard movement.
    const moved = await fetchJson<{ weekStartDate: string; revision: number }>(
      'PATCH',
      `/api/v1/entries/${entry.body.id}`,
      { weekStartDate: '2026-07-07', expectedRevision: 2 },
      cookieAlice
    );
    expect(moved.status).toBe(200);
    expect(moved.body.weekStartDate).toBe('2026-07-07');
    expect(moved.body.revision).toBe(3);

    // Second editor with the stale revision gets 409.
    const stale = await fetchJson<{ code?: string }>(
      'PATCH',
      `/api/v1/entries/${entry.body.id}`,
      { title: 'ac09-entry (bob)', expectedRevision: 1 },
      cookieBob
    );
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('revision_conflict');
  });

  it('creates a project without holiday markers when the region is omitted', async () => {
    const created = await fetchJson<{ id: string; holidayRegion: string }>(
      'POST',
      `/api/v1/workspaces/${workspaceId}/projects`,
      { name: 'ac09-no-holiday-default', startDate: '2026-07-06', endDate: '2026-09-30' },
      cookieAlice
    );
    expect(created.status).toBe(201);
    expect(created.body.holidayRegion).toBe('NONE');

    const reread = await fetchJson<{ holidayRegion: string }>('GET', `/api/v1/projects/${created.body.id}`, undefined, cookieAlice);
    expect(reread.status).toBe(200);
    expect(reread.body.holidayRegion).toBe('NONE');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: created.body.id } })).holidayRegion).toBe('NONE');
  });

  it.each(['CN', 'US'] as const)('preserves the explicit legacy %s region when renaming a project', async (holidayRegion) => {
    const created = await fetchJson<{ id: string; revision: number; holidayRegion: string }>(
      'POST',
      `/api/v1/workspaces/${workspaceId}/projects`,
      { name: `ac09-legacy-${holidayRegion}`, startDate: '2026-07-06', endDate: '2026-09-30', holidayRegion },
      cookieAlice
    );
    expect(created.status).toBe(201);
    expect(created.body.holidayRegion).toBe(holidayRegion);

    const before = await fetchJson<{ holidayRegion: string }>('GET', `/api/v1/projects/${created.body.id}`, undefined, cookieAlice);
    expect(before.status).toBe(200);
    expect(before.body.holidayRegion).toBe(holidayRegion);

    const renamed = await fetchJson<{ name: string; holidayRegion: string }>(
      'PATCH',
      `/api/v1/projects/${created.body.id}`,
      { name: `ac09-renamed-${holidayRegion}`, expectedRevision: created.body.revision },
      cookieAlice
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body.holidayRegion).toBe(holidayRegion);

    const after = await fetchJson<{ name: string; holidayRegion: string }>('GET', `/api/v1/projects/${created.body.id}`, undefined, cookieAlice);
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ name: `ac09-renamed-${holidayRegion}`, holidayRegion });
  });
});
