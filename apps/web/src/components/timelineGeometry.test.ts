import { describe, expect, it } from 'vitest';
import { dateToTimelineDay, planTimelineMoves, timelineContentSize, timelineDateAtPosition, timelineDatePosition, timelineDragDays, timelineFitScale } from './timelineGeometry';

describe('timeline geometry', () => {
  it('keeps an ordinary desktop timeline readable instead of fitting a large empty canvas', () => {
    const size = timelineContentSize(1);
    expect(size.height).toBe(520);
    expect(timelineFitScale(1280, 500, size.height)).toBeGreaterThan(0.8);
    expect(timelineFitScale(1280, 500, timelineContentSize(10).height)).toBe(0.65);
    expect(timelineFitScale(1280, 240, size.height, true)).toBeLessThan(0.5);
  });

  it('measures dates through DST as whole calendar days', () => {
    expect(dateToTimelineDay('2026-03-09') - dateToTimelineDay('2026-03-07')).toBe(2);
    expect(timelineDatePosition('2026-03-08', '2026-03-07', '2026-03-09')).toBe(50);
    expect(timelineDateAtPosition(0.6, '2026-03-07', '2026-03-09')).toBe('2026-03-08');
  });

  it('moves by pointer displacement without snapping the card to the initial click position', () => {
    expect(timelineDragDays(700, 700, 1000, '2026-01-01', '2026-01-11')).toBe(0);
    expect(timelineDragDays(700, 800, 1000, '2026-01-01', '2026-01-11')).toBe(1);
    expect(timelineDragDays(700, 600, 1000, '2026-01-01', '2026-01-11')).toBe(-1);
  });

  it('clamps a selection at either project boundary while preserving spacing', () => {
    const items = [{ id: 'a', date: '2026-01-03' }, { id: 'b', date: '2026-01-08' }];
    expect(planTimelineMoves(items, 10, '2026-01-01', '2026-01-10').map(item => item.newDate)).toEqual(['2026-01-05', '2026-01-10']);
    expect(planTimelineMoves(items, -10, '2026-01-01', '2026-01-10').map(item => item.newDate)).toEqual(['2026-01-01', '2026-01-06']);
  });

  it('respects locked cards and leaves a card at the edge in place', () => {
    expect(planTimelineMoves([{ id: 'a', date: '2026-01-10' }], 1, '2026-01-01', '2026-01-10')).toEqual([]);
    expect(planTimelineMoves([{ id: 'a', date: '2026-01-10', locked: true }, { id: 'b', date: '2026-01-03' }], 1, '2026-01-01', '2026-01-10')).toEqual([{ id: 'b', oldDate: '2026-01-03', newDate: '2026-01-04' }]);
  });

  it('handles a same-day project without division by zero', () => {
    expect(timelineDatePosition('2026-01-01', '2026-01-01', '2026-01-01')).toBe(0);
    expect(timelineDateAtPosition(1, '2026-01-01', '2026-01-01')).toBe('2026-01-01');
    expect(timelineDragDays(10, 100, 200, '2026-01-01', '2026-01-01')).toBe(0);
  });
});
