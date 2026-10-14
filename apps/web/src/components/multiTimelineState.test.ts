import { describe, expect, it } from 'vitest';
import type { WorkLog } from '../types';
import {
  cardMentionsUser,
  countCards,
  filterLogs,
  groupTasksByWorkspace,
  localDateStr,
  mentionsUser,
  toggleGroup,
  toggleTask,
  type PickerTask
} from './multiTimelineState';

const ME = 'user-me';
const log = (weekStartDate: string, over: Partial<WorkLog> = {}): WorkLog => ({
  id: `l-${weekStartDate}`,
  author: 'u',
  level: 3,
  weekStartDate,
  summary: '',
  goals: [],
  notes: '',
  createdAt: 0,
  ...over
});

describe('localDateStr', () => {
  it('formats using the local calendar day, not UTC', () => {
    expect(localDateStr(new Date(2026, 9, 14))).toBe('2026-10-14');
    expect(localDateStr(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
});

describe('groupTasksByWorkspace', () => {
  it('groups tasks and keeps first-seen project order', () => {
    const tasks: PickerTask[] = [
      { id: 'a', name: 'A', color: '#000', workspaceId: 'w2', workspaceName: 'Second' },
      { id: 'b', name: 'B', color: '#000', workspaceId: 'w1', workspaceName: 'First' },
      { id: 'c', name: 'C', color: '#000', workspaceId: 'w2', workspaceName: 'Second' }
    ];
    expect(groupTasksByWorkspace(tasks).map((g) => g.workspaceId)).toEqual(['w2', 'w1']);
    expect(groupTasksByWorkspace(tasks)[0].tasks.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('returns nothing for an empty list', () => {
    expect(groupTasksByWorkspace([])).toEqual([]);
  });
});

describe('toggleTask', () => {
  it('adds then removes without mutating the input', () => {
    const start = ['a'];
    const added = toggleTask(start, 'b');
    expect(added).toEqual(['a', 'b']);
    expect(start).toEqual(['a']);
    expect(toggleTask(added, 'a')).toEqual(['b']);
  });
});

describe('toggleGroup', () => {
  it('selects a whole group, then clears it when already full', () => {
    const g = ['a', 'b'];
    expect(toggleGroup(['a'], g)).toEqual(['a', 'b']);
    expect(toggleGroup(['a', 'b'], g)).toEqual([]);
  });

  it('leaves tasks outside the group untouched', () => {
    expect(toggleGroup(['z'], ['a', 'b'])).toEqual(['z', 'a', 'b']);
  });
});

describe('countCards', () => {
  it('counts cards across every date bucket', () => {
    expect(countCards({ '2026-10-14': [log('2026-10-14'), log('2026-10-14')], '2026-10-13': [log('2026-10-13')] })).toBe(3);
    expect(countCards({})).toBe(0);
  });
});

describe('cardMentionsUser', () => {
  it('matches an explicit @name', () => {
    expect(cardMentionsUser(log('2026-10-14', { mentionedUserIds: ['someone', ME] }), ME)).toBe(true);
  });

  it('matches @everyone', () => {
    expect(cardMentionsUser(log('2026-10-14', { mentionAll: true }), ME)).toBe(true);
  });

  it('does not match a card mentioning only other people', () => {
    expect(cardMentionsUser(log('2026-10-14', { mentionedUserIds: ['someone'] }), ME)).toBe(false);
    expect(cardMentionsUser(log('2026-10-14'), ME)).toBe(false);
  });

  it('never matches when there is no current user', () => {
    expect(cardMentionsUser(log('2026-10-14', { mentionAll: true }), '')).toBe(false);
  });
});

describe('mentionsUser', () => {
  it('is true when any card on the task mentions the user', () => {
    expect(mentionsUser({ '2026-10-13': [log('2026-10-13')], '2026-10-14': [log('2026-10-14', { mentionAll: true })] }, ME)).toBe(true);
  });

  it('is false for a task with no matching card', () => {
    expect(mentionsUser({ '2026-10-14': [log('2026-10-14')] }, ME)).toBe(false);
  });
});

describe('filterLogs', () => {
  it('keeps only cards dated today', () => {
    const logs = { '2026-10-14': [log('2026-10-14')], '2026-10-13': [log('2026-10-13')] };
    expect(Object.keys(filterLogs(logs, 'today', '2026-10-14'))).toEqual(['2026-10-14']);
  });

  it('returns an empty map rather than a phantom today bucket', () => {
    expect(filterLogs({ '2026-10-13': [log('2026-10-13')] }, 'today', '2026-10-14')).toEqual({});
  });

  it('keeps only cards mentioning the user, across every date', () => {
    const logs = {
      '2026-10-13': [log('2026-10-13', { mentionAll: true }), log('2026-10-13')],
      '2026-10-14': [log('2026-10-14', { mentionedUserIds: [ME] })]
    };
    const out = filterLogs(logs, 'mentions', '2026-10-14', ME);
    expect(Object.keys(out).sort()).toEqual(['2026-10-13', '2026-10-14']);
    expect(out['2026-10-13']).toHaveLength(1);
    expect(out['2026-10-14']).toHaveLength(1);
  });

  it('passes logs through untouched when not filtering', () => {
    const logs = { '2026-10-13': [log('2026-10-13')] };
    expect(filterLogs(logs, 'all', '2026-10-14', ME)).toBe(logs);
  });
});
