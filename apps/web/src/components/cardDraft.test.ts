import { describe, expect, it, vi } from 'vitest';
import type { WorkLog } from '../types';
import { buildCardSave, captureCardBaseline } from './cardDraft';

const original: WorkLog = {
  id: 'card-1', author: 'Launch', summary: 'Original overview', notes: 'Original details',
  level: 1, weekStartDate: '2026-10-12', revision: 4, createdAt: 100, status: 'pending',
  goals: [{ id: 'goal-1', title: 'Scope', description: '', status: 'pending' }],
  mentionedUserIds: ['member-1']
};

describe('collaborative card drafts', () => {
  it('can open a new card on an HTTP company network without secure-context UUID support', () => {
    vi.stubGlobal('crypto', {});
    try {
      const baseline = captureCardBaseline('2026-10-12', undefined, 2);
      const saved = buildCardSave(baseline, { author: 'Launch', summary: '', notes: '' }, 2, {});
      expect(baseline.id).toBeTruthy();
      expect(saved).toMatchObject({ id: baseline.id, weekStartDate: '2026-10-12', level: 2 });
    } finally { vi.unstubAllGlobals(); }
  });

  it('keeps the opened revision and date when the incoming card changes', () => {
    const incoming = { ...original, goals: original.goals.map((goal) => ({ ...goal })), mentionedUserIds: ['member-1'] };
    const baseline = captureCardBaseline('2026-09-30', incoming);
    incoming.revision = 5;
    incoming.weekStartDate = '2026-10-19';
    incoming.goals[0].title = 'Changed elsewhere';
    incoming.mentionedUserIds.push('member-2');
    const saved = buildCardSave(baseline, { author: ' My launch ', summary: '', notes: 'My details' }, 2, { mentionAll: false, mentionedUserIds: [] }, 200);
    expect(saved).toMatchObject({ id: 'card-1', revision: 4, weekStartDate: '2026-10-12', author: 'My launch', summary: '', notes: 'My details', level: 2, createdAt: 100, updatedAt: 200 });
    expect(saved.goals[0].title).toBe('Scope');
    expect(baseline.mentionedUserIds).toEqual(['member-1']);
  });

  it('uses a reviewed latest version only when explicitly captured, keeping the local text', () => {
    const draft = { author: 'My launch', summary: 'My overview', notes: '' };
    const opened = captureCardBaseline(original.weekStartDate, original);
    const latest = { ...original, revision: 5, author: 'Teammate launch', summary: 'Teammate overview', weekStartDate: '2026-10-19' };
    expect(buildCardSave(opened, draft, 1, {}).revision).toBe(4);
    const reviewed = captureCardBaseline(latest.weekStartDate, latest);
    expect(buildCardSave(reviewed, draft, 1, {})).toMatchObject({ ...draft, revision: 5, weekStartDate: '2026-10-19' });
  });
});
