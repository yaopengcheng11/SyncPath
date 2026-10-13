// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Timeline from './Timeline';
import { I18nProvider } from '../i18n';
import type { WorkLog } from '../types';

function card(id: string, date: string, level: 1 | 2 | 3, isLocked = false): WorkLog {
  return { id, author: id, weekStartDate: date, level, isLocked, summary: '', notes: '', goals: [], createdAt: 0 };
}

const logs = {
  '2026-10-12': [card('detail', '2026-10-12', 3), card('locked-card', '2026-10-12', 3, true)],
  '2026-10-13': [card('phase', '2026-10-13', 2)],
  '2026-10-14': [card('milestone', '2026-10-14', 1)]
};

let container: HTMLDivElement;
let root: Root;

beforeAll(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.setItem('syncpath_locale', 'en');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  window.localStorage.removeItem('syncpath_locale');
  vi.useRealTimers();
});

async function mount(overrides: Partial<React.ComponentProps<typeof Timeline>> = {}) {
  const props = {
    logs,
    project: { id: 'task-1', name: 'Launch', startDate: '2026-10-10', endDate: '2026-10-30', color: '#6366f1' },
    onSelectDate: vi.fn(),
    onDeleteLogs: vi.fn(async (_ids: string[]): Promise<void> => {}),
    onMoveLogs: vi.fn(),
    onCopyLogs: vi.fn(),
    onPasteLogs: vi.fn(),
    onUndo: vi.fn(),
    ...overrides
  };
  await act(async () => { root.render(<I18nProvider><Timeline {...props} /></I18nProvider>); });
  await act(async () => { vi.runOnlyPendingTimers(); });
  return props;
}

function timeline(): HTMLDivElement {
  return container.querySelector<HTMLDivElement>('[tabindex="0"]')!;
}

function dialog(): HTMLElement | null {
  return container.querySelector('[role="dialog"]');
}

function button(scope: HTMLElement, name: string): HTMLButtonElement {
  const element = [...scope.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
    (candidate.getAttribute('aria-label') ?? candidate.textContent?.trim()) === name
  );
  if (!element) throw new Error(`Expected a ${name} button`);
  return element;
}

async function key(keyName: string, options: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...options }));
  });
}

async function selectAll(): Promise<void> {
  timeline().focus();
  await key('a', { ctrlKey: true });
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => { element.click(); });
}

function selectedIds(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-log-id]')]
    .filter(element => element.classList.contains('ring-2'))
    .map(element => element.dataset.logId!);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(fulfill => { resolve = fulfill; });
  return { promise, resolve };
}

describe('permanent card deletion confirmation', () => {
  it.each(['Delete', 'Backspace'])('%s asks first and cancellation preserves the selection', async (shortcut) => {
    const props = await mount();
    await selectAll();
    const selection = selectedIds();
    await key(shortcut);

    expect(dialog()?.textContent).toContain('Delete cards?');
    expect(dialog()?.textContent).toContain('Delete 3 selected cards? This cannot be undone.');
    expect(props.onDeleteLogs).not.toHaveBeenCalled();
    await click(button(dialog()!, 'Cancel'));

    expect(dialog()).toBeNull();
    expect(selectedIds()).toEqual(selection);
    expect(props.onDeleteLogs).not.toHaveBeenCalled();
  });

  it('submits only the frozen unlocked selection once and blocks dismissal and timeline interaction while pending', async () => {
    const request = deferred();
    const onDeleteLogs = vi.fn((_ids: string[]) => request.promise);
    const props = await mount({ onDeleteLogs });
    const levelLocks = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Lock level"]')];
    await click(levelLocks[1]);
    await selectAll();
    await key('Delete');
    expect(dialog()?.textContent).toContain('Delete 2 selected cards? This cannot be undone.');

    const confirm = button(dialog()!, 'Delete');
    await act(async () => { confirm.click(); confirm.click(); });
    const confirmation = dialog()!;
    const cancel = button(confirmation, 'Cancel');
    const close = button(confirmation, 'Close dialog');
    expect(confirm.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    expect(close.disabled).toBe(true);
    expect(document.activeElement).toBe(confirmation);
    expect(onDeleteLogs.mock.calls).toEqual([[['detail', 'milestone']]]);

    await click(cancel);
    await click(close);
    await key('Escape');
    await act(async () => {
      confirmation.parentElement!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    timeline().focus();
    await key('Delete');
    await key('Backspace');
    await key('ArrowRight');
    await key('z', { ctrlKey: true });
    await key('Escape');
    await act(async () => {
      container.querySelector<HTMLElement>('[data-log-id="phase"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 50 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 100 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 100 }));
    });

    expect(dialog()).toBe(confirmation);
    expect(onDeleteLogs).toHaveBeenCalledTimes(1);
    expect(props.onMoveLogs).not.toHaveBeenCalled();
    expect(props.onCopyLogs).not.toHaveBeenCalled();
    expect(props.onUndo).not.toHaveBeenCalled();
    expect(selectedIds()).toEqual(['detail', 'locked-card', 'phase', 'milestone']);
    await act(async () => { request.resolve(); await request.promise; });

    expect(dialog()).toBeNull();
    expect(onDeleteLogs).toHaveBeenCalledTimes(1);
    expect(selectedIds()).toEqual(['locked-card', 'phase']);
  });

  it('keeps failures visible and retries the same selection', async () => {
    const onDeleteLogs = vi.fn(async (_ids: string[]): Promise<void> => {});
    onDeleteLogs.mockRejectedValueOnce(new Error('Connection lost'));
    await mount({ onDeleteLogs });
    await selectAll();
    const selection = selectedIds();
    await key('Delete');
    await click(button(dialog()!, 'Delete'));

    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe('Connection lost');
    expect(selectedIds()).toEqual(selection);
    expect(button(dialog()!, 'Retry').disabled).toBe(false);
    await click(button(dialog()!, 'Retry'));

    expect(dialog()).toBeNull();
    expect(onDeleteLogs.mock.calls).toEqual([
      [['detail', 'phase', 'milestone']],
      [['detail', 'phase', 'milestone']]
    ]);
    expect(selectedIds()).toEqual(['locked-card']);
  });

  it.each([{ readOnly: true }, { suspended: true }])('does not open deletion when interaction is restricted by %j', async (restriction) => {
    const props = await mount(restriction);
    await selectAll();
    await key('Delete');

    expect(dialog()).toBeNull();
    expect(props.onDeleteLogs).not.toHaveBeenCalled();
  });
});
