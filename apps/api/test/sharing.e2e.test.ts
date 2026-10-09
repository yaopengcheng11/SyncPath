import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { newId } from '@syncpath/domain';

const API = process.env.API_BASE ?? 'http://127.0.0.1:3160';
const prisma = new PrismaClient();
type Share = { id: string; kind: 'workspace' | 'project'; token: string; revokedAt: string | null };
type Content = {
  kind: 'workspace' | 'project';
  workspace: { id: string; name: string };
  projects: Array<{ id: string; name: string; myRole: string }>;
  entries: Array<{ id: string; projectId: string; title: string; revision: number }>;
};
type Account = { id: string; cookie: string };

async function request<T = unknown>(method: string, path: string, body?: unknown, cookie?: string) {
  const response = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

describe('Authenticated capability links are scoped and read-only', () => {
  const suffix = `${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  const ownedUserIds: string[] = [];
  const ownedWorkspaceIds: string[] = [];
  let owner: Account;
  let admin: Account;
  let lead: Account;
  let editor: Account;
  let viewer: Account;
  let outsider: Account;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let projectId: string;
  let privateSiblingId: string;
  let publicSiblingId: string;
  let archivedSiblingId: string;
  let deletedSiblingId: string;
  let cardId: string;
  let taskShare: Share;
  let workspaceShare: Share;

  async function register(role: string): Promise<Account> {
    const username = `share_${role}_${suffix}`;
    const created = await request<{ user: { id: string } }>('POST', '/sessions/register', {
      username, email: `${username}@syncpath.test`, password: 'share-fixture-1234'
    });
    expect(created.status).toBe(201);
    expect(created.cookie).toBeTruthy();
    const row = await prisma.user.findUniqueOrThrow({ where: { username } });
    ownedUserIds.push(row.id);
    return { id: row.id, cookie: created.cookie! };
  }

  async function createProject(name: string, targetWorkspace = workspaceId, visibility: 'private' | 'workspace' = 'workspace'): Promise<string> {
    const result = await request<{ id: string }>('POST', `/workspaces/${targetWorkspace}/projects`, {
      name, startDate: '2026-10-05', endDate: '2026-12-31', visibility
    }, owner.cookie);
    expect(result.status).toBe(201);
    return result.body.id;
  }

  async function createCard(targetProject: string, title: string): Promise<string> {
    const result = await request<{ id: string }>('POST', `/projects/${targetProject}/entries`, {
      title, level: 'minor', weekStartDate: '2026-10-05', notes: 'Shared read-only notes'
    }, owner.cookie);
    expect(result.status).toBe(201);
    return result.body.id;
  }

  async function newTaskShare(cookie = owner.cookie, targetProject = projectId): Promise<Share> {
    const result = await request<Share>('POST', `/projects/${targetProject}/share-links`, undefined, cookie);
    expect(result.status).toBe(201);
    return result.body;
  }

  async function resolve(token: string, cookie = outsider.cookie) {
    return request<Content>('POST', '/share-links/resolve', { token }, cookie);
  }

  beforeAll(async () => {
    owner = await register('owner');
    admin = await register('admin');
    lead = await register('lead');
    editor = await register('editor');
    viewer = await register('viewer');
    const workspace = await request<{ id: string }>('POST', '/workspaces', { name: `Share fixture ${suffix}` }, owner.cookie);
    expect(workspace.status).toBe(201);
    workspaceId = workspace.body.id;
    ownedWorkspaceIds.push(workspaceId);
    const other = await request<{ id: string }>('POST', '/workspaces', { name: `Other share fixture ${suffix}` }, owner.cookie);
    expect(other.status).toBe(201);
    otherWorkspaceId = other.body.id;
    ownedWorkspaceIds.push(otherWorkspaceId);
    await prisma.membership.createMany({ data: [admin, lead, editor, viewer].map((account) => ({
      id: newId(), workspaceId, userId: account.id, role: account.id === admin.id ? 'Admin' as const : 'Member' as const
    })) });
    projectId = await createProject('Shared task', workspaceId, 'private');
    privateSiblingId = await createProject('Private sibling', workspaceId, 'private');
    publicSiblingId = await createProject('Public sibling');
    archivedSiblingId = await createProject('Archived sibling');
    deletedSiblingId = await createProject('Deleted sibling');
    const otherProjectId = await createProject('Other tenant task', otherWorkspaceId);
    await prisma.project.update({ where: { id: archivedSiblingId }, data: { status: 'archived' } });
    await prisma.project.update({ where: { id: deletedSiblingId }, data: { deletedAt: new Date() } });
    await prisma.projectMember.createMany({ data: [
      { id: newId(), projectId, userId: lead.id, role: 'Lead' },
      { id: newId(), projectId, userId: editor.id, role: 'Editor' },
      { id: newId(), projectId, userId: viewer.id, role: 'Viewer' }
    ] });
    cardId = await createCard(projectId, 'Shared card');
    await createCard(privateSiblingId, 'Private sibling card');
    await createCard(publicSiblingId, 'Public sibling card');
    await createCard(otherProjectId, 'Other tenant card');
    taskShare = await newTaskShare();
    const sharedWorkspace = await request<Share>('POST', `/workspaces/${workspaceId}/share-links`, undefined, owner.cookie);
    expect(sharedWorkspace.status).toBe(201);
    workspaceShare = sharedWorkspace.body;
  });

  afterAll(async () => {
    // Cleanup only this suite's exact IDs. The runner owns the entire database.
    await prisma.workspace.deleteMany({ where: { id: { in: ownedWorkspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownedUserIds } } });
    await prisma.$disconnect();
  });

  it('does not disclose a shared target until the recipient registers or logs in', async () => {
    const anonymous = await request('POST', '/share-links/resolve', { token: taskShare.token });
    expect(anonymous.status).toBe(401);
    expect(JSON.stringify(anonymous.body)).not.toContain('Shared task');
    expect(JSON.stringify(anonymous.body)).not.toContain(workspaceId);
    outsider = await register('recipient');
    expect((await resolve(taskShare.token)).status).toBe(200);
  });

  it('returns exactly the shared task and its cards, without public/private siblings', async () => {
    const result = await resolve(taskShare.token);
    expect(result.status).toBe(200);
    expect(result.body.kind).toBe('project');
    expect(result.body.workspace.id).toBe(workspaceId);
    expect(result.body.projects.map((item) => item.id)).toEqual([projectId]);
    expect(result.body.projects[0].myRole).toBe('Viewer');
    expect(result.body.entries.map((item) => item.id)).toEqual([cardId]);
    expect(JSON.stringify(result.body)).not.toContain('sibling');
  });

  it('shares all current active tasks in one workspace, including private tasks, without another tenant', async () => {
    const result = await resolve(workspaceShare.token);
    expect(result.status).toBe(200);
    expect(result.body.kind).toBe('workspace');
    expect(result.body.projects.map((item) => item.id).sort()).toEqual([projectId, privateSiblingId, publicSiblingId].sort());
    expect(result.body.projects.every((item) => item.myRole === 'Viewer')).toBe(true);
    expect(result.body.entries).toHaveLength(3);
    expect(result.body.entries.every((entry) => [projectId, privateSiblingId, publicSiblingId].includes(entry.projectId))).toBe(true);
    expect(JSON.stringify(result.body)).not.toContain('Other tenant');
    expect(JSON.stringify(result.body)).not.toContain(archivedSiblingId);
    expect(JSON.stringify(result.body)).not.toContain(deletedSiblingId);
  });

  it('never creates workspace or task membership, or access through ordinary read routes', async () => {
    expect(await prisma.membership.count({ where: { userId: outsider.id } })).toBe(0);
    expect(await prisma.projectMember.count({ where: { userId: outsider.id } })).toBe(0);
    expect((await request<unknown[]>('GET', '/workspaces', undefined, outsider.cookie)).body).toEqual([]);
    for (const path of [`/workspaces/${workspaceId}`, `/workspaces/${workspaceId}/projects`, `/projects/${projectId}`, `/projects/${projectId}/entries`, `/entries/${cardId}`, `/projects/${privateSiblingId}`, `/projects/${projectId}/members`, `/workspaces/${workspaceId}/members`]) {
      expect([403, 404], path).toContain((await request('GET', path, undefined, outsider.cookie)).status);
    }
  });

  it('denies recipients every existing mutation, membership, settings, presence and resharing surface', async () => {
    const attempts: Array<[string, string, unknown?]> = [
      ['POST', `/projects/${projectId}/entries`, { title: 'Forged create', level: 'minor', weekStartDate: '2026-10-05' }],
      ['PATCH', `/entries/${cardId}`, { title: 'Forged edit', expectedRevision: 1 }],
      ['PATCH', `/entries/${cardId}`, { weekStartDate: '2026-10-12', expectedRevision: 1 }],
      ['PATCH', `/entries/${cardId}`, { isLocked: true, expectedRevision: 1 }],
      ['DELETE', `/entries/${cardId}?expectedRevision=1`],
      ['PATCH', `/projects/${projectId}`, { name: 'Forged task', expectedRevision: 1 }],
      ['DELETE', `/projects/${projectId}`],
      ['POST', `/workspaces/${workspaceId}/projects`, { name: 'Forged task', startDate: '2026-10-05', endDate: '2026-12-31' }],
      ['PATCH', `/workspaces/${workspaceId}`, { name: 'Forged project' }],
      ['DELETE', `/workspaces/${workspaceId}`],
      ['POST', `/projects/${projectId}/members`, { userId: outsider.id, role: 'Lead' }],
      ['PATCH', `/projects/${projectId}/members/${owner.id}`, { role: 'Viewer' }],
      ['DELETE', `/projects/${projectId}/members/${owner.id}`],
      ['POST', `/workspaces/${workspaceId}/members`, { userId: outsider.id, role: 'Admin' }],
      ['PATCH', `/workspaces/${workspaceId}/members/${admin.id}`, { role: 'Member' }],
      ['DELETE', `/workspaces/${workspaceId}/members/${lead.id}`],
      ['POST', `/projects/${projectId}/presence`, { clientId: 'forged', action: 'Viewing', targetId: null }],
      ['DELETE', `/projects/${projectId}/presence?clientId=forged`],
      ['POST', `/projects/${projectId}/share-links`],
      ['GET', `/projects/${projectId}/share-links`],
      ['POST', `/workspaces/${workspaceId}/share-links`],
      ['GET', `/workspaces/${workspaceId}/share-links`],
      ['DELETE', `/share-links/${taskShare.id}`]
    ];
    for (const [method, path, body] of attempts) {
      expect([403, 404], `${method} ${path}`).toContain((await request(method, path, body, outsider.cookie)).status);
    }
    const card = await prisma.progressEntry.findUniqueOrThrow({ where: { id: cardId } });
    expect(card).toMatchObject({ title: 'Shared card', revision: 1, isLocked: false, deletedAt: null });
    expect(await prisma.progressEntry.count({ where: { projectId } })).toBe(1);
  });

  it('stores only SHA-256 hashes and exposes no token again in metadata lists', async () => {
    expect(taskShare.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await prisma.shareLink.findUniqueOrThrow({ where: { id: taskShare.id } });
    expect(stored.tokenHash).toBe(createHash('sha256').update(taskShare.token).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(taskShare.token);
    const metadata = await request<Array<Record<string, unknown>>>('GET', `/projects/${projectId}/share-links`, undefined, owner.cookie);
    expect(metadata.status).toBe(200);
    expect(metadata.body.some((link) => link.id === taskShare.id)).toBe(true);
    expect(metadata.body.every((link) => !('token' in link) && !('tokenHash' in link))).toBe(true);
  });

  it('allows only workspace administrators to share a workspace, and task Lead or administrator to share one task', async () => {
    for (const account of [lead, editor, viewer, outsider]) {
      expect((await request('POST', `/workspaces/${workspaceId}/share-links`, undefined, account.cookie)).status).toBe(403);
    }
    for (const account of [editor, viewer, outsider]) {
      expect((await request('POST', `/projects/${projectId}/share-links`, undefined, account.cookie)).status).toBe(403);
    }
    expect((await request('POST', `/workspaces/${workspaceId}/share-links`, undefined, admin.cookie)).status).toBe(201);
    expect((await newTaskShare(lead.cookie)).kind).toBe('project');
    expect((await newTaskShare(admin.cookie)).kind).toBe('project');
  });

  it('lets a current administrator revoke another creator link and refuses every new resolution afterwards', async () => {
    const link = await newTaskShare(lead.cookie);
    expect((await resolve(link.token)).status).toBe(200);
    expect((await request('DELETE', `/share-links/${link.id}`, undefined, admin.cookie)).status).toBe(204);
    expect((await request('DELETE', `/share-links/${link.id}`, undefined, admin.cookie)).status).toBe(204);
    expect((await resolve(link.token)).status).toBe(404);
    const listing = await request<Array<{ id: string; revokedAt: string | null }>>('GET', `/projects/${projectId}/share-links`, undefined, admin.cookie);
    expect(listing.body.find((item) => item.id === link.id)?.revokedAt).toBeTruthy();
  });

  it('immediately rejects a link whose task Lead has lost share authority', async () => {
    const link = await newTaskShare(lead.cookie);
    expect((await resolve(link.token)).status).toBe(200);
    await prisma.projectMember.update({ where: { projectId_userId: { projectId, userId: lead.id } }, data: { role: 'Editor' } });
    try { expect((await resolve(link.token)).status).toBe(404); }
    finally { await prisma.projectMember.update({ where: { projectId_userId: { projectId, userId: lead.id } }, data: { role: 'Lead' } }); }
  });

  it('immediately rejects a workspace link when its administrator is demoted', async () => {
    const link = await request<Share>('POST', `/workspaces/${workspaceId}/share-links`, undefined, admin.cookie);
    expect(link.status).toBe(201);
    await prisma.membership.update({ where: { workspaceId_userId: { workspaceId, userId: admin.id } }, data: { role: 'Member' } });
    try { expect((await resolve(link.body.token)).status).toBe(404); }
    finally { await prisma.membership.update({ where: { workspaceId_userId: { workspaceId, userId: admin.id } }, data: { role: 'Admin' } }); }
  });

  it('rejects a task link when its creator loses parent membership even if a task Lead row remains', async () => {
    const link = await newTaskShare(lead.cookie);
    const membership = await prisma.membership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId, userId: lead.id } } });
    await prisma.membership.delete({ where: { id: membership.id } });
    try { expect((await resolve(link.token)).status).toBe(404); }
    finally { await prisma.membership.create({ data: membership }); }
  });

  it('rejects links from suspended or soft-deleted creators without exposing their former target', async () => {
    const link = await newTaskShare(lead.cookie);
    await prisma.user.update({ where: { id: lead.id }, data: { status: 'suspended' } });
    try { expect((await resolve(link.token)).status).toBe(404); }
    finally { await prisma.user.update({ where: { id: lead.id }, data: { status: 'active' } }); }
    await prisma.user.update({ where: { id: lead.id }, data: { deletedAt: new Date() } });
    try { expect((await resolve(link.token)).status).toBe(404); }
    finally { await prisma.user.update({ where: { id: lead.id }, data: { deletedAt: null } }); }
  });

  it('requires an active recipient account for every new resolution', async () => {
    await prisma.user.update({ where: { id: outsider.id }, data: { status: 'suspended' } });
    try { expect((await resolve(taskShare.token)).status).toBe(401); }
    finally { await prisma.user.update({ where: { id: outsider.id }, data: { status: 'active' } }); }
    await prisma.user.update({ where: { id: outsider.id }, data: { deletedAt: new Date() } });
    try { expect((await resolve(taskShare.token)).status).toBe(401); }
    finally { await prisma.user.update({ where: { id: outsider.id }, data: { deletedAt: null } }); }
  });

  it('rejects a task link after archive or soft-delete', async () => {
    const archivedTask = await createProject('Task to archive');
    const archivedLink = await newTaskShare(owner.cookie, archivedTask);
    await prisma.project.update({ where: { id: archivedTask }, data: { status: 'archived' } });
    expect((await resolve(archivedLink.token)).status).toBe(404);
    expect((await request('DELETE', `/share-links/${archivedLink.id}`, undefined, admin.cookie)).status).toBe(204);
    await prisma.project.update({ where: { id: archivedTask }, data: { status: 'active' } });
    expect((await resolve(archivedLink.token)).status).toBe(404);
    const deletedTask = await createProject('Task to delete');
    const deletedLink = await newTaskShare(owner.cookie, deletedTask);
    await prisma.project.update({ where: { id: deletedTask }, data: { deletedAt: new Date() } });
    expect((await resolve(deletedLink.token)).status).toBe(404);
  });

  it('rejects both workspace and nested task links after their parent project is archived', async () => {
    await prisma.workspace.update({ where: { id: workspaceId }, data: { deletedAt: new Date() } });
    try {
      expect((await resolve(workspaceShare.token)).status).toBe(404);
      expect((await resolve(taskShare.token)).status).toBe(404);
    } finally { await prisma.workspace.update({ where: { id: workspaceId }, data: { deletedAt: null } }); }
  });

  it('uses one unavailable envelope for malformed, unknown and revoked tokens', async () => {
    const link = await newTaskShare();
    await request('DELETE', `/share-links/${link.id}`, undefined, owner.cookie);
    for (const token of ['', 'bad-token', randomBytes(32).toString('base64url'), link.token]) {
      const result = await request<{ code: string; message: string }>('POST', '/share-links/resolve', { token }, outsider.cookie);
      expect(result.status).toBe(404);
      expect(result.body.code).toBe('share_not_found');
      expect(result.body.message).toBe('Share link not found or unavailable.');
    }
  });

  it('rejects a database link that points at a task in a different workspace', async () => {
    await expect(prisma.shareLink.create({ data: {
      id: newId(), workspaceId: otherWorkspaceId, projectId, creatorId: owner.id,
      tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex')
    } })).rejects.toMatchObject({ code: 'P2003' });
  });
});
