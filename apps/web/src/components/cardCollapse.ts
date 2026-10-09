export interface CollapseTogglePlan {
  /** The next collapsed-id set. Always a new Set — the input is never mutated. */
  next: Set<string>;
  /** true = these ids are being folded, false = they are being expanded. */
  willCollapse: boolean;
}

/**
 * Decide what pressing the collapse shortcut does for a selection.
 *
 * The rule is "fold if anything in the selection is still expanded": it makes the
 * shortcut idempotent on a single card (E, E, E -> folded, expanded, folded) and
 * gives a mixed multi-selection the direction that actually declutters the board.
 *
 * Pure, so the behaviour is testable without mounting the timeline.
 */
export function planCollapseToggle(current: Set<string>, ids: string[]): CollapseTogglePlan {
  // Same reference back for a no-op: React skips the re-render.
  if (ids.length === 0) {
    return { next: current, willCollapse: false };
  }
  const willCollapse = ids.some(id => !current.has(id));
  const next = new Set(current);
  ids.forEach(id => {
    if (willCollapse) next.add(id);
    else next.delete(id);
  });
  return { next, willCollapse };
}

/** Keep only the ids that still exist (deleted cards, cards outside the range). */
export function pruneCollapsedIds(current: Set<string>, liveIds: Set<string>): Set<string> {
  let changed = false;
  const next = new Set<string>();
  current.forEach(id => {
    if (liveIds.has(id)) next.add(id);
    else changed = true;
  });
  return changed ? next : current;
}
