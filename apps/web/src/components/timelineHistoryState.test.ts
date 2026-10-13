import { describe, expect, it } from 'vitest';
import type { TimelineVersionSummary, TimelineVersionsPage } from '@syncpath/api-client';
import { appendTimelineVersionPage, mergeTimelineVersionPages } from './timelineHistoryState';

function page(versions: number[], nextBeforeVersion: number | null, projectId = 'task'): TimelineVersionsPage {
  return { items: versions.map((version): TimelineVersionSummary => ({ id: `${projectId}:${version}`, projectId, version, createdAt: '2026-10-09T00:00:00.000Z', actor: null, action: version === 0 ? 'baseline' : 'entry.updated', entryId: null, changes: [] })), nextBeforeVersion };
}

describe('timeline history pagination', () => {
  it('keeps older loaded versions after refreshing the newest page and deduplicates overlap', () => {
    const result = mergeTimelineVersionPages(page([5, 4, 3, 2], 2), page([7, 6, 5, 4], 4));
    expect(result.items.map((item) => item.version)).toEqual([7, 6, 5, 4, 3, 2]);
    expect(result.nextBeforeVersion).toBe(2);
  });

  it('resets the paging cursor after a burst of changes rather than permanently omitting intermediate versions', () => {
    const newest = page([30, 29, 28], 28);
    expect(mergeTimelineVersionPages(page([5, 4, 3, 2, 1, 0], null), newest)).toEqual(newest);
  });

  it('deduplicates older pages and never carries another task into the current history', () => {
    const result = appendTimelineVersionPage(page([4, 3, 2], 2), page([2, 1, 0], null));
    expect(result.items.map((item) => item.version)).toEqual([4, 3, 2, 1, 0]);
    expect(result.nextBeforeVersion).toBeNull();
    expect(mergeTimelineVersionPages(page([9], 9, 'other-task'), page([3, 2], 2))).toEqual(page([3, 2], 2));
    expect(mergeTimelineVersionPages(page([3, 2], 2), page([], null))).toEqual(page([], null));
  });
});
