// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicProject, PublicWorkspace } from '@syncpath/api-client';
import WorkspaceSettingsPanel from './WorkspaceSettingsPanel';
import { I18nProvider } from '../i18n';

const workspace: PublicWorkspace = {
  id: 'workspace-1', name: 'Editorial', slug: 'editorial', role: 'Owner',
  createdAt: '2026-10-10T00:00:00.000Z'
};
const task: PublicProject = {
  id: 'task-1', workspaceId: workspace.id, name: 'Launch', description: null,
  startDate: '2026-10-12', endDate: '2026-10-26', visibility: 'workspace',
  status: 'active', color: '#6366f1', holidayRegion: 'NONE', revision: 1,
  creatorId: 'owner-1', createdAt: workspace.createdAt, updatedAt: workspace.createdAt,
  myRole: 'Lead'
};

let container: HTMLDivElement;
let root: Root;

beforeAll(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => {
  window.localStorage.setItem('syncpath_locale', 'en');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  window.localStorage.removeItem('syncpath_locale');
});

async function mount(locale: 'en' | 'zh' = 'en') {
  window.localStorage.setItem('syncpath_locale', locale);
  const props = {
    workspace, tasks: [task], onClose: vi.fn(), onManageMembers: vi.fn(),
    renameWorkspace: vi.fn(async () => workspace), onUpdated: vi.fn(),
    deleteWorkspace: vi.fn(async (): Promise<void> => {}), onDeleted: vi.fn(),
    onDeleteTask: vi.fn(async (_taskId: string): Promise<void> => {})
  };
  await act(async () => { root.render(<I18nProvider><WorkspaceSettingsPanel {...props} /></I18nProvider>); });
  return props;
}

function dialog(name: string): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>('[role="dialog"]')].find((element) => {
    const labelledBy = element.getAttribute('aria-labelledby');
    return (element.getAttribute('aria-label') ?? (labelledBy ? document.getElementById(labelledBy)?.textContent : '')) === name;
  });
}

function requireDialog(name: string): HTMLElement {
  const element = dialog(name);
  if (!element) throw new Error(`Expected the ${name} dialog to be open`);
  return element;
}

function button(scope: HTMLElement, name: string): HTMLButtonElement {
  const element = [...scope.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
    (candidate.getAttribute('aria-label') ?? candidate.textContent?.trim()) === name
  );
  if (!element) throw new Error(`Expected a ${name} button`);
  return element;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => { element.click(); });
}

async function mouseDown(element: HTMLElement): Promise<void> {
  await act(async () => { element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((fulfill) => { resolve = () => fulfill(); });
  return { promise, resolve };
}

const actions = [
  {
    kind: 'task', openLabel: 'Delete task Launch', title: 'Delete task Launch?', confirmLabel: 'Delete task', cancelLabel: 'Keep task',
    message: 'This task and all its cards, member permissions, shares and history will be permanently deleted. This cannot be undone.',
    zhOpenLabel: '删除任务 Launch', zhTitle: '删除任务「Launch」？',
    zhMessage: '此任务及其全部卡片、成员权限、分享和历史记录将被永久删除。此操作无法撤销。'
  },
  {
    kind: 'project', openLabel: 'Delete project', title: 'Delete project Editorial?', confirmLabel: 'Delete project', cancelLabel: 'Keep project',
    message: 'This project and all its tasks, cards, member permissions, shares and history will be permanently deleted. This cannot be undone.',
    zhOpenLabel: '删除项目', zhTitle: '删除项目「Editorial」？',
    zhMessage: '此项目及其全部任务、卡片、成员权限、分享和历史记录将被永久删除。此操作无法撤销。'
  }
] as const;

describe.each(actions)('$kind permanent deletion in project settings', (action) => {
  it('closes only the confirmation when its backdrop receives mouseDown', async () => {
    const props = await mount();
    await click(button(requireDialog('Project settings'), action.openLabel));
    const confirmation = requireDialog(action.title);
    const descriptionId = confirmation.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)?.textContent).toBe(action.message);
    expect(container.textContent).not.toMatch(/archiv|recover|preserv/i);

    await mouseDown(confirmation.parentElement!);

    expect(dialog(action.title)).toBeUndefined();
    expect(dialog('Project settings')).toBeDefined();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onDeleteTask).not.toHaveBeenCalled();
    expect(props.deleteWorkspace).not.toHaveBeenCalled();
  });

  it('describes permanent deletion and the affected data in Chinese', async () => {
    const props = await mount('zh');
    await click(button(requireDialog('项目设置'), action.zhOpenLabel));
    const confirmation = requireDialog(action.zhTitle);
    const descriptionId = confirmation.getAttribute('aria-describedby');

    expect(document.getElementById(descriptionId!)?.textContent).toBe(action.zhMessage);
    expect(container.textContent).not.toMatch(/归档|恢复|数据.*保留/);
    expect(props.onDeleteTask).not.toHaveBeenCalled();
    expect(props.deleteWorkspace).not.toHaveBeenCalled();
  });

  it('keeps a failed confirmation open, announces the error, and retries successfully', async () => {
    const props = await mount();
    const operation = action.kind === 'task' ? props.onDeleteTask : props.deleteWorkspace;
    const retry = deferred();
    operation.mockRejectedValueOnce(new Error('Connection lost')).mockImplementationOnce(() => retry.promise);
    await click(button(requireDialog('Project settings'), action.openLabel));
    await click(button(requireDialog(action.title), action.confirmLabel));

    const failedConfirmation = requireDialog(action.title);
    expect(failedConfirmation.querySelector('[role="alert"]')?.textContent).toBe('Connection lost');
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onDeleted).not.toHaveBeenCalled();

    await click(button(failedConfirmation, 'Retry'));

    expect(requireDialog(action.title).querySelector('[role="alert"]')).toBeNull();
    expect(operation).toHaveBeenCalledTimes(2);
    await act(async () => { retry.resolve(); await retry.promise; });

    expect(dialog(action.title)).toBeUndefined();
    expect(dialog('Project settings')).toBeDefined();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onUpdated).not.toHaveBeenCalled();
    if (action.kind === 'task') {
      expect(props.onDeleteTask.mock.calls).toEqual([[task.id], [task.id]]);
      expect(props.onDeleted).not.toHaveBeenCalled();
    } else {
      expect(props.onDeleted).toHaveBeenCalledTimes(1);
    }
  });

  it('blocks confirmation, cancel, close, Escape and backdrop dismissal while pending', async () => {
    const props = await mount();
    const operation = action.kind === 'task' ? props.onDeleteTask : props.deleteWorkspace;
    const request = deferred();
    operation.mockImplementationOnce(() => request.promise);
    await click(button(requireDialog('Project settings'), action.openLabel));
    const confirm = button(requireDialog(action.title), action.confirmLabel);
    await click(confirm);

    const confirmation = requireDialog(action.title);
    const cancel = button(confirmation, action.cancelLabel);
    const close = button(confirmation, 'Close dialog');
    const settingsClose = button(requireDialog('Project settings'), 'Close project settings');
    expect(confirm.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    expect(close.disabled).toBe(true);
    expect(settingsClose.disabled).toBe(true);
    expect(document.activeElement).toBe(confirmation);

    await click(confirm);
    await click(cancel);
    await click(close);
    await click(settingsClose);
    await act(async () => {
      confirmation.focus();
      confirmation.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await mouseDown(confirmation.parentElement!);
    await mouseDown(requireDialog('Project settings').parentElement!);

    expect(dialog(action.title)).toBeDefined();
    expect(dialog('Project settings')).toBeDefined();
    expect(operation).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onDeleted).not.toHaveBeenCalled();
    await act(async () => { request.resolve(); await request.promise; });

    expect(dialog(action.title)).toBeUndefined();
    expect(dialog('Project settings')).toBeDefined();
    expect(operation).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
    if (action.kind === 'task') {
      expect(props.onDeleteTask).toHaveBeenCalledWith(task.id);
      expect(props.onDeleted).not.toHaveBeenCalled();
    } else {
      expect(props.onDeleted).toHaveBeenCalledTimes(1);
    }
  });
});
