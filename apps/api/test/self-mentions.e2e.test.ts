import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { PublicEntry } from '../src/modules/entries/dto';
import type { MentionTimelineContent } from '../src/modules/mentions/timeline.dto';
import type { TimelineVersionDetail, TimelineVersionPage } from '../src/modules/timeline-history/dto';

// The repository's integration configuration verifies these injected targets
// before loading tests. There is deliberately no running-app fallback.
const API = process.env.API_BASE!;
const prisma = new PrismaClient();
const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 10000)}`;
type Account = { id: string; username: string; cookie: string };
type Notification = { entry: { id: string }; actor: { id: string } };
const createdUserIds: string[] = [];

async function call<T>(method: string, path: string, account: Account, body?: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: {
      Cookie: account.cookie, 'X-SyncPath-User-Id': account.id,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

async function register(label: string): Promise<Account> {
  const username = `self_${label}_${suffix}`;
  const response = await fetch(`${API}/api/v1/sessions/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@syncpath.test`, password: 'self-mentions-1234' })
  });
  expect(response.status).toBe(201);
  const data = await response.json() as { user: { id: string } };
  createdUserIds.push(data.user.id);
  return { id: data.user.id, username, cookie: response.headers.get('set-cookie')!.split(';')[0] };
}

async function assertStoredMentions(entry: PublicEntry, userIds: string[]): Promise<void> {
  expect([...entry.mentionedUserIds].sort()).toEqual([...userIds].sort());
  const stored = await prisma.progressEntry.findUniqueOrThrow({ where: { id: entry.id } });
  expect([...stored.mentionedUserIds].sort()).toEqual([...userIds].sort());
}

async function mentions(account: Account): Promise<PublicEntry[]> {
  const response = await call<MentionTimelineContent>('GET', '/mentions/timeline', account);
  expect(response.status).toBe(200);
  return response.body.items.map((item) => item.entry);
}

async function assertNoSelfNotification(account: Account, entryId: string): Promise<void> {
  const response = await call<Notification[]>('GET', '/notifications', account);
  expect(response.status).toBe(200);
  expect(response.body.some((notification) => notification.entry.id === entryId)).toBe(false);
  expect(await prisma.mentionNotification.count({ where: { entryId, actorId: account.id, recipientId: account.id } })).toBe(0);
}

describe('self mentions remain content without self notification', () => {
  let owner: Account;
  let editor: Account;
  let workspaceId: string;
  let projectId: string;
  let ownerSelf: PublicEntry;
  let otherThenSelf: PublicEntry;
  let addedSelfVersionId: string;
  let editorSelf: PublicEntry;

  beforeAll(async () => {
    [owner, editor] = await Promise.all(['owner', 'editor'].map(register));
    const workspace = await call<{ id: string }>('POST', '/workspaces', owner, { name: `Self mentions ${suffix}`, slug: `self-mentions-${suffix}` });
    expect(workspace.status).toBe(201); workspaceId = workspace.body.id;
    const project = await call<{ id: string }>('POST', `/workspaces/${workspaceId}/projects`, owner, {
      name: 'Self mention timeline', startDate: '2026-01-01', endDate: '2026-12-31', visibility: 'private'
    });
    expect(project.status).toBe(201); projectId = project.body.id;
    expect((await call('POST', `/projects/${projectId}/members`, owner, { userId: editor.id, role: 'Editor' })).status).toBe(201);
  });

  afterAll(async () => {
    if (workspaceId) await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it('persists an explicit self mention on create and includes it in the actor timeline without a bell notification', async () => {
    const response = await call<PublicEntry>('POST', `/projects/${projectId}/entries`, owner, {
      title: 'Owner self mention', weekStartDate: '2026-04-10', level: 'primary', mentionedUserIds: [owner.id, owner.id]
    });
    expect(response.status).toBe(201); ownerSelf = response.body;
    await assertStoredMentions(ownerSelf, [owner.id]);
    expect((await mentions(owner)).some((entry) => entry.id === ownerSelf.id)).toBe(true);
    expect((await mentions(editor)).some((entry) => entry.id === ownerSelf.id)).toBe(false);
    await assertNoSelfNotification(owner, ownerSelf.id);
  });

  it('preserves self mentions through repeated edits that do not change mention selection', async () => {
    for (const patch of [{ summary: 'First ordinary edit' }, { notes: 'Second ordinary edit' }, { title: 'Renamed self card' }]) {
      const response = await call<PublicEntry>('PATCH', `/entries/${ownerSelf.id}`, owner, { expectedRevision: ownerSelf.revision, ...patch });
      expect(response.status).toBe(200); ownerSelf = response.body;
      await assertStoredMentions(ownerSelf, [owner.id]);
    }
    expect((await mentions(owner)).find((entry) => entry.id === ownerSelf.id)?.title).toBe('Renamed self card');
    await assertNoSelfNotification(owner, ownerSelf.id);
  });

  it('adding self to a card previously mentioning another user updates live content and the immutable readable version', async () => {
    const created = await call<PublicEntry>('POST', `/projects/${projectId}/entries`, owner, {
      title: 'Other then self', weekStartDate: '2026-05-11', level: 'secondary', mentionedUserIds: [editor.id]
    });
    expect(created.status).toBe(201); otherThenSelf = created.body;
    expect((await mentions(owner)).some((entry) => entry.id === otherThenSelf.id)).toBe(false);
    expect(await prisma.mentionNotification.count({ where: { entryId: otherThenSelf.id, recipientId: editor.id } })).toBe(1);
    const updated = await call<PublicEntry>('PATCH', `/entries/${otherThenSelf.id}`, owner, {
      expectedRevision: otherThenSelf.revision, mentionedUserIds: [editor.id, owner.id]
    });
    expect(updated.status).toBe(200); otherThenSelf = updated.body;
    await assertStoredMentions(otherThenSelf, [owner.id, editor.id]);
    expect((await mentions(owner)).some((entry) => entry.id === otherThenSelf.id)).toBe(true);
    const versions = await call<TimelineVersionPage>('GET', `/projects/${projectId}/timeline-versions`, owner);
    expect(versions.status).toBe(200);
    const version = versions.body.items.find((item) => item.action === 'entry.updated' && item.entryId === otherThenSelf.id)!;
    expect(version.actor?.id).toBe(owner.id); addedSelfVersionId = version.id;
    const change = version.changes.find((item) => item.field === 'mentionedUserIds')!;
    expect(change.before).toContain(`@${editor.username}`);
    expect(change.before).not.toContain(`@${owner.username}`);
    expect(change.after).toContain(`@${editor.username}`);
    expect(change.after).toContain(`@${owner.username}`);
    const detail = await call<TimelineVersionDetail>('GET', `/projects/${projectId}/timeline-versions/${version.id}`, owner);
    expect(detail.status).toBe(200);
    expect(detail.body.snapshot.entries.find((entry) => entry.id === otherThenSelf.id)?.mentionedUserIds.sort()).toEqual([owner.id, editor.id].sort());
    expect(await prisma.mentionNotification.count({ where: { entryId: otherThenSelf.id, recipientId: editor.id } })).toBe(1);
    await assertNoSelfNotification(owner, otherThenSelf.id);
  });

  it('removing self removes the live card from the actor timeline without changing old snapshots or repeating the other notification', async () => {
    const updated = await call<PublicEntry>('PATCH', `/entries/${otherThenSelf.id}`, owner, {
      expectedRevision: otherThenSelf.revision, mentionedUserIds: [editor.id]
    });
    expect(updated.status).toBe(200); otherThenSelf = updated.body;
    await assertStoredMentions(otherThenSelf, [editor.id]);
    expect((await mentions(owner)).some((entry) => entry.id === otherThenSelf.id)).toBe(false);
    expect((await mentions(editor)).some((entry) => entry.id === otherThenSelf.id)).toBe(true);
    expect(await prisma.mentionNotification.count({ where: { entryId: otherThenSelf.id, recipientId: editor.id } })).toBe(1);
    const preserved = await call<TimelineVersionDetail>('GET', `/projects/${projectId}/timeline-versions/${addedSelfVersionId}`, owner);
    expect(preserved.status).toBe(200);
    expect(preserved.body.snapshot.entries.find((entry) => entry.id === otherThenSelf.id)?.mentionedUserIds.sort()).toEqual([owner.id, editor.id].sort());
    await assertNoSelfNotification(owner, otherThenSelf.id);
  });

  it('@all includes the author and other member in saved content while notifying only the other member', async () => {
    const created = await call<PublicEntry>('POST', `/projects/${projectId}/entries`, owner, {
      title: 'Everyone including author', weekStartDate: '2026-06-15', level: 'minor', mentionAll: true
    });
    expect(created.status).toBe(201);
    expect(created.body.mentionAll).toBe(true);
    await assertStoredMentions(created.body, [owner.id, editor.id]);
    for (const account of [owner, editor]) expect((await mentions(account)).some((entry) => entry.id === created.body.id)).toBe(true);
    await assertNoSelfNotification(owner, created.body.id);
    expect(await prisma.mentionNotification.count({ where: { entryId: created.body.id, recipientId: editor.id, actorId: owner.id } })).toBe(1);
    const notifications = await call<Notification[]>('GET', '/notifications', editor);
    expect(notifications.body.some((notification) => notification.entry.id === created.body.id && notification.actor.id === owner.id)).toBe(true);
  });

  it('an Editor can explicitly mention themself and keep that selection when editing', async () => {
    const created = await call<PublicEntry>('POST', `/projects/${projectId}/entries`, editor, {
      title: 'Editor self mention', weekStartDate: '2026-07-20', level: 'secondary', mentionedUserIds: [editor.id]
    });
    expect(created.status).toBe(201); editorSelf = created.body;
    await assertStoredMentions(editorSelf, [editor.id]);
    expect((await mentions(editor)).some((entry) => entry.id === editorSelf.id)).toBe(true);
    expect((await mentions(owner)).some((entry) => entry.id === editorSelf.id)).toBe(false);
    const updated = await call<PublicEntry>('PATCH', `/entries/${editorSelf.id}`, editor, { expectedRevision: editorSelf.revision, summary: 'Editor ordinary edit' });
    expect(updated.status).toBe(200); editorSelf = updated.body;
    await assertStoredMentions(editorSelf, [editor.id]);
    await assertNoSelfNotification(editor, editorSelf.id);
  });

  it('an Editor using @all also preserves their own content selection and sends only the owner a notification', async () => {
    const created = await call<PublicEntry>('POST', `/projects/${projectId}/entries`, editor, {
      title: 'Editor mentions everyone', weekStartDate: '2026-08-21', level: 'minor', mentionAll: true, mentionedUserIds: []
    });
    expect(created.status).toBe(201);
    await assertStoredMentions(created.body, [owner.id, editor.id]);
    expect((await mentions(editor)).some((entry) => entry.id === created.body.id)).toBe(true);
    expect((await mentions(owner)).some((entry) => entry.id === created.body.id)).toBe(true);
    await assertNoSelfNotification(editor, created.body.id);
    expect(await prisma.mentionNotification.count({ where: { entryId: created.body.id, actorId: editor.id, recipientId: owner.id } })).toBe(1);
    const notifications = await call<Notification[]>('GET', '/notifications', owner);
    expect(notifications.body.some((notification) => notification.entry.id === created.body.id && notification.actor.id === editor.id)).toBe(true);
  });
});
