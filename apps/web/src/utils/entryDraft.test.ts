import { describe, expect, it } from 'vitest';
import { entryDraftToChanges } from './entryDraft';
import type { WorkLog } from '../types';

const draft: WorkLog = {
  id: 'card-1', author: ' 发布 MVP ', level: 1, weekStartDate: '2026-10-01',
  summary: '', notes: '', goals: [], createdAt: 1, updatedAt: 2, revision: 3
};

describe('saving an existing card draft', () => {
  it('clears deleted text in the serialized PATCH instead of omitting it', () => {
    const body = JSON.parse(JSON.stringify(entryDraftToChanges(draft)));
    expect(body).toMatchObject({ title: '发布 MVP', summary: '', notes: '', expectedRevision: 3 });
  });

  it('preserves the draft revision and mentions rather than taking a live cache revision', () => {
    const changes = entryDraftToChanges({ ...draft, mentionAll: true, mentionedUserIds: ['member-1'], revision: 4 });
    expect(changes).toMatchObject({ expectedRevision: 4, mentionAll: true, mentionedUserIds: ['member-1'] });
    expect(changes).not.toHaveProperty('weekStartDate');
  });

  it('rejects an existing draft without a revision instead of silently overwriting', () => {
    expect(() => entryDraftToChanges({ ...draft, revision: undefined })).toThrow();
  });
});
