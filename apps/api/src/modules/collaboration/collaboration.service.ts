import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
const PRESENCE_SWEEP_MS = 5_000;
const LEGACY_CLIENT_ID = '__legacy__';

@Injectable()
export class CollaborationService implements OnModuleInit, OnModuleDestroy {
  private readonly events = new Subject<CollaborationEvent>();
  private readonly revocations = new Subject<{ projectId: string; userId: string }>();
  private readonly mentionEvents = new Subject<{ recipientId: string; notificationId: string }>();
  // Each browser connection owns a lease. A user's public state is derived
  // from their live leases, so closing one window cannot hide another window.
  private readonly presence = new Map<string, Map<string, Map<string, PresenceState>>>();
  private presenceTimer?: ReturnType<typeof setInterval>;

  onModuleInit(): void {
    if (this.presenceTimer) return;
    this.presenceTimer = setInterval(() => this.expirePresence(), PRESENCE_SWEEP_MS);
    this.presenceTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = undefined;
    this.presence.clear();
    this.events.complete();
    this.revocations.complete();
    this.mentionEvents.complete();
  }

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
    const projectPresence = this.presence.get(projectId);
    const leases = projectPresence?.get(userId);
    const state = leases && this.aggregatePresence(leases);
    if (!state) return;
    projectPresence!.delete(userId);
    if (projectPresence!.size === 0) this.presence.delete(projectId);
    this.publish({ projectId, type: 'presence.leave', actor: this.presenceActor(state) });
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
    clientId?: string;
  }): void {
    const now = Date.now();
    this.expirePresence(input.projectId, now);
    const projectPresence = this.presence.get(input.projectId) ?? new Map<string, Map<string, PresenceState>>();
    const leases = projectPresence.get(input.user.id) ?? new Map<string, PresenceState>();
    const previousPublic = this.aggregatePresence(leases);
    const clientId = input.clientId ?? LEGACY_CLIENT_ID;
    const previous = leases.get(clientId);
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
    leases.set(clientId, state);
    projectPresence.set(input.user.id, leases);
    this.presence.set(input.projectId, projectPresence);
    const publicState = this.aggregatePresence(leases)!;
    if (!previousPublic) {
      this.publish({ projectId: input.projectId, type: 'presence.join', actor: input.user, data: this.publicPresence(publicState) });
    } else if (this.activityChanged(previousPublic, publicState)) {
      this.publish({ projectId: input.projectId, type: 'presence.update', actor: input.user, data: this.publicPresence(publicState) });
    }
  }

  leave(projectId: string, user: User, clientId?: string): void {
    this.expirePresence(projectId);
    const projectPresence = this.presence.get(projectId);
    const leases = projectPresence?.get(user.id);
    const previous = leases && this.aggregatePresence(leases);
    if (!leases || !previous || !leases.delete(clientId ?? LEGACY_CLIENT_ID)) return;
    const state = this.aggregatePresence(leases);
    if (!state) {
      projectPresence!.delete(user.id);
      if (projectPresence!.size === 0) this.presence.delete(projectId);
      this.publish({ projectId, type: 'presence.leave', actor: user });
    } else if (this.activityChanged(previous, state)) {
      this.publish({ projectId, type: 'presence.update', actor: user, data: this.publicPresence(state) });
    }
  }

  private listPresence(projectId: string): Array<Record<string, unknown>> {
    this.expirePresence(projectId);
    const projectPresence = this.presence.get(projectId);
    if (!projectPresence) return [];
    return [...projectPresence.values()].map((leases) => this.publicPresence(this.aggregatePresence(leases)!));
  }

  private expirePresence(projectId?: string, now = Date.now()): void {
    const cutoff = now - PRESENCE_TTL_MS;
    for (const [id, projectPresence] of this.presence) {
      if (projectId !== undefined && id !== projectId) continue;
      for (const [userId, leases] of projectPresence) {
        const previous = this.aggregatePresence(leases)!;
        for (const [clientId, state] of leases) {
          if (state.lastSeen <= cutoff) leases.delete(clientId);
        }
        const state = this.aggregatePresence(leases);
        if (!state) {
          projectPresence.delete(userId);
          this.publish({ projectId: id, type: 'presence.leave', actor: this.presenceActor(previous) });
        } else if (this.activityChanged(previous, state)) {
          this.publish({ projectId: id, type: 'presence.update', actor: this.presenceActor(state), data: this.publicPresence(state) });
        }
      }
      if (projectPresence.size === 0) this.presence.delete(id);
    }
  }

  private aggregatePresence(leases: Map<string, PresenceState>): PresenceState | undefined {
    let result: PresenceState | undefined;
    for (const state of leases.values()) {
      if (!result || (state.action === 'Editing' && result.action !== 'Editing') || (
        (state.action === 'Editing') === (result.action === 'Editing') && state.lastSeen >= result.lastSeen
      )) result = state;
    }
    return result;
  }

  private activityChanged(previous: PresenceState, state: PresenceState): boolean {
    return previous.action !== state.action || previous.targetId !== state.targetId;
  }

  private presenceActor(state: PresenceState): CollaborationEvent['actor'] {
    return { id: state.userId, username: state.username, displayName: state.displayName };
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
