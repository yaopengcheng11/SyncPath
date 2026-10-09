import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLockedContentChange, isLockedUpdateRejected } from '../src/modules/entries/entryLock';

test('a locked card refuses every content, date, level, status and mention change', () => {
  for (const changes of [
    { title: 'New title' },
    { summary: 'New summary' },
    { notes: 'New notes' },
    // A move is a weekStartDate change and must be refused like an edit.
    { weekStartDate: '2026-03-02' },
    { level: 'primary' },
    { status: 'completed' },
    { mentionAll: true },
    { mentionedUserIds: ['user-1'] },
    { summary: null },
    { title: 'T', weekStartDate: '2026-03-02', mentionedUserIds: [] }
  ]) {
    assert.equal(isLockedUpdateRejected(true, changes), true, JSON.stringify(changes));
  }
});

test('a locked card still accepts its own unlock, and a redundant lock', () => {
  assert.equal(isLockedUpdateRejected(true, { isLocked: false }), false);
  assert.equal(isLockedUpdateRejected(true, { isLocked: true }), false);
  // An empty PATCH is a no-op, not an edit.
  assert.equal(isLockedUpdateRejected(true, {}), false);
});

test('unlocking and editing in one request is refused, not silently split', () => {
  // Otherwise a caller could smuggle a content change past the guard by
  // pairing it with the unlock.
  assert.equal(isLockedUpdateRejected(true, { isLocked: false, title: 'Sneaky' }), true);
});

test('an unlocked card accepts anything, including locking', () => {
  for (const changes of [
    { title: 'New title' },
    { weekStartDate: '2026-03-02' },
    { isLocked: true },
    { isLocked: true, title: 'Lock and rename' }
  ]) {
    assert.equal(isLockedUpdateRejected(false, changes), false, JSON.stringify(changes));
  }
});

test('isLocked alone is never a content change', () => {
  assert.equal(isLockedContentChange({ isLocked: false }), false);
  assert.equal(isLockedContentChange({ isLocked: true, notes: 'x' }), true);
});