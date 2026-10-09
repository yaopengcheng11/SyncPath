import type { LogLevel, WorkLog } from '../types';

export type CardFields = Pick<WorkLog, 'author' | 'summary' | 'notes'>;

/** A draft stays tied to the version the user actually opened or reviewed. */
export function captureCardBaseline(dateStr: string, initialLog?: WorkLog, initialLevel: LogLevel = 3): WorkLog {
  return {
    ...initialLog,
    id: initialLog?.id ?? globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 11),
    author: initialLog?.author ?? '',
    summary: initialLog?.summary ?? '',
    notes: initialLog?.notes ?? '',
    level: initialLog?.level ?? initialLevel,
    weekStartDate: initialLog?.weekStartDate ?? dateStr,
    goals: initialLog?.goals.map((goal) => ({ ...goal })) ?? [],
    mentionedUserIds: initialLog?.mentionedUserIds ? [...initialLog.mentionedUserIds] : [],
    createdAt: initialLog?.createdAt ?? Date.now(),
    status: initialLog?.status ?? 'pending'
  };
}

export function buildCardSave(
  baseline: WorkLog,
  fields: CardFields,
  level: LogLevel,
  mentions: Pick<WorkLog, 'mentionAll' | 'mentionedUserIds'>,
  now = Date.now()
): WorkLog {
  return { ...baseline, ...fields, author: fields.author.trim(), level, ...mentions, updatedAt: now };
}
