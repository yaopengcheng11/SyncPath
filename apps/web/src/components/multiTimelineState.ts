import type { WorkLog } from '../types';

/** Which cards the multi-task view shows. */
export type MultiTimelineFilter = 'all' | 'today' | 'mentions';

export interface PickerTask {
  id: string;
  name: string;
  color: string;
  /** Owning project, used to group the picker. */
  workspaceId: string;
  workspaceName: string;
}

/** Local calendar day as YYYY-MM-DD, matching the keys used in `logs`. */
export function localDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Group tasks by their owning project, preserving the incoming order. */
export function groupTasksByWorkspace(tasks: PickerTask[]): { workspaceId: string; workspaceName: string; tasks: PickerTask[] }[] {
  const order: string[] = [];
  const groups = new Map<string, { workspaceId: string; workspaceName: string; tasks: PickerTask[] }>();
  for (const task of tasks) {
    let group = groups.get(task.workspaceId);
    if (!group) {
      group = { workspaceId: task.workspaceId, workspaceName: task.workspaceName, tasks: [] };
      groups.set(task.workspaceId, group);
      order.push(task.workspaceId);
    }
    group.tasks.push(task);
  }
  return order.map((id) => groups.get(id)!);
}

/** Toggle one task in the selection without mutating the input. */
export function toggleTask(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

/** Select or clear a whole group; returns the next selection. */
export function toggleGroup(selected: string[], groupIds: string[]): string[] {
  const allSelected = groupIds.every((id) => selected.includes(id));
  if (allSelected) return selected.filter((id) => !groupIds.includes(id));
  return Array.from(new Set([...selected, ...groupIds]));
}

export function countCards(logs: Record<string, WorkLog[]>): number {
  return Object.values(logs).reduce((sum, list) => sum + (list?.length ?? 0), 0);
}

/** True when a card addresses this user, by @name or by @everyone. */
export function cardMentionsUser(log: WorkLog, userId: string): boolean {
  if (!userId) return false;
  return log.mentionAll === true || (log.mentionedUserIds ?? []).includes(userId);
}

/** True when any card on this task mentions the user. */
export function mentionsUser(logs: Record<string, WorkLog[]>, userId: string): boolean {
  if (!userId) return false;
  return Object.values(logs).some((list) => (list ?? []).some((log) => cardMentionsUser(log, userId)));
}

/**
 * Keep only the cards matching the active filter. Keys are exact calendar
 * days, so the today filter drops other buckets outright rather than
 * comparing timestamps. Returns the input untouched when not filtering.
 */
export function filterLogs(
  logs: Record<string, WorkLog[]>,
  filter: MultiTimelineFilter,
  today: string,
  userId = ''
): Record<string, WorkLog[]> {
  if (filter === 'all') return logs;
  const out: Record<string, WorkLog[]> = {};
  for (const [date, list] of Object.entries(logs)) {
    const kept = (list ?? []).filter((log) => {
      if (filter === 'today') return date === today && log.weekStartDate === today;
      if (filter === 'mentions') return cardMentionsUser(log, userId);
      return true;
    });
    if (kept.length > 0) out[date] = kept;
  }
  return out;
}
