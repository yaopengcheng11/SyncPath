/**
 * Lock semantics for a progress card, kept separate from EntriesService so the
 * rule is testable without a database.
 *
 * A locked card is immutable. Concretely that means no moves, no content
 * edits, no level/status/mention changes, and no deletes. The one write a
 * locked card still accepts is its own unlock — otherwise a card could be
 * locked forever.
 */

/** The fields a PATCH may carry, minus the optimistic-lock revision. */
export interface LockableChanges {
  weekStartDate?: string;
  title?: string;
  level?: string;
  summary?: string | null;
  notes?: string | null;
  status?: string;
  mentionAll?: boolean;
  mentionedUserIds?: string[];
  isLocked?: boolean;
}

export const ENTRY_LOCKED_UPDATE_MESSAGE =
  'This card is locked. Unlock it before changing its content, date, level, or mentions.';

export const ENTRY_LOCKED_DELETE_MESSAGE = 'Unlock the card before deleting it.';

/**
 * True when `changes` would alter the card itself rather than only the lock
 * flag. Moving is a `weekStartDate` change, so it is covered by the same rule
 * as editing the body.
 *
 * A PATCH carrying only `isLocked` — or nothing at all — is not a content
 * change, which is what lets an unlock through on a locked card.
 */
export function isLockedContentChange(changes: LockableChanges): boolean {
  const { isLocked: _isLocked, ...content } = changes;
  return Object.keys(content).length > 0;
}

/** Whether this update must be refused because the card is locked. */
export function isLockedUpdateRejected(isLocked: boolean, changes: LockableChanges): boolean {
  return isLocked && isLockedContentChange(changes);
}