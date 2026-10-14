import type { LogLevel, Project, WorkLog } from '../types';
import { parseCalendarDate } from './calendarDate';

export interface GanttTimelineOptions {
  locale?: 'zh' | 'en';
  visibleLevels?: Partial<Record<LogLevel, boolean>>;
}

export interface GanttTimelineOutput {
  /** The bare <svg> element, so the dialog previews exactly what gets downloaded. */
  svg: string;
  /** A self-contained document with the same SVG inlined. */
  html: string;
  cardCount: number;
}

/**
 * SyncPath light-mode design tokens, mapped onto the semantic roles a chart
 * expects. Reusing the product palette is the point: someone who knows the app
 * reads the exported chart without a legend lookup.
 */
const SKIN = {
  paper: '#f4f5f8',
  ink: '#202635',
  secondary: '#465166',
  muted: '#5d697e'
} as const;

/**
 * One hue per card level. The style guide asks for a single accent, and that
 * rule exists to stop invented colour — here the three tones are the product's
 * own level taxonomy, so they carry meaning instead of competing.
 */
const LEVEL_STYLE: Record<LogLevel, { stroke: string; fill: string; doneFill: string }> = {
  1: { stroke: '#dba934', fill: 'rgba(219,169,52,0.20)', doneFill: 'rgba(219,169,52,0.46)' },
  2: { stroke: '#6454d7', fill: 'rgba(100,84,215,0.16)', doneFill: 'rgba(100,84,215,0.32)' },
  3: { stroke: '#708096', fill: 'rgba(112,128,150,0.18)', doneFill: 'rgba(112,128,150,0.38)' }
};

const LABELS = {
  en: {
    levels: { 1: 'Milestone', 2: 'Phase', 3: 'Task' },
    completed: 'Completed', pending: 'Pending', legend: 'Legend', chart: 'Gantt',
    cards: '{{count}} cards'
  },
  zh: {
    levels: { 1: '里程碑', 2: '阶段节点', 3: '执行事项' },
    completed: '已完成', pending: '待完成', legend: '图例', chart: '甘特图',
    cards: '{{count}} 张卡片'
  }
} as const;

type Labels = (typeof LABELS)['en'] | (typeof LABELS)['zh'];

/** Grid. Every box coordinate, width and gap below is a multiple of four. */
const PAD = 20;
const LABEL_X = 20;
const LABEL_W = 180;
const TIMELINE_X = 200;
const MIN_TIMELINE_WIDTH = 760;
/** Below this a column is unreadable, so the axis falls back to equal columns. */
const MIN_COLUMN_WIDTH = 12;
/** Equal-column pitch, and also the floor for how wide the chart may grow. */
const MIN_COLUMN_PITCH = 72;
const HEADER_LABEL_Y = 56;
const HEADER_RULE_Y = 64;
const ROWS_TOP = 76;
const ROW_H = 40;
const BAR_TOP = 8;
const SLOT_H = 24;

const FONT_SANS = "'Geist','PingFang SC','Hiragino Sans GB','Microsoft YaHei',system-ui,sans-serif";
const FONT_MONO = "'Geist Mono',ui-monospace,monospace";

function normalizedText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Project names and card titles are user text and land inside <text> elements. */
function escapeXml(value: string): string {
  return normalizedText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Advance width in em. Full-width and wide scripts cost a full em; everything
 * else costs a typical Latin advance. Measuring per character is what keeps a
 * Chinese title inside its column while an English one is not cut short for no
 * reason.
 */
function charEm(character: string): number {
  const code = character.codePointAt(0)!;
  if (code >= 0x20000) return 1;
  if (code >= 0x1100 && (
    code <= 0x115f
    || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
  )) return 1;
  return 0.6;
}

function textWidth(value: string, fontPx: number): number {
  let width = 0;
  for (const character of value) width += charEm(character) * fontPx;
  return width;
}

/** Cut a label to the width it is allowed, appending an ellipsis when it did not fit. */
function truncateToWidth(value: string, maxPx: number, fontPx: number): string {
  const budget = maxPx - fontPx;
  let width = 0;
  let out = '';
  for (const character of value) {
    const next = width + charEm(character) * fontPx;
    if (next > budget) break;
    out += character;
    width = next;
  }
  return out === value ? value : `${out}…`;
}

/** Identifiers are ASCII so they survive being referenced from url(#id). */
function svgId(name: string): string {
  const slug = normalizedText(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'syncpath-gantt';
}

interface Bucket {
  date: string;
  cards: WorkLog[];
}

interface Row {
  card: WorkLog;
  /** Index of the column this card belongs to. */
  column: number;
}

/**
 * Keep the date buckets the visible timeline shows, then order each week's cards
 * parent-first. The timeline stacks detail above milestone only because the
 * marker hangs off the bottom of its stem; on a horizontal axis there is no such
 * reason, and a milestone reads as the summary of the tasks beneath it.
 */
function collectBuckets(
  logs: Record<string, WorkLog[]>,
  startDate: string,
  endDate: string,
  visibleLevels: Partial<Record<LogLevel, boolean>> | undefined
): Bucket[] {
  return Object.keys(logs)
    .filter(date => parseCalendarDate(date) && date >= startDate && date <= endDate)
    .sort()
    .map(date => ({
      date,
      cards: logs[date]
        .filter(card => visibleLevels?.[card.level] !== false)
        .slice()
        .sort((left, right) => left.level - right.level || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    }))
    .filter(bucket => bucket.cards.length > 0);
}

/**
 * One column per bucket. Columns are sized by the real gap between dates so an
 * idle stretch stays visible; when that would squeeze a column past legibility
 * the whole axis switches to equal columns rather than misstating the spacing.
 */
function columnWidths(
  buckets: Bucket[],
  timelineWidth: number,
  dayOf: (date: string) => number
): number[] {
  const count = buckets.length;
  const offsets = buckets.map(bucket => dayOf(bucket.date));
  const gaps = offsets.map((offset, index) =>
    index < count - 1
      ? Math.max(1, offsets[index + 1] - offset)
      : Math.max(1, offset - offsets[index - 1]));
  const totalDays = gaps.reduce((sum, gap) => sum + gap, 0);
  const proportional = gaps.every(gap => (gap / totalDays) * timelineWidth >= MIN_COLUMN_WIDTH);
  if (!proportional) return buckets.map(() => timelineWidth / count);
  return gaps.map(gap => (gap / totalDays) * timelineWidth);
}

function barMarkup(level: 2 | 3, completed: boolean, x: number, y: number, width: number, height: number): string {
  const style = LEVEL_STYLE[level];
  const fill = completed ? style.doneFill : style.fill;
  const dash = completed ? '' : ' stroke-dasharray="4 3"';
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" fill="${fill}" stroke="${style.stroke}" stroke-width="1"${dash}/>`;
}

function legendSwatch(kind: 'milestone' | 'phase' | 'detail' | 'completed' | 'pending', x: number, y: number): string {
  if (kind === 'milestone') {
    const style = LEVEL_STYLE[1];
    return `<path d="M ${x + 8} ${y} L ${x + 16} ${y + 6} L ${x + 8} ${y + 12} L ${x} ${y + 6} Z" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1"/>`;
  }
  if (kind === 'phase') return barMarkup(2, false, x, y, 16, 12);
  if (kind === 'detail') return barMarkup(3, false, x, y, 16, 12);
  return barMarkup(3, kind === 'completed', x, y, 16, 12);
}

interface Column {
  x: number;
  width: number;
  date: string;
  /** Y of the first row in this bucket, for the week rule. */
  top: number;
}

function renderSvg(
  project: Pick<Project, 'name' | 'startDate' | 'endDate'>,
  buckets: Bucket[],
  labels: Labels,
  locale: 'zh' | 'en'
): string {
  const count = buckets.length;
  const timelineWidth = Math.max(MIN_TIMELINE_WIDTH, count * MIN_COLUMN_PITCH);
  const svgWidth = TIMELINE_X + timelineWidth + PAD;
  const right = svgWidth - PAD;

  const start = parseCalendarDate(project.startDate)!;
  const dayOf = (date: string): number =>
    Math.round((parseCalendarDate(date)!.getTime() - start.getTime()) / 86400000);

  const widths = columnWidths(buckets, timelineWidth, dayOf);
  const rows: Row[] = buckets.flatMap((bucket, column) => bucket.cards.map(card => ({ card, column })));
  const firstRowOfBucket = new Map<number, number>();
  rows.forEach((row, index) => { if (!firstRowOfBucket.has(row.column)) firstRowOfBucket.set(row.column, index); });

  let cursor = 0;
  const columns: Column[] = buckets.map((bucket, index) => {
    const column: Column = {
      x: TIMELINE_X + cursor,
      width: widths[index],
      date: bucket.date,
      top: ROWS_TOP + (firstRowOfBucket.get(index) ?? 0) * ROW_H
    };
    cursor += widths[index];
    return column;
  });

  const rowsBottom = ROWS_TOP + rows.length * ROW_H;
  const narrowest = Math.min(...widths);
  // Date labels sit 56px apart at most; past that they would collide.
  const labelStep = Math.max(1, Math.ceil(56 / narrowest));

  const body: string[] = [];

  // Column bands, so a run of weeks reads as one group before any bar is drawn.
  columns.forEach((column, index) => {
    if (index % 2 === 0) return;
    body.push(`<rect x="${column.x}" y="${HEADER_RULE_Y}" width="${column.width}" height="${rowsBottom - HEADER_RULE_Y}" fill="rgba(32,38,53,0.02)"/>`);
  });

  columns.forEach((column, index) => {
    body.push(`<line x1="${column.x}" y1="${HEADER_RULE_Y}" x2="${column.x}" y2="${rowsBottom}" stroke="rgba(32,38,53,0.05)" stroke-width="0.6"/>`);
    if (index % labelStep !== 0) return;
    body.push(`<text x="${column.x + column.width / 2}" y="${HEADER_LABEL_Y}" fill="${SKIN.muted}" font-size="8" font-family="${FONT_MONO}" text-anchor="middle">${escapeXml(column.date)}</text>`);
  });

  // A rule wherever the week changes, across the label column too.
  columns.forEach((column, index) => {
    if (index === 0) return;
    body.push(`<line x1="${PAD}" y1="${column.top}" x2="${right}" y2="${column.top}" stroke="rgba(32,38,53,0.08)" stroke-width="0.8"/>`);
  });

  body.push(`<line x1="${TIMELINE_X}" y1="${HEADER_RULE_Y}" x2="${TIMELINE_X}" y2="${rowsBottom}" stroke="rgba(32,38,53,0.20)" stroke-width="0.8"/>`);
  body.push(`<line x1="${TIMELINE_X}" y1="${HEADER_RULE_Y}" x2="${right}" y2="${HEADER_RULE_Y}" stroke="rgba(32,38,53,0.20)" stroke-width="0.8"/>`);
  body.push(`<line x1="${PAD}" y1="${rowsBottom}" x2="${right}" y2="${rowsBottom}" stroke="rgba(32,38,53,0.12)" stroke-width="0.8"/>`);

  // One row per card: the label sits in its own column, the bar in the plot area.
  rows.forEach(({ card, column }, index) => {
    const plot = columns[column];
    const barY = ROWS_TOP + index * ROW_H + BAR_TOP;
    const inset = Math.min(8, Math.max(2, plot.width * 0.12));
    const barWidth = Math.max(4, plot.width - inset * 2);
    const completed = card.status === 'completed';
    const style = LEVEL_STYLE[card.level];
    const title = truncateToWidth(normalizedText(card.author), LABEL_W - 8, 10);

    body.push(`<text x="${LABEL_X}" y="${barY + 16}" fill="${SKIN.ink}" font-size="10" font-weight="600" font-family="${FONT_SANS}">${escapeXml(title)}</text>`);

    if (card.level === 1) {
      // A milestone is a point in time rather than a span, so it is a marker.
      const cx = plot.x + plot.width / 2;
      const cy = barY + SLOT_H / 2;
      const fill = completed ? style.doneFill : style.fill;
      const dash = completed ? '' : ' stroke-dasharray="4 3"';
      body.push(`<path d="M ${cx} ${cy - 8} L ${cx + 8} ${cy} L ${cx} ${cy + 8} L ${cx - 8} ${cy} Z" fill="${fill}" stroke="${style.stroke}" stroke-width="1"${dash}/>`);
    } else if (card.level === 2) {
      body.push(barMarkup(2, completed, plot.x + inset, barY + 2, barWidth, 20));
    } else {
      body.push(barMarkup(3, completed, plot.x + inset, barY + 6, barWidth, 12));
    }
  });

  // Legend strip.
  const legendRule = rowsBottom + 12;
  const legendTitle = legendRule + 20;
  const legendSwatchY = legendTitle + 12;
  body.push(`<line x1="${PAD}" y1="${legendRule}" x2="${right}" y2="${legendRule}" stroke="rgba(32,38,53,0.10)" stroke-width="0.8"/>`);
  body.push(`<text x="${PAD}" y="${legendTitle}" fill="${SKIN.muted}" font-size="8" font-family="${FONT_MONO}" letter-spacing="0.18em">${escapeXml(labels.legend.toUpperCase())}</text>`);

  const items: { kind: 'milestone' | 'phase' | 'detail' | 'completed' | 'pending'; text: string }[] = [
    { kind: 'milestone', text: labels.levels[1] },
    { kind: 'phase', text: labels.levels[2] },
    { kind: 'detail', text: labels.levels[3] },
    { kind: 'completed', text: labels.completed },
    { kind: 'pending', text: labels.pending }
  ];
  let legendX = PAD;
  for (const item of items) {
    body.push(legendSwatch(item.kind, legendX, legendSwatchY));
    body.push(`<text x="${legendX + 24}" y="${legendSwatchY + 10}" fill="${SKIN.muted}" font-size="9" font-family="${FONT_SANS}">${escapeXml(item.text)}</text>`);
    // Advance to the next 4px stop so measured label widths cannot drift off grid.
    legendX = Math.ceil((legendX + 24 + textWidth(item.text, 9) + 32) / 4) * 4;
  }

  const height = legendSwatchY + 32;
  const id = svgId(project.name);
  const cardUnit = locale === 'zh' ? '张卡片' : labels.levels[3].toLowerCase();

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${height}" width="${svgWidth}" height="${height}" role="img" aria-labelledby="${id}-title ${id}-desc">`,
    `<title id="${id}-title">${escapeXml(project.name)} · ${labels.chart}</title>`,
    `<desc id="${id}-desc">${escapeXml(`${project.startDate} — ${project.endDate} · ${rows.length} ${cardUnit}`)}</desc>`,
    `<rect width="100%" height="100%" fill="${SKIN.paper}"/>`,
    ...body,
    '</svg>'
  ].join('');
}

/**
 * Export the visible cards as a Gantt chart: one row per card, one column per
 * week, and the card level carried by bar shape and height. Every identifier is
 * generated here and all user text is escaped, so nothing a user types can
 * change the structure of the document.
 */
export function buildGanttTimeline(
  project: Pick<Project, 'name' | 'startDate' | 'endDate'>,
  logs: Record<string, WorkLog[]>,
  options: GanttTimelineOptions = {}
): GanttTimelineOutput {
  const locale = options.locale ?? 'en';
  const labels = LABELS[locale];
  const validRange = !!parseCalendarDate(project.startDate)
    && !!parseCalendarDate(project.endDate)
    && project.startDate <= project.endDate;
  if (!validRange) return { svg: '', html: '', cardCount: 0 };

  const buckets = collectBuckets(logs, project.startDate, project.endDate, options.visibleLevels);
  const cardCount = buckets.reduce((sum, bucket) => sum + bucket.cards.length, 0);
  if (cardCount === 0) return { svg: '', html: '', cardCount: 0 };

  const svg = renderSvg(project, buckets, labels, locale);
  return { svg, html: renderDocument(project, svg, cardCount, labels, locale), cardCount };
}

/** A portable download name: no path separators or control characters, with Chinese preserved. */
export function ganttFilename(name: string): string {
  const cleaned = name.normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.html?$/i, '')
    .replace(/^[.\s-]+|[.\s-]+$/g, '');
  const encoder = new TextEncoder();
  let stem = '';
  for (const character of cleaned) {
    // Leave room for a reserved-name prefix and the extension under the 255-byte limit.
    if (encoder.encode(stem + character).length > 230) break;
    stem += character;
  }
  const base = stem.replace(/[.\s-]+$/g, '') || 'timeline';
  const portableBase = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? `timeline-${base}` : base;
  return `${portableBase}.html`;
}

function renderDocument(
  project: Pick<Project, 'name' | 'startDate' | 'endDate'>,
  svg: string,
  cardCount: number,
  labels: Labels,
  locale: 'zh' | 'en'
): string {
  const width = Number(/viewBox="0 0 (\d+) /.exec(svg)?.[1] ?? 0);
  const zh = locale === 'zh';
  const count = labels.cards.replace('{{count}}', String(cardCount));
  return `<!DOCTYPE html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeXml(project.name)} · ${labels.chart}</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --color-paper: ${SKIN.paper};
  --color-ink: ${SKIN.ink};
  --color-muted: ${SKIN.muted};
  --font-sans: 'Geist', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif;
  --font-serif: 'Instrument Serif', Georgia, serif;
  --font-mono: 'Geist Mono', ui-monospace, monospace;
}
body { font-family: var(--font-sans); background: var(--color-paper); color: var(--color-ink); min-height: 100vh; padding: 3rem 2rem; }
.frame { max-width: 1200px; margin: 0 auto; width: 100%; }
.eyebrow { font-family: var(--font-mono); font-size: 0.66rem; font-weight: 500; letter-spacing: 0.18em; text-transform: uppercase; color: var(--color-muted); margin-bottom: 0.5rem; }
h1 { font-family: var(--font-serif); font-size: clamp(1.5rem, 2.4vw + 0.75rem, 2rem); font-weight: 400; letter-spacing: -0.02em; line-height: 1.15; margin-bottom: 0.5rem; }
.meta { font-family: var(--font-mono); font-size: 0.75rem; color: var(--color-muted); margin-bottom: 1.5rem; }
.scroll { overflow-x: auto; overflow-y: hidden; padding-bottom: 0.5rem; }
svg { display: block; width: 100%; min-width: ${width}px; height: auto; }
@media print { body { padding: 1rem; } }
</style>
</head>
<body>
<div class="frame">
<p class="eyebrow">SyncPath · ${labels.chart}</p>
<h1>${escapeXml(project.name)}</h1>
<p class="meta">${escapeXml(project.startDate)} — ${escapeXml(project.endDate)} · ${count}</p>
<div class="scroll">
${svg}
</div>
</div>
</body>
</html>
`;
}
