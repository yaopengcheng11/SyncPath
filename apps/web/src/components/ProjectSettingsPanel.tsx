// apps/web/src/components/ProjectSettingsPanel.tsx
//
// Edit the project parameters the API already supports (PATCH
// /api/v1/projects/:id): name, dates, description, colour and visibility.
// The project carries a `revision`; every save sends the revision this form
// was opened with, so a teammate's change surfaces as a 409 we can show
// side by side instead of silently overwriting it.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicProject } from '@syncpath/api-client';
import { apiClient, ApiError } from '../services/api';
import AppDialog from './AppDialog';
import { useI18n } from '../i18n';

export interface ProjectSettingsPanelProps {
  project: PublicProject;
  canEdit: boolean;
  /** Persist the draft. Must throw ApiError('revision_conflict') on a 409. */
  onSave: (projectId: string, body: {
    name: string;
    description: string;
    startDate: string;
    endDate: string;
    color: string;
    visibility: 'private' | 'workspace';
    expectedRevision: number;
  }) => Promise<void>;
  onClose: () => void;
}

interface SettingsDraft {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  color: string;
  visibility: 'private' | 'workspace';
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#ec4899'];

function draftFrom(project: PublicProject): SettingsDraft {
  return {
    name: project.name,
    description: project.description ?? '',
    startDate: project.startDate,
    endDate: project.endDate,
    color: project.color || '#6366f1',
    visibility: project.visibility
  };
}

const ProjectSettingsPanel: React.FC<ProjectSettingsPanelProps> = ({
  project,
  canEdit,
  onSave,
  onClose
}) => {
  const { t } = useI18n();
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFrom(project));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PublicProject | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  // The revision this form was opened against — never refreshed behind the
  // user's back, otherwise their save would silently win.
  const baseline = useRef(project.revision);
  const savingRef = useRef(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFrom(project));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !savingRef.current) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Adopt the newest server version after a conflict, or the owner's own save.
  const adoptLatest = useCallback((latest: PublicProject) => {
    baseline.current = latest.revision;
    setDraft(draftFrom(latest));
  }, []);

  const loadLatest = useCallback(async () => {
    try {
      const latest = await apiClient.getProject(project.id);
      adoptLatest(latest);
      setConflict(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Unable to load the latest version.'));
    }
  }, [project.id, adoptLatest, t]);

  const validate = (value: SettingsDraft): string | null => {
    if (!value.name.trim()) return t('The task needs a name.');
    if (!value.startDate || !value.endDate) return t('Both the start and end date are required.');
    if (value.endDate < value.startDate) return t('The end date must be on or after the start date.');
    return null;
  };

  const submit = async (revisionOverride?: number): Promise<void> => {
    if (savingRef.current) return;
    const problem = validate(draft);
    if (problem) {
      setError(problem);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(project.id, {
        name: draft.name.trim(),
        description: draft.description.trim(),
        startDate: draft.startDate,
        endDate: draft.endDate,
        color: draft.color,
        visibility: draft.visibility,
        expectedRevision: revisionOverride ?? baseline.current
      });
      setConfirmOverwrite(false);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'revision_conflict' || err.status === 409)) {
        setConflict(await apiClient.getProject(project.id).catch(() => null));
      } else {
        setError(err instanceof Error ? err.message : t('Unable to save these task settings.'));
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 disabled:opacity-60';

  return (
    <div className="fixed inset-0 z-[3000] bg-slate-950/40 backdrop-blur-sm flex justify-end" onMouseDown={() => !savingRef.current && onClose()}>
      <aside
        className="w-full max-w-xl h-full bg-white shadow-2xl flex flex-col"
        onMouseDown={(event) => event.stopPropagation()}
        aria-label={t('Task settings')}
      >
        <header className="px-8 py-7 border-b border-slate-100 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-500">{t('Task')}</p>
            <h2 className="text-2xl font-black text-slate-900 mt-1">{t('Task settings')}</h2>
            <p className="text-sm text-slate-500 mt-1">{project.name}</p>
          </div>
          <button onClick={onClose} disabled={saving} className="w-10 h-10 shrink-0 rounded-xl hover:bg-slate-100 text-slate-400 disabled:opacity-40" aria-label={t('Close task settings')}>
            <i className="fas fa-times"></i>
          </button>
        </header>

        {!canEdit && (
          <div className="mx-8 mt-5 px-4 py-3 rounded-xl bg-slate-50 text-slate-600 text-sm">
            {t('You need the Lead or Editor role to change these settings.')}
          </div>
        )}

        {conflict && (
          <div role="alert" className="mx-8 mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">{t('Someone else changed this task while you were editing.')}</p>
            <p className="mt-1 leading-6 text-amber-900/80">{t('Compare the latest version before replacing it with your draft.')}</p>
            <dl className="mt-3 space-y-1 rounded-xl border border-amber-200/75 bg-white/75 p-3 text-xs text-slate-700">
              <div className="flex gap-2"><dt className="font-bold text-slate-500 w-20 shrink-0">{t('Name')}</dt><dd className="font-semibold text-slate-900 break-words">{conflict.name}</dd></div>
              <div className="flex gap-2"><dt className="font-bold text-slate-500 w-20 shrink-0">{t('Dates')}</dt><dd>{conflict.startDate} → {conflict.endDate}</dd></div>
              {conflict.description && <div className="flex gap-2"><dt className="font-bold text-slate-500 w-20 shrink-0">{t('Description')}</dt><dd className="break-words">{conflict.description}</dd></div>}
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={saving} onClick={() => void loadLatest()} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-700 border border-amber-200 hover:bg-amber-100 disabled:opacity-50">
                {t('Load the latest version')}
              </button>
              <button type="button" disabled={saving} onClick={() => setConfirmOverwrite(true)} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                {t('Replace with my draft')}
              </button>
            </div>
          </div>
        )}

        <form
          className="flex-1 overflow-y-auto px-8 py-6 space-y-5"
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
          noValidate
        >
          <fieldset disabled={saving || !canEdit} className="space-y-5">
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
              {t('Task name')}
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                className={`mt-2 ${inputClass} normal-case tracking-normal font-normal`}
              />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                {t('Start Date')}
                <input
                  type="date"
                  value={draft.startDate}
                  onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
                  className={`mt-2 ${inputClass}`}
                />
              </label>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                {t('End Date')}
                <input
                  type="date"
                  value={draft.endDate}
                  onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}
                  className={`mt-2 ${inputClass}`}
                />
              </label>
            </div>

            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
              {t('Description')}
              <textarea
                rows={3}
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                placeholder={t('Optional context for the team')}
                className={`mt-2 resize-y ${inputClass}`}
              />
            </label>

            <div>
              <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">{t('Colour')}</span>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setDraft({ ...draft, color })}
                    aria-label={color}
                    aria-pressed={draft.color === color}
                    className={`w-9 h-9 rounded-full border-2 transition ${draft.color === color ? 'border-slate-900 scale-110' : 'border-transparent hover:scale-105'}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
              {t('Visibility')}
              <select
                value={draft.visibility}
                onChange={(event) => setDraft({ ...draft, visibility: event.target.value as 'private' | 'workspace' })}
                className={`mt-2 ${inputClass}`}
              >
                <option value="workspace">{t('Everyone in this project')}</option>
                <option value="private">{t('Only task members')}</option>
              </select>
            </label>
            <p className="text-xs leading-5 text-slate-500">{t('Visibility controls who sees this task in the project list. Card content and real-time collaboration require task membership.')}</p>
          </fieldset>

          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}
        </form>

        <footer className="px-8 py-5 border-t border-slate-100 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} disabled={saving} className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-40">
            {t('Cancel')}
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving || !dirty || conflict !== null || validate(draft) !== null}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 text-xs font-bold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-40"
            >
              {saving ? t('Saving…') : t('Save settings')}
            </button>
          )}
        </footer>
      </aside>

      <AppDialog
        open={confirmOverwrite}
        tone="warning"
        title={t('Replace the latest version?')}
        message={t('Another teammate changed this task. Replacing it will overwrite their changes.')}
        confirmLabel={t('Replace and save')}
        cancelLabel={t('Keep editing')}
        onConfirm={() => { setConfirmOverwrite(false); void submit(conflict?.revision); }}
        onCancel={() => setConfirmOverwrite(false)}
      />
    </div>
  );
};

export default ProjectSettingsPanel;
