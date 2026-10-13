import React, { useEffect, useId, useRef, useState } from 'react';
import type { PublicWorkspace } from '@syncpath/api-client';
import { useI18n } from '../i18n';
import AppDialog from './AppDialog';
import DatePicker from './DatePicker';
import { parseCalendarDate } from '../utils/calendarDate';

export interface ProjectDraft {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
}

function dateText(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function initialDraft(): ProjectDraft {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + 30);
  return { name: '', description: '', startDate: dateText(today), endDate: dateText(end) };
}

const ProjectFormDialog: React.FC<{
  workspace: PublicWorkspace;
  onSubmit: (draft: ProjectDraft) => Promise<void>;
  onClose: () => void;
}> = ({ workspace, onSubmit, onClose }) => {
  const { t } = useI18n();
  const titleId = useId();
  const [draft, setDraft] = useState(initialDraft);
  const baseline = useRef(draft);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<() => void>(() => undefined);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline.current);
  closeRef.current = () => {
    if (savingRef.current) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    nameRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!dialogRef.current?.contains(document.activeElement) || event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key === 'Tab') {
        const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'));
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (savingRef.current) return;
    // DatePicker stores the selected ISO date in the form's hidden field.
    const fields = new FormData(event.currentTarget as HTMLFormElement);
    const submitted = { ...draft, startDate: String(fields.get('startDate') ?? draft.startDate), endDate: String(fields.get('endDate') ?? draft.endDate) };
    setDraft(submitted);
    if (!submitted.name.trim() || !parseCalendarDate(submitted.startDate) || !parseCalendarDate(submitted.endDate)) {
      setError(t('Choose a project and fill in the task name, start date, and end date.'));
      return;
    }
    if (submitted.endDate < submitted.startDate) {
      setError(t('The end date must be on or after the start date.'));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(submitted);
    } catch {
      setError(t('Could not create this task. Your details are kept here. Please try again.'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const inputClass = 'w-full rounded-xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 disabled:opacity-60';
  return (
    <>
      <div className="sp-modal-backdrop fixed inset-0 z-[3000] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-lg sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}>
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="sp-dialog flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-[2rem] border border-white/70 bg-white/95 shadow-[0_32px_100px_-24px_rgba(15,23,42,0.45)] backdrop-blur-2xl outline-none">
          <header className="sp-dialog-header flex items-center justify-between gap-4 px-6 py-5 sm:px-8">
            <div>
              <p className="sp-metadata">{workspace.name}</p>
              <h2 id={titleId} className="mt-1 text-xl font-bold">{t('New Task')}</h2>
            </div>
            <button type="button" onClick={() => closeRef.current()} disabled={saving} aria-label={t('Close dialog')} className="sp-icon-button flex shrink-0 items-center justify-center disabled:opacity-40"><i className="fas fa-times" /></button>
          </header>
          <form onSubmit={submit} className="overflow-y-auto p-6 sm:p-8" noValidate>
            <fieldset disabled={saving} className="space-y-5">
              <label className="block text-xs font-bold text-slate-600">
                {t('Task name')}
                <input ref={nameRef} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={t('e.g. AI assistant launch')} className={`mt-2 ${inputClass}`} />
              </label>
              <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                <DatePicker label={t('Start Date')} name="startDate" value={draft.startDate} max={draft.endDate} disabled={saving} onChange={(date) => setDraft((current) => ({ ...current, startDate: date }))} />
                <DatePicker label={t('End Date')} name="endDate" value={draft.endDate} min={draft.startDate} disabled={saving} onChange={(date) => setDraft((current) => ({ ...current, endDate: date }))} />
              </div>
              <label className="block text-xs font-bold text-slate-600">{t('Description')}<textarea rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder={t('Optional context for the team')} className={`mt-2 resize-y ${inputClass}`} /></label>
            </fieldset>
            {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}
            <div className="mt-6 flex justify-end"><button type="submit" disabled={saving || !draft.name.trim()} className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-40">{saving ? t('Creating…') : t('Create Task')}</button></div>
          </form>
        </div>
      </div>
      <AppDialog open={confirmDiscard} tone="warning" title={t('Discard task details?')} message={t('This task has not been created. Your unsaved details will be discarded.')} confirmLabel={t('Discard')} cancelLabel={t('Keep editing')} onConfirm={onClose} onCancel={() => setConfirmDiscard(false)} />
    </>
  );
};

export default ProjectFormDialog;
