import { useCallback, useEffect, useRef, useState } from 'react';
import type { Collaborator } from '../types';

interface CollaborationEnvelope {
  actor?: { id: string; username: string; displayName: string | null };
  data?: {
    users?: Array<{ userId: string; username: string; displayName: string | null; action?: string; targetId?: string | null }>;
    userId?: string;
    username?: string;
    displayName?: string | null;
    action?: string;
    targetId?: string | null;
  };
}

interface UseProjectCollaborationOptions {
  projectId: string | null;
  refreshEntries: (projectId: string) => Promise<unknown>;
}

export function useProjectCollaboration({ projectId, refreshEntries }: UseProjectCollaborationOptions) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [connected, setConnected] = useState(false);
  const [presenceHealthy, setPresenceHealthy] = useState(false);
  const [selfPresence, setSelfPresence] = useState<{ action: string; targetId?: string }>({ action: 'Viewing' });
  const presenceRef = useRef<{ action: string; targetId?: string }>({ action: 'Viewing' });
  const leaseRef = useRef<{ projectId: string; clientId: string; requests: AbortController } | null>(null);
  const activeProjectRef = useRef(projectId);
  activeProjectRef.current = projectId;

  const updatePresence = useCallback(async (action: string, targetId?: string): Promise<void> => {
    const lease = leaseRef.current;
    if (!projectId || activeProjectRef.current !== projectId || lease?.projectId !== projectId) return;
    presenceRef.current = { action, targetId };
    setSelfPresence((current) => current.action === action && current.targetId === targetId
      ? current : { action, targetId });
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/presence`, {
        method: 'POST', credentials: 'include', signal: lease.requests.signal,
        headers: { 'Content-Type': 'application/json' },
        // An explicit null clears the previous editing target.
        body: JSON.stringify({ action, targetId: targetId ?? null, clientId: lease.clientId })
      });
      if (leaseRef.current === lease && activeProjectRef.current === projectId) {
        setPresenceHealthy(response.ok);
      }
    } catch {
      if (leaseRef.current === lease && !lease.requests.signal.aborted) setPresenceHealthy(false);
    }
  }, [projectId]);

  useEffect(() => {
    setCollaborators([]);
    setConnected(false);
    setPresenceHealthy(false);
    leaseRef.current = null;
    presenceRef.current = { action: 'Viewing' };
    setSelfPresence({ action: 'Viewing' });
    if (!projectId) {
      return undefined;
    }

    let disposed = false;
    let accessRevoked = false;
    // Each subscription owns a lease, including StrictMode's replacement
    // subscriptions. A delayed leave cannot clear a newer tab's presence.
    const lease = { projectId, clientId: createPresenceClientId(), requests: new AbortController() };
    leaseRef.current = lease;
    const source = new EventSource(`/api/v1/projects/${projectId}/events`, { withCredentials: true });

    const toCollaborator = (value: { userId: string; username: string; displayName?: string | null; action?: string; targetId?: string | null }): Collaborator => ({
      clientId: hashClientId(value.userId),
      userId: value.userId,
      displayName: value.displayName,
      username: value.username,
      color: hashColor(value.username),
      action: value.action ?? 'Viewing',
      targetId: value.targetId ?? undefined
    });

    const onSnapshot = (event: MessageEvent<string>): void => {
      if (disposed || accessRevoked) return;
      const envelope = parseEnvelope(event.data) as { users?: Array<{ userId: string; username: string; displayName?: string | null; action?: string; targetId?: string | null }> } | null;
      if (!envelope || !Array.isArray(envelope.users)) return;
      setCollaborators(envelope.users
        .filter(user => typeof user?.userId === 'string' && typeof user.username === 'string')
        .map(toCollaborator));
    };
    const onPresence = (event: MessageEvent<string>): void => {
      if (disposed || accessRevoked) return;
      const envelope = parseEnvelope(event.data) as CollaborationEnvelope | null;
      if (!envelope) return;
      const actorId = envelope.actor?.id ?? envelope.data?.userId;
      const username = envelope.actor?.username ?? envelope.data?.username;
      if (typeof actorId !== 'string' || typeof username !== 'string' || !actorId || !username) return;
      const type = event.type;
      setCollaborators((current) => {
        if (type === 'presence.leave') return current.filter((item) => item.userId !== actorId);
        const next = toCollaborator({
          userId: actorId,
          username,
          displayName: envelope.actor?.displayName ?? envelope.data?.displayName,
          action: envelope.data?.action,
          targetId: envelope.data?.targetId ?? undefined
        });
        const index = current.findIndex((item) => item.userId === next.userId);
        if (index < 0) return [...current, next];
        return current.map((item, itemIndex) => itemIndex === index ? next : item);
      });
    };
    const onDataChanged = (): void => {
      if (disposed || accessRevoked) return;
      void refreshEntries(projectId).catch((error: unknown) => {
        if (disposed || accessRevoked) return;
        const status = error && typeof error === 'object' && 'status' in error
          ? Number((error as { status?: unknown }).status)
          : 0;
        if (status === 401 || status === 403 || status === 404) {
          // A revoked member can still have an EventSource open for a short
          // time. Stop reconnect attempts as soon as the API confirms that
          // the project is no longer readable.
          accessRevoked = true;
          source.close();
          setConnected(false);
          setCollaborators([]);
        }
      });
    };

    source.addEventListener('presence.snapshot', onSnapshot as EventListener);
    source.addEventListener('presence.join', onPresence as EventListener);
    source.addEventListener('presence.update', onPresence as EventListener);
    source.addEventListener('presence.leave', onPresence as EventListener);
    source.addEventListener('entry.created', onDataChanged);
    source.addEventListener('entry.updated', onDataChanged);
    source.addEventListener('entry.deleted', onDataChanged);
    source.addEventListener('project.updated', onDataChanged);
    source.addEventListener('membership.updated', onDataChanged);
    source.onopen = () => {
      if (disposed || accessRevoked) return;
      setConnected(true);
      const current = presenceRef.current;
      void updatePresence(current.action, current.targetId);
      // SSE does not replay missed entry events. Reload on every connection,
      // including reconnects, before relying on the live stream again.
      onDataChanged();
    };
    source.onerror = () => {
      if (!disposed && !accessRevoked) {
        setConnected(false);
        setPresenceHealthy(false);
        setCollaborators([]);
      }
    };

    void updatePresence('Viewing');
    const heartbeat = window.setInterval(() => {
      const current = presenceRef.current;
      void updatePresence(current.action, current.targetId);
    }, 20_000);

    const leave = (): void => {
      void fetch(`/api/v1/projects/${projectId}/presence?clientId=${encodeURIComponent(lease.clientId)}`, {
        method: 'DELETE', credentials: 'include', keepalive: true
      }).catch(() => undefined);
    };
    const resume = (): void => {
      const current = presenceRef.current;
      void updatePresence(current.action, current.targetId);
    };
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', resume);

    return () => {
      disposed = true;
      window.clearInterval(heartbeat);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', resume);
      source.close();
      lease.requests.abort();
      if (leaseRef.current === lease) leaseRef.current = null;
      leave();
    };
  }, [projectId, refreshEntries, updatePresence]);

  const currentProject = leaseRef.current?.projectId === projectId;
  return {
    collaborators: currentProject ? collaborators : [],
    connected: currentProject && connected && presenceHealthy,
    updatePresence,
    selfPresence
  };
}

function createPresenceClientId(): string {
  // LAN HTTP pages need a fallback when randomUUID is unavailable.
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    return [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function parseEnvelope(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function hashClientId(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash) + value.charCodeAt(index);
  return Math.abs(hash);
}

function hashColor(value: string): string {
  const hash = hashClientId(value).toString(16).padStart(6, '0');
  return `#${hash.slice(-6)}`;
}
