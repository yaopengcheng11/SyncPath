import React, { useEffect, useRef, useState } from 'react';
import type { PublicProject, PublicWorkspace } from '@syncpath/api-client';
import AppDialog from './AppDialog';
import { useI18n } from '../i18n';
import { ApiError } from '../services/api';

interface Props {
  workspace: PublicWorkspace;
  onClose: () => void;
  onManageMembers: () => void;
  renameWorkspace: (name: string) => Promise<PublicWorkspace>;
  deleteWorkspace: () => Promise<void>;
  onUpdated: (workspace: PublicWorkspace) => void;
  onDeleted: () => void;
  tasks: PublicProject[];
  onDeleteTask: (taskId: string) => Promise<void>;
}

const WorkspaceSettingsPanel: React.FC<Props> = ({
  workspace,
  onClose,
  onManageMembers,
  renameWorkspace,
  deleteWorkspace,
  onUpdated,
  onDeleted,
  tasks,
  onDeleteTask
}) => {
  const { t } = useI18n();
  const [name, setName] = useState(workspace.name);
  const [saving, setSaving] = useState(false);
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);
  const [workspaceDeleteConfirmOpen, setWorkspaceDeleteConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingTask, setDeletingTask] = useState(false);
  const [pendingTask, setPendingTask] = useState<PublicProject | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(false);
  const busy = saving || deletingWorkspace || deletingTask;
  busyRef.current = busy;
  const canRename = workspace.role === 'Owner' || workspace.role === 'Admin';
  const canDeleteWorkspace = workspace.role === 'Owner';

  const operationError = (err: unknown, fallback: string): string => {
    if (err instanceof ApiError) {
      if (err.status === 401) return t('Your session has expired. Sign in again.');
      if (err.status === 403) return t('You no longer have permission for this action.');
      if (err.status === 404) return t('This task or project is no longer available. Refresh the page to update the list.');
      if (err.status === 0) return t('Check your connection and try again.');
      if (err.status >= 500) return t(fallback);
    }
    return err instanceof Error ? t(err.message) : t(fallback);
  };

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const keydown = (event: KeyboardEvent): void => {
      if (!panelRef.current?.contains(document.activeElement) || event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (!busyRef.current) closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const controls = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const updated = await renameWorkspace(nextName);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Unable to update project.'));
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  const handleDeleteWorkspace = async (): Promise<void> => {
    if (!canDeleteWorkspace || busyRef.current) return;
    busyRef.current = true;
    setDeletingWorkspace(true);
    setError(null);
    try {
      await deleteWorkspace();
      setWorkspaceDeleteConfirmOpen(false);
      onDeleted();
    } catch (err) {
      setError(operationError(err, 'Unable to delete project.'));
    } finally {
      busyRef.current = false;
      setDeletingWorkspace(false);
    }
  };

  const deleteTask = async (): Promise<void> => {
    if (!pendingTask || busyRef.current) return;
    busyRef.current = true;
    setDeletingTask(true);
    setError(null);
    try {
      await onDeleteTask(pendingTask.id);
      setPendingTask(null);
    } catch (err) {
      setError(operationError(err, 'Unable to delete task'));
    } finally { busyRef.current = false; setDeletingTask(false); }
  };

  return (
    <div className="sp-modal-backdrop fixed inset-0 z-[3000] bg-slate-950/40 backdrop-blur-sm flex justify-end" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyRef.current) onClose(); }}>
      <aside ref={panelRef} role="dialog" aria-modal="true" aria-label={t('Project settings')} tabIndex={-1} className="sp-side-panel w-full max-w-xl h-full bg-white shadow-2xl flex flex-col outline-none" onMouseDown={(event) => event.stopPropagation()}>
        <header className="px-8 py-7 border-b border-slate-100 flex items-start justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-500">{t('Project settings')}</p>
            <h2 className="text-2xl font-black text-slate-900 mt-1">{workspace.name}</h2>
            <p className="text-sm text-slate-500 mt-1">
              {t('Your role:')} <span className="font-black text-slate-700">{t(workspace.role)}</span>
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="w-10 h-10 rounded-xl hover:bg-slate-100 text-slate-400 disabled:opacity-40" aria-label={t('Close project settings')}>
            <i className="fas fa-times"></i>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-8 py-8">
          <button
            type="button"
            onClick={onManageMembers}
            disabled={busy}
            className="mb-8 w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-200 text-left hover:border-indigo-200 hover:bg-indigo-50/40 transition-colors disabled:opacity-40"
          >
            <span>
              <span className="block text-sm font-black text-slate-800">{t('Team members')}</span>
              <span className="block text-xs text-slate-400 mt-1">{t('Manage people and project roles')}</span>
            </span>
            <i className="fas fa-arrow-right text-xs text-slate-400"></i>
          </button>

          {canRename ? (
            <form onSubmit={save} className="space-y-4">
              <div>
                <label htmlFor="workspace-name" className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                  {t('Project name')}
                </label>
                <input
                  id="workspace-name"
                  disabled={busy}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50"
                />
              </div>
              <button
                type="submit"
                disabled={busy || !name.trim() || name.trim() === workspace.name}
                className="px-5 py-3 rounded-xl bg-slate-900 text-white text-xs font-black disabled:opacity-40"
              >
                {saving ? t('Saving…') : t('Save name')}
              </button>
            </form>
          ) : (
            <p className="text-sm text-slate-500">{t('Only the project Owner or Admin can change project settings.')}</p>
          )}

          <section className="mt-8 border-t border-slate-100 pt-6">
            <h3 className="text-sm font-bold text-slate-800">{t('Manage tasks')}</h3>
            {tasks.length === 0 ? <p className="mt-3 text-xs text-slate-500">{t('No tasks in this project yet.')}</p> : <ul className="mt-3 divide-y divide-slate-100">
              {tasks.map((task) => <li key={task.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-700">{task.name}</p><p className="mt-1 text-xs text-slate-400">{task.startDate} → {task.endDate}</p></div>
                {(canRename || task.myRole === 'Lead') && <button type="button" aria-label={t('Delete task {{name}}', { name: task.name })} disabled={busy} onClick={() => { setError(null); setPendingTask(task); }} className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40"><i className="fas fa-trash-alt mr-2" aria-hidden="true" />{t('Delete')}</button>}
              </li>)}
            </ul>}
          </section>

          <div className="mt-12 pt-7 border-t border-slate-100">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t('Danger zone')}</p>
            <p className="text-sm text-slate-500 mt-2 leading-6">
              {t('This project and all its tasks, cards, member permissions, shares and history will be permanently deleted. This cannot be undone.')}
            </p>
            <button
              type="button"
              onClick={() => { setError(null); setWorkspaceDeleteConfirmOpen(true); }}
              disabled={!canDeleteWorkspace || busy}
              className="mt-4 px-5 py-3 rounded-xl border border-red-200 text-red-600 text-xs font-black hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deletingWorkspace ? t('Deleting…') : t('Delete project')}
            </button>
            {!canDeleteWorkspace && <p className="text-[11px] text-slate-400 mt-2">{t('Only the project Owner can delete a project.')}</p>}
          </div>

          {error && !pendingTask && !workspaceDeleteConfirmOpen && <div role="alert" className="mt-6 px-4 py-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>}
        </div>
      </aside>
      <AppDialog
        open={pendingTask !== null}
        tone="danger"
        title={t('Delete task {{name}}?', { name: pendingTask?.name ?? '' })}
        message={t('This task and all its cards, member permissions, shares and history will be permanently deleted. This cannot be undone.')}
        error={error ?? undefined}
        confirmLabel={deletingTask ? t('Deleting…') : error ? t('Retry') : t('Delete task')}
        cancelLabel={t('Keep task')}
        confirmDisabled={deletingTask}
        cancelDisabled={deletingTask}
        onConfirm={() => void deleteTask()}
        onCancel={() => { if (!busyRef.current) { setPendingTask(null); setError(null); } }}
      />
      <AppDialog
        open={workspaceDeleteConfirmOpen}
        tone="danger"
        title={t('Delete project {{name}}?', { name: workspace.name })}
        message={t('This project and all its tasks, cards, member permissions, shares and history will be permanently deleted. This cannot be undone.')}
        error={error ?? undefined}
        confirmLabel={deletingWorkspace ? t('Deleting…') : error ? t('Retry') : t('Delete project')}
        cancelLabel={t('Keep project')}
        confirmDisabled={deletingWorkspace}
        cancelDisabled={deletingWorkspace}
        onConfirm={() => void handleDeleteWorkspace()}
        onCancel={() => {
          if (!busyRef.current) { setWorkspaceDeleteConfirmOpen(false); setError(null); }
        }}
      />
    </div>
  );
};

export default WorkspaceSettingsPanel;
