/** Calendar dates use UTC arithmetic so a timezone or DST change cannot move a day. */
export function parseCalendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || year > 9999) return null;
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, day);
  result.setUTCHours(0, 0, 0, 0);
  return result.getUTCFullYear() === year && result.getUTCMonth() === month - 1 && result.getUTCDate() === day ? result : null;
}

export function calendarDateText(value: Date): string {
  return `${String(value.getUTCFullYear()).padStart(4, '0')}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

export function todayCalendarDate(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

export function shiftCalendarDate(value: string, days: number): string {
  const date = parseCalendarDate(value);
  if (!date) return value;
  date.setUTCDate(date.getUTCDate() + days);
  return calendarDateText(date);
}

export function calendarMonth(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

export function shiftCalendarMonth(value: string, months: number): string {
  const date = parseCalendarDate(calendarMonth(value));
  if (!date) return value;
  date.setUTCMonth(date.getUTCMonth() + months);
  return calendarDateText(date);
}

export function calendarGrid(month: string): string[] {
  const first = parseCalendarDate(calendarMonth(month));
  if (!first) return [];
  // Monday starts the week. Include adjacent days to keep a stable six-row grid.
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  first.setUTCDate(first.getUTCDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(date.getUTCDate() + index);
    return calendarDateText(date);
  });
}

export function isCalendarDateAllowed(value: string, min?: string, max?: string): boolean {
  return !!parseCalendarDate(value) && (!min || value >= min) && (!max || value <= max);
}

export function clampCalendarDate(value: string, min?: string, max?: string): string {
  if (min && value < min) return min;
  if (max && value > max) return max;
  return value;
}
