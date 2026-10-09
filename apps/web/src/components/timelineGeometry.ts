const DAY_MS = 24 * 60 * 60 * 1000;

// Calendar dates are measured independently of timezones and daylight saving.
export function dateToTimelineDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function timelineDayToDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function timelineDatePosition(date: string, startDate: string, endDate: string): number {
  const start = dateToTimelineDay(startDate);
  const duration = dateToTimelineDay(endDate) - start;
  return duration > 0 ? ((dateToTimelineDay(date) - start) / duration) * 100 : 0;
}

export function timelineDateAtPosition(position: number, startDate: string, endDate: string): string {
  const start = dateToTimelineDay(startDate);
  const duration = Math.max(0, dateToTimelineDay(endDate) - start);
  return timelineDayToDate(start + Math.round(Math.max(0, Math.min(1, position)) * duration));
}

export function timelineDragDays(startX: number, currentX: number, axisWidth: number, startDate: string, endDate: string): number {
  if (axisWidth <= 0) return 0;
  return Math.round(((currentX - startX) / axisWidth) * Math.max(0, dateToTimelineDay(endDate) - dateToTimelineDay(startDate)));
}

export function planTimelineMoves(
  items: { id: string; date: string; locked?: boolean }[],
  requestedDays: number,
  startDate: string,
  endDate: string,
): { id: string; oldDate: string; newDate: string }[] {
  const movable = items.filter(item => !item.locked);
  if (movable.length === 0) return [];
  const start = dateToTimelineDay(startDate);
  const end = dateToTimelineDay(endDate);
  const dates = movable.map(item => dateToTimelineDay(item.date));
  const minMove = start - Math.min(...dates);
  const maxMove = end - Math.max(...dates);
  if (minMove > maxMove) return [];
  const days = Math.max(minMove, Math.min(maxMove, Math.round(requestedDays)));
  if (days === 0) return [];
  return movable.map((item, index) => ({ id: item.id, oldDate: item.date, newDate: timelineDayToDate(dates[index] + days) }));
}

export function timelineContentSize(maxCardsOnDate: number): { skylineHeight: number; height: number } {
  const skylineHeight = 240 + Math.max(0, maxCardsOnDate) * 100;
  return { skylineHeight, height: Math.max(520, skylineHeight + 160) };
}

export function timelineFitScale(width: number, height: number, contentHeight: number, preview = false): number {
  const paddingX = preview ? 40 : 96;
  const paddingY = preview ? 40 : 80;
  const scaleX = Math.max(20, width - paddingX) / Math.max(width, 1400);
  const scaleY = Math.max(20, height - paddingY) / contentHeight;
  // Full timelines keep labels legible; dense plans can be panned with Space.
  return Math.max(preview ? 0.1 : 0.65, Math.min(1, scaleX, scaleY));
}
