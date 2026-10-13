import { describe, expect, it } from 'vitest';
import { calendarDateText, calendarGrid, clampCalendarDate, isCalendarDateAllowed, parseCalendarDate, shiftCalendarDate, shiftCalendarMonth } from './calendarDate';

describe('calendar date controls', () => {
  it('rejects overflowed dates and accepts valid leap years', () => {
    expect(parseCalendarDate('2025-02-29')).toBeNull();
    expect(parseCalendarDate('2026-04-31')).toBeNull();
    expect(parseCalendarDate('2026-13-01')).toBeNull();
    expect(parseCalendarDate('2026-1-09')).toBeNull();
    expect(calendarDateText(parseCalendarDate('2024-02-29')!)).toBe('2024-02-29');
  });

  it('keeps day arithmetic stable across DST and year boundaries', () => {
    expect(shiftCalendarDate('2026-03-08', 1)).toBe('2026-03-09');
    expect(shiftCalendarDate('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftCalendarDate('2025-12-31', 1)).toBe('2026-01-01');
    expect(shiftCalendarDate('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('navigates months from the first day rather than overflowing a short month', () => {
    expect(shiftCalendarMonth('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftCalendarMonth('2026-01-01', -1)).toBe('2025-12-01');
  });

  it('builds a Monday-first grid with unique consecutive calendar dates', () => {
    const grid = calendarGrid('2026-10-01');
    expect(grid).toHaveLength(42);
    expect(new Set(grid).size).toBe(42);
    expect(grid[0]).toBe('2026-09-28');
    expect(grid[41]).toBe('2026-11-08');
    expect(parseCalendarDate(grid[0])?.getUTCDay()).toBe(1);
  });

  it('enforces inclusive bounds and clamps initial keyboard focus into range', () => {
    expect(isCalendarDateAllowed('2026-10-08', '2026-10-09', '2026-10-20')).toBe(false);
    expect(isCalendarDateAllowed('2026-10-09', '2026-10-09', '2026-10-20')).toBe(true);
    expect(isCalendarDateAllowed('2026-10-20', '2026-10-09', '2026-10-20')).toBe(true);
    expect(isCalendarDateAllowed('2026-10-21', '2026-10-09', '2026-10-20')).toBe(false);
    expect(clampCalendarDate('2026-10-01', '2026-10-09')).toBe('2026-10-09');
  });
});
