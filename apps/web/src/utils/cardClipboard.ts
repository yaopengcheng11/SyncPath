// apps/web/src/utils/cardClipboard.ts
//
// An in-app clipboard for timeline cards.
//
// The previous implementation serialised cards to the *system* clipboard as
// JSON. That leaks internal roadmap content into the Windows clipboard history
// (and any cloud clipboard sync), and it makes paste depend on clipboard
// permissions plus a fragile focus check. Cards are copied and pasted inside
// one browser tab via this module instead: the ids and revisions are dropped on
// write, because a pasted card is always a new row, never a copy of an
// existing one.

import type { LogLevel } from '../types';

export interface ClipboardCard {
  title: string;
  level: LogLevel;
  weekStartDate: string;
  summary?: string;
  notes?: string;
  status?: 'pending' | 'completed';
  mentionAll?: boolean;
  mentionedUserIds?: string[];
}

let cards: ClipboardCard[] = [];

export const cardClipboard = {
  write(next: ClipboardCard[]): number {
    cards = next.map((card) => ({ ...card }));
    return cards.length;
  },
  read(): ClipboardCard[] {
    return cards.map((card) => ({ ...card }));
  },
  get size(): number {
    return cards.length;
  },
  clear(): void {
    cards = [];
  }
};