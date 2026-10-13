import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { ApiError, apiClient } from '../services/api';
import { MentionInboxState } from './mentionInboxState';

/** Mount once for the signed-in account, above the home/task view switch. */
export function useMentionInbox(userId: string, onSessionExpired?: () => void) {
  const onSessionExpiredRef = useRef(onSessionExpired);
  onSessionExpiredRef.current = onSessionExpired;
  const state = useMemo(() => new MentionInboxState({
    list: (signal) => apiClient.listMentionNotifications({ signal }),
    markRead: (notificationId, signal) => apiClient.markMentionRead(notificationId, { signal }),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) onSessionExpiredRef.current?.();
    }
  }), [userId]);
  const snapshot = useSyncExternalStore(state.subscribe, state.getSnapshot, state.getSnapshot);

  useEffect(() => {
    state.start();
    const source = new EventSource('/api/v1/notifications/events', { withCredentials: true });
    source.addEventListener('mention.created', state.refresh);
    const interval = window.setInterval(() => { void state.refresh(); }, 60_000);
    return () => {
      source.close();
      window.clearInterval(interval);
      state.stop();
    };
  }, [state]);

  return {
    ...snapshot,
    setOpen: state.setOpen,
    toggle: state.toggle,
    refresh: state.refresh,
    markRead: state.markRead
  };
}

export type MentionInboxModel = ReturnType<typeof useMentionInbox>;
