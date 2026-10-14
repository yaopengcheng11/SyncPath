import { describe, expect, it } from 'vitest';
import { buildGanttTimeline, ganttFilename } from './ganttTimeline';
import type { LogLevel, Project, WorkLog } from '../types';

const project: Pick<Project, 'name' | 'startDate' | 'endDate'> = {
  name: 'Launch Roadmap', startDate: '2026-10-05', endDate: '2026-10-30'
};

const card = (
  id: string,
  author: string,
  level: LogLevel,
  status?: 'pending' | 'completed'
): WorkLog => ({ id, author, level, weekStartDate: '', summary: 'Private summary', notes: 'Private notes', goals: [], createdAt: 1, status });

/** Every label row sits 40px below the previous one. */
function rowLabelY(svg: string): number[] {
  return [...svg.matchAll(/<text x="20" y="(\d+)" fill="#202635"/g)].map(match => Number(match[1]));
}

/** The vertical gridlines that start at the header rule mark every column edge. */
function columnEdgeX(svg: string): number[] {
  const edges = [...svg.matchAll(/<line x1="(\d+)" y1="64" x2="\1" y2="\d+"/g)].map(match => Number(match[1]));
  // The first column edge doubles as the label divider; keep one copy of each.
  return [...new Set(edges)];
}

describe('gantt timeline export', () => {
  it('plots one row per visible card and leaves private card fields out', () => {
    const result = buildGanttTimeline(project, {
      '2026-10-05': [card('a', 'Release 1.0', 1, 'completed')],
      '2026-10-12': [card('b', 'Build phase', 2), card('c', 'Fix a bug', 3, 'completed')],
      '2026-11-02': [card('e', 'Outside dates', 1)]
    });

    expect(result.cardCount).toBe(3);
    expect(rowLabelY(result.svg)).toHaveLength(3);
    expect(result.svg).toContain('Release 1.0');
    expect(result.svg).toContain('Build phase');
    expect(result.svg).toContain('Fix a bug');
    expect(result.svg).not.toMatch(/Private summary|Private notes|Outside dates/);
  });

  it('orders each week parent-first and is independent of insertion order', () => {
    const ordered = buildGanttTimeline(project, {
      '2026-10-12': [card('m', 'Milestone', 1), card('p', 'Phase', 2), card('t', 'Task', 3)]
    });
    const shuffled = buildGanttTimeline(project, {
      '2026-10-12': [card('t', 'Task', 3), card('p', 'Phase', 2), card('m', 'Milestone', 1)]
    });

    expect(ordered.svg).toBe(shuffled.svg);
    expect(rowLabelY(ordered.svg).every((y, index) => index === 0 || y - rowLabelY(ordered.svg)[index - 1] === 40)).toBe(true);
  });

  it('drops weeks whose cards are all hidden', () => {
    const logs = {
      '2026-10-05': [card('a', 'Kept', 1)],
      '2026-10-12': [card('b', 'Hidden', 2)]
    };
    const all = buildGanttTimeline(project, logs);
    const filtered = buildGanttTimeline(project, logs, { visibleLevels: { 1: true, 2: false, 3: true } });

    expect(all.cardCount).toBe(2);
    expect(filtered.cardCount).toBe(1);
    expect(filtered.svg).toContain('Kept');
    expect(filtered.svg).not.toContain('Hidden');
    expect(filtered.svg).not.toContain('2026-10-12');
  });

  it('returns nothing to draw for an invalid range or an empty view', () => {
    const empty = buildGanttTimeline({ ...project, startDate: '2026-10-30', endDate: '2026-10-05' }, {
      '2026-10-12': [card('a', 'Outside', 1)]
    });
    const blank = buildGanttTimeline(project, {});
    const malformed = buildGanttTimeline({ ...project, startDate: 'not-a-date' }, {
      '2026-10-12': [card('a', 'Milestone', 1)]
    });

    for (const result of [empty, blank, malformed]) {
      expect(result).toEqual({ svg: '', html: '', cardCount: 0 });
    }
  });

  it('carries the level by shape and the status by fill', () => {
    const { svg } = buildGanttTimeline(project, {
      '2026-10-05': [card('m', 'Ship it', 1, 'completed')],
      '2026-10-12': [card('p', 'Build', 2), card('t', 'Polish', 3, 'completed')]
    });

    // A milestone is a zero-width marker centred in its week, drawn as a diamond.
    expect(svg).toContain('<path d="M 390 88 L 398 96 L 390 104 L 382 96 Z" fill="rgba(219,169,52,0.46)" stroke="#dba934" stroke-width="1"/>');
    // Phase is a tall pending bar, task a short completed one.
    expect(svg).toMatch(/height="20" rx="4" fill="rgba\(100,84,215,0\.16\)" stroke="#6454d7" stroke-width="1" stroke-dasharray="4 3"/);
    expect(svg).toMatch(/height="12" rx="4" fill="rgba\(112,128,150,0\.38\)" stroke="#708096" stroke-width="1"\/>/);
  });

  it('escapes user text so no card title can add markup', () => {
    const hostile = '<b>A&B</b>';
    const { svg, html } = buildGanttTimeline(
      { ...project, name: '<img src=x>' },
      { '2026-10-05': [card('a', hostile, 1)] }
    );

    expect(svg).toContain('&lt;b&gt;A&amp;B&lt;/b&gt;');
    expect(html).toContain('&lt;b&gt;A&amp;B&lt;/b&gt;');
    expect(svg).not.toMatch(/<b>|<img|<script/i);
    expect(html).not.toMatch(/<img|<script/i);
  });

  it('names the SVG accessibly and puts the title first', () => {
    const { svg } = buildGanttTimeline(project, { '2026-10-05': [card('a', 'Milestone', 1)] });

    expect(svg).toMatch(/^<svg [^>]*role="img" aria-labelledby="launch-roadmap-title launch-roadmap-desc"/);
    expect(svg).toMatch(/<svg [^>]*>\s*<title id="launch-roadmap-title">/);
    expect(svg).toContain('<desc id="launch-roadmap-desc">');
  });

  it('falls back to a stable id when the task name has no ascii', () => {
    const { svg } = buildGanttTimeline({ ...project, name: '场景还原' }, { '2026-10-05': [card('a', '里程碑', 1)] });

    expect(svg).toContain('aria-labelledby="syncpath-gantt-title syncpath-gantt-desc"');
    expect(svg).toContain('<title id="syncpath-gantt-title">场景还原');
  });

  it('sizes columns by the real gap between weeks', () => {
    const { svg } = buildGanttTimeline(project, {
      '2026-10-05': [card('a', 'A', 3)],
      '2026-10-12': [card('b', 'B', 3)],
      '2026-10-26': [card('c', 'C', 3)]
    });

    const edges = columnEdgeX(svg);
    const gaps = edges.slice(1).map((x, index) => x - edges[index]);
    expect(new Set(gaps).size).toBeGreaterThan(1);
  });

  it('falls back to equal columns when one gap would collapse below legibility', () => {
    const logs: Record<string, WorkLog[]> = {};
    for (let day = 1; day <= 10; day += 1) {
      logs[`2026-01-${String(day).padStart(2, '0')}`] = [card(`d${day}`, `Task ${day}`, 3)];
    }
    logs['2026-12-31'] = [card('far', 'Much later', 3)];

    const { svg } = buildGanttTimeline({ ...project, startDate: '2026-01-01', endDate: '2026-12-31' }, logs);
    const edges = columnEdgeX(svg);
    const gaps = edges.slice(1).map((x, index) => x - edges[index]);

    expect(new Set(gaps).size).toBe(1);
  });

  it('labels the legend in the requested language', () => {
    const en = buildGanttTimeline(project, { '2026-10-05': [card('a', 'Ship', 1)] });
    const zh = buildGanttTimeline(project, { '2026-10-05': [card('a', '发布', 1)] }, { locale: 'zh' });

    expect(en.svg).toContain('>LEGEND<');
    expect(en.svg).toContain('>Milestone<');
    expect(zh.svg).toContain('>图例<');
    expect(zh.svg).toContain('>里程碑<');
    expect(zh.html).toContain('<html lang="zh-CN">');
    expect(zh.html).toContain('3 张卡片'.replace('3', '1'));
  });

  it('truncates a label that cannot fit its column', () => {
    const { svg } = buildGanttTimeline(project, {
      '2026-10-05': [card('a', '场景还原与资产重建流程梳理和验收标准统一对齐工作', 3)]
    });

    // A full-width glyph costs a full em, so 16 of them fit the 172px column.
    expect(svg).toContain('场景还原与资产重建流程梳理和验收…</text>');
    expect(svg).not.toContain('验收标准统一对齐工作');
  });

  it('wraps the SVG in a self-contained document at the chart width', () => {
    const { html, svg } = buildGanttTimeline(project, { '2026-10-05': [card('a', 'Ship', 1)] });

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<style>');
    expect(html).toContain('<svg ');
    expect(html).toContain('min-width: 980px');
    expect(html).toContain(svg);
    expect(html).toContain('SyncPath · Gantt');
  });
});

describe('gantt download filename', () => {
  it('gives the export an html extension', () => {
    expect(ganttFilename('产品计划')).toBe('产品计划.html');
    expect(ganttFilename('产品计划.html')).toBe('产品计划.html');
    expect(ganttFilename('Release   Plan')).toBe('Release Plan.html');
  });

  it('strips path separators, control characters and reserved device names', () => {
    expect(ganttFilename('../路径\\计划:\u0000\n?.')).toBe('路径-计划.html');
    expect(ganttFilename(' ../\\ ')).toBe('timeline.html');
    expect(ganttFilename('CON')).toBe('timeline-CON.html');
  });

  it('caps a long name inside the common 255-byte limit', () => {
    const result = ganttFilename('计划🚀'.repeat(100));
    expect(result.endsWith('.html')).toBe(true);
    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(255);
  });
});
