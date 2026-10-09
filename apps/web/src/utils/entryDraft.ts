import type { ApiClient } from '@syncpath/api-client';
import type { WorkLog } from '../types';

/** Use the editor's opening revision, even when live updates refresh the cache. */
export function entryDraftToChanges(log: WorkLog): Parameters<ApiClient['updateEntry']>[1] {
  if (!Number.isInteger(log.revision) || (log.revision ?? 0) < 1) {
    throw new Error('An existing card needs its opening revision.');
  }
  return {
    title: log.author.trim(),
    // Empty strings deliberately clear existing fields; undefined leaves them unchanged.
    summary: log.summary ?? '',
    notes: log.notes ?? '',
    mentionAll: log.mentionAll ?? false,
    mentionedUserIds: log.mentionedUserIds ?? [],
    level: log.level === 1 ? 'primary' : log.level === 2 ? 'secondary' : 'minor',
    status: log.status === 'completed' ? 'completed' : 'pending',
    expectedRevision: log.revision!
  };
}
