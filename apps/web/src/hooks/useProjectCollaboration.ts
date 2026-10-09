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
  const presenceRef = useRef<{ action: string; targetId?: string }>({ action: 'Viewing' });
  const activeProjectRef = useRef(projectId);
  activeProjectRef.current = projectId;

  const updatePresence = useCallback(async (action: string, targetId?: string): Promise<void> => {
    if (!projectId || activeProjectRef.current !== projectId) return;
    presenceRef.current = { action, targetId };
    await fetch(`/api/v1/projects/${projectId}/presence`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      // Send null when there is no active card so the server clears the
      // previous target instead of carrying stale editing state forward.
      body: JSON.stringify({ action, targetId: targetId ?? null })
    }).catch(() => undefined);
  }, [projectId]);

  useEffect(() => {
    setCollaborators([]);
    setConnected(false);
    presenceRef.current = { action: 'Viewing' };
    if (!projectId) {
      return undefined;
    }

    let disposed = false;
    let accessRevoked = false;
    const source = new EventSource(`/api/v1/projects/${projectId}/events`, { withCredentials: true });

    const toCollaborator = (value: { userId: string; username: string; action?: string; targetId?: string | null }): Collaborator => ({
      clientId: hashClientId(value.userId),
      username: value.username,
      color: hashColor(value.username),
      action: value.action ?? 'Viewing',
      targetId: value.targetId ?? undefined
    });

    const onSnapshot = (event: MessageEvent<string>): void => {
      if (disposed || accessRevoked) return;
      const envelope = parseEnvelope(event.data) as { users?: Array<{ userId: string; username: string; action?: string; targetId?: string | null }> } | null;
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
        if (type === 'presence.leave') return current.filter((item) => item.clientId !== hashClientId(actorId));
        const next = toCollaborator({
          userId: actorId,
          username,
          action: envelope.data?.action,
          targetId: envelope.data?.targetId ?? undefined
        });
        const index = current.findIndex((item) => item.clientId === next.clientId);
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
      // SSE does not replay missed entry events. Reload on every connection,
      // including reconnects, before relying on the live stream again.
      onDataChanged();
    };
    source.onerror = () => { if (!disposed && !accessRevoked) setConnected(false); };

    void updatePresence('Viewing');
    const heartbeat = window.setInterval(() => {
      const current = presenceRef.current;
      void updatePresence(current.action, current.targetId);
    }, 20_000);

    return () => {
      disposed = true;
      window.clearInterval(heartbeat);
      source.close();
      void fetch(`/api/v1/projects/${projectId}/presence`, { method: 'DELETE', credentials: 'include' }).catch(() => undefined);
    };
  }, [projectId, refreshEntries, updatePresence]);

  return { collaborators, connected, updatePresence };
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
