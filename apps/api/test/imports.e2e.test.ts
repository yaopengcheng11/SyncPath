/**
 * AC-08 — legacy JSON import pre-flight + apply.
 *
 *   A. Preview surfaces counts and warnings (no DB writes).
 *   B. Apply accepts the payload atomically: even with one bad row, good
 *      rows land and the summary reports the skipped count.
 *   C. Repeated apply of the same idempotency hash does not double-import
 *      a project (simplified: apply runs twice on the same target workspace
 *      and we assert the new workspace is created the first time only when
 *      a fresh workspaceName is supplied).
 *   D. Sensitive fields (password hashes, session tokens) in the legacy
 *      payload are silently stripped before reaching the DB.
 *
 * Run alongside identity.e2e.test.ts and tenancy.e2e.test.ts; all three
 * share the same `demo` and `ac02_*` users without conflict.
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
    try { parsed = JSON.parse(rawText); } catch { /* keep */ }
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
      password: 'ac08-pass-1234'
    }
  );
  if (r.status !== 201) {
    throw new Error(`register ${username} failed (${r.status}): ${r.rawText}`);
  }
  const setCookie = r.setCookie!;
  return pickCookie(setCookie)!;
}

describe('AC-08 legacy JSON import', () => {
  const username = `ac08_${Date.now()}`;
  let cookie: string;

  beforeAll(async () => {
    // Tear down any prior AC-08 fixtures in FK-safe order.
    await prisma.session.deleteMany({
      where: { user: { username: { startsWith: 'ac08_' } } }
    });
    await prisma.progressEntry.deleteMany({
      where: { project: { workspace: { name: { startsWith: 'ac08-' } } } }
    });
    await prisma.projectMember.deleteMany({
      where: { project: { workspace: { name: { startsWith: 'ac08-' } } } }
    });
    await prisma.project.deleteMany({
      where: { workspace: { name: { startsWith: 'ac08-' } } }
    });
    await prisma.membership.deleteMany({
      where: { workspace: { name: { startsWith: 'ac08-' } } }
    });
    await prisma.workspace.deleteMany({
      where: { name: { startsWith: 'ac08-' } }
    });
    await prisma.user.deleteMany({
      where: { username: { startsWith: 'ac08_' } }
    });
    cookie = await register(username);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── AC-08.A: validate never writes ────────────────────────────────────

  it('validate returns counts + warnings and writes nothing', async () => {
    const beforeProjects = await prisma.project.count();
    const validate = await fetchJson<{
      projects: number;
      entries: number;
      warnings: string[];
    }>(
      'POST',
      '/api/v1/imports/validate',
      {
        projects: [
          {
            name: 'Preview only',
            startDate: '2026-02-01',
            endDate: '2026-04-30',
            logs: [
              { author: 'A', level: 1, weekStartDate: '2026-02-02' },
              { author: 'B', level: 2, weekStartDate: '2026-02-09' }
            ]
          }
        ]
      },
      cookie
    );
    expect(validate.status).toBe(200);
    expect(validate.body.projects).toBe(1);
    expect(validate.body.entries).toBe(2);
    expect(validate.body.warnings.length).toBeGreaterThan(0);
    const afterProjects = await prisma.project.count();
    expect(afterProjects).toBe(beforeProjects);
  });

  // ── AC-08.B: apply imports what it can and reports skipped rows ─────

  it('apply creates the workspace + project and reports per-row skips', async () => {
    const apply = await fetchJson<{
      workspace: { created: boolean; name: string; slug: string; id: string };
      projects: Array<{
        name: string;
        created: boolean;
        entriesCreated: number;
        entriesSkipped: number;
      }>;
      totals: {
        projectsCreated: number;
        projectsSkipped: number;
        entriesCreated: number;
        entriesSkipped: number;
      };
    }>(
      'POST',
      '/api/v1/imports/apply',
      {
        accept: true,
        workspaceName: `ac08-ws-${username}`,
        projects: [
          {
            id: 'legacy-project-1',
            name: 'Legacy project',
            personnel: 'alice, bob, carol',
            description: 'imported via AC-08',
            startDate: '2026-02-01',
            endDate: '2026-04-30',
            logs: [
              {
                author: 'Kickoff',
                level: 1,
                weekStartDate: '2026-02-02',
                summary: 'Sprint 1',
                notes: 'old format',
                goals: [{ title: 'Plan', status: 'pending' }]
              },
              {
                author: 'Bad row',
                level: 2,
                weekStartDate: '',
                summary: 'no date'
              }
            ]
          }
        ]
      },
      cookie
    );
    expect(apply.status).toBe(201);
    expect(apply.body.workspace.created).toBe(true);
    expect(apply.body.totals.projectsCreated).toBe(1);
    expect(apply.body.totals.entriesCreated).toBe(1);
    expect(apply.body.totals.entriesSkipped).toBe(1);

    const created = apply.body.projects[0];
    expect(created.name).toBe('Legacy project');
    expect(created.entriesCreated).toBe(1);
    expect(created.entriesSkipped).toBe(1);
  });

  // ── AC-08.C: apply without accept fails closed ──────────────────────

  it('apply refuses to run without accept: true', async () => {
    const noAccept = await fetchJson<{ code?: string }>(
      'POST',
      '/api/v1/imports/apply',
      {
        workspaceName: 'never-created',
        projects: [{ name: 'x', startDate: '2026-02-01', endDate: '2026-04-30' }]
      },
      cookie
    );
    expect(noAccept.status).toBe(400);
    expect(noAccept.body.code).toBe('accept_required');
  });

  // ── AC-08.D: payload shape that includes sensitive fields is ignored ──

  it('payload containing passwordHash / token fields is silently dropped', async () => {
    const beforeUsers = await prisma.user.count();
    const beforeSessions = await prisma.session.count();
    const apply = await fetchJson<{ totals: { entriesCreated: number } }>(
      'POST',
      '/api/v1/imports/apply',
      {
        accept: true,
        workspaceName: `ac08-leak-${username}`,
        projects: [
          {
            name: 'Sensitive payload',
            startDate: '2026-02-01',
            endDate: '2026-04-30',
            passwordHash: 'should-be-stripped',
            sessionToken: 'opaque-leak',
            logs: [
              {
                author: 'one entry',
                level: 3,
                weekStartDate: '2026-02-09',
                summary: 'x',
                password: 'should-be-stripped',
                tokenHash: 'leak'
              }
            ]
          }
        ]
      },
      cookie
    );
    expect(apply.status).toBe(201);
    expect(apply.body.totals.entriesCreated).toBe(1);

    // The DB state should be unchanged for users + sessions; the new
    // workspace only has the one imported project + entry.
    expect(await prisma.user.count()).toBe(beforeUsers);
    expect(await prisma.session.count()).toBe(beforeSessions);

    const project = await prisma.project.findFirst({
      where: { name: 'Sensitive payload' },
      include: { workspace: true }
    });
    expect(project).toBeTruthy();
    // Description is empty: the passwordHash / sessionToken fields at the
    // project level are NOT mapped to any column on Project, so they
    // simply don't land.
    expect(project?.description ?? null).toBeNull();
  });

  // ── AC-08.E: re-applying to the same workspaceName does not duplicate ─

  it('re-applying with the same workspaceName reuses the workspace', async () => {
    const wsName = `ac08-idem-${username}`;
    const first = await fetchJson<{
      workspace: { created: boolean; id: string };
    }>(
      'POST',
      '/api/v1/imports/apply',
      {
        accept: true,
        workspaceName: wsName,
        projects: [
          {
            name: 'Idempotent A',
            startDate: '2026-02-01',
            endDate: '2026-04-30'
          }
        ]
      },
      cookie
    );
    expect(first.body.workspace.created).toBe(true);

    const second = await fetchJson<{
      workspace: { created: boolean; id: string };
    }>(
      'POST',
      '/api/v1/imports/apply',
      {
        accept: true,
        workspaceName: wsName,
        projects: [
          {
            name: 'Idempotent B',
            startDate: '2026-02-01',
            endDate: '2026-04-30'
          }
        ]
      },
      cookie
    );
    expect(second.body.workspace.created).toBe(false);
    expect(second.body.workspace.id).toBe(first.body.workspace.id);

    const projects = await prisma.project.findMany({
      where: { workspaceId: first.body.workspace.id }
    });
    expect(projects).toHaveLength(2);
  });
});
