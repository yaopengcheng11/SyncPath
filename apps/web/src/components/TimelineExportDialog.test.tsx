// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import TimelineExportDialog from './TimelineExportDialog';
import Timeline from './Timeline';
import { I18nProvider } from '../i18n';
import type { Project, WorkLog } from '../types';
import html2canvas from 'html2canvas';

vi.mock('html2canvas', () => ({ default: vi.fn() }));

vi.mock('./MermaidPreview', () => ({
  default: ({ code, empty }: { code: string; empty: boolean }) => <svg aria-label="Mermaid timeline preview" data-code={code} data-empty={String(empty)}><text>Preview</text></svg>
}));

const project: Project = {
  id: 'task-1', name: 'Launch Roadmap', startDate: '2026-10-10', endDate: '2026-10-30', color: '#6366f1'
};
const card = (id: string, author: string, date: string, level: 1 | 2 | 3): WorkLog => ({
  id, author, weekStartDate: date, level, summary: 'A private summary', notes: 'Private notes', goals: [], createdAt: 1
});
const logs: Record<string, WorkLog[]> = {
  '2026-10-12': [card('shown', 'Release', '2026-10-12', 1)],
  '2026-10-13': [card('hidden', 'Hidden phase', '2026-10-13', 2)],
  '2026-11-01': [card('outside', 'Outside dates', '2026-11-01', 1)]
};

type Props = React.ComponentProps<typeof TimelineExportDialog>;
let container: HTMLDivElement;
let trigger: HTMLButtonElement;
let root: Root;
let clipboardDescriptor: PropertyDescriptor | undefined;
let createUrlDescriptor: PropertyDescriptor | undefined;
let revokeUrlDescriptor: PropertyDescriptor | undefined;

beforeAll(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => {
  window.localStorage.setItem('syncpath_locale', 'en');
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  createUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  revokeUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  trigger = document.createElement('button');
  trigger.textContent = 'Export';
  document.body.appendChild(trigger);
  trigger.focus();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  trigger.remove();
  vi.restoreAllMocks();
  for (const [object, key, descriptor] of [
    [navigator, 'clipboard', clipboardDescriptor],
    [URL, 'createObjectURL', createUrlDescriptor],
    [URL, 'revokeObjectURL', revokeUrlDescriptor]
  ] as const) {
    if (descriptor) Object.defineProperty(object, key, descriptor);
    else Reflect.deleteProperty(object, key);
  }
  window.localStorage.removeItem('syncpath_locale');
});

async function mount(overrides: Partial<Props> = {}, locale: 'en' | 'zh' = 'en') {
  window.localStorage.setItem('syncpath_locale', locale);
  const callbacks = {
    onExportPng: vi.fn(async (): Promise<void> => {}), onClose: vi.fn(), onBackgroundChange: vi.fn(), onBubble: vi.fn()
  };
  let props: Props = {
    open: true, project, logs, visibleLevels: { 1: true, 2: false, 3: true },
    background: 'white', exporting: false, ...callbacks, ...overrides
  };
  const render = async (changes: Partial<Props> = {}): Promise<void> => {
    props = { ...props, ...changes };
    await act(async () => {
      root.render(<I18nProvider><div onMouseDown={callbacks.onBubble}><TimelineExportDialog {...props} /></div></I18nProvider>);
    });
  };
  await render();
  return { ...callbacks, render };
}

function dialog(): HTMLDivElement {
  const element = container.querySelector<HTMLDivElement>('[role="dialog"]');
  if (!element) throw new Error('Expected the timeline export dialog');
  return element;
}

function button(name: string): HTMLButtonElement {
  const element = [...container.querySelectorAll<HTMLButtonElement>('button')].find(candidate =>
    (candidate.getAttribute('aria-label') ?? candidate.textContent?.trim()) === name
  );
  if (!element) throw new Error(`Expected the ${name} button`);
  return element;
}

function codeField(): HTMLTextAreaElement {
  const element = container.querySelector<HTMLTextAreaElement>('textarea');
  if (!element) throw new Error('Expected the Mermaid code field');
  return element;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => { element.click(); });
}

async function keydown(element: HTMLElement, key: string, shiftKey = false): Promise<void> {
  await act(async () => { element.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })); });
}

async function mouseDown(element: HTMLElement): Promise<void> {
  await act(async () => { element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((fulfill, fail) => { resolve = () => fulfill(); reject = fail; });
  return { promise, resolve, reject };
}

describe('timeline export dialog', () => {
  it('exports the visible levels within the task dates and supplies the matching preview and code', async () => {
    await mount();
    expect(button('Image').getAttribute('aria-selected')).toBe('true');
    expect(dialog().textContent).toContain('1 visible cards · 2026-10-10 — 2026-10-30');

    await click(button('Mermaid'));

    expect(codeField().readOnly).toBe(true);
    expect(codeField().value).toContain('Release');
    expect(codeField().value).not.toMatch(/Hidden phase|Outside dates|private summary|Private notes/);
    expect(container.querySelector('svg')?.getAttribute('data-code')).toBe(codeField().value);
    expect(container.querySelector('svg')?.getAttribute('data-empty')).toBe('false');
  });

  it('retains the PNG background choice and prevents duplicate exports and dismissal while pending', async () => {
    const request = deferred();
    const onExportPng = vi.fn(() => request.promise);
    const controls = await mount({ onExportPng });
    await click(button('Transparent'));
    expect(controls.onBackgroundChange).toHaveBeenCalledWith('transparent');
    await controls.render({ background: 'transparent' });
    expect(button('Transparent').getAttribute('aria-pressed')).toBe('true');
    const download = button('Download PNG');

    await act(async () => { download.click(); download.click(); });

    expect(onExportPng).toHaveBeenCalledTimes(1);
    expect(download.disabled).toBe(true);
    expect(button('Close export dialog').disabled).toBe(true);
    expect(button('Close').disabled).toBe(true);
    expect(button('Mermaid').disabled).toBe(true);
    expect(document.activeElement).toBe(dialog());
    await click(button('Close export dialog'));
    await keydown(dialog(), 'Escape');
    await mouseDown(dialog().parentElement!);
    expect(controls.onClose).not.toHaveBeenCalled();
    expect(controls.onBubble).not.toHaveBeenCalled();

    await act(async () => { request.resolve(); await request.promise; });
    expect(button('Download PNG').disabled).toBe(false);
    expect(onExportPng).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed PNG export in the dialog and allows another attempt', async () => {
    const onExportPng = vi.fn(async (): Promise<void> => {}).mockRejectedValueOnce(new Error('PNG unavailable'));
    const controls = await mount({ onExportPng });
    await click(button('Download PNG'));

    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe('PNG unavailable');
    expect(controls.onClose).not.toHaveBeenCalled();
    await click(button('Download PNG'));
    expect(onExportPng).toHaveBeenCalledTimes(2);
    expect(dialog().querySelector('[role="alert"]')).toBeNull();
  });

  it('disables both formats when the view has no visible cards', async () => {
    await mount({ visibleLevels: { 1: false, 2: false, 3: false } });
    expect(dialog().textContent).toContain('0 visible cards');
    expect(button('Download PNG').disabled).toBe(true);
    await click(button('Mermaid'));
    expect(button('Copy code').disabled).toBe(true);
    expect(button('Download .mmd').disabled).toBe(true);
    expect(container.querySelector('svg')?.getAttribute('data-empty')).toBe('true');
  });

  it('copies the displayed Mermaid code once and announces success', async () => {
    const request = deferred();
    const writeText = vi.fn(() => request.promise);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await mount();
    await click(button('Mermaid'));
    const code = codeField().value;
    const copy = button('Copy code');

    await act(async () => { copy.click(); copy.click(); });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(code);
    expect(copy.disabled).toBe(true);
    await act(async () => { request.resolve(); await request.promise; });
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Code copied');
    expect(button('Copy code').disabled).toBe(false);
  });

  it('does not claim updated code was copied when the timeline changes during an asynchronous copy', async () => {
    const request = deferred();
    const writeText = vi.fn(async (_code: string): Promise<void> => {}).mockImplementationOnce(() => request.promise);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const controls = await mount();
    await click(button('Mermaid'));
    const originalCode = codeField().value;
    await click(button('Copy code'));

    await controls.render({ logs: { '2026-10-12': [card('shown', 'Updated release', '2026-10-12', 1)] } });
    const latestCode = codeField().value;
    expect(latestCode).not.toBe(originalCode);
    expect(container.querySelector('[role="status"]')).toBeNull();
    await act(async () => { request.resolve(); await request.promise; });

    expect(writeText).toHaveBeenNthCalledWith(1, originalCode);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('The timeline changed. Copy the latest code again.');
    await click(button('Copy code'));
    expect(writeText).toHaveBeenNthCalledWith(2, latestCode);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Code copied');

    await controls.render({ logs: { '2026-10-12': [card('shown', 'Another release update', '2026-10-12', 1)] } });
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it.each(['unavailable', 'rejected'] as const)('selects code for manual copying when the clipboard is %s', async (availability) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: availability === 'unavailable' ? undefined : { writeText: vi.fn().mockRejectedValue(new Error('Access denied')) }
    });
    await mount();
    await click(button('Mermaid'));
    await click(button('Copy code'));

    expect(document.activeElement).toBe(codeField());
    expect(codeField().selectionStart).toBe(0);
    expect(codeField().selectionEnd).toBe(codeField().value.length);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Code selected. Press Ctrl+C or ⌘C to copy.');
  });

  it('downloads the displayed code as a .mmd file and releases its temporary URL', async () => {
    let file: Blob | undefined;
    const createUrl = vi.fn((blob: Blob) => { file = blob; return 'blob:mermaid-download'; });
    const revokeUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
    let download: { name: string; href: string } | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      download = { name: this.download, href: this.href };
    });
    await mount();
    await click(button('Mermaid'));
    const code = codeField().value;
    await click(button('Download .mmd'));

    expect(download).toEqual({ name: 'Launch Roadmap.mmd', href: 'blob:mermaid-download' });
    expect(file?.type).toBe('text/plain;charset=utf-8');
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(file!);
    });
    expect(text).toBe(code);
    await new Promise(resolve => window.setTimeout(resolve, 5));
    expect(revokeUrl).toHaveBeenCalledWith('blob:mermaid-download');
  });

  it('traps focus, isolates its backdrop and restores focus when it closes', async () => {
    const controls = await mount();
    expect(document.activeElement).toBe(dialog());
    await keydown(dialog(), 'Tab');
    expect(document.activeElement).toBe(button('Close export dialog'));
    await keydown(button('Close export dialog'), 'Tab', true);
    expect(document.activeElement).toBe(button('Close'));
    await keydown(button('Close'), 'Tab');
    expect(document.activeElement).toBe(button('Close export dialog'));
    await mouseDown(dialog());
    expect(controls.onClose).not.toHaveBeenCalled();
    await mouseDown(dialog().parentElement!);
    expect(controls.onClose).toHaveBeenCalledTimes(1);
    expect(controls.onBubble).not.toHaveBeenCalled();
    await controls.render({ open: false });
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape when idle and shows the scope in Chinese', async () => {
    const controls = await mount({}, 'zh');
    expect(dialog().textContent).toContain('导出时间线');
    expect(dialog().textContent).toContain('当前显示 1 张卡片');
    await click(button('Mermaid'));
    expect(codeField().value).toContain('里程碑');
    expect(button('复制代码')).toBeDefined();
    await keydown(codeField(), 'Escape');
    expect(controls.onClose).toHaveBeenCalledTimes(1);
  });

  it('lets a read-only timeline export through the existing single entry point', async () => {
    const onDeleteLogs = vi.fn();
    const onMoveLogs = vi.fn();
    await act(async () => {
      root.render(<I18nProvider><Timeline project={project} logs={logs} readOnly onSelectDate={vi.fn()} onDeleteLogs={onDeleteLogs} onMoveLogs={onMoveLogs} /></I18nProvider>);
    });
    expect([...container.querySelectorAll('button')].filter(element => element.textContent?.trim() === 'Export')).toHaveLength(1);
    await click(button('Export'));
    await click(button('Mermaid'));
    expect(codeField().value).toContain('Release');
    expect(codeField().value).not.toContain('Outside dates');
    await keydown(dialog(), 'Delete');
    await keydown(dialog(), 'ArrowRight');
    expect(onDeleteLogs).not.toHaveBeenCalled();
    expect(onMoveLogs).not.toHaveBeenCalled();
  });

  it('downloads PNG through an attached anchor with a PNG Blob URL', async () => {
    const image = new Blob(['PNG bytes'], { type: 'image/png' });
    const toBlob = vi.fn((callback: BlobCallback) => callback(image));
    vi.mocked(html2canvas).mockResolvedValue({ toBlob } as unknown as HTMLCanvasElement);
    const createUrl = vi.fn(() => 'blob:png-download');
    const revokeUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
    let downloaded: HTMLAnchorElement | undefined;
    let connectedAtClick = false;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloaded = this;
      connectedAtClick = this.isConnected;
    });
    await act(async () => {
      root.render(<I18nProvider><Timeline project={project} logs={logs} onSelectDate={vi.fn()} /></I18nProvider>);
    });
    await click(button('Export'));
    await click(button('Download PNG'));
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 130)); });

    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
    expect(createUrl).toHaveBeenCalledWith(image);
    expect(image.type).toBe('image/png');
    expect(connectedAtClick).toBe(true);
    expect(downloaded?.download).toBe('launch-roadmap-snapshot.png');
    expect(downloaded?.href).toBe('blob:png-download');
    expect(downloaded?.isConnected).toBe(false);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(revokeUrl).not.toHaveBeenCalled();
  });

  it('keeps PNG conversion failures inside the export dialog', async () => {
    const toBlob = vi.fn((callback: BlobCallback) => callback(null));
    vi.mocked(html2canvas).mockResolvedValue({ toBlob } as unknown as HTMLCanvasElement);
    await act(async () => {
      root.render(<I18nProvider><Timeline project={project} logs={logs} onSelectDate={vi.fn()} /></I18nProvider>);
    });
    await click(button('Export'));
    await click(button('Download PNG'));
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 130)); });

    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe('Failed to generate export. Please try again.');
    expect(button('Download PNG').disabled).toBe(false);
  });
});
