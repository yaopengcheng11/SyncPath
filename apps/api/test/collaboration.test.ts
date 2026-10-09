import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';
import { CollaborationService, type CollaborationEventType } from '../src/modules/collaboration/collaboration.service';

const alice = { id: 'alice', username: 'alice', displayName: 'Alice' };
const bob = { id: 'bob', username: 'bob', displayName: 'Bob' };
type StreamEvent = { type: string; data: unknown; id?: string };

describe('project collaboration streams', () => {
  it('delivers data events from the same account so another window stays current', () => {
    const service = new CollaborationService();
    const received: StreamEvent[] = [];
    const subscription = service.stream('project-a', alice.id).subscribe(event => received.push(event));
    const types: Exclude<CollaborationEventType, 'presence.snapshot'>[] = [
      'entry.created', 'entry.updated', 'entry.deleted', 'project.updated', 'membership.updated'
    ];
    for (const type of types) service.publish({ projectId: 'project-a', type, actor: alice, data: { id: 'entry-a' } });
    expect(received.map(event => event.type)).toEqual(['presence.snapshot', ...types]);
    subscription.unsubscribe();
  });

  it('hides the current account only for presence events', () => {
    const service = new CollaborationService();
    const received: StreamEvent[] = [];
    const subscription = service.stream('project-a', alice.id).subscribe(event => received.push(event));
    for (const type of ['presence.join', 'presence.update', 'presence.leave'] as const) {
      service.publish({ projectId: 'project-a', type, actor: alice });
      service.publish({ projectId: 'project-a', type, actor: bob });
    }
    expect(received.map(event => event.type)).toEqual(['presence.snapshot', 'presence.join', 'presence.update', 'presence.leave']);
    expect(received.slice(1).every(event => (event.data as { actor: typeof bob }).actor.id === bob.id)).toBe(true);
    subscription.unsubscribe();
  });

  it('excludes the current account from the initial presence snapshot', () => {
    const service = new CollaborationService();
    service.heartbeat({ projectId: 'project-a', user: alice as User });
    service.heartbeat({ projectId: 'project-a', user: bob as User });
    const received: StreamEvent[] = [];
    const subscription = service.stream('project-a', alice.id).subscribe(event => received.push(event));
    expect(received[0]).toEqual({
      type: 'presence.snapshot',
      data: { users: [{ userId: 'bob', username: 'bob', displayName: 'Bob', action: 'Viewing', targetId: undefined }] }
    });
    subscription.unsubscribe();
  });

  it('never mixes another project into the stream', () => {
    const service = new CollaborationService();
    const received: StreamEvent[] = [];
    const subscription = service.stream('project-a', alice.id).subscribe(event => received.push(event));
    service.publish({ projectId: 'project-b', type: 'entry.created', actor: alice });
    service.publish({ projectId: 'project-b', type: 'presence.join', actor: bob });
    expect(received.map(event => event.type)).toEqual(['presence.snapshot']);
    subscription.unsubscribe();
  });

  it('delivers membership removal, then closes immediately without leaking later events', () => {
    const service = new CollaborationService();
    const received: StreamEvent[] = [];
    let complete = false;
    service.stream('project-a', alice.id).subscribe({
      next: event => received.push(event),
      complete: () => { complete = true; }
    });
    service.publish({ projectId: 'project-a', type: 'membership.updated', actor: alice, data: { action: 'removed', userId: alice.id } });
    service.revoke('project-a', alice.id);
    expect(complete).toBe(true);
    service.publish({ projectId: 'project-a', type: 'entry.created', actor: bob });
    expect(received.map(event => event.type)).toEqual(['presence.snapshot', 'membership.updated']);
  });

  it('limits revocation to the affected user and project', () => {
    const service = new CollaborationService();
    const sameProjectEvents: StreamEvent[] = [];
    const otherProjectEvents: StreamEvent[] = [];
    const bobSubscription = service.stream('project-a', bob.id).subscribe(event => sameProjectEvents.push(event));
    const aliceSubscription = service.stream('project-b', alice.id).subscribe(event => otherProjectEvents.push(event));
    service.revoke('project-a', alice.id);
    service.publish({ projectId: 'project-a', type: 'entry.created', actor: alice });
    service.publish({ projectId: 'project-b', type: 'entry.created', actor: bob });
    expect(sameProjectEvents.map(event => event.type)).toEqual(['presence.snapshot', 'entry.created']);
    expect(otherProjectEvents.map(event => event.type)).toEqual(['presence.snapshot', 'entry.created']);
    bobSubscription.unsubscribe();
    aliceSubscription.unsubscribe();
  });
});

describe('project presence leases', () => {
  const services: CollaborationService[] = [];
  function createService(startSweep = false): CollaborationService {
    const service = new CollaborationService();
    services.push(service);
    if (startSweep) service.onModuleInit();
    return service;
  }
  function snapshot(service: CollaborationService, projectId = 'project-a', viewer = 'viewer'): unknown {
    let result: unknown;
    const subscription = service.stream(projectId, viewer).subscribe(event => {
      if (event.type === 'presence.snapshot') result = event.data;
    });
    subscription.unsubscribe();
    return result;
  }
  afterEach(() => {
    for (const service of services.splice(0)) service.onModuleDestroy();
    vi.useRealTimers();
  });

  it('broadcasts expiry to an already-open viewer without another snapshot request', () => {
    vi.useFakeTimers();
    const service = createService(true);
    service.heartbeat({ projectId: 'project-a', user: bob as User, clientId: 'bob-tab' });
    const received: StreamEvent[] = [];
    service.stream('project-a', alice.id).subscribe(event => received.push(event));
    vi.advanceTimersByTime(44_999);
    expect(received.map(event => event.type)).toEqual(['presence.snapshot']);
    vi.advanceTimersByTime(1);
    expect(received.map(event => event.type)).toEqual(['presence.snapshot', 'presence.leave']);
    expect((received[1].data as { actor: typeof bob }).actor).toEqual(bob);
    expect(snapshot(service)).toEqual({ users: [] });
    vi.advanceTimersByTime(50_000);
    expect(received.filter(event => event.type === 'presence.leave')).toHaveLength(1);
  });

  it('treats an expired heartbeat as a fresh join and clears the expired activity', () => {
    vi.useFakeTimers();
    const service = createService();
    service.heartbeat({ projectId: 'project-a', user: bob as User, action: 'Editing', targetId: 'entry-a', clientId: 'bob-tab' });
    const received: StreamEvent[] = [];
    service.stream('project-a', alice.id).subscribe(event => received.push(event));
    vi.advanceTimersByTime(46_000);
    service.heartbeat({ projectId: 'project-a', user: bob as User, clientId: 'bob-tab' });
    expect(received.map(event => event.type)).toEqual(['presence.snapshot', 'presence.leave', 'presence.join']);
    expect(snapshot(service)).toEqual({ users: [{ userId: bob.id, username: bob.username, displayName: bob.displayName, action: 'Viewing', targetId: undefined }] });
  });

  it('deduplicates two tabs and stays online until the last tab leaves', () => {
    const service = createService();
    const received: StreamEvent[] = [];
    service.stream('project-a', alice.id).subscribe(event => received.push(event));
    service.heartbeat({ projectId: 'project-a', user: bob as User, clientId: 'tab-one' });
    service.heartbeat({ projectId: 'project-a', user: bob as User, clientId: 'tab-two' });
    service.leave('project-a', bob as User, 'tab-one');
    expect(received.map(event => event.type)).toEqual(['presence.snapshot', 'presence.join']);
    expect((snapshot(service) as { users: unknown[] }).users).toHaveLength(1);
    service.leave('project-a', bob as User, 'tab-two');
    expect(received.map(event => event.type)).toEqual(['presence.snapshot', 'presence.join', 'presence.leave']);
    expect(snapshot(service)).toEqual({ users: [] });
  });

  it('keeps the legacy lease separate from identified browser connections', () => {
    const service = createService();
    service.heartbeat({ projectId: 'project-a', user: bob as User });
    service.heartbeat({ projectId: 'project-a', user: bob as User, clientId: 'new-tab' });
    service.leave('project-a', bob as User);
    expect((snapshot(service) as { users: unknown[] }).users).toHaveLength(1);
    service.leave('project-a', bob as User, 'new-tab');
    expect(snapshot(service)).toEqual({ users: [] });
  });

  it('prefers an editing tab and broadcasts the remaining tab activity on leave', () => {
    vi.useFakeTimers();
    const service = createService();
    const received: StreamEvent[] = [];
    service.stream('project-a', alice.id).subscribe(event => received.push(event));
    service.heartbeat({ projectId: 'project-a', user: bob as User, action: 'Editing', targetId: 'entry-a', clientId: 'editor' });
    vi.advanceTimersByTime(1_000);
    service.heartbeat({ projectId: 'project-a', user: bob as User, action: 'Viewing', clientId: 'viewer' });
    expect((snapshot(service) as { users: Array<{ action: string; targetId: string }> }).users[0]).toMatchObject({ action: 'Editing', targetId: 'entry-a' });
    expect(received.map(event => event.type)).toEqual(['presence.snapshot', 'presence.join']);
    service.leave('project-a', bob as User, 'editor');
    expect(received.map(event => event.type)).toEqual(['presence.snapshot', 'presence.join', 'presence.update']);
    expect((received[2].data as { data: unknown }).data).toMatchObject({ userId: bob.id, action: 'Viewing', targetId: undefined });
  });

  it('preserves activity per tab on clock-only heartbeats and honors explicit target clears', () => {
    const service = createService();
    service.heartbeat({ projectId: 'project-a', user: bob as User, action: 'Editing', targetId: 'entry-a', clientId: 'editor' });
    service.heartbeat({ projectId: 'project-a', user: bob as User, clientId: 'viewer' });
    service.heartbeat({ projectId: 'project-a', user: bob as User, clientId: 'editor' });
    expect((snapshot(service) as { users: unknown[] }).users[0]).toMatchObject({ action: 'Editing', targetId: 'entry-a' });
    service.heartbeat({ projectId: 'project-a', user: bob as User, action: 'Viewing', targetId: null, clientId: 'editor' });
    expect((snapshot(service) as { users: unknown[] }).users[0]).toMatchObject({ action: 'Viewing', targetId: undefined });
  });

  it('uses the newest lease when two live tabs have equal activity priority', () => {
    vi.useFakeTimers();
    const service = createService();
    service.heartbeat({ projectId: 'project-a', user: bob as User, action: 'Editing', targetId: 'entry-a', clientId: 'first' });
    vi.advanceTimersByTime(1_000);
    service.heartbeat({ projectId: 'project-a', user: bob as User, action: 'Editing', targetId: 'entry-b', clientId: 'second' });
    expect((snapshot(service) as { users: unknown[] }).users[0]).toMatchObject({ action: 'Editing', targetId: 'entry-b' });
    vi.advanceTimersByTime(1_000);
    service.heartbeat({ projectId: 'project-a', user: bob as User, clientId: 'first' });
    expect((snapshot(service) as { users: unknown[] }).users[0]).toMatchObject({ action: 'Editing', targetId: 'entry-a' });
  });

  it('updates activity when an editing lease expires while another tab remains alive', () => {
    vi.useFakeTimers();
    const service = createService(true);
    service.heartbeat({ projectId: 'project-a', user: bob as User, action: 'Editing', targetId: 'entry-a', clientId: 'editor' });
    const received: StreamEvent[] = [];
    service.stream('project-a', alice.id).subscribe(event => received.push(event));
    vi.advanceTimersByTime(30_000);
    service.heartbeat({ projectId: 'project-a', user: bob as User, clientId: 'viewer' });
    vi.advanceTimersByTime(15_000);
    expect(received.map(event => event.type)).toEqual(['presence.snapshot', 'presence.update']);
    expect((received[1].data as { data: unknown }).data).toMatchObject({ action: 'Viewing', targetId: undefined });
    vi.advanceTimersByTime(30_000);
    expect(received.map(event => event.type)).toEqual(['presence.snapshot', 'presence.update', 'presence.leave']);
  });

  it('removes all revoked user leases, broadcasts leave, and keeps other projects online', () => {
    const service = createService();
    service.heartbeat({ projectId: 'project-a', user: alice as User, clientId: 'alice-one' });
    service.heartbeat({ projectId: 'project-a', user: alice as User, clientId: 'alice-two' });
    service.heartbeat({ projectId: 'project-a', user: bob as User, clientId: 'bob-tab' });
    service.heartbeat({ projectId: 'project-b', user: alice as User, clientId: 'alice-one' });
    const received: StreamEvent[] = [];
    service.stream('project-a', bob.id).subscribe(event => received.push(event));
    let revokedComplete = false;
    service.stream('project-a', alice.id).subscribe({ complete: () => { revokedComplete = true; } });
    service.revoke('project-a', alice.id);
    service.revoke('project-a', alice.id);
    expect(revokedComplete).toBe(true);
    expect(received.map(event => event.type)).toEqual(['presence.snapshot', 'presence.leave']);
    expect((received[1].data as { actor: typeof alice }).actor).toEqual(alice);
    expect((snapshot(service) as { users: Array<{ userId: string }> }).users.map(user => user.userId)).toEqual([bob.id]);
    expect((snapshot(service, 'project-b') as { users: Array<{ userId: string }> }).users.map(user => user.userId)).toEqual([alice.id]);
  });

  it('starts one sweep timer and clears it and subscriptions when the module is destroyed', () => {
    vi.useFakeTimers();
    const service = createService(true);
    service.onModuleInit();
    expect(vi.getTimerCount()).toBe(1);
    let complete = false;
    service.stream('project-a', alice.id).subscribe({ complete: () => { complete = true; } });
    service.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(complete).toBe(true);
  });
});
