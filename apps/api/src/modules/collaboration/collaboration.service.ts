import { Injectable } from '@nestjs/common';
import { merge, Observable, of, Subject } from 'rxjs';
import { filter, map, takeUntil } from 'rxjs/operators';
import type { User } from '@prisma/client';

export type CollaborationEventType =
  | 'presence.join'
  | 'presence.update'
  | 'presence.leave'
  | 'presence.snapshot'
  | 'entry.created'
  | 'entry.updated'
  | 'entry.deleted'
  | 'project.updated'
  | 'membership.updated';

export interface CollaborationEvent {
  id: string;
  projectId: string;
  type: CollaborationEventType;
  actor: { id: string; username: string; displayName: string | null };
  data?: Record<string, unknown>;
  at: string;
}

export interface PresenceState {
  userId: string;
  username: string;
  displayName: string | null;
  action: string;
  targetId?: string;
  lastSeen: number;
}

const PRESENCE_TTL_MS = 45_000;

@Injectable()
export class CollaborationService {
  private readonly events = new Subject<CollaborationEvent>();
  private readonly revocations = new Subject<{ projectId: string; userId: string }>();
  private readonly mentionEvents = new Subject<{ recipientId: string; notificationId: string }>();
  private readonly presence = new Map<string, Map<string, PresenceState>>();

  stream(projectId: string, excludeUserId: string): Observable<{ type: string; data: unknown; id?: string }> {
    return merge(
      of({
        type: 'presence.snapshot',
        data: {
          // The caller already knows their own state. Keeping the snapshot
          // to other viewers avoids showing the current user as a second
          // avatar and makes reconnects idempotent.
          users: this.listPresence(projectId).filter((user) => user.userId !== excludeUserId)
        }
      }),
      this.events.pipe(
        // Hide the caller's own avatar, but keep data events from their other
        // windows. Filtering every event by actor leaves those windows stale.
        filter((event) => event.projectId === projectId && (
          !event.type.startsWith('presence.') || event.actor.id !== excludeUserId
        )),
        map((event) => ({ type: event.type, id: event.id, data: event }))
      )
    ).pipe(
      // A project-member revoke must terminate an already-open SSE stream.
      // Otherwise the browser could continue receiving project events until
      // its next reconnect even though the next API request is forbidden.
      takeUntil(this.revocations.pipe(
        filter((revocation) => revocation.projectId === projectId && revocation.userId === excludeUserId)
      ))
    );
  }

  streamMentions(recipientId: string): Observable<{ type: string; data: unknown }> {
    return this.mentionEvents.pipe(
      filter((event) => event.recipientId === recipientId),
      map((event) => ({ type: 'mention.created', data: { notificationId: event.notificationId } }))
    );
  }

  publishMention(recipientId: string, notificationId: string): void {
    this.mentionEvents.next({ recipientId, notificationId });
  }

  revoke(projectId: string, userId: string): void {
    // Controllers publish membership.updated before calling revoke. Subject
    // delivery is synchronous, so terminate now without a gap for data events
    // after the user's access has been removed.
    this.revocations.next({ projectId, userId });
  }

  publish(input: {
    projectId: string;
    type: Exclude<CollaborationEventType, 'presence.snapshot'>;
    actor: User | { id: string; username: string; displayName: string | null };
    data?: Record<string, unknown>;
  }): void {
    this.events.next({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      projectId: input.projectId,
      type: input.type,
      actor: {
        id: input.actor.id,
        username: input.actor.username,
        displayName: input.actor.displayName ?? null
      },
      data: input.data,
      at: new Date().toISOString()
    });
  }

  heartbeat(input: {
    projectId: string;
    user: User;
    action?: string;
    targetId?: string | null;
  }): void {
    const now = Date.now();
    const projectPresence = this.presence.get(input.projectId) ?? new Map<string, PresenceState>();
    const previous = projectPresence.get(input.user.id);
    const state: PresenceState = {
      userId: input.user.id,
      username: input.user.username,
      displayName: input.user.displayName,
      action: input.action ?? previous?.action ?? 'Viewing',
      // `null` is an explicit clear from the browser. An omitted field keeps
      // the previous target for heartbeat calls that only refresh the clock.
      targetId: input.targetId === undefined ? previous?.targetId : input.targetId ?? undefined,
      lastSeen: now
    };
    projectPresence.set(input.user.id, state);
    this.presence.set(input.projectId, projectPresence);
    if (!previous) {
      this.publish({ projectId: input.projectId, type: 'presence.join', actor: input.user, data: this.publicPresence(state) });
    } else if (previous.action !== state.action || previous.targetId !== state.targetId) {
      this.publish({ projectId: input.projectId, type: 'presence.update', actor: input.user, data: this.publicPresence(state) });
    }
  }

  leave(projectId: string, user: User): void {
    const projectPresence = this.presence.get(projectId);
    if (!projectPresence?.delete(user.id)) return;
    if (projectPresence.size === 0) this.presence.delete(projectId);
    this.publish({ projectId, type: 'presence.leave', actor: user });
  }

  private listPresence(projectId: string): Array<Record<string, unknown>> {
    const projectPresence = this.presence.get(projectId);
    if (!projectPresence) return [];
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    for (const [userId, state] of projectPresence) {
      if (state.lastSeen < cutoff) projectPresence.delete(userId);
    }
    if (projectPresence.size === 0) this.presence.delete(projectId);
    return [...projectPresence.values()].map((state) => this.publicPresence(state));
  }

  private publicPresence(state: PresenceState): Record<string, unknown> {
    return {
      userId: state.userId,
      username: state.username,
      displayName: state.displayName,
      action: state.action,
      targetId: state.targetId
    };
  }
}
