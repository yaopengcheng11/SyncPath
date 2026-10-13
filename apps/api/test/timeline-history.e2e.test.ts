import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { PublicEntry } from '../src/modules/entries/dto';
import type { TimelineVersionDetail, TimelineVersionPage } from '../src/modules/timeline-history/dto';

const API = process.env.API_BASE!;
const prisma = new PrismaClient();
const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 10000)}`;
type Account = { id: string; cookie: string; username: string };

async function call<T>(method: string, path: string, cookie: string, body?: unknown, expectedUserId?: string): Promise<{ status: number; body: T }> {
  const response = await fetch(`${API}/api/v1${path}`, { method,
    headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(expectedUserId === undefined ? {} : { 'X-SyncPath-User-Id': expectedUserId }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}
async function register(label: string): Promise<Account> {
  const username = `history_${label}_${suffix}`;
  const response = await fetch(`${API}/api/v1/sessions/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@syncpath.test`, password: 'timeline-history-1234', displayName: label }) });
  expect(response.status).toBe(201);
  const data = await response.json() as { user: { id: string } };
  return { id: data.user.id, username, cookie: response.headers.get('set-cookie')!.split(';')[0] };
}

describe('immutable whole timeline history', () => {
  let owner: Account; let editor: Account; let viewer: Account; let lead: Account; let outsider: Account;
  let workspaceId: string; let projectId: string; let otherProjectId: string;
  let entry: PublicEntry; let second: PublicEntry;
  const createdUsers: string[] = [];

  beforeAll(async () => {
    [owner, editor, viewer, lead, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'lead', 'outside'].map(register));
    createdUsers.push(owner.id, editor.id, viewer.id, lead.id, outsider.id);
    const workspace = await call<{ id: string }>('POST', '/workspaces', owner.cookie, { name: `History ${suffix}`, slug: `history-${suffix}` });
    expect(workspace.status).toBe(201); workspaceId = workspace.body.id;
    const project = await call<{ id: string }>('POST', `/workspaces/${workspaceId}/projects`, owner.cookie, { name: 'Timeline original', startDate: '2026-01-01', endDate: '2026-12-31' });
    expect(project.status).toBe(201); projectId = project.body.id;
    const other = await call<{ id: string }>('POST', `/workspaces/${workspaceId}/projects`, owner.cookie, { name: 'Other timeline', startDate: '2026-01-01', endDate: '2026-12-31' });
    expect(other.status).toBe(201); otherProjectId = other.body.id;
    for (const [account, role] of [[editor, 'Editor'], [viewer, 'Viewer'], [lead, 'Lead']] as const) {
      expect((await call('POST', `/projects/${projectId}/members`, owner.cookie, { userId: account.id, role })).status).toBe(201);
    }
  });
  afterAll(async () => {
    if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    await prisma.$disconnect();
  });
  const list = (cookie = owner.cookie, query = '') => call<TimelineVersionPage>('GET', `/projects/${projectId}/timeline-versions${query}`, cookie);
  const detail = (id: string, cookie = owner.cookie) => call<TimelineVersionDetail>('GET', `/projects/${projectId}/timeline-versions/${id}`, cookie);

  it('a read of an untracked existing timeline performs no baseline write', async () => {
    const result = await list(); expect(result.status).toBe(200); expect(result.body.items).toEqual([]);
    expect(await prisma.timelineVersion.count({ where: { projectId } })).toBe(0);
  });

  it('captures a baseline and the first create atomically with actor and complete snapshot', async () => {
    const response = await call<PublicEntry>('POST', `/projects/${projectId}/entries`, editor.cookie, { title: 'Original card', weekStartDate: '2026-04-10', level: 'primary', summary: 'First summary', mentionedUserIds: [viewer.id] });
    expect(response.status).toBe(201); entry = response.body;
    const result = await list(); expect(result.body.items.map((version) => version.version)).toEqual([1, 0]);
    const latest = result.body.items[0]; expect(latest.actor?.id).toBe(editor.id); expect(latest.action).toBe('entry.created');
    expect(latest.changes).toContainEqual(expect.objectContaining({ entity: 'card', entityId: entry.id, field: 'created', after: 'Original card' }));
    const baseline = await detail(result.body.items[1].id); expect(baseline.body.snapshot.entries).toEqual([]); expect(baseline.body.actor).toBeNull();
    const snapshot = await detail(latest.id); expect(snapshot.body.snapshot.entries[0].summary).toBe('First summary');
    expect(snapshot.body.snapshot.entries[0].mentionedUserIds).toEqual([viewer.id]);
  });

  it('records readable field changes, date moves, lock and unlock as versions', async () => {
    const response = await call<PublicEntry>('PATCH', `/entries/${entry.id}`, editor.cookie, { expectedRevision: entry.revision, title: 'Edited card', summary: 'Changed summary', weekStartDate: '2026-05-11', mentionedUserIds: [lead.id] });
    expect(response.status).toBe(200); entry = response.body;
    const version = (await list()).body.items[0]; expect(version.version).toBe(2);
    expect(version.changes).toContainEqual(expect.objectContaining({ field: 'title', before: 'Original card', after: 'Edited card' }));
    expect(version.changes).toContainEqual(expect.objectContaining({ field: 'weekStartDate', before: '2026-04-10', after: '2026-05-11' }));
    expect(version.changes.find((change) => change.field === 'mentionedUserIds')?.before).toContain(`@${viewer.username}`);
    const locked = await call<PublicEntry>('PATCH', `/entries/${entry.id}`, editor.cookie, { expectedRevision: entry.revision, isLocked: true });
    expect(locked.status).toBe(200); entry = locked.body;
    expect((await list()).body.items[0].changes).toContainEqual(expect.objectContaining({ field: 'isLocked', before: 'false', after: 'true' }));
    expect((await call('DELETE', `/entries/${entry.id}?expectedRevision=${entry.revision}`, editor.cookie)).status).toBe(409);
    const unlocked = await call<PublicEntry>('PATCH', `/entries/${entry.id}`, editor.cookie, { expectedRevision: entry.revision, isLocked: false });
    expect(unlocked.status).toBe(200); entry = unlocked.body;
    expect((await list()).body.items[0].version).toBe(4);
  });

  it('no-op edits and rejected out-of-range moves do not invent content versions', async () => {
    const before = (await list()).body.items[0].version;
    const noop = await call<PublicEntry>('PATCH', `/entries/${entry.id}`, editor.cookie, { expectedRevision: entry.revision, title: entry.title });
    expect(noop.status).toBe(200); entry = noop.body;
    expect((await list()).body.items[0].version).toBe(before);
    expect((await call('PATCH', `/entries/${entry.id}`, editor.cookie, { expectedRevision: entry.revision, weekStartDate: '2027-01-01' })).status).toBe(409);
    expect((await list()).body.items[0].version).toBe(before);
  });

  it('same-card concurrent CAS admits one writer and rolls back the losing history', async () => {
    const before = (await list()).body.items[0].version;
    const responses = await Promise.all(['Writer A', 'Writer B'].map((title) => call<PublicEntry>('PATCH', `/entries/${entry.id}`, editor.cookie, { expectedRevision: entry.revision, title })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    entry = responses.find((response) => response.status === 200)!.body;
    expect((await list()).body.items[0].version).toBe(before + 1);
    expect((await detail((await list()).body.items[0].id)).body.snapshot.entries[0].title).toBe(entry.title);
  });

  it('concurrent different-card writes produce ordered snapshots retaining both updates', async () => {
    const response = await call<PublicEntry>('POST', `/projects/${projectId}/entries`, owner.cookie, { title: 'Second card', weekStartDate: '2026-06-15', level: 'minor' });
    expect(response.status).toBe(201); second = response.body;
    const before = (await list()).body.items[0].version;
    const responses = await Promise.all([
      call<PublicEntry>('PATCH', `/entries/${entry.id}`, editor.cookie, { expectedRevision: entry.revision, summary: 'Concurrent first' }),
      call<PublicEntry>('PATCH', `/entries/${second.id}`, owner.cookie, { expectedRevision: second.revision, summary: 'Concurrent second' })
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]); [entry, second] = responses.map((response) => response.body);
    const versions = (await list()).body.items; expect(versions.slice(0, 2).map((version) => version.version)).toEqual([before + 2, before + 1]);
    const snapshot = (await detail(versions[0].id)).body.snapshot;
    expect(snapshot.entries.find((row) => row.id === entry.id)?.summary).toBe('Concurrent first');
    expect(snapshot.entries.find((row) => row.id === second.id)?.summary).toBe('Concurrent second');
  });

  it('records task settings and erases a deleted card from earlier snapshots', async () => {
    const existingVersions = (await list()).body.items;
    const previous = existingVersions.find((row) => row.entryId === entry.id)!;
    const removedVersion = existingVersions.find((row) => row.entryId === second.id)!;
    expect((await detail(previous.id)).body.snapshot.entries.map((row) => row.id)).toContain(second.id);
    const updated = await call('PATCH', `/workspaces/${workspaceId}/projects/${projectId}`, owner.cookie, { expectedRevision: 1, name: 'Renamed timeline', endDate: '2026-11-30', color: '#f97316' });
    expect(updated.status).toBe(200);
    const version = (await list()).body.items[0]; expect(version.action).toBe('project.updated');
    expect(version.changes).toContainEqual(expect.objectContaining({ entity: 'task', field: 'name', before: 'Timeline original', after: 'Renamed timeline' }));
    const timelineRevision = (await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).timelineRevision;
    const deletion = await call('DELETE', `/entries/${second.id}?expectedRevision=${second.revision}`, owner.cookie); expect(deletion.status).toBe(204);
    const latest = (await list()).body.items[0]; expect(latest.id).toBe(version.id); expect(latest.action).toBe('project.updated');
    expect((await detail(latest.id)).body.snapshot.entries.map((row) => row.id)).not.toContain(second.id);
    expect((await detail(previous.id)).body.snapshot.entries.map((row) => row.id)).not.toContain(second.id);
    expect((await detail(removedVersion.id)).status).toBe(404);
    expect(await prisma.progressEntry.findUnique({ where: { id: second.id } })).toBeNull();
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).timelineRevision).toBe(timelineRevision + 1);
    const retainedHistory = await prisma.timelineVersion.findMany({ where: { projectId } });
    expect(JSON.stringify(retainedHistory)).not.toContain(second.id);
    expect(JSON.stringify(retainedHistory)).not.toContain('Second card');
    expect(retainedHistory.some((row) => row.entryId === entry.id)).toBe(true);
  });

  it('retains actor snapshots after rename and restricts both reads to leads/admins', async () => {
    await prisma.user.update({ where: { id: editor.id }, data: { displayName: 'Renamed editor' } });
    const versions = (await list()).body.items;
    expect(versions.find((version) => version.version === 1)?.actor?.displayName).toBe('editor');
    expect((await list(lead.cookie)).status).toBe(200);
    expect((await list(editor.cookie)).status).toBe(403); expect((await detail(versions[0].id, viewer.cookie)).status).toBe(403);
    expect((await list(outsider.cookie)).status).toBe(404);
    expect((await call('GET', `/projects/${otherProjectId}/timeline-versions/${versions[0].id}`, owner.cookie)).status).toBe(404);
    expect((await call('GET', `/projects/${projectId}/timeline-versions`, owner.cookie, undefined, editor.id)).status).toBe(401);
    expect((await call('GET', `/projects/${projectId}/timeline-versions/${versions[0].id}`, owner.cookie, undefined, editor.id)).status).toBe(401);
  });

  it('paginates without duplicates and rejects invalid bounds', async () => {
    const first = await list(owner.cookie, '?limit=2'); expect(first.body.items).toHaveLength(2); expect(first.body.nextBeforeVersion).not.toBeNull();
    const next = await list(owner.cookie, `?limit=2&beforeVersion=${first.body.nextBeforeVersion}`); expect(next.body.items).toHaveLength(2);
    expect(next.body.items.every((item) => item.version < first.body.nextBeforeVersion!)).toBe(true);
    expect((await list(owner.cookie, '?limit=100')).status).toBe(400); expect((await list(owner.cookie, '?beforeVersion=-1')).status).toBe(400);
  });

  it('records imported cards through the legacy importer', async () => {
    const result = await call<{ projects: Array<{ id: string; created: boolean }> }>('POST', '/imports/apply', owner.cookie, { accept: true, workspaceName: `History ${suffix}`, projects: [{ name: 'Imported timeline', startDate: '2026-01-01', endDate: '2026-12-31', logs: [{ author: 'Imported card', date: '2026-03-04', level: 1 }] }] });
    expect(result.status).toBe(201);
    const importedProjectId = result.body.projects[0].id;
    expect(result.body.projects[0].created).toBe(true);
    const versions = await call<TimelineVersionPage>('GET', `/projects/${importedProjectId}/timeline-versions`, owner.cookie);
    expect(versions.body.items[0].action).toBe('entry.imported'); expect(versions.body.items[0].actor?.id).toBe(owner.id);
    expect((await call<TimelineVersionDetail>('GET', `/projects/${importedProjectId}/timeline-versions/${versions.body.items[0].id}`, owner.cookie)).body.snapshot.entries[0].title).toBe('Imported card');
  });
});
