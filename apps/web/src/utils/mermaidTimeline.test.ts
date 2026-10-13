// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import mermaid from 'mermaid';
import type { WorkLog } from '../types';
import { buildMermaidTimeline, mermaidFilename } from './mermaidTimeline';

const project = { name: '产品 Launch', startDate: '2026-10-10', endDate: '2026-10-20' };

function card(id: string, author: string, level: 1 | 2 | 3, status: WorkLog['status'] = 'pending'): WorkLog {
  return {
    id, author, level, status, weekStartDate: '2026-10-12', createdAt: 0,
    notes: 'PRIVATE NOTES', summary: 'PRIVATE SUMMARY', goals: [], mentionedUserIds: ['PRIVATE MEMBER']
  };
}

beforeAll(() => { mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' }); });

async function parsedTasks(code: string): Promise<{ task: string; events: string[]; section: string }[]> {
  expect(await mermaid.parse(code)).toMatchObject({ diagramType: 'timeline' });
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(code);
  const db = diagram.db as { getTasks: () => { task: string; events: string[]; section: string }[] };
  // The parser retains formatting spaces around separators; compare the rendered text semantics.
  return db.getTasks().map(({ task, events, section }) => ({ task: task.trim(), events: events.map(event => event.trim()), section }));
}

describe('Mermaid timeline export', () => {
  it('preserves Chinese titles, localized levels and status, grouping all events for the same date', async () => {
    const result = buildMermaidTimeline(project, {
      '2026-10-12': [card('internal-milestone', '正式上线', 1, 'completed'), card('internal-detail', '补充测试', 3), card('internal-phase', '开发收尾', 2)]
    }, { locale: 'zh' });

    expect(result).toEqual({
      cardCount: 3,
      code: 'timeline\n    title 产品 Launch\n    2026-10-12 : 执行事项 — 补充测试 [待完成] : 阶段节点 — 开发收尾 [待完成] : 里程碑 — 正式上线 [已完成]\n'
    });
    const tasks = await parsedTasks(result.code);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ task: '2026-10-12', events: ['执行事项 — 补充测试 [待完成]', '阶段节点 — 开发收尾 [待完成]', '里程碑 — 正式上线 [已完成]'] });
    expect(result.code).not.toMatch(/PRIVATE|internal-|goals|mention/);
  });

  it('orders dates and same-level cards deterministically without mutating input', async () => {
    const unsorted = [card('z', 'Last detail', 3), card('a', 'First detail', 3), card('m', 'Phase review', 2, 'completed')];
    const logs = {
      '2026-10-20': [card('last', 'Final release', 1, 'completed')],
      '2026-10-12': unsorted,
      '2026-10-10': [card('first', 'Begin', 1)]
    };
    const result = buildMermaidTimeline(project, logs);
    const tasks = await parsedTasks(result.code);

    expect(result.cardCount).toBe(5);
    expect(tasks.map(task => task.task)).toEqual(['2026-10-10', '2026-10-12', '2026-10-20']);
    expect(tasks[1].events).toEqual(['Task detail — First detail [Pending]', 'Task detail — Last detail [Pending]', 'Phase checkpoint — Phase review [Completed]']);
    expect(unsorted.map(item => item.id)).toEqual(['z', 'a', 'm']);
    expect(buildMermaidTimeline(project, { ...logs, '2026-10-12': [...unsorted].reverse() })).toEqual(result);
  });

  it('filters hidden levels, out-of-range and invalid calendar dates while keeping inclusive boundaries', async () => {
    const result = buildMermaidTimeline(project, {
      '2026-10-21': [card('late', 'Too late', 1)],
      '2026-10-12': [card('hidden', 'Hidden phase', 2), card('visible', 'Visible detail', 3)],
      '2026-10-09': [card('early', 'Too early', 1)],
      '2026-10-10': [card('start', 'Start boundary', 1)],
      '2026-10-20': [card('end', 'End boundary', 1)],
      '2026-10-00': [card('bad-day', 'Invalid day', 1)],
      '2026-10-32': [card('overflow', 'Overflow date', 1)],
      '2026-10-1': [card('format', 'Invalid format', 1)],
      '2026-02-29': [card('non-leap', 'Invalid leap date', 1)],
      'section Fake': [card('injected-date', 'Invalid key', 1)]
    }, { visibleLevels: { 2: false } });

    expect(result.cardCount).toBe(3);
    expect(result.code).not.toMatch(/Too late|Too early|Hidden phase|Invalid|Overflow|Fake/);
    expect((await parsedTasks(result.code)).map(task => task.task)).toEqual(['2026-10-10', '2026-10-12', '2026-10-20']);
  });

  const emptyInputs: Record<string, WorkLog[]>[] = [{}, { '2026-10-12': [] }, { '2026-10-12': [card('hidden', 'Hidden', 1)] }];
  it.each(emptyInputs)('does not invent events for an empty or fully hidden timeline', async (logs) => {
    const result = buildMermaidTimeline(project, logs, { visibleLevels: { 1: false } });
    expect(result).toEqual({ code: 'timeline\n    title 产品 Launch\n', cardCount: 0 });
    expect(await parsedTasks(result.code)).toEqual([]);
  });

  it.each([
    { ...project, startDate: '2026-10-32' },
    { ...project, endDate: 'invalid' },
    { ...project, startDate: '2026-10-21' }
  ])('does not export cards with an invalid or reversed project range', async (invalidProject) => {
    const result = buildMermaidTimeline(invalidProject, { '2026-10-12': [card('a', 'Do not export', 1)] });
    expect(result.cardCount).toBe(0);
    expect(await parsedTasks(result.code)).toEqual([]);
  });

  it('encodes punctuation, HTML and injected Mermaid instructions without creating extra events or sections', async () => {
    const hostile = '冒号: 两段\nsection 注入\r\n%%{init: {"securityLevel":"loose"}}%% <img src=x onerror=alert(1)> #60; & "quote" `code` [A] {B} ; \\ End';
    const result = buildMermaidTimeline({ ...project, name: hostile }, { '2026-10-12': [card('private-id', hostile, 1)] });

    expect(result.cardCount).toBe(1);
    expect(result.code.trimEnd().split('\n')).toHaveLength(3);
    expect(result.code).not.toMatch(/<img|%%|^\s*section /m);
    expect(result.code).toContain('冒号#58; 两段 section 注入');
    expect(result.code).toContain('#60;img src=x onerror=alert(1)#62;');
    expect(result.code).toContain('#35;60#59;');
    expect(result.code).toContain('#38; #34;quote#34; #96;code#96; #91;A#93; #123;B#125;');
    const tasks = await parsedTasks(result.code);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].events).toHaveLength(1);
    expect(tasks[0].section).toBe('');
    expect((await mermaid.parse(result.code)).config ?? {}).toEqual({});
  });

  it('wraps a long Chinese title inside one event while preserving its full text, level and completion status', async () => {
    const title = '跨团队联调与关键业务路径完整验证';
    const result = buildMermaidTimeline(project, { '2026-10-12': [card('long-chinese', title, 2, 'completed')] }, { locale: 'zh' });
    const tasks = await parsedTasks(result.code);

    expect(result.cardCount).toBe(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].events).toEqual(['阶段节点 — 跨团队联调与关<br>键业务路径完整<br>验证 [已完成]']);
    expect(tasks[0].events[0].replace(/<br>/g, '')).toBe(`阶段节点 — ${title} [已完成]`);
    expect(result.code).not.toMatch(/PRIVATE|long-chinese/);
  });

  it.each([
    'SupercalifragilisticexpialidociousProductionDeployment',
    'W'.repeat(36)
  ])('wraps an oversized English word without losing characters or creating another event: %s', async (title) => {
    const result = buildMermaidTimeline(project, { '2026-10-12': [card('long-word', title, 1)] });
    const tasks = await parsedTasks(result.code);
    const event = tasks[0].events[0];
    const fragments = event.slice('Milestone — '.length, -' [Pending]'.length).split('<br>');

    expect(tasks).toHaveLength(1);
    expect(tasks[0].events).toHaveLength(1);
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments.join('')).toBe(title);
    expect(fragments.every(fragment => fragment.length > 0 && fragment.length <= 14)).toBe(true);
    if (title.startsWith('WW')) expect(fragments).toEqual(['WWWWWWW', 'WWWWWWW', 'WWWWWWW', 'WWWWWWW', 'WWWWWWW', 'W']);
  });

  it('keeps HTML and numeric entities escaped atomically when a wrap falls next to dangerous punctuation', async () => {
    const title = '跨团队联调与<svg/onload=alert(1)>#60;&lt;"结束<br>';
    const result = buildMermaidTimeline(project, { '2026-10-12': [card('unsafe-long-title', title, 3)] });
    const tasks = await parsedTasks(result.code);
    // Mermaid internally substitutes numeric entities while parsing. Validate
    // source atoms here, and use the real parser below to verify event isolation.
    const event = result.code.split('\n')[2].slice('    2026-10-12 : '.length);
    const fragments = event.slice('Task detail — '.length, -' [Pending]'.length).split('<br>');

    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments.join('')).toBe('跨团队联调与#60;svg/onload=alert(1)#62;#35;60#59;#38;lt#59;#34;结束#60;br#62;');
    for (const fragment of fragments) {
      // Every generated entity must remain complete on its own displayed line.
      expect((fragment.match(/#\d+;|[^#]/gu) ?? []).join('')).toBe(fragment);
    }
    expect(result.code.replace(/<br>/g, '')).not.toMatch(/<|>|&|^\s*section /m);
    expect(tasks[0]).toMatchObject({ task: '2026-10-12', section: '' });
    expect(tasks[0].events).toHaveLength(1);
    expect((await mermaid.parse(result.code)).config ?? {}).toEqual({});
  });

  it('keeps an empty project title empty and normalizes all line separators inside card text', async () => {
    const result = buildMermaidTimeline({ ...project, name: ' \t ' }, { '2026-10-12': [card('a', 'A\u2028title\u2029with\tspacing\u0000done', 1)] });
    expect(result.code).toBe('timeline\n    2026-10-12 : Milestone — A title with spacing done [Pending]\n');
    expect((await parsedTasks(result.code))[0].events).toEqual(['Milestone — A title with spacing done [Pending]']);
  });
});

describe('Mermaid download filename', () => {
  it('preserves Chinese and uses one mmd extension', () => {
    expect(mermaidFilename('产品计划')).toBe('产品计划.mmd');
    expect(mermaidFilename('产品计划.mmd')).toBe('产品计划.mmd');
    expect(mermaidFilename('产品计划.mmd ')).toBe('产品计划.mmd');
    expect(mermaidFilename('Release   Plan')).toBe('Release Plan.mmd');
  });

  it('removes path and control characters, including reserved portable names', () => {
    const result = mermaidFilename('../路径\\计划:\u0000\n?.');
    expect(result).not.toMatch(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/);
    expect(result).toContain('路径-计划');
    expect(result.endsWith('.mmd')).toBe(true);
    expect(mermaidFilename(' ../\\ ')).toBe('timeline.mmd');
    expect(mermaidFilename('CON')).toBe('timeline-CON.mmd');
  });

  it('bounds UTF-8 filename bytes without cutting a Unicode character', () => {
    const result = mermaidFilename('计划🚀'.repeat(100));
    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(255);
    expect(result).not.toContain('\ufffd');
    expect(result.endsWith('.mmd')).toBe(true);
  });
});
