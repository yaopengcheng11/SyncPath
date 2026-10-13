import type { TimelineVersionsPage } from '@syncpath/api-client';

/** Preserve loaded older pages unless a burst of new edits leaves a page gap. */
export function mergeTimelineVersionPages(current: TimelineVersionsPage, incoming: TimelineVersionsPage): TimelineVersionsPage {
  if (incoming.items.length === 0 || current.items.length === 0) return incoming;
  const projectId = incoming.items[0].projectId;
  const old = current.items.filter((item) => item.projectId === projectId);
  if (old.length === 0) return incoming;
  const newestOld = Math.max(...old.map((item) => item.version));
  const oldestIncoming = Math.min(...incoming.items.map((item) => item.version));
  if (oldestIncoming > newestOld + 1) return incoming;
  const byId = new Map([...old, ...incoming.items].map((item) => [item.id, item]));
  const items = [...byId.values()].sort((a, b) => b.version - a.version);
  return {
    items,
    nextBeforeVersion: old.some((item) => item.version < oldestIncoming) ? current.nextBeforeVersion : incoming.nextBeforeVersion
  };
}

export function appendTimelineVersionPage(current: TimelineVersionsPage, older: TimelineVersionsPage): TimelineVersionsPage {
  const projectId = current.items[0]?.projectId ?? older.items[0]?.projectId;
  const byId = new Map([...current.items, ...older.items].filter((item) => item.projectId === projectId).map((item) => [item.id, item]));
  return { items: [...byId.values()].sort((a, b) => b.version - a.version), nextBeforeVersion: older.nextBeforeVersion };
}
