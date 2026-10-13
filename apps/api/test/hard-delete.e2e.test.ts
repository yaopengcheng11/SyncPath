import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { newId } from '@syncpath/domain';
import type { CreateEntryBody, PublicEntry } from '../src/modules/entries/dto';
import type { PublicProject } from '../src/modules/projects/dto';
import type { TimelineChange, TimelineSnapshot, TimelineVersionDetail, TimelineVersionPage } from '../src/modules/timeline-history/dto';

// vitest.config.ts verifies the disposable database and isolated API first.
const API = process.env.API_BASE!;
const prisma = new PrismaClient();
type Account = { id: string; cookie: string };
type Share = { id: string; token: string };
type ErrorBody = { code?: string };

async function call<T = unknown>(method: string, path: string, cookie: string, body?: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

describe('permanent deletion removes owned data and keeps unrelated records', () => {
  const suffix = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const ownedUserIds: string[] = [];
  const ownedWorkspaceIds: string[] = [];
  let owner: Account; let admin: Account; let lead: Account;
  let editor: Account; let viewer: Account; let outsider: Account;
  let untouchedWorkspaceId: string;

  async function register(label: string): Promise<Account> {
    const username = `hd_${label}_${suffix}`;
    const response = await fetch(`${API}/api/v1/sessions/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email: `${username}@syncpath.test`, password: 'hard-delete-fixture-1234' })
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { user: { id: string } };
    ownedUserIds.push(body.user.id);
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    expect(cookie).toBeTruthy();
    return { id: body.user.id, cookie: cookie! };
  }

  async function workspace(label: string): Promise<string> {
    const result = await call<{ id: string }>('POST', '/workspaces', owner.cookie, {
      name: `${label} ${suffix}`, slug: `hard-delete-${suffix}-${ownedWorkspaceIds.length}`
    });
    expect(result.status).toBe(201);
    const id = result.body.id;
    ownedWorkspaceIds.push(id);
    await prisma.membership.createMany({ data: [admin, lead, editor, viewer].map((account) => ({
      id: newId(), workspaceId: id, userId: account.id, role: account.id === admin.id ? 'Admin' as const : 'Member' as const
    })) });
    return id;
  }

  async function project(workspaceId: string, name: string): Promise<PublicProject> {
    const result = await call<PublicProject>('POST', `/workspaces/${workspaceId}/projects`, owner.cookie, {
      name, startDate: '2026-01-01', endDate: '2026-12-31'
    });
    expect(result.status).toBe(201);
    await prisma.projectMember.createMany({ data: [
      { id: newId(), projectId: result.body.id, userId: lead.id, role: 'Lead' },
      { id: newId(), projectId: result.body.id, userId: editor.id, role: 'Editor' },
      { id: newId(), projectId: result.body.id, userId: viewer.id, role: 'Viewer' }
    ] });
    return result.body;
  }

  async function card(projectId: string, title: string, fields: Partial<CreateEntryBody> = {}): Promise<PublicEntry> {
    const result = await call<PublicEntry>('POST', `/projects/${projectId}/entries`, owner.cookie, {
      title, weekStartDate: '2026-06-01', level: 'primary', mentionedUserIds: [viewer.id], ...fields
    });
    expect(result.status).toBe(201);
    return result.body;
  }

  async function share(kind: 'workspace' | 'project', targetId: string): Promise<Share> {
    const path = kind === 'workspace' ? `/workspaces/${targetId}/share-links` : `/projects/${targetId}/share-links`;
    const result = await call<Share>('POST', path, owner.cookie);
    expect(result.status).toBe(201);
    return result.body;
  }

  async function receive(link: Share): Promise<string> {
    expect((await call('POST', '/share-links/resolve', outsider.cookie, { token: link.token })).status).toBe(200);
    const receipt = await prisma.receivedShare.findUniqueOrThrow({ where: { userId_linkId: { userId: outsider.id, linkId: link.id } } });
    return receipt.id;
  }

  const projectRelations = {
    entries: { orderBy: { id: 'asc' as const } },
    members: { orderBy: { id: 'asc' as const } },
    mentionNotifications: { orderBy: { id: 'asc' as const } },
    timelineVersions: { orderBy: { version: 'asc' as const } },
    shareLinks: { orderBy: { id: 'asc' as const }, include: { receivedShares: { orderBy: { id: 'asc' as const } } } }
  };
  const projectState = (id: string) => prisma.project.findUniqueOrThrow({ where: { id }, include: projectRelations });

  async function untouchedState() {
    return {
      workspace: await prisma.workspace.findUniqueOrThrow({ where: { id: untouchedWorkspaceId }, include: {
        memberships: { orderBy: { id: 'asc' } },
        mentionNotifications: { orderBy: { id: 'asc' } },
        shareLinks: { orderBy: { id: 'asc' }, include: { receivedShares: { orderBy: { id: 'asc' } } } },
        projects: { orderBy: { id: 'asc' }, include: projectRelations }
      } }),
      users: await prisma.user.findMany({ where: { id: { in: ownedUserIds } }, orderBy: { id: 'asc' } }),
      sessions: await prisma.session.findMany({ where: { userId: { in: ownedUserIds } }, orderBy: { id: 'asc' } })
    };
  }

  async function expectProjectGone(id: string, receiptIds: string[]) {
    expect(await prisma.project.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.progressEntry.count({ where: { projectId: id } })).toBe(0);
    expect(await prisma.projectMember.count({ where: { projectId: id } })).toBe(0);
    expect(await prisma.mentionNotification.count({ where: { projectId: id } })).toBe(0);
    expect(await prisma.timelineVersion.count({ where: { projectId: id } })).toBe(0);
    expect(await prisma.shareLink.count({ where: { projectId: id } })).toBe(0);
    expect(await prisma.receivedShare.count({ where: { id: { in: receiptIds } } })).toBe(0);
  }

  beforeAll(async () => {
    owner = await register('owner'); admin = await register('admin'); lead = await register('lead');
    editor = await register('editor'); viewer = await register('viewer'); outsider = await register('outside');
    untouchedWorkspaceId = await workspace('Unrelated project');
    const untouched = await project(untouchedWorkspaceId, 'Unrelated task');
    await card(untouched.id, 'Unrelated card', { summary: 'Keep this summary', notes: 'Keep these notes' });
    await receive(await share('project', untouched.id));
  });

  afterAll(async () => {
    // These exact IDs belong to this suite; the safe runner owns the database.
    await prisma.workspace.deleteMany({ where: { id: { in: ownedWorkspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownedUserIds } } });
    await prisma.$disconnect();
  });

  it('rejects non-owner workspace deletion and insufficient task/card roles without changing any rows', async () => {
    const workspaceId = await workspace('Permission fixture');
    const target = await project(workspaceId, 'Protected task');
    const entry = await card(target.id, 'Protected card');
    const receiptId = await receive(await share('project', target.id));
    const before = await projectState(target.id);
    const receiptBefore = await prisma.receivedShare.findUniqueOrThrow({ where: { id: receiptId } });
    const workspaceBefore = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });

    for (const account of [admin, lead, editor, viewer]) {
      const result = await call<ErrorBody>('DELETE', `/workspaces/${workspaceId}`, account.cookie);
      expect(result.status).toBe(403); expect(result.body.code).toBe('owner_required');
    }
    expect((await call('DELETE', `/workspaces/${workspaceId}`, outsider.cookie)).status).toBe(404);
    for (const account of [editor, viewer]) for (const path of [`/projects/${target.id}`, `/workspaces/${workspaceId}/projects/${target.id}`]) {
      const result = await call<ErrorBody>('DELETE', path, account.cookie);
      expect(result.status).toBe(403); expect(result.body.code).toBe('insufficient_project_role');
    }
    const cardDenied = await call<ErrorBody>('DELETE', `/entries/${entry.id}?expectedRevision=${entry.revision}`, viewer.cookie);
    expect(cardDenied.status).toBe(403); expect(cardDenied.body.code).toBe('insufficient_project_role');
    expect((await call('DELETE', `/entries/${entry.id}?expectedRevision=${entry.revision}`, outsider.cookie)).status).toBe(404);
    expect((await call('DELETE', `/projects/${target.id}`, outsider.cookie)).status).toBe(404);
    expect(await projectState(target.id)).toEqual(before);
    expect(await prisma.receivedShare.findUniqueOrThrow({ where: { id: receiptId } })).toEqual(receiptBefore);
    expect(await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).toEqual(workspaceBefore);
  });

  it('rejects archived status through both task update paths without writing settings or history', async () => {
    const workspaceId = await workspace('Status fixture');
    const target = await project(workspaceId, 'Active task');
    await card(target.id, 'Active card');
    const before = await projectState(target.id);
    for (const path of [`/projects/${target.id}`, `/workspaces/${workspaceId}/projects/${target.id}`]) {
      const result = await call<ErrorBody>('PATCH', path, owner.cookie, { expectedRevision: target.revision, status: 'archived' });
      expect(result.status).toBe(400); expect(result.body.code).toBe('unsupported_project_status');
      expect(await projectState(target.id)).toEqual(before);
    }
  });

  it('retains locked cards and rejects a stale delete revision without removing history or mentions', async () => {
    const workspaceId = await workspace('Card conflict fixture');
    const target = await project(workspaceId, 'Card conflicts');
    let entry = await card(target.id, 'Conflict card');
    const lock = await call<PublicEntry>('PATCH', `/entries/${entry.id}`, editor.cookie, { expectedRevision: entry.revision, isLocked: true });
    expect(lock.status).toBe(200); entry = lock.body;
    const lockedBefore = await projectState(target.id);
    const locked = await call<ErrorBody>('DELETE', `/entries/${entry.id}?expectedRevision=${entry.revision}`, owner.cookie);
    expect(locked.status).toBe(409); expect(locked.body.code).toBe('entry_locked');
    expect(await projectState(target.id)).toEqual(lockedBefore);
    const oldRevision = entry.revision;
    const unlock = await call<PublicEntry>('PATCH', `/entries/${entry.id}`, editor.cookie, { expectedRevision: entry.revision, isLocked: false });
    expect(unlock.status).toBe(200); entry = unlock.body;
    const unlockedBefore = await projectState(target.id);
    const stale = await call<ErrorBody>('DELETE', `/entries/${entry.id}?expectedRevision=${oldRevision}`, owner.cookie);
    expect(stale.status).toBe(409); expect(stale.body.code).toBe('revision_conflict');
    const invalid = await call<ErrorBody>('DELETE', `/entries/${entry.id}?expectedRevision=invalid`, owner.cookie);
    expect(invalid.status).toBe(409); expect(invalid.body.code).toBe('invalid_expected_revision');
    expect(await projectState(target.id)).toEqual(unlockedBefore);
  });

  it('physically deletes a card, erases all its historical content and retains the other card history', async () => {
    const workspaceId = await workspace('Card erasure fixture');
    const target = await project(workspaceId, 'Erase one card');
    const secret = {
      title: `erase-title-original-${suffix}`, summary: `erase-summary-original-${suffix}`, notes: `erase-notes-original-${suffix}`
    };
    let erased = await card(target.id, secret.title, secret);
    const survivor = await card(target.id, `retained-card-${suffix}`, { summary: 'Retained initial summary', notes: 'Retained notes' });
    const changedSecret = {
      title: `erase-title-edited-${suffix}`, summary: `erase-summary-edited-${suffix}`, notes: `erase-notes-edited-${suffix}`
    };
    const edited = await call<PublicEntry>('PATCH', `/entries/${erased.id}`, editor.cookie, { expectedRevision: erased.revision, ...changedSecret });
    expect(edited.status).toBe(200); erased = edited.body;
    const survivorUpdate = await call<PublicEntry>('PATCH', `/entries/${survivor.id}`, owner.cookie, { expectedRevision: survivor.revision, summary: 'Retained updated summary' });
    expect(survivorUpdate.status).toBe(200);
    expect((await call('PATCH', `/projects/${target.id}`, owner.cookie, { expectedRevision: target.revision, name: 'Retained task settings' })).status).toBe(200);
    const before = await projectState(target.id);
    const untouchedBefore = await untouchedState();
    const linkedVersions = before.timelineVersions.filter((row) => row.entryId === erased.id);
    const retainedVersions = before.timelineVersions.filter((row) => row.entryId !== erased.id);
    expect(linkedVersions).toHaveLength(2);
    expect(retainedVersions.some((row) => (row.snapshot as unknown as TimelineSnapshot).entries.some((entry) => entry.id === erased.id))).toBe(true);
    expect(before.mentionNotifications.some((row) => row.entryId === erased.id)).toBe(true);
    expect(before.mentionNotifications.some((row) => row.entryId === survivor.id)).toBe(true);

    const deleted = await call('DELETE', `/entries/${erased.id}?expectedRevision=${erased.revision}`, editor.cookie);
    expect(deleted.status).toBe(204); expect(deleted.body).toBeNull();
    expect(await prisma.progressEntry.findUnique({ where: { id: erased.id } })).toBeNull();
    expect(await prisma.mentionNotification.count({ where: { entryId: erased.id } })).toBe(0);
    expect(await prisma.timelineVersion.count({ where: { projectId: target.id, entryId: erased.id } })).toBe(0);
    const after = await projectState(target.id);
    expect(after.timelineRevision).toBe(before.timelineRevision + 1);
    expect(after.timelineVersions.map((row) => row.id)).toEqual(retainedVersions.map((row) => row.id));
    expect(after.timelineVersions.some((row) => row.action === 'entry.deleted')).toBe(false);
    const serialized = JSON.stringify(after.timelineVersions);
    for (const value of [erased.id, ...Object.values(secret), ...Object.values(changedSecret)]) expect(serialized).not.toContain(value);
    expect(after.timelineVersions).toEqual(retainedVersions.map((row) => ({
      ...row,
      changes: (row.changes as unknown as TimelineChange[]).filter((change) => !(change.entity === 'card' && change.entityId === erased.id)),
      snapshot: { ...row.snapshot as unknown as TimelineSnapshot,
        entries: (row.snapshot as unknown as TimelineSnapshot).entries.filter((entry) => entry.id !== erased.id)
      }
    })));
    expect(after.entries).toEqual(before.entries.filter((entry) => entry.id !== erased.id));
    expect(after.mentionNotifications).toEqual(before.mentionNotifications.filter((row) => row.entryId !== erased.id));
    expect(after.members).toEqual(before.members);
    expect(after.shareLinks).toEqual(before.shareLinks);
    expect(await untouchedState()).toEqual(untouchedBefore);

    const listed = await call<TimelineVersionPage>('GET', `/projects/${target.id}/timeline-versions`, owner.cookie);
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((row) => row.id).sort()).toEqual(retainedVersions.map((row) => row.id).sort());
    for (const row of listed.body.items) {
      const detail = await call<TimelineVersionDetail>('GET', `/projects/${target.id}/timeline-versions/${row.id}`, owner.cookie);
      expect(detail.status).toBe(200);
      for (const value of [erased.id, ...Object.values(secret), ...Object.values(changedSecret)]) expect(JSON.stringify(detail.body)).not.toContain(value);
    }
    for (const row of linkedVersions) expect((await call('GET', `/projects/${target.id}/timeline-versions/${row.id}`, owner.cookie)).status).toBe(404);
    expect((await call('GET', `/entries/${erased.id}`, owner.cookie)).status).toBe(404);
    expect((await call('DELETE', `/entries/${erased.id}?expectedRevision=${erased.revision}`, owner.cookie)).status).toBe(404);

    // Future snapshots must use the advanced counter and never recover the erased card.
    const next = await call<PublicEntry>('PATCH', `/entries/${survivor.id}`, owner.cookie, {
      expectedRevision: survivorUpdate.body.revision, notes: 'Retained next notes'
    });
    expect(next.status).toBe(200);
    const nextProject = await projectState(target.id);
    expect(nextProject.timelineRevision).toBe(after.timelineRevision + 1);
    const latest = nextProject.timelineVersions[nextProject.timelineVersions.length - 1];
    expect(latest.version).toBe(after.timelineRevision + 1);
    expect((latest.snapshot as unknown as TimelineSnapshot).entries.map((row) => row.id)).toEqual([survivor.id]);
    expect(JSON.stringify(nextProject.timelineVersions)).not.toContain(erased.id);
  });

  it.each(['direct', 'workspace'] as const)('physically deletes a task through the %s route and removes its receipts only', async (route) => {
    const workspaceId = await workspace(`Task cascade ${route}`);
    const target = await project(workspaceId, `Delete task ${route}`);
    const sibling = await project(workspaceId, `Keep sibling ${route}`);
    const entry = await card(target.id, `Delete task card ${route}`);
    await card(sibling.id, `Keep sibling card ${route}`);
    const targetLink = await share('project', target.id);
    const targetReceiptId = await receive(targetLink);
    const siblingLink = await share('project', sibling.id);
    const siblingReceiptId = await receive(siblingLink);
    const workspaceLink = await share('workspace', workspaceId);
    const workspaceReceiptId = await receive(workspaceLink);
    const targetBefore = await projectState(target.id);
    expect(targetBefore.entries).toHaveLength(1);
    expect(targetBefore.members.length).toBeGreaterThan(0);
    expect(targetBefore.mentionNotifications.length).toBeGreaterThan(0);
    expect(targetBefore.timelineVersions.length).toBeGreaterThan(0);
    expect(targetBefore.shareLinks).toHaveLength(1);
    const siblingBefore = await projectState(sibling.id);
    const workspaceBefore = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const workspaceLinkBefore = await prisma.shareLink.findUniqueOrThrow({ where: { id: workspaceLink.id }, include: { receivedShares: true } });
    const siblingReceiptBefore = await prisma.receivedShare.findUniqueOrThrow({ where: { id: siblingReceiptId } });
    const untouchedBefore = await untouchedState();

    const path = route === 'direct' ? `/projects/${target.id}` : `/workspaces/${workspaceId}/projects/${target.id}`;
    expect((await call('DELETE', path, route === 'direct' ? owner.cookie : lead.cookie)).status).toBe(204);
    await expectProjectGone(target.id, [targetReceiptId]);
    expect(await projectState(sibling.id)).toEqual(siblingBefore);
    expect(await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).toEqual(workspaceBefore);
    expect(await prisma.shareLink.findUniqueOrThrow({ where: { id: workspaceLink.id }, include: { receivedShares: true } })).toEqual(workspaceLinkBefore);
    expect(await prisma.receivedShare.findUniqueOrThrow({ where: { id: siblingReceiptId } })).toEqual(siblingReceiptBefore);
    expect(await untouchedState()).toEqual(untouchedBefore);
    expect((await call('POST', `/received-shares/${targetReceiptId}/resolve`, outsider.cookie)).status).toBe(404);
    expect((await call('POST', '/share-links/resolve', outsider.cookie, { token: targetLink.token })).status).toBe(404);
    expect((await call('POST', `/received-shares/${siblingReceiptId}/resolve`, outsider.cookie)).status).toBe(200);
    expect((await call('POST', `/received-shares/${workspaceReceiptId}/resolve`, outsider.cookie)).status).toBe(200);
    expect((await call('GET', `/entries/${entry.id}`, owner.cookie)).status).toBe(404);
    expect((await call('GET', `/projects/${target.id}/timeline-versions`, owner.cookie)).status).toBe(404);
    expect((await call('DELETE', path, owner.cookie)).status).toBe(404);
  });

  it('physically deletes a workspace and every task, card, membership, mention, history, link and receipt beneath it', async () => {
    const workspaceId = await workspace('Workspace cascade');
    const targets = await Promise.all(['First task', 'Second task'].map((name) => project(workspaceId, name)));
    const entries = await Promise.all(targets.map((target, index) => card(target.id, `Workspace card ${index}`)));
    const links = [await share('workspace', workspaceId), ...await Promise.all(targets.map((target) => share('project', target.id)))];
    const revokedLink = await share('project', targets[0].id);
    links.push(revokedLink);
    const receiptIds = await Promise.all(links.map(receive));
    expect((await call('DELETE', `/share-links/${revokedLink.id}`, owner.cookie)).status).toBe(204);
    const projectIds = targets.map((target) => target.id);
    const membershipIds = (await prisma.membership.findMany({ where: { workspaceId }, select: { id: true } })).map((row) => row.id);
    expect(membershipIds.length).toBeGreaterThan(0);
    expect(await prisma.mentionNotification.count({ where: { workspaceId } })).toBe(2);
    expect(await prisma.timelineVersion.count({ where: { projectId: { in: projectIds } } })).toBe(4);
    expect(await prisma.receivedShare.count({ where: { id: { in: receiptIds } } })).toBe(4);
    const untouchedBefore = await untouchedState();

    expect((await call('DELETE', `/workspaces/${workspaceId}`, owner.cookie)).status).toBe(204);
    expect(await prisma.workspace.findUnique({ where: { id: workspaceId } })).toBeNull();
    expect(await prisma.membership.count({ where: { id: { in: membershipIds } } })).toBe(0);
    expect(await prisma.project.count({ where: { workspaceId } })).toBe(0);
    expect(await prisma.mentionNotification.count({ where: { workspaceId } })).toBe(0);
    expect(await prisma.shareLink.count({ where: { workspaceId } })).toBe(0);
    expect(await prisma.shareLink.count({ where: { id: { in: links.map((link) => link.id) } } })).toBe(0);
    expect(await prisma.receivedShare.count({ where: { id: { in: receiptIds } } })).toBe(0);
    for (const target of targets) await expectProjectGone(target.id, receiptIds);
    expect(await untouchedState()).toEqual(untouchedBefore);
    for (const id of receiptIds) expect((await call('POST', `/received-shares/${id}/resolve`, outsider.cookie)).status).toBe(404);
    for (const link of links) expect((await call('POST', '/share-links/resolve', outsider.cookie, { token: link.token })).status).toBe(404);
    const received = await call<Array<{ id: string }>>('GET', '/received-shares', outsider.cookie);
    expect(received.status).toBe(200);
    expect(received.body.every((row) => !receiptIds.includes(row.id))).toBe(true);
    for (const entry of entries) expect((await call('GET', `/entries/${entry.id}`, owner.cookie)).status).toBe(404);
    expect((await call('GET', `/workspaces/${workspaceId}`, owner.cookie)).status).toBe(404);
    expect((await call('DELETE', `/workspaces/${workspaceId}`, owner.cookie)).status).toBe(404);
  });
});
