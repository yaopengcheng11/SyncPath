import type { MentionTimelineItem } from '@syncpath/api-client';
import type { Project, WorkLog } from '../types';

export function mentionsTimelineScope(userId: string, workspaceIds: string[] | null): string {
  return JSON.stringify([userId, workspaceIds === null ? null : [...new Set(workspaceIds)].sort()]);
}

/** Only presentation changes here. Entry IDs and source records stay intact. */
export function mentionedTimelineItems(items: MentionTimelineItem[], workspaceIds: string[] | null): MentionTimelineItem[] {
  const allowed = workspaceIds === null ? null : new Set(workspaceIds);
  const seen = new Set<string>();
  return items.filter((item) => {
    if (allowed && !allowed.has(item.workspace.id)) return false;
    if (item.entry.projectId !== item.project.id || item.project.workspaceId !== item.workspace.id) return false;
    if (seen.has(item.entry.id)) return false;
    seen.add(item.entry.id);
    return true;
  }).sort((a, b) => a.entry.weekStartDate.localeCompare(b.entry.weekStartDate)
    || a.workspace.id.localeCompare(b.workspace.id)
    || a.project.id.localeCompare(b.project.id)
    || a.entry.id.localeCompare(b.entry.id));
}

export function mentionSourceCaption(item: MentionTimelineItem): string {
  return `${item.workspace.name} / ${item.project.name}`;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function mentionedItemsToTimeline(items: MentionTimelineItem[], userId: string, name: string): {
  project: Project | null;
  logs: Record<string, WorkLog[]>;
} {
  const logs: Record<string, WorkLog[]> = {};
  if (items.length === 0) return { project: null, logs };
  const dates = items.map((item) => item.entry.weekStartDate).sort();
  for (const item of items) {
    const entry = item.entry;
    const log: WorkLog = {
      id: entry.id,
      author: entry.title,
      level: entry.level === 'primary' ? 1 : entry.level === 'secondary' ? 2 : 3,
      weekStartDate: entry.weekStartDate,
      summary: [mentionSourceCaption(item), entry.summary].filter(Boolean).join('\n'),
      notes: entry.notes ?? '',
      goals: [],
      status: entry.status,
      isLocked: entry.isLocked,
      revision: entry.revision,
      createdAt: Date.parse(entry.createdAt),
      updatedAt: Date.parse(entry.updatedAt)
    };
    (logs[entry.weekStartDate] ??= []).push(log);
  }
  return {
    project: {
      id: `mentions:${userId}`, name, startDate: addDays(dates[0], -7),
      endDate: addDays(dates[dates.length - 1], 7), color: '#6366f1', holidayRegion: 'NONE'
    },
    logs
  };
}
