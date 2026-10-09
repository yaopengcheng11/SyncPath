/**
 * Authorization regression tests for RV-01 / RV-02 / RV-10.
 *
 *   RV-01: Cross-tenant reads (entries / projects) return 404, never 200.
 *   RV-02: Viewer cannot update or delete projects through any path.
 *   RV-10: Soft-deleted projects and entries cannot be reached by list,
 *          detail, update, or delete routes.
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

async function register(username: string): Promise<string> {
  const reg = await fetch(`${API}/api/v1/sessions/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `${username}@syncpath.test`,
      username,
      password: 'rv01-pass-1234'
    })
  });
  if (reg.status !== 201) {
    throw new Error(`register ${username} failed (${reg.status})`);
  }
  return loginAs(username, 'rv01-pass-1234');
}

describe('RV-01 / RV-02 / RV-10 authorization boundaries', () => {
  const suffix = Date.now();
  const alice = `rv01_alice_${suffix}`;
  const bob = `rv01_bob_${suffix}`;
  let cookieAlice: string;
  let cookieBob: string;
  let aliceWorkspaceId: string;
  let aliceProjectId: string;
  let aliceEntryId: string;

  beforeAll(async () => {
    // Tear down rv-prefixed fixtures in FK-safe order. Covers rv01,
    // rv08 (concurrency), rv10 (workspace archive). To stay scoped we
    // only purge usernames starting with `rv` and slugs containing `rv`.
    await prisma.session.deleteMany({
      where: { user: { username: { startsWith: 'rv' } } }
    });
    await prisma.progressEntry.deleteMany({
      where: { project: { workspace: { slug: { contains: 'rv' } } } }
    });
    await prisma.projectMember.deleteMany({
      where: { project: { workspace: { slug: { contains: 'rv' } } } }
    });
    await prisma.project.deleteMany({
      where: { workspace: { slug: { contains: 'rv' } } }
    });
    await prisma.membership.deleteMany({
      where: { workspace: { slug: { contains: 'rv' } } }
    });
    await prisma.workspace.deleteMany({
      where: { slug: { contains: 'rv' } } }
    );
    await prisma.user.deleteMany({
      where: { username: { startsWith: 'rv' } } }
    );

    cookieAlice = await register(alice);
    cookieBob = await register(bob);

    const ws = await request<{ id: string }>(
      'POST',
      '/api/v1/workspaces',
      { name: 'rv01-ws', slug: `rv01-${suffix}` },
      cookieAlice
    );
    aliceWorkspaceId = ws.body.id;

    const proj = await request<{ id: string }>(
      'POST',
      `/api/v1/workspaces/${aliceWorkspaceId}/projects`,
      {
        name: 'rv01-project',
        startDate: '2026-09-07',
        endDate: '2026-12-31'
      },
      cookieAlice
    );
    aliceProjectId = proj.body.id;

    const entry = await request<{ id: string }>(
      'POST',
      `/api/v1/projects/${aliceProjectId}/entries`,
      { weekStartDate: '2026-09-07', title: 'Tenant A secret', level: 'primary' },
      cookieAlice
    );
    aliceEntryId = entry.body.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ─── RV-01 ────────────────────────────────────────────────────────

  it('Bob (not in Alice workspace) gets 404 on Alice entry by id', async () => {
    const r = await request<{ code?: string }>(
      'GET',
      `/api/v1/entries/${aliceEntryId}`,
      undefined,
      cookieBob
    );
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('project_not_found');
  });

  it('Bob gets 404 on Alice project (workspaces + projects path)', async () => {
    const r = await request<{ code?: string }>(
      'GET',
      `/api/v1/workspaces/${aliceWorkspaceId}/projects/${aliceProjectId}`,
      undefined,
      cookieBob
    );
    expect(r.status).toBe(404);
    // Bob is not in Alice's workspace, so the workspace-level guard fires
    // first and returns workspace_not_found (correctly hiding whether
    // the project exists at all).
    expect(r.body.code).toBe('workspace_not_found');
  });

  it('Bob gets 404 on Alice project (top-level /projects/:id path)', async () => {
    const r = await request<{ code?: string }>(
      'GET',
      `/api/v1/projects/${aliceProjectId}`,
      undefined,
      cookieBob
    );
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('project_not_found');
  });

  // ─── RV-02 ────────────────────────────────────────────────────────

  it('Viewer (workspace Member, no project_members row) cannot PATCH via /workspaces/:wid/projects/:id', async () => {
    // Promote bob to workspace Member in Alice's workspace (but no project_members row).
    const bobUser = await prisma.user.findUnique({ where: { username: bob } });
    if (!bobUser) throw new Error('bob missing');
    await prisma.membership.create({
      data: {
        id: `rv01-m-${suffix}`,
        workspaceId: aliceWorkspaceId,
        userId: bobUser.id,
        role: 'Member'
      }
    });

    const r = await request<{ code?: string }>(
      'PATCH',
      `/api/v1/workspaces/${aliceWorkspaceId}/projects/${aliceProjectId}`,
      { name: 'hijacked', expectedRevision: 1 },
      cookieBob
    );
    // docs §6.1 / §7.2: insufficient privilege returns 403, not 409.
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('insufficient_project_role');
  });

  it('Viewer cannot DELETE via the same path', async () => {
    const r = await request<{ code?: string }>(
      'DELETE',
      `/api/v1/workspaces/${aliceWorkspaceId}/projects/${aliceProjectId}`,
      undefined,
      cookieBob
    );
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('insufficient_project_role');
  });

  it('Viewer cannot PATCH Alice entry', async () => {
    const r = await request<{ code?: string }>(
      'PATCH',
      `/api/v1/entries/${aliceEntryId}`,
      { title: 'tampered', expectedRevision: 1 },
      cookieBob
    );
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('insufficient_project_role');
  });

  it('Viewer cannot PATCH /projects/:id', async () => {
    const r = await request<{ code?: string }>(
      'PATCH',
      `/api/v1/projects/${aliceProjectId}`,
      { name: 'hijacked2', expectedRevision: 1 },
      cookieBob
    );
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('insufficient_project_role');
  });

  // ─── RV-10 ────────────────────────────────────────────────────────

  it('soft-deleted parent workspace hides children on every route', async () => {
    // Spin up a fresh workspace so we can archive it without breaking
    // the other RV-10 project-soft-delete test below.
    const ws = await request<{ id: string }>(
      'POST',
      '/api/v1/workspaces',
      { name: 'rv10-ws', slug: `rv10-${suffix}-ws` },
      cookieAlice
    );
    expect(ws.status).toBe(201);
    const wid = ws.body.id;
    const proj = await request<{ id: string }>(
      'POST',
      `/api/v1/workspaces/${wid}/projects`,
      {
        name: 'rv10-project',
        startDate: '2026-09-07',
        endDate: '2026-12-31'
      },
      cookieAlice
    );
    const pid = proj.body.id;
    const entry = await request<{ id: string }>(
      'POST',
      `/api/v1/projects/${pid}/entries`,
      { weekStartDate: '2026-09-07', title: 'rv10 secret', level: 'primary' },
      cookieAlice
    );
    const eid = entry.body.id;

    // Archive the workspace.
    const archive = await request(
      'DELETE',
      `/api/v1/workspaces/${wid}`,
      undefined,
      cookieAlice
    );
    expect(archive.status).toBe(204);

    // /workspaces list must not return the archived one.
    const list = await request<Array<{ id: string }>>(
      'GET',
      '/api/v1/workspaces',
      undefined,
      cookieAlice
    );
    expect(list.status).toBe(200);
    expect(list.body.find((w) => w.id === wid)).toBeUndefined();

    // Direct routes that previously leaked.
    const directProject = await request<{ code?: string }>(
      'GET',
      `/api/v1/projects/${pid}`,
      undefined,
      cookieAlice
    );
    expect(directProject.status).toBe(404);
    expect(directProject.body.code).toBe('project_not_found');

    const directEntry = await request<{ code?: string }>(
      'GET',
      `/api/v1/entries/${eid}`,
      undefined,
      cookieAlice
    );
    expect(directEntry.status).toBe(404);

    // Nested routes still 404. The workspace-scoped route hits
    // WorkspaceRolesGuard first, which returns workspace_not_found for
    // archived workspaces — this is the right answer (don't leak
    // whether the project exists at all).
    const nestedProject = await request<{ code?: string }>(
      'GET',
      `/api/v1/workspaces/${wid}/projects/${pid}`,
      undefined,
      cookieAlice
    );
    expect(nestedProject.status).toBe(404);
    expect(nestedProject.body.code).toBe('workspace_not_found');
  });

  it('only Owner can archive a workspace', async () => {
    const ws = await request<{ id: string }>(
      'POST',
      '/api/v1/workspaces',
      { name: 'rv10-owner', slug: `rv10-${suffix}-owner` },
      cookieAlice
    );
    expect(ws.status).toBe(201);
    const wid = ws.body.id;

    // Bob is not in this workspace at all → 404.
    const bobAttempt = await request<{ code?: string }>(
      'DELETE',
      `/api/v1/workspaces/${wid}`,
      undefined,
      cookieBob
    );
    expect(bobAttempt.status).toBe(404);

    const rename = await request<{ name: string; role: string }>(
      'PATCH',
      `/api/v1/workspaces/${wid}`,
      { name: 'rv10-owner-renamed' },
      cookieAlice
    );
    expect(rename.status).toBe(200);
    expect(rename.body.name).toBe('rv10-owner-renamed');
    expect(rename.body.role).toBe('Owner');

    const ownerArchive = await request(
      'DELETE',
      `/api/v1/workspaces/${wid}`,
      undefined,
      cookieAlice
    );
    expect(ownerArchive.status).toBe(204);
  });

  it('soft-deleted project is hidden from list and detail', async () => {
    // Alice (Owner) soft-deletes the project.
    const del = await request(
      'DELETE',
      `/api/v1/workspaces/${aliceWorkspaceId}/projects/${aliceProjectId}`,
      undefined,
      cookieAlice
    );
    expect(del.status).toBe(204);

    const list = await request<Array<{ id: string }>>(
      'GET',
      `/api/v1/workspaces/${aliceWorkspaceId}/projects`,
      undefined,
      cookieAlice
    );
    expect(list.status).toBe(200);
    expect(list.body.find((p) => p.id === aliceProjectId)).toBeUndefined();

    const detail = await request<{ code?: string }>(
      'GET',
      `/api/v1/projects/${aliceProjectId}`,
      undefined,
      cookieAlice
    );
    expect(detail.status).toBe(404);
    expect(detail.body.code).toBe('project_not_found');

    const nestedDetail = await request<{ code?: string }>(
      'GET',
      `/api/v1/workspaces/${aliceWorkspaceId}/projects/${aliceProjectId}`,
      undefined,
      cookieAlice
    );
    expect(nestedDetail.status).toBe(404);
    expect(nestedDetail.body.code).toBe('project_not_found');

    // The previously-fetched entry ID should now also 404 — the parent
    // project is gone so the entry route can't resolve the project id.
    const entryAfter = await request<{ code?: string }>(
      'GET',
      `/api/v1/entries/${aliceEntryId}`,
      undefined,
      cookieAlice
    );
    expect(entryAfter.status).toBe(404);
  });
});
