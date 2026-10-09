import { describe, expect, it } from 'vitest';
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
