import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { PublicEntry } from '../src/modules/entries/dto';
import type { MentionTimelineContent } from '../src/modules/mentions/timeline.dto';

const API = process.env.API_BASE!; const prisma = new PrismaClient();
const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 10000)}`;
type Account = { id: string; cookie: string };
async function call<T>(method: string, path: string, cookie: string, body?: unknown, expectedUserId?: string): Promise<{ status: number; body: T }> {
  const response = await fetch(`${API}/api/v1${path}`, { method,
    headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(expectedUserId === undefined ? {} : { 'X-SyncPath-User-Id': expectedUserId }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text(); return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}
async function register(label: string): Promise<Account> {
  const username = `mt_${label}_${suffix}`;
  const response = await fetch(`${API}/api/v1/sessions/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email: `${username}@syncpath.test`, password: 'mention-timeline-1234' }) });
  expect(response.status).toBe(201); const data = await response.json() as { user: { id: string } };
  return { id: data.user.id, cookie: response.headers.get('set-cookie')!.split(';')[0] };
}

describe('current mentions consolidated timeline', () => {
  let owner: Account; let recipient: Account; let outsider: Account;
  const workspaceIds: string[] = []; const projectIds: string[] = []; let hiddenProjectId: string; const entries: PublicEntry[] = [];
  beforeAll(async () => {
    [owner, recipient, outsider] = await Promise.all(['owner', 'recipient', 'outside'].map(register));
    for (const label of ['First', 'Second']) {
      const workspace = await call<{ id: string }>('POST', '/workspaces', owner.cookie, { name: `${label} mentions ${suffix}`, slug: `${label.toLowerCase()}-mt-${suffix}` });
      expect(workspace.status).toBe(201); workspaceIds.push(workspace.body.id);
      const project = await call<{ id: string }>('POST', `/workspaces/${workspace.body.id}/projects`, owner.cookie, { name: `${label} task`, startDate: '2026-01-01', endDate: '2026-12-31', visibility: 'private' });
      expect(project.status).toBe(201); projectIds.push(project.body.id);
      expect((await call('POST', `/projects/${project.body.id}/members`, owner.cookie, { userId: recipient.id, role: 'Viewer' })).status).toBe(201);
      const entry = await call<PublicEntry>('POST', `/projects/${project.body.id}/entries`, owner.cookie, { title: `${label} mention`, weekStartDate: label === 'First' ? '2026-02-03' : '2026-03-04', level: 'secondary', mentionAll: label === 'Second', mentionedUserIds: label === 'First' ? [recipient.id] : [] });
      expect(entry.status).toBe(201); entries.push(entry.body);
    }
    const hidden = await call<{ id: string }>('POST', `/workspaces/${workspaceIds[0]}/projects`, owner.cookie, { name: 'Hidden task', startDate: '2026-01-01', endDate: '2026-12-31', visibility: 'private' });
    expect(hidden.status).toBe(201); hiddenProjectId = hidden.body.id;
    await prisma.progressEntry.create({ data: { id: randomUUID(), projectId: hiddenProjectId, authorId: owner.id, title: 'Forbidden mention', level: 'minor', weekStartDate: new Date('2026-04-01T00:00:00Z'), mentionedUserIds: [recipient.id] } });
  });
  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner?.id, recipient?.id, outsider?.id].filter(Boolean) } } });
    await prisma.$disconnect();
  });
  const timeline = (query = '', cookie = recipient.cookie) => call<MentionTimelineContent>('GET', `/mentions/timeline${query}`, cookie);

  it('combines explicit and @all current cards with readable task/project sources', async () => {
    const result = await timeline(); expect(result.status).toBe(200); expect(result.body.items.map((item) => item.entry.id)).toEqual(entries.map((entry) => entry.id));
    expect(result.body.workspaces.map((workspace) => workspace.id).sort()).toEqual([...workspaceIds].sort());
    expect(result.body.items[0].workspace.id).toBe(workspaceIds[0]); expect(result.body.items[0].project.startDate).toBe('2026-01-01');
    expect(result.body.items.every((item) => item.project.myRole === 'Viewer')).toBe(true);
    expect(result.body.items.some((item) => item.project.id === hiddenProjectId)).toBe(false);
    // @all is a persisted mention for the author too, while the explicitly
    // recipient-only card must not appear on the author's timeline.
    const authorResult = await timeline('', owner.cookie);
    expect(authorResult.body.items.map((item) => item.entry.id)).toEqual([entries[1].id]);
    expect(authorResult.body.items[0].entry.mentionedUserIds).toContain(owner.id);
  });

  it('project selection only narrows access, empty means none, and identity header binds the user', async () => {
    const selected = await timeline(`?workspaceIds=${workspaceIds[1]}`); expect(selected.body.items.map((item) => item.entry.id)).toEqual([entries[1].id]);
    expect(selected.body.workspaces).toHaveLength(2);
    expect((await timeline('?workspaceIds=')).body.items).toEqual([]);
    expect((await timeline(`?workspaceIds=${workspaceIds[0]}`, outsider.cookie)).body).toEqual({ workspaces: [], items: [] });
    expect((await call('GET', '/mentions/timeline', recipient.cookie, undefined, owner.id)).status).toBe(401);
    expect((await timeline('?workspaceIds=bad%20id')).status).toBe(400);
  });

  it('is not limited to the inbox notification cap or notification history', async () => {
    await prisma.progressEntry.createMany({ data: Array.from({ length: 110 }, (_, index) => ({ id: randomUUID(), projectId: projectIds[1], authorId: owner.id, title: `Bulk mention ${index}`, level: 'minor' as const, weekStartDate: new Date('2026-07-01T00:00:00Z'), mentionedUserIds: [recipient.id] })) });
    expect((await timeline()).body.items).toHaveLength(112);
    expect((await prisma.mentionNotification.count({ where: { recipientId: recipient.id } }))).toBe(2);
  });

  it('removed mentions disappear even when the durable inbox notification remains', async () => {
    expect((await call('PATCH', `/entries/${entries[0].id}`, owner.cookie, { expectedRevision: entries[0].revision, mentionedUserIds: [], mentionAll: false })).status).toBe(200);
    expect((await timeline()).body.items.some((item) => item.entry.id === entries[0].id)).toBe(false);
    expect(await prisma.mentionNotification.count({ where: { entryId: entries[0].id } })).toBe(1);
  });

  it('revocation hides the private task immediately; parent admins can see their own mentions', async () => {
    expect((await call('DELETE', `/projects/${projectIds[1]}/members/${recipient.id}`, owner.cookie)).status).toBe(204);
    expect((await timeline()).body.items).toEqual([]);
    await prisma.membership.update({ where: { workspaceId_userId: { workspaceId: workspaceIds[1], userId: recipient.id } }, data: { role: 'Admin' } });
    const result = await timeline(); expect(result.body.items).toHaveLength(111); expect(result.body.items.every((item) => item.project.myRole === 'Lead')).toBe(true);
  });

  it('archived tasks and deleted projects, cards, and memberships are excluded', async () => {
    await prisma.progressEntry.update({ where: { id: entries[1].id }, data: { deletedAt: new Date() } }); expect((await timeline()).body.items).toHaveLength(110);
    await prisma.project.update({ where: { id: projectIds[1] }, data: { status: 'archived' } }); expect((await timeline()).body.items).toHaveLength(0);
    await prisma.project.update({ where: { id: projectIds[1] }, data: { status: 'active' } });
    await prisma.membership.delete({ where: { workspaceId_userId: { workspaceId: workspaceIds[1], userId: recipient.id } } }); expect((await timeline()).body.items).toHaveLength(0);
    expect((await timeline()).body.workspaces.map((workspace) => workspace.id)).toEqual([workspaceIds[0]]);
    await prisma.workspace.update({ where: { id: workspaceIds[0] }, data: { deletedAt: new Date() } }); expect((await timeline()).body.workspaces).toEqual([]);
  });
});
