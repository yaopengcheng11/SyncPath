import type { LogLevel, Project, WorkLog } from '../types';
import { parseCalendarDate } from './calendarDate';

export interface MermaidTimelineOptions {
  locale?: 'zh' | 'en';
  visibleLevels?: Partial<Record<LogLevel, boolean>>;
}

const LABELS = {
  en: { levels: { 1: 'Milestone', 2: 'Phase checkpoint', 3: 'Task detail' }, completed: 'Completed', pending: 'Pending' },
  zh: { levels: { 1: '里程碑', 2: '阶段节点', 3: '执行事项' }, completed: '已完成', pending: '待完成' }
} as const;

function normalizedText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Encode timeline delimiters and HTML characters as Mermaid numeric entities. */
function mermaidText(value: string): string {
  return normalizedText(value)
    .replace(/[&<>"'`\\:;#%{}\[\]|]/g, character => `#${character.codePointAt(0)};`);
}

/**
 * Mermaid's 150px timeline nodes wrap only at spaces or literal <br> tokens.
 * Bound uninterrupted words conservatively: CJK and wide Latin glyphs count
 * twice, while ordinary Latin letters count once. Keep short words unchanged
 * so Mermaid still chooses natural whitespace breaks for ordinary titles.
 */
function mermaidCardTitle(value: string): string {
  const maxWordWidth = 14;
  return normalizedText(value).split(' ').map(word => {
    const lines: string[] = [];
    let line = '';
    let width = 0;
    for (const character of word) {
      const characterWidth = character.codePointAt(0)! > 127 || /[MWmw@%&]/.test(character)
        ? 2 : /[A-Z0-9]/.test(character) ? 1.5 : 1;
      if (line && width + characterWidth > maxWordWidth) {
        lines.push(mermaidText(line));
        line = '';
        width = 0;
      }
      line += character;
      width += characterWidth;
    }
    lines.push(mermaidText(line));
    // Escape each complete source fragment before adding trusted formatting.
    // An encoded numeric entity is never split and user HTML cannot become a tag.
    return lines.join('<br>');
  }).join(' ');
}

/** Export the same date buckets and levels as the visible timeline, without private card details. */
export function buildMermaidTimeline(
  project: Pick<Project, 'name' | 'startDate' | 'endDate'>,
  logs: Record<string, WorkLog[]>,
  options: MermaidTimelineOptions = {}
): { code: string; cardCount: number } {
  const labels = LABELS[options.locale ?? 'en'];
  const lines = ['timeline'];
  const title = mermaidText(project.name);
  if (title) lines.push(`    title ${title}`);
  let cardCount = 0;

  const validRange = parseCalendarDate(project.startDate) && parseCalendarDate(project.endDate) && project.startDate <= project.endDate;
  if (!validRange) return { code: `${lines.join('\n')}\n`, cardCount };

  // The date bucket is authoritative for the current view. Do not derive durations or dependencies.
  const dates = Object.keys(logs)
    .filter(date => parseCalendarDate(date) && date >= project.startDate && date <= project.endDate)
    .sort();
  for (const date of dates) {
    const cards = logs[date]
      .filter(card => options.visibleLevels?.[card.level] !== false && labels.levels[card.level])
      // Match the view's level order; IDs only break ties and never appear in the output.
      .slice().sort((left, right) => right.level - left.level || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    if (cards.length === 0) continue;
    const events = cards.map(card => {
      const status = card.status === 'completed' ? labels.completed : labels.pending;
      return `${labels.levels[card.level]} — ${mermaidCardTitle(card.author)} [${status}]`;
    });
    lines.push(`    ${date} : ${events.join(' : ')}`);
    cardCount += cards.length;
  }

  return { code: `${lines.join('\n')}\n`, cardCount };
}

/** A portable download name: no path separators or control characters, with Chinese preserved. */
export function mermaidFilename(name: string): string {
  const cleaned = name.normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.mmd$/i, '')
    .replace(/^[.\s-]+|[.\s-]+$/g, '');
  const encoder = new TextEncoder();
  let stem = '';
  for (const character of cleaned) {
    // Leave space for the extension and a reserved-name prefix under common 255-byte limits.
    if (encoder.encode(stem + character).length > 240) break;
    stem += character;
  }
  const base = stem.replace(/[.\s-]+$/g, '') || 'timeline';
  const portableBase = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? `timeline-${base}` : base;
  return `${portableBase}.mmd`;
}
