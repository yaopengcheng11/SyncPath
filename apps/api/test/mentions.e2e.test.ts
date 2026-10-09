import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const API = process.env.API_BASE ?? 'http://127.0.0.1:3160';
const prisma = new PrismaClient();
const suffix = `${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 1000)}`;
const aliceName = `mention_alice_${suffix}`;
const bobName = `mention_bob_${suffix}`;
const outsiderName = `mention_outside_${suffix}`;

async function call<T>(method: string, path: string, body?: unknown, cookie?: string): Promise<{ status: number; body: T }> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

async function register(name: string): Promise<{ id: string; cookie: string }> {
  const response = await fetch(`${API}/api/v1/sessions/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, email: `${name}@syncpath.test`, password: 'mentions-pass-1234', displayName: name === bobName ? '张三' : name })
  });
  if (response.status !== 201) throw new Error(`register ${name}: ${response.status}`);
  const session = await response.json() as { user: { id: string } };
  return { id: session.user.id, cookie: response.headers.get('set-cookie')!.split(';')[0] };
}

describe('project card mentions', () => {
  let alice: { id: string; cookie: string };
  let bob: { id: string; cookie: string };
  let outsider: { id: string; cookie: string };
  let workspaceId: string;
  let projectId: string;
  let entryId: string;

  beforeAll(async () => {
    alice = await register(aliceName);
    bob = await register(bobName);
    outsider = await register(outsiderName);
    const workspace = await call<{ id: string }>('POST', '/api/v1/workspaces', { name: `Mentions ${suffix}`, slug: `mention-${suffix}` }, alice.cookie);
    expect(workspace.status).toBe(201);
    workspaceId = workspace.body.id;
    const project = await call<{ id: string }>('POST', `/api/v1/workspaces/${workspaceId}/projects`, {
      name: 'Mention test project', startDate: '2026-09-01', endDate: '2026-12-31'
    }, alice.cookie);
    expect(project.status).toBe(201);
    projectId = project.body.id;
    const invited = await call('POST', `/api/v1/projects/${projectId}/members`, { userId: bob.id, role: 'Editor' }, alice.cookie);
    expect(invited.status).toBe(201);
  });

  afterAll(async () => {
    if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: { in: [alice?.id, bob?.id, outsider?.id].filter(Boolean) as string[] } } });
    await prisma.$disconnect();
  });

  it('lists only eligible project teammates as mention candidates', async () => {
    const result = await call<Array<{ id: string; displayName: string | null }>>('GET', `/api/v1/projects/${projectId}/mention-candidates`, undefined, alice.cookie);
    expect(result.status).toBe(200);
    expect(result.body.map((item) => item.id)).toContain(alice.id);
    expect(result.body.map((item) => item.id)).toContain(bob.id);
    expect(result.body.map((item) => item.id)).not.toContain(outsider.id);
    expect(result.body.find((item) => item.id === bob.id)?.displayName).toBe('张三');
  });

  it('rejects a member ID outside the project without creating an entry', async () => {
    const result = await call('POST', `/api/v1/projects/${projectId}/entries`, {
      weekStartDate: '2026-09-23', title: 'Bad mention', level: 'primary', mentionedUserIds: [outsider.id]
    }, alice.cookie);
    expect(result.status).toBe(400);
    expect(await prisma.progressEntry.count({ where: { projectId } })).toBe(0);
  });

  it('@所有人 creates a durable notification for other project members only', async () => {
    const created = await call<{ id: string; mentionAll: boolean; mentionedUserIds: string[] }>('POST', `/api/v1/projects/${projectId}/entries`, {
      weekStartDate: '2026-09-23', title: 'Release @所有人', level: 'primary', mentionAll: true, mentionedUserIds: []
    }, alice.cookie);
    expect(created.status).toBe(201);
    entryId = created.body.id;
    expect(created.body.mentionAll).toBe(true);
    expect(created.body.mentionedUserIds).toEqual([bob.id]);
    const inbox = await call<Array<{ id: string; entry: { id: string }; readAt: string | null }>>('GET', '/api/v1/notifications', undefined, bob.cookie);
    expect(inbox.status).toBe(200);
    expect(inbox.body).toHaveLength(1);
    expect(inbox.body[0].entry.id).toBe(entryId);
    expect(inbox.body[0].readAt).toBeNull();
    expect((await call<unknown[]>('GET', '/api/v1/notifications', undefined, alice.cookie)).body).toHaveLength(0);
  });

  it('keeps one notification on an unrelated edit, supports read, and hides it after revoke', async () => {
    const updated = await call<{ revision: number }>('PATCH', `/api/v1/entries/${entryId}`, {
      title: 'Updated release @所有人', mentionAll: true, mentionedUserIds: [], expectedRevision: 1
    }, alice.cookie);
    expect(updated.status).toBe(200);
    expect(updated.body.revision).toBe(2);
    const inbox = await call<Array<{ id: string }>>('GET', '/api/v1/notifications', undefined, bob.cookie);
    expect(inbox.body).toHaveLength(1);
    const markRead = await call('PATCH', `/api/v1/notifications/${inbox.body[0].id}/read`, undefined, bob.cookie);
    expect(markRead.status, JSON.stringify(markRead.body)).toBe(204);
    const readInbox = await call<Array<{ readAt: string | null }>>('GET', '/api/v1/notifications', undefined, bob.cookie);
    expect(readInbox.body[0].readAt).not.toBeNull();
    expect((await call('DELETE', `/api/v1/projects/${projectId}/members/${bob.id}`, undefined, alice.cookie)).status).toBe(204);
    expect((await call<unknown[]>('GET', '/api/v1/notifications', undefined, bob.cookie)).body).toHaveLength(0);
  });

  it('@张三 targets only the chosen user after project access is restored', async () => {
    expect((await call('POST', `/api/v1/projects/${projectId}/members`, { userId: bob.id, role: 'Viewer' }, alice.cookie)).status).toBe(201);
    const abort = new AbortController();
    const stream = await fetch(`${API}/api/v1/notifications/events`, {
      headers: { Cookie: bob.cookie }, signal: abort.signal
    });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    const nextMention = (async () => {
      let text = '';
      while (!text.includes('mention.created')) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Mention stream closed before notification.');
        text += new TextDecoder().decode(chunk.value);
      }
      return text;
    })();
    const created = await call<{ id: string; mentionAll: boolean; mentionedUserIds: string[] }>('POST', `/api/v1/projects/${projectId}/entries`, {
      weekStartDate: '2026-09-24', title: 'Review with @张三', level: 'secondary', mentionAll: false, mentionedUserIds: [bob.id]
    }, alice.cookie);
    expect(created.status).toBe(201);
    expect(created.body.mentionAll).toBe(false);
    expect(created.body.mentionedUserIds).toEqual([bob.id]);
    try {
      const event = await Promise.race([
        nextMention,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Mention stream timed out.')), 2000))
      ]);
      expect(event).toContain('mention.created');
    } finally {
      abort.abort();
    }
    const inbox = await call<Array<{ entry: { id: string }; readAt: string | null }>>('GET', '/api/v1/notifications', undefined, bob.cookie);
    expect(inbox.body.find((item) => item.entry.id === created.body.id)?.readAt).toBeNull();
    expect(inbox.body).toHaveLength(2);
  });
});
