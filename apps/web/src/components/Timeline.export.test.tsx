// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import html2canvas from 'html2canvas';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Timeline from './Timeline';
import { I18nProvider } from '../i18n';
import type { WorkLog } from '../types';

vi.mock('html2canvas', () => ({ default: vi.fn() }));
vi.mock('./MermaidPreview', () => ({ default: () => null }));

const logs: Record<string, WorkLog[]> = {
  '2026-10-12': [{
    id: 'release', author: 'Release', weekStartDate: '2026-10-12', level: 1,
    summary: 'Export fixture', notes: '', goals: [], createdAt: 1
  }]
};

let container: HTMLDivElement;
let root: Root;
let originalTheme: string | null;
let originalClass: string;
let originalColorScheme: string;
let originalLocale: string | null;
let createUrlDescriptor: PropertyDescriptor | undefined;
let revokeUrlDescriptor: PropertyDescriptor | undefined;

beforeAll(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(html2canvas).mockReset();
  originalTheme = document.documentElement.getAttribute('data-theme');
  originalClass = document.documentElement.className;
  originalColorScheme = document.documentElement.style.colorScheme;
  originalLocale = window.localStorage.getItem('syncpath_locale');
  createUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  revokeUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.classList.add('dark');
  document.documentElement.style.colorScheme = 'dark';
  window.localStorage.setItem('syncpath_locale', 'en');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalTheme === null) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', originalTheme);
  document.documentElement.className = originalClass;
  document.documentElement.style.colorScheme = originalColorScheme;
  if (originalLocale === null) window.localStorage.removeItem('syncpath_locale');
  else window.localStorage.setItem('syncpath_locale', originalLocale);
  for (const [key, descriptor] of [
    ['createObjectURL', createUrlDescriptor], ['revokeObjectURL', revokeUrlDescriptor]
  ] as const) {
    if (descriptor) Object.defineProperty(URL, key, descriptor);
    else Reflect.deleteProperty(URL, key);
  }
});

function button(name: string): HTMLButtonElement {
  const element = [...container.querySelectorAll<HTMLButtonElement>('button')].find(candidate =>
    (candidate.getAttribute('aria-label') ?? candidate.textContent?.trim()) === name
  );
  if (!element) throw new Error(`Expected the ${name} button`);
  return element;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => { element.click(); });
}

async function mount() {
  await act(async () => {
    root.render(<I18nProvider><Timeline
      project={{ id: 'task', name: 'Launch Roadmap', startDate: '2026-10-10', endDate: '2026-10-30', color: '#6366f1' }}
      logs={logs}
      onSelectDate={() => {}}
    /></I18nProvider>);
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  const wrapper = container.querySelector<HTMLElement>('[data-capture-wrapper]')!;
  const inner = container.querySelector<HTMLElement>('[data-inner-container]')!;
  // Independent dark surface fixtures model the theme's painted backgrounds.
  // The export callback must override both cloned layers, never these live ones.
  wrapper.style.background = '#111214';
  inner.style.background = '#111214';
  return { wrapper, inner };
}

function mockPngExport(blob: Blob | null = new Blob(['png fixture'], { type: 'image/png' })) {
  const clones: Document[] = [];
  const downloads: Array<{ href: string; filename: string; attached: boolean }> = [];
  const canvas = document.createElement('canvas');
  const toBlob = vi.spyOn(canvas, 'toBlob').mockImplementation(callback => { callback(blob); });
  const createObjectURL = vi.fn(() => 'blob:syncpath-export-fixture');
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ href: this.href, filename: this.download, attached: this.isConnected });
  });
  vi.mocked(html2canvas).mockImplementation(async (element, options) => {
    const clonedDoc = document.implementation.createHTMLDocument('PNG clone');
    clonedDoc.documentElement.dataset.theme = document.documentElement.dataset.theme;
    clonedDoc.documentElement.className = document.documentElement.className;
    clonedDoc.documentElement.style.colorScheme = document.documentElement.style.colorScheme;
    const clonedElement = clonedDoc.importNode(element, true);
    clonedDoc.body.appendChild(clonedElement);
    if (!options?.onclone) throw new Error('PNG export must prepare its cloned document');
    await options.onclone(clonedDoc, clonedElement);
    clones.push(clonedDoc);
    return canvas;
  });
  return { blob, clones, downloads, toBlob, createObjectURL, revokeObjectURL };
}

async function download(background: 'white' | 'transparent'): Promise<void> {
  await click(button('Export'));
  await click(button(background === 'white' ? 'White' : 'Transparent'));
  await click(button('Download PNG'));
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
}

describe('timeline PNG export theme isolation', () => {
  it.each(['white', 'transparent'] as const)('renders a dark timeline with %s background through the clone and Blob download flow', async (background) => {
    const live = await mount();
    const exported = mockPngExport();

    await download(background);

    expect(html2canvas).toHaveBeenCalledTimes(1);
    expect(vi.mocked(html2canvas).mock.calls[0][0]).toBe(live.wrapper);
    expect(vi.mocked(html2canvas).mock.calls[0][1]?.backgroundColor).toBe(background === 'white' ? '#ffffff' : null);
    expect(exported.clones).toHaveLength(1);
    const clone = exported.clones[0];
    expect(clone).not.toBe(document);
    expect(clone.documentElement.dataset.theme).toBe(background === 'white' ? 'light' : 'dark');
    expect(clone.documentElement.classList.contains('dark')).toBe(background === 'transparent');
    expect(clone.documentElement.style.colorScheme).toBe(background === 'white' ? 'light' : 'dark');
    for (const selector of ['[data-capture-wrapper]', '[data-inner-container]']) {
      expect(clone.querySelector<HTMLElement>(selector)?.style.backgroundColor).toBe(background === 'white' ? 'rgb(255, 255, 255)' : 'transparent');
    }
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(live.wrapper.style.backgroundColor).toBe('rgb(17, 18, 20)');
    expect(live.inner.style.backgroundColor).toBe('rgb(17, 18, 20)');
    expect(exported.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
    expect(exported.createObjectURL).toHaveBeenCalledWith(exported.blob);
    expect(exported.downloads).toEqual([{ href: 'blob:syncpath-export-fixture', filename: 'launch-roadmap-snapshot.png', attached: true }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(exported.revokeObjectURL).toHaveBeenCalledWith('blob:syncpath-export-fixture');
  });

  it('shows a null-Blob failure without downloading or changing the live theme', async () => {
    await mount();
    const exported = mockPngExport(null);

    await download('white');

    expect(exported.toBlob).toHaveBeenCalledTimes(1);
    expect(exported.createObjectURL).not.toHaveBeenCalled();
    expect(exported.downloads).toEqual([]);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Failed to generate export. Please try again.');
    expect(button('Download PNG').disabled).toBe(false);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
