import React, { useState } from 'react';
import type { PublicWorkspace } from '@syncpath/api-client';
import AppDialog from './AppDialog';
import { useI18n } from '../i18n';

interface Props {
  workspace: PublicWorkspace;
  onClose: () => void;
  onManageMembers: () => void;
  renameWorkspace: (name: string) => Promise<PublicWorkspace>;
  archiveWorkspace: () => Promise<void>;
  onUpdated: (workspace: PublicWorkspace) => void;
  onArchived: () => void;
}

const WorkspaceSettingsPanel: React.FC<Props> = ({
  workspace,
  onClose,
  onManageMembers,
  renameWorkspace,
  archiveWorkspace,
  onUpdated,
  onArchived
}) => {
  const { t } = useI18n();
  const [name, setName] = useState(workspace.name);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRename = workspace.role === 'Owner' || workspace.role === 'Admin';
  const canArchive = workspace.role === 'Owner';

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || saving || archiving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await renameWorkspace(nextName);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Unable to update project.'));
    } finally {
      setSaving(false);
    }
  };

  const archive = async (): Promise<void> => {
    if (!canArchive || saving || archiving) return;
    setArchiving(true);
    setError(null);
    try {
      await archiveWorkspace();
      setArchiveConfirmOpen(false);
      onArchived();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Unable to archive project.'));
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[3000] bg-slate-950/40 backdrop-blur-sm flex justify-end" onMouseDown={onClose}>
      <aside className="w-full max-w-xl h-full bg-white shadow-2xl flex flex-col" onMouseDown={(event) => event.stopPropagation()}>
        <header className="px-8 py-7 border-b border-slate-100 flex items-start justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-500">{t('Project settings')}</p>
            <h2 className="text-2xl font-black text-slate-900 mt-1">{workspace.name}</h2>
            <p className="text-sm text-slate-500 mt-1">
              {t('Your role:')} <span className="font-black text-slate-700">{t(workspace.role)}</span>
            </p>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-xl hover:bg-slate-100 text-slate-400" aria-label={t('Close project settings')}>
            <i className="fas fa-times"></i>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-8 py-8">
          <button
            type="button"
            onClick={onManageMembers}
            className="mb-8 w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-200 text-left hover:border-indigo-200 hover:bg-indigo-50/40 transition-colors"
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
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50"
                />
              </div>
              <button
                type="submit"
                disabled={saving || archiving || !name.trim() || name.trim() === workspace.name}
                className="px-5 py-3 rounded-xl bg-slate-900 text-white text-xs font-black disabled:opacity-40"
              >
                {saving ? t('Saving…') : t('Save name')}
              </button>
            </form>
          ) : (
            <p className="text-sm text-slate-500">{t('Only the project Owner or Admin can change project settings.')}</p>
          )}

          <div className="mt-12 pt-7 border-t border-slate-100">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t('Danger zone')}</p>
            <p className="text-sm text-slate-500 mt-2 leading-6">
              {t('Archiving hides this project and all of its tasks from the team. The data remains preserved for a future recovery workflow.')}
            </p>
            <button
              type="button"
              onClick={() => setArchiveConfirmOpen(true)}
              disabled={!canArchive || saving || archiving}
              className="mt-4 px-5 py-3 rounded-xl border border-red-200 text-red-600 text-xs font-black hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {archiving ? t('Archiving…') : t('Archive project')}
            </button>
            {!canArchive && <p className="text-[11px] text-slate-400 mt-2">{t('Only the project Owner can archive a project.')}</p>}
          </div>

          {error && <div className="mt-6 px-4 py-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>}
        </div>
      </aside>
      <AppDialog
        open={archiveConfirmOpen}
        tone="danger"
        title={`${t('Archive')} ${workspace.name}?`}
        message={t('Its tasks will be hidden from the team. The data will be preserved and can be recovered through a future project recovery flow.')}
        confirmLabel={t('Archive project')}
        cancelLabel={t('Keep project')}
        confirmDisabled={archiving}
        onConfirm={() => void archive()}
        onCancel={() => {
          if (!archiving) setArchiveConfirmOpen(false);
        }}
      />
    </div>
  );
};

export default WorkspaceSettingsPanel;
