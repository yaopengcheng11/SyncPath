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
type Account = { id: string; cookie: string; username: string };
type Receipt = {
  id: string; kind: 'workspace' | 'project'; name: string; workspaceName: string;
  sharedBy: { username: string; displayName: string | null };
  receivedAt: string; status: 'active' | 'unavailable';
};

async function request<T = unknown>(method: string, path: string, body?: unknown, cookie?: string, expectedUserId?: string) {
  const response = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(expectedUserId !== undefined ? { 'X-SyncPath-User-Id': expectedUserId } : {}) },
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
  let existingRecipient: Account;
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
    const username = `share_${role.slice(0, 8)}_${suffix}`;
    const created = await request<{ user: { id: string } }>('POST', '/sessions/register', {
      username, email: `${username}@syncpath.test`, password: 'share-fixture-1234'
    });
    expect(created.status).toBe(201);
    expect(created.cookie).toBeTruthy();
    const row = await prisma.user.findUniqueOrThrow({ where: { username } });
    ownedUserIds.push(row.id);
    return { id: row.id, cookie: created.cookie!, username };
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

  async function received(cookie = outsider.cookie) {
    const result = await request<Receipt[]>('GET', '/received-shares', undefined, cookie);
    expect(result.status).toBe(200);
    return result.body;
  }

  async function receiptFor(linkId: string, userId = outsider.id) {
    return prisma.receivedShare.findUniqueOrThrow({ where: { userId_linkId: { userId, linkId } } });
  }

  async function reopen(id: string, cookie = outsider.cookie) {
    return request<Content>('POST', `/received-shares/${id}/resolve`, undefined, cookie);
  }

  async function expectUnavailableReceipt(linkId: string) {
    const receipt = await receiptFor(linkId);
    expect((await received()).find((item) => item.id === receipt.id)?.status).toBe('unavailable');
    const result = await reopen(receipt.id);
    expect(result.status).toBe(404);
    expect(JSON.stringify(result.body)).not.toContain('Shared card');
  }

  beforeAll(async () => {
    owner = await register('owner');
    admin = await register('admin');
    lead = await register('lead');
    editor = await register('editor');
    viewer = await register('viewer');
    existingRecipient = await register('existing_recipient');
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
    expect(await prisma.receivedShare.count()).toBe(0);
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

  it('remembers a share for an existing external account and reopens it after logout and login', async () => {
    expect(await received(existingRecipient.cookie)).toEqual([]);
    const opened = await resolve(taskShare.token, existingRecipient.cookie);
    expect(opened.status).toBe(200);
    const receipt = await receiptFor(taskShare.id, existingRecipient.id);
    expect(await received(existingRecipient.cookie)).toEqual([{
      id: receipt.id, kind: 'project', name: 'Shared task', workspaceName: `Share fixture ${suffix}`,
      sharedBy: { username: owner.username, displayName: null },
      receivedAt: receipt.receivedAt.toISOString(), status: 'active'
    }]);
    expect((await request('DELETE', '/sessions/me', undefined, existingRecipient.cookie)).status).toBe(200);
    expect((await request('GET', '/received-shares', undefined, existingRecipient.cookie)).status).toBe(401);
    const login = await request('POST', '/sessions', { username: existingRecipient.username, password: 'share-fixture-1234' });
    expect(login.status).toBe(200);
    expect(login.cookie).toBeTruthy();
    existingRecipient.cookie = login.cookie!;
    expect((await received(existingRecipient.cookie)).map((item) => item.id)).toEqual([receipt.id]);
    expect((await reopen(receipt.id, existingRecipient.cookie)).body).toEqual(opened.body);
    expect(await prisma.membership.count({ where: { userId: existingRecipient.id } })).toBe(0);
    expect(await prisma.projectMember.count({ where: { userId: existingRecipient.id } })).toBe(0);
    expect([403, 404]).toContain((await request('PATCH', `/entries/${cardId}`, { title: 'Receipt write', expectedRevision: 1 }, existingRecipient.cookie)).status);
  });

  it('deduplicates concurrent first acceptance and never updates receipts during content polling', async () => {
    const link = await newTaskShare();
    const responses = await Promise.all(Array.from({ length: 8 }, () => resolve(link.token)));
    expect(responses.map((item) => item.status)).toEqual(Array(8).fill(200));
    expect(await prisma.receivedShare.count({ where: { userId: outsider.id, linkId: link.id } })).toBe(1);
    const before = await receiptFor(link.id);
    await resolve(link.token);
    await reopen(before.id);
    const after = await receiptFor(link.id);
    expect(after).toEqual(before);
    expect(JSON.stringify(await received())).not.toContain(link.token);
    expect(JSON.stringify(await received())).not.toContain('tokenHash');
  });

  it('rejects sharing reads after another tab switches the session account, before any receipt side effect', async () => {
    const link = await newTaskShare();
    const ownReceipt = await receiptFor(taskShare.id, existingRecipient.id);
    const count = await prisma.receivedShare.count({ where: { userId: existingRecipient.id } });
    const mismatched: Array<[string, string, unknown?]> = [
      ['POST', '/share-links/resolve', { token: link.token }],
      ['GET', '/received-shares'],
      ['POST', `/received-shares/${ownReceipt.id}/resolve`]
    ];
    for (const [method, path, body] of mismatched) {
      const result = await request<{ message: string }>(method, path, body, existingRecipient.cookie, outsider.id);
      expect(result.status, path).toBe(401);
      expect(result.body.message).toBe('Session changed');
      expect(JSON.stringify(result.body)).not.toContain('Shared task');
    }
    expect(await prisma.receivedShare.count({ where: { userId: existingRecipient.id } })).toBe(count);
    expect(await prisma.receivedShare.count({ where: { userId: existingRecipient.id, linkId: link.id } })).toBe(0);

    const opened = await request<Content>('POST', '/share-links/resolve', { token: link.token }, existingRecipient.cookie, existingRecipient.id);
    expect(opened.status).toBe(200);
    const receipt = await receiptFor(link.id, existingRecipient.id);
    const listing = await request<Receipt[]>('GET', '/received-shares', undefined, existingRecipient.cookie, existingRecipient.id);
    expect(listing.status).toBe(200);
    expect(listing.body.some((item) => item.id === receipt.id)).toBe(true);
    const reopened = await request<Content>('POST', `/received-shares/${receipt.id}/resolve`, undefined, existingRecipient.cookie, existingRecipient.id);
    expect(reopened.status).toBe(200);
    expect(reopened.body).toEqual(opened.body);
    expect((await request('GET', '/received-shares', undefined, undefined, existingRecipient.id)).status).toBe(401);
  });

  it('lists only the current account receipts and never resolves another recipients guessed ID', async () => {
    const receipt = await receiptFor(taskShare.id);
    expect((await received(existingRecipient.cookie)).some((item) => item.id === receipt.id)).toBe(false);
    expect((await reopen(receipt.id, existingRecipient.cookie)).status).toBe(404);
    expect((await reopen(newId(), existingRecipient.cookie)).status).toBe(404);
    expect((await request('POST', `/received-shares/${receipt.id}/resolve`)).status).toBe(401);
    expect((await request('GET', '/received-shares')).status).toBe(401);
  });

  it('reopens task and whole-workspace receipts with the exact original scope and Viewer roles', async () => {
    const taskReceipt = await receiptFor(taskShare.id);
    const workspaceReceipt = await receiptFor(workspaceShare.id);
    const task = await reopen(taskReceipt.id);
    expect(task.status).toBe(200);
    expect(task.body.projects.map((item) => item.id)).toEqual([projectId]);
    expect(task.body.entries.map((item) => item.id)).toEqual([cardId]);
    const workspace = await reopen(workspaceReceipt.id);
    expect(workspace.status).toBe(200);
    expect(workspace.body.projects.map((item) => item.id).sort()).toEqual([projectId, privateSiblingId, publicSiblingId].sort());
    expect(workspace.body.projects.every((item) => item.myRole === 'Viewer')).toBe(true);
    expect((await received()).find((item) => item.id === workspaceReceipt.id)).toMatchObject({
      kind: 'workspace', name: `Share fixture ${suffix}`, workspaceName: `Share fixture ${suffix}`, status: 'active'
    });
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
    await expectUnavailableReceipt(link.id);
    const listing = await request<Array<{ id: string; revokedAt: string | null }>>('GET', `/projects/${projectId}/share-links`, undefined, admin.cookie);
    expect(listing.body.find((item) => item.id === link.id)?.revokedAt).toBeTruthy();
  });

  it('immediately rejects a link whose task Lead has lost share authority', async () => {
    const link = await newTaskShare(lead.cookie);
    expect((await resolve(link.token)).status).toBe(200);
    await prisma.projectMember.update({ where: { projectId_userId: { projectId, userId: lead.id } }, data: { role: 'Editor' } });
    try {
      expect((await resolve(link.token)).status).toBe(404);
      await expectUnavailableReceipt(link.id);
    }
    finally { await prisma.projectMember.update({ where: { projectId_userId: { projectId, userId: lead.id } }, data: { role: 'Lead' } }); }
  });

  it('immediately rejects a workspace link when its administrator is demoted', async () => {
    const link = await request<Share>('POST', `/workspaces/${workspaceId}/share-links`, undefined, admin.cookie);
    expect(link.status).toBe(201);
    expect((await resolve(link.body.token)).status).toBe(200);
    await prisma.membership.update({ where: { workspaceId_userId: { workspaceId, userId: admin.id } }, data: { role: 'Member' } });
    try {
      expect((await resolve(link.body.token)).status).toBe(404);
      await expectUnavailableReceipt(link.body.id);
    }
    finally { await prisma.membership.update({ where: { workspaceId_userId: { workspaceId, userId: admin.id } }, data: { role: 'Admin' } }); }
  });

  it('rejects a task link when its creator loses parent membership even if a task Lead row remains', async () => {
    const link = await newTaskShare(lead.cookie);
    expect((await resolve(link.token)).status).toBe(200);
    const membership = await prisma.membership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId, userId: lead.id } } });
    await prisma.membership.delete({ where: { id: membership.id } });
    try {
      expect((await resolve(link.token)).status).toBe(404);
      await expectUnavailableReceipt(link.id);
    }
    finally { await prisma.membership.create({ data: membership }); }
  });

  it('rejects links from suspended or soft-deleted creators without exposing their former target', async () => {
    const link = await newTaskShare(lead.cookie);
    expect((await resolve(link.token)).status).toBe(200);
    await prisma.user.update({ where: { id: lead.id }, data: { status: 'suspended' } });
    try {
      expect((await resolve(link.token)).status).toBe(404);
      await expectUnavailableReceipt(link.id);
    }
    finally { await prisma.user.update({ where: { id: lead.id }, data: { status: 'active' } }); }
    await prisma.user.update({ where: { id: lead.id }, data: { deletedAt: new Date() } });
    try {
      expect((await resolve(link.token)).status).toBe(404);
      await expectUnavailableReceipt(link.id);
    }
    finally { await prisma.user.update({ where: { id: lead.id }, data: { deletedAt: null } }); }
  });

  it('requires an active recipient account for every new resolution', async () => {
    const receipt = await receiptFor(taskShare.id);
    await prisma.user.update({ where: { id: outsider.id }, data: { status: 'suspended' } });
    try {
      expect((await resolve(taskShare.token)).status).toBe(401);
      expect((await reopen(receipt.id)).status).toBe(401);
      expect((await request('GET', '/received-shares', undefined, outsider.cookie)).status).toBe(401);
    }
    finally { await prisma.user.update({ where: { id: outsider.id }, data: { status: 'active' } }); }
    await prisma.user.update({ where: { id: outsider.id }, data: { deletedAt: new Date() } });
    try {
      expect((await resolve(taskShare.token)).status).toBe(401);
      expect((await reopen(receipt.id)).status).toBe(401);
      expect((await request('GET', '/received-shares', undefined, outsider.cookie)).status).toBe(401);
    }
    finally { await prisma.user.update({ where: { id: outsider.id }, data: { deletedAt: null } }); }
  });

  it('rejects a task link after archive or soft-delete', async () => {
    const archivedTask = await createProject('Task to archive');
    const archivedLink = await newTaskShare(owner.cookie, archivedTask);
    expect((await resolve(archivedLink.token)).status).toBe(200);
    await prisma.project.update({ where: { id: archivedTask }, data: { status: 'archived' } });
    expect((await resolve(archivedLink.token)).status).toBe(404);
    await expectUnavailableReceipt(archivedLink.id);
    expect((await request('DELETE', `/share-links/${archivedLink.id}`, undefined, admin.cookie)).status).toBe(204);
    await prisma.project.update({ where: { id: archivedTask }, data: { status: 'active' } });
    expect((await resolve(archivedLink.token)).status).toBe(404);
    const deletedTask = await createProject('Task to delete');
    const deletedLink = await newTaskShare(owner.cookie, deletedTask);
    expect((await resolve(deletedLink.token)).status).toBe(200);
    await prisma.project.update({ where: { id: deletedTask }, data: { deletedAt: new Date() } });
    expect((await resolve(deletedLink.token)).status).toBe(404);
    await expectUnavailableReceipt(deletedLink.id);
  });

  it('rejects both workspace and nested task links after their parent project is archived', async () => {
    await prisma.workspace.update({ where: { id: workspaceId }, data: { deletedAt: new Date() } });
    try {
      expect((await resolve(workspaceShare.token)).status).toBe(404);
      expect((await resolve(taskShare.token)).status).toBe(404);
      await expectUnavailableReceipt(workspaceShare.id);
      await expectUnavailableReceipt(taskShare.id);
    } finally { await prisma.workspace.update({ where: { id: workspaceId }, data: { deletedAt: null } }); }
  });

  it('uses one unavailable envelope for malformed, unknown and revoked tokens', async () => {
    const link = await newTaskShare();
    await request('DELETE', `/share-links/${link.id}`, undefined, owner.cookie);
    const receiptCount = await prisma.receivedShare.count({ where: { userId: outsider.id } });
    for (const token of ['', 'bad-token', randomBytes(32).toString('base64url'), link.token]) {
      const result = await request<{ code: string; message: string }>('POST', '/share-links/resolve', { token }, outsider.cookie);
      expect(result.status).toBe(404);
      expect(result.body.code).toBe('share_not_found');
      expect(result.body.message).toBe('Share link not found or unavailable.');
    }
    expect(await prisma.receivedShare.count({ where: { userId: outsider.id } })).toBe(receiptCount);
  });

  it('preserves an unavailable metadata snapshot when the original task, workspace or creator is physically deleted', async () => {
    const task = await createProject('Receipt task removed');
    const taskLink = await newTaskShare(owner.cookie, task);
    expect((await resolve(taskLink.token)).status).toBe(200);
    const taskReceipt = await receiptFor(taskLink.id);
    await prisma.project.delete({ where: { id: task } });
    expect((await received()).find((item) => item.id === taskReceipt.id)).toMatchObject({
      name: 'Receipt task removed', sharedBy: { username: owner.username }, status: 'unavailable'
    });
    expect((await reopen(taskReceipt.id)).status).toBe(404);
    expect((await prisma.receivedShare.findUniqueOrThrow({ where: { id: taskReceipt.id } })).linkId).toBeNull();

    const workspace = await request<{ id: string }>('POST', '/workspaces', { name: 'Receipt project removed' }, owner.cookie);
    expect(workspace.status).toBe(201);
    ownedWorkspaceIds.push(workspace.body.id);
    const workspaceLink = await request<Share>('POST', `/workspaces/${workspace.body.id}/share-links`, undefined, owner.cookie);
    expect(workspaceLink.status).toBe(201);
    expect((await resolve(workspaceLink.body.token)).status).toBe(200);
    const workspaceReceipt = await receiptFor(workspaceLink.body.id);
    await prisma.workspace.delete({ where: { id: workspace.body.id } });
    expect((await received()).find((item) => item.id === workspaceReceipt.id)).toMatchObject({ name: 'Receipt project removed', status: 'unavailable' });
    expect((await reopen(workspaceReceipt.id)).status).toBe(404);

    const temporaryCreator = await register('removed_creator');
    await prisma.membership.create({ data: { id: newId(), workspaceId, userId: temporaryCreator.id, role: 'Member' } });
    await prisma.projectMember.create({ data: { id: newId(), projectId, userId: temporaryCreator.id, role: 'Lead' } });
    await prisma.user.update({ where: { id: temporaryCreator.id }, data: { displayName: 'Former sharer' } });
    const creatorLink = await newTaskShare(temporaryCreator.cookie);
    expect((await resolve(creatorLink.token)).status).toBe(200);
    const creatorReceipt = await receiptFor(creatorLink.id);
    await prisma.user.delete({ where: { id: temporaryCreator.id } });
    expect((await received()).find((item) => item.id === creatorReceipt.id)).toMatchObject({
      sharedBy: { username: temporaryCreator.username, displayName: 'Former sharer' }, status: 'unavailable'
    });
    expect((await reopen(creatorReceipt.id)).status).toBe(404);
  });

  it('rejects a database link that points at a task in a different workspace', async () => {
    await expect(prisma.shareLink.create({ data: {
      id: newId(), workspaceId: otherWorkspaceId, projectId, creatorId: owner.id,
      tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex')
    } })).rejects.toMatchObject({ code: 'P2003' });
  });
});
