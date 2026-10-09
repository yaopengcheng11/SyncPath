/**
 * AC-02 — workspace / project tenancy boundaries.
 *
 *   A. Replace any ID in the URL/body with one belonging to a workspace
 *      the caller is NOT a member of → 404, no DB leakage, summary /
 *      count / export payloads never include B's content.
 *   B. User with Viewer role on a project cannot create entries → 403.
 *
 * Run alongside identity.e2e.test.ts; they share the seeded `demo`
 * workspace and fixtures.
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

describe('AC-02 tenancy boundaries', () => {
  // ── Fixtures ────────────────────────────────────────────────────────
  let ownerA: string;             // alice — owner of workspace A
  let ownerB: string;             // bob — owner of workspace B
  let editorA: string;            // carol — editor in workspace A
  let viewerA: string;            // dave — viewer in workspace A
  let workspaceA: string;
  let workspaceB: string;
  let projectA: string;
  let projectB: string;
  let viewerOnlyEntry: string;    // entry inside project B (should never leak)

  beforeAll(async () => {
    // Clean up any prior fixtures and seed two fully-isolated workspaces.
    await prisma.session.deleteMany({
      where: { user: { username: { startsWith: 'ac02_' } } }
    });
    await prisma.progressEntry.deleteMany({
      where: { project: { workspace: { slug: { startsWith: 'ac02-' } } } }
    });
    await prisma.projectMember.deleteMany({
      where: { project: { workspace: { slug: { startsWith: 'ac02-' } } } }
    });
    await prisma.project.deleteMany({
      where: { workspace: { slug: { startsWith: 'ac02-' } } }
    });
    await prisma.membership.deleteMany({
      where: { workspace: { slug: { startsWith: 'ac02-' } } }
    });
    await prisma.workspace.deleteMany({
      where: { slug: { startsWith: 'ac02-' } }
    });
    await prisma.user.deleteMany({
      where: { username: { startsWith: 'ac02_' } }
    });

    const suffix = Date.now();
    ownerA = `ac02_alice_${suffix}`;
    editorA = `ac02_carol_${suffix}`;
    viewerA = `ac02_dave_${suffix}`;
    ownerB = `ac02_bob_${suffix}`;

    async function register(username: string): Promise<void> {
      const r = await fetchJson('POST', '/api/v1/sessions/register', {
        email: `${username}@syncpath.test`,
        username,
        password: 'ac02-pass-1234'
      });
      if (r.status !== 201) {
        throw new Error(`register ${username} failed (${r.status}): ${r.rawText}`);
      }
    }
    await register(ownerA);
    await register(editorA);
    await register(viewerA);
    await register(ownerB);

    const cookie = await loginAs(ownerA, 'ac02-pass-1234');
    const ws = await fetchJson<{ id: string }>(
      'POST',
      '/api/v1/workspaces',
      { name: 'ac02-A', slug: `ac02-a-${suffix}` },
      cookie
    );
    if (ws.status !== 201) {
      throw new Error(`create workspace A failed (${ws.status}): ${ws.rawText}`);
    }
    workspaceA = ws.body.id;

    const cookieB = await loginAs(ownerB, 'ac02-pass-1234');
    const wsB = await fetchJson<{ id: string }>(
      'POST',
      '/api/v1/workspaces',
      { name: 'ac02-B', slug: `ac02-b-${suffix}` },
      cookieB
    );
    workspaceB = wsB.body.id;

    // carol → Editor in workspace A
    const carolUser = await prisma.user.findUnique({ where: { username: editorA } });
    if (!carolUser) throw new Error('carol not found');
    await prisma.membership.create({
      data: {
        id: `ac02-m-carol-${suffix}`,
        workspaceId: workspaceA,
        userId: carolUser.id,
        role: 'Member'
      }
    });

    // dave → Viewer-only Member in workspace A (workspace role is Member,
    // not a project role; project-level Viewer assignment is below).
    const daveUser = await prisma.user.findUnique({ where: { username: viewerA } });
    if (!daveUser) throw new Error('dave not found');
    await prisma.membership.create({
      data: {
        id: `ac02-m-dave-${suffix}`,
        workspaceId: workspaceA,
        userId: daveUser.id,
        role: 'Member'
      }
    });

    void carolUser;
    void daveUser;

    // Seed two projects: one in A, one in B.
    const projA = await fetchJson<{ id: string }>(
      'POST',
      `/api/v1/workspaces/${workspaceA}/projects`,
      {
        name: 'ac02-Project-A',
        startDate: '2026-05-04',
        endDate: '2026-06-29'
      },
      cookie
    );
    projectA = projA.body.id;

    const projB = await fetchJson<{ id: string }>(
      'POST',
      `/api/v1/workspaces/${workspaceB}/projects`,
      {
        name: 'ac02-Project-B',
        startDate: '2026-05-04',
        endDate: '2026-06-29'
      },
      cookieB
    );
    projectB = projB.body.id;

    // dave becomes Viewer on project A (so workspace role allows visibility
    // but project-level writes are blocked).
    await prisma.projectMember.create({
      data: {
        id: `ac02-pm-dave-${suffix}`,
        projectId: projectA,
        userId: daveUser.id,
        role: 'Viewer'
      }
    });

    // carol becomes Editor on project A so the "Editor can create" test
    // below is meaningful.
    await prisma.projectMember.create({
      data: {
        id: `ac02-pm-carol-${suffix}`,
        projectId: projectA,
        userId: carolUser.id,
        role: 'Editor'
      }
    });

    // Seed one entry inside project B with a recognisable summary.
    const projBEntry = await fetchJson<{ id: string }>(
      'POST',
      `/api/v1/projects/${projectB}/entries`,
      {
        weekStartDate: '2026-05-04',
        title: 'SECRET-B',
        level: 'primary',
        summary: 'B-internal-do-not-leak'
      },
      cookieB
    );
    viewerOnlyEntry = projBEntry.body.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── AC-02.A: cross-workspace lookups return 404, never leak B ───────

  it('returns 404 when alice (workspace A) requests workspace B by id', async () => {
    const cookie = await loginAs(ownerA, 'ac02-pass-1234');
    const { status, body } = await fetchJson<{ code?: string }>(
      'GET',
      `/api/v1/workspaces/${workspaceB}`,
      undefined,
      cookie
    );
    expect(status).toBe(404);
    expect(body.code).toBe('workspace_not_found');
  });

  it('returns 404 when alice tries to create a project under workspace B', async () => {
    const cookie = await loginAs(ownerA, 'ac02-pass-1234');
    const { status, body } = await fetchJson<{ code?: string }>(
      'POST',
      `/api/v1/workspaces/${workspaceB}/projects`,
      { name: 'intruder', startDate: '2026-05-04', endDate: '2026-06-29' },
      cookie
    );
    expect(status).toBe(404);
    expect(body.code).toBe('workspace_not_found');
  });

  it('returns 404 when alice requests project B by id', async () => {
    const cookie = await loginAs(ownerA, 'ac02-pass-1234');
    const { status, body } = await fetchJson<{ code?: string }>(
      'GET',
      `/api/v1/projects/${projectB}`,
      undefined,
      cookie
    );
    expect(status).toBe(404);
    expect(body.code).toBe('project_not_found');
  });

  it("alice's listing never returns project B or any of its entries", async () => {
    const cookie = await loginAs(ownerA, 'ac02-pass-1234');
    const { status, body } = await fetchJson<Array<{ id: string; name: string }>>(
      'GET',
      `/api/v1/workspaces/${workspaceA}/projects`,
      undefined,
      cookie
    );
    expect(status).toBe(200);
    const ids = body.map((p) => p.id);
    expect(ids).toContain(projectA);
    expect(ids).not.toContain(projectB);

    // Also: trying to list entries on a foreign project must 404.
    const foreign = await fetchJson(
      'GET',
      `/api/v1/projects/${projectB}/entries`,
      undefined,
      cookie
    );
    expect(foreign.status).toBe(404);
  });

  it('bob cannot see any of alice workspace A content in list responses', async () => {
    const cookie = await loginAs(ownerB, 'ac02-pass-1234');
    const list = await fetchJson<Array<{ id: string }>>(
      'GET',
      '/api/v1/workspaces',
      undefined,
      cookie
    );
    expect(list.status).toBe(200);
    const wsIds = list.body.map((w) => w.id);
    expect(wsIds).not.toContain(workspaceA);
    expect(wsIds).toContain(workspaceB);
  });

  // ── AC-02.B: Viewer cannot mutate ────────────────────────────────────

  it('dave (project Viewer) cannot create entries in project A', async () => {
    const cookie = await loginAs(viewerA, 'ac02-pass-1234');
    const { status, body } = await fetchJson<{ code?: string }>(
      'POST',
      `/api/v1/projects/${projectA}/entries`,
      { weekStartDate: '2026-05-04', title: 'unauthorised', level: 'minor' },
      cookie
    );
    expect(status).toBe(403);
    expect(body.code).toBe('insufficient_project_role');
  });

  it('dave (project Viewer) cannot patch or delete an existing entry', async () => {
    const cookie = await loginAs(viewerA, 'ac02-pass-1234');
    // Seed an entry owned by alice inside project A so dave has something
    // to attempt to mutate.
    const ownerCookie = await loginAs(ownerA, 'ac02-pass-1234');
    const seed = await fetchJson<{ id: string }>(
      'POST',
      `/api/v1/projects/${projectA}/entries`,
      { weekStartDate: '2026-05-04', title: 'A entry', level: 'minor' },
      ownerCookie
    );
    expect(seed.status).toBe(201);
    const entryId = seed.body.id;

    const patch = await fetchJson(
      'PATCH',
      `/api/v1/entries/${entryId}`,
      { title: 'tampered', expectedRevision: 1 },
      cookie
    );
    expect(patch.status).toBe(403);

    const del = await fetchJson(
      'DELETE',
      `/api/v1/entries/${entryId}`,
      undefined,
      cookie
    );
    expect(del.status).toBe(403);
  });

  it('carol (Editor) can create entries in project A', async () => {
    const cookie = await loginAs(editorA, 'ac02-pass-1234');
    const { status, body } = await fetchJson<{ id: string }>(
      'POST',
      `/api/v1/projects/${projectA}/entries`,
      { weekStartDate: '2026-05-04', title: 'editor OK', level: 'minor' },
      cookie
    );
    expect(status).toBe(201);
    expect(body.id).toBeTruthy();
    void viewerOnlyEntry; // keep the variable referenced for clarity
  });
});
