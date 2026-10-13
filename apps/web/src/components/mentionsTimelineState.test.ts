import { describe, expect, it } from 'vitest';
import type { MentionTimelineItem } from '@syncpath/api-client';
import { mentionedItemsToTimeline, mentionedTimelineItems, mentionsTimelineScope } from './mentionsTimelineState';

function item(id: string, workspaceId: string, projectId: string, date: string): MentionTimelineItem {
  return {
    workspace: { id: workspaceId, name: `Project ${workspaceId}` },
    project: { id: projectId, workspaceId, creatorId: 'author', name: `Task ${projectId}`, description: null, startDate: '2025-01-01', endDate: '2027-12-31', visibility: 'workspace', status: 'active', color: '#6366f1', holidayRegion: 'NONE', revision: 1, createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z', myRole: 'Editor' },
    entry: { id, projectId, authorId: 'author', weekStartDate: date, title: `Card ${id}`, level: 'secondary', summary: 'Summary', notes: 'Notes', status: 'pending', isLocked: false, mentionAll: false, mentionedUserIds: ['recipient'], revision: 2, createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T01:00:00.000Z' }
  };
}

describe('consolidated mentions timeline', () => {
  it('scopes data to the account and project selection independently of selection order', () => {
    expect(mentionsTimelineScope('alice', ['b', 'a', 'a'])).toBe(mentionsTimelineScope('alice', ['a', 'b']));
    expect(mentionsTimelineScope('alice', null)).not.toBe(mentionsTimelineScope('alice', []));
    expect(mentionsTimelineScope('alice', ['a'])).not.toBe(mentionsTimelineScope('bob', ['a']));
  });

  it('filters by selected UI projects, preserves actual card IDs, and rejects mismatched source records', () => {
    const a = item('a', 'workspace-a', 'task-a', '2026-10-10');
    const b = item('b', 'workspace-b', 'task-b', '2026-10-08');
    const mismatch = { ...b, entry: { ...b.entry, id: 'wrong', projectId: 'different-task' } };
    expect(mentionedTimelineItems([a, b, a, mismatch], null).map((value) => value.entry.id)).toEqual(['b', 'a']);
    expect(mentionedTimelineItems([a, b], ['workspace-a']).map((value) => value.entry.id)).toEqual(['a']);
    expect(mentionedTimelineItems([a, b], [])).toEqual([]);
  });

  it('uses a single date axis covering the mentioned cards across tasks and includes source captions', () => {
    const a = item('a', 'workspace-a', 'task-a', '2026-01-01');
    const b = item('b', 'workspace-b', 'task-b', '2026-03-01');
    const result = mentionedItemsToTimeline([a, b], 'recipient', 'My mentions');
    expect(result.project).toMatchObject({ startDate: '2025-12-25', endDate: '2026-03-08', holidayRegion: 'NONE' });
    expect(Object.values(result.logs).flat().map((value) => value.id)).toEqual(['a', 'b']);
    expect(result.logs['2026-01-01'][0].summary).toBe('Project workspace-a / Task task-a\nSummary');
    expect(a.entry.summary).toBe('Summary');
  });

  it('keeps a one-day or leap-day timeline usable and has no invented range for an empty result', () => {
    const value = mentionedItemsToTimeline([item('leap', 'workspace', 'task', '2024-02-29')], 'recipient', 'My mentions');
    expect(value.project).toMatchObject({ startDate: '2024-02-22', endDate: '2024-03-07' });
    expect(mentionedItemsToTimeline([], 'recipient', 'My mentions')).toEqual({ project: null, logs: {} });
  });
});
