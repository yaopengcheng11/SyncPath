import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, type PublicMentionCandidate } from '@syncpath/api-client';
import { apiClient } from '../services/api';
import type { LogLevel, WorkLog } from '../types';
import AppDialog from './AppDialog';
import { useI18n } from '../i18n';
import { buildCardSave, captureCardBaseline } from './cardDraft';

interface LogEditorProps {
  dateStr: string;
  initialLog?: WorkLog;
  initialLevel?: LogLevel;
  projectId?: string;
  currentUserId?: string;
  onSave: (log: WorkLog) => void | Promise<void>;
  onBack: () => void;
  readOnly?: boolean;
  /** The card is locked: show it, but never let it be edited or saved. */
  locked?: boolean;
}

type Field = 'author' | 'summary' | 'notes';
type MentionTrigger = { field: Field; start: number; end: number; query: string };
type MentionOption = { id: string; label: string; detail: string; all?: boolean; self?: boolean };
type SaveError = 'conflict' | 'session' | 'forbidden' | 'missing' | 'network' | 'locked';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function hasMention(text: string, label: string): boolean {
  return new RegExp(`(^|[\\s(（，,])@${escapeRegExp(label)}(?=$|[\\s)），。.!！?？;；:：])`, 'u').test(text);
}

function findTrigger(field: Field, value: string, caret: number): MentionTrigger | null {
  const before = value.slice(0, caret);
  const match = /@([^\s@,，。.!！?？;；:：）)]*)$/u.exec(before);
  return match ? { field, start: before.length - match[0].length, end: caret, query: match[1] } : null;
}

const LogEditor: React.FC<LogEditorProps> = ({
  dateStr,
  initialLog,
  initialLevel = 3,
  projectId,
  currentUserId,
  onSave,
  onBack,
  readOnly = false,
  locked = false
}) => {
  const { t, locale } = useI18n();
  // A locked card is read-only even for an editor, and the lock outranks the
  // caller's own permission — otherwise the Save path would only fail later
  // with a 409 from the server.
  const fieldsLocked = readOnly || locked;
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const authorRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const savingRef = useRef(false);
  const lastEditorFocusRef = useRef<HTMLElement | null>(null);
  const nestedWasOpenRef = useRef(false);
  const existingCardRef = useRef(Boolean(initialLog));
  const [baseline, setBaseline] = useState(() => captureCardBaseline(dateStr, initialLog, initialLevel));
  const [form, setForm] = useState({
    author: baseline.author,
    summary: baseline.summary,
    notes: baseline.notes
  });
  const [level, setLevel] = useState<LogLevel>(baseline.level);
  const [candidates, setCandidates] = useState<PublicMentionCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(Boolean(projectId));
  const [candidatesError, setCandidatesError] = useState(false);
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [suggestRect, setSuggestRect] = useState<{ top: number; left: number; width: number; above: boolean } | null>(null);
  const [activeOption, setActiveOption] = useState(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const [replacementCandidate, setReplacementCandidate] = useState<WorkLog | null>(null);
  const nestedDialogOpen = Boolean(notice || confirmDiscard || replacementCandidate);

  useEffect(() => {
    if (!nestedDialogOpen && nestedWasOpenRef.current && lastEditorFocusRef.current?.isConnected) lastEditorFocusRef.current.focus();
    nestedWasOpenRef.current = nestedDialogOpen;
  }, [nestedDialogOpen]);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    setCandidatesLoading(true);
    void apiClient.listMentionCandidates(projectId)
      .then((items) => { if (active) { setCandidates(items); setCandidatesError(false); } })
      .catch(() => { if (active) setCandidatesError(true); })
      .finally(() => { if (active) setCandidatesLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = requestAnimationFrame(() => authorRef.current?.focus());
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const labels = useMemo(() => {
    const counts = new Map<string, number>();
    candidates.forEach((candidate) => {
      const name = candidate.displayName?.trim();
      if (name && !/\s/u.test(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    return candidates.map((candidate) => {
      const name = candidate.displayName?.trim();
      return {
        id: candidate.id,
        label: name && !/\s/u.test(name) && counts.get(name) === 1 ? name : candidate.username,
        detail: name && name !== candidate.username ? candidate.username : ''
      };
    });
  }, [candidates]);

  const options = useMemo<MentionOption[]>(() => {
    if (!trigger) return [];
    const query = trigger.query.toLocaleLowerCase();
    const allLabel = locale === 'zh' ? '所有人' : 'everyone';
    const all = !query || allLabel.toLocaleLowerCase().includes(query) || 'all'.includes(query)
      ? [{ id: 'all', label: allLabel, detail: t('Notify everyone on this task'), all: true }]
      : [];
    // The signed-in user stays in the list: @-ing yourself is a legitimate
    // "this one is mine" marker and belongs in their mentions timeline.
    // The server preserves that selection while skipping self-notifications.
    const people = labels
      .filter((candidate) => !query || candidate.label.toLocaleLowerCase().includes(query) || candidate.detail.toLocaleLowerCase().includes(query))
      .map((candidate) => ({ ...candidate, all: false, self: candidate.id === currentUserId }));
    return [...all, ...people].slice(0, 9);
  }, [trigger, labels, currentUserId, locale, t]);

  const hasUnsaved = form.author !== baseline.author ||
    form.summary !== baseline.summary ||
    form.notes !== baseline.notes ||
    level !== baseline.level;
  const latestVersion = initialLog?.id === baseline.id &&
    initialLog.revision !== undefined && baseline.revision !== undefined && initialLog.revision > baseline.revision
    ? initialLog : null;

  const requestClose = (): void => {
    if (savingRef.current) return;
    if (hasUnsaved) setConfirmDiscard(true);
    else onBack();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || notice || confirmDiscard || replacementCandidate || composingRef.current || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      if (trigger) setTrigger(null);
      else requestClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  });

  const fieldRefs: Record<Field, React.RefObject<HTMLInputElement | HTMLTextAreaElement>> = {
    author: authorRef,
    summary: summaryRef,
    notes: notesRef
  };

  // The mention list is portalled to <body> and positioned against the
  // viewport, because the dialog body scrolls and would otherwise clip an
  // absolutely-positioned list drawn inside it.
  const syncSuggestRect = (field: Field): void => {
    const element = fieldRefs[field].current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const MENU_MAX = 256;
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < MENU_MAX && rect.top > spaceBelow;
    setSuggestRect({
      top: above ? rect.top - 8 : rect.bottom + 8,
      left: rect.left,
      width: rect.width,
      above
    });
  };

  useEffect(() => {
    if (!trigger) {
      setSuggestRect(null);
      return;
    }
    const reposition = (): void => syncSuggestRect(trigger.field);
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [trigger?.field, options.length]);

  const updateTrigger = (field: Field, value: string, caret: number): void => {
    setTrigger(findTrigger(field, value, caret));
    setActiveOption(0);
  };

  const onChange = (field: Field, element: HTMLInputElement | HTMLTextAreaElement): void => {
    setForm((current) => ({ ...current, [field]: element.value }));
    if (!composingRef.current) updateTrigger(field, element.value, element.selectionStart ?? element.value.length);
  };

  const selectOption = (option: MentionOption): void => {
    if (!trigger || fieldsLocked || savingRef.current) return;
    const field = trigger.field;
    const replacement = `@${option.label} `;
    const nextCaret = trigger.start + replacement.length;
    setForm((current) => ({
      ...current,
      [field]: current[field].slice(0, trigger.start) + replacement + current[field].slice(trigger.end)
    }));
    setTrigger(null);
    requestAnimationFrame(() => {
      const element = field === 'author' ? authorRef.current : field === 'summary' ? summaryRef.current : notesRef.current;
      element?.focus();
      element?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleFieldKeyDown = (event: React.KeyboardEvent, field: Field): void => {
    if (!trigger || trigger.field !== field || composingRef.current || event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveOption((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % Math.max(options.length, 1));
    } else if (event.key === 'Enter' && options.length > 0) {
      event.preventDefault();
      selectOption(options[activeOption] ?? options[0]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setTrigger(null);
    }
  };

  const onCompositionEnd = (field: Field, element: HTMLInputElement | HTMLTextAreaElement): void => {
    composingRef.current = false;
    window.setTimeout(() => updateTrigger(field, element.value, element.selectionStart ?? element.value.length), 0);
  };

  const renderSuggestions = (field: Field) => {
    if (!(trigger?.field === field && !fieldsLocked && !saving && !candidatesLoading && !candidatesError && options.length > 0 && suggestRect)) return null;
    return createPortal(
      <div
        role="listbox"
        aria-label={t('Mention a teammate')}
        style={{
          position: 'fixed',
          top: suggestRect.above ? undefined : suggestRect.top,
          bottom: suggestRect.above ? window.innerHeight - suggestRect.top : undefined,
          left: suggestRect.left,
          width: suggestRect.width,
          zIndex: 4000
        }}
        className="max-h-64 overflow-y-auto rounded-2xl border border-white/80 bg-white/95 p-1.5 shadow-2xl shadow-slate-900/15 backdrop-blur-xl"
      >
        {options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            role="option"
            aria-selected={index === activeOption}
            onMouseDown={(event) => { event.preventDefault(); selectOption(option); }}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${index === activeOption ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'}`}
          >
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${option.all ? 'bg-slate-900 text-white' : 'bg-indigo-100 text-indigo-700'}`}>
              {option.all ? '@' : option.label.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{option.all ? t('Everyone') : option.label}</span>
            {option.detail && <span className="truncate text-xs text-slate-400">{option.detail}</span>}
            {option.self && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">{t('You')}</span>}
          </button>
        ))}
      </div>,
      document.body
    );
  };

  const handleSave = async (reviewedBaseline?: WorkLog): Promise<void> => {
    if (fieldsLocked || savingRef.current || composingRef.current) return;
    if (saveError === 'missing' || (saveError === 'conflict' && !reviewedBaseline)) return;
    if (!form.author.trim()) {
      setNotice({ title: t('Key objective required'), message: t('Add a short objective before publishing this entry.') });
      return;
    }
    const text = `${form.author}\n${form.summary}\n${form.notes}`;
    if (projectId && text.includes('@') && (candidatesLoading || candidatesError)) {
      setNotice({ title: t('Team list unavailable'), message: t('Wait for the task members to load before saving a mention.') });
      return;
    }
    const mentionAll = hasMention(text, '所有人') || hasMention(text, 'everyone');
    const mentionedUserIds = labels.filter((candidate) => hasMention(text, candidate.label)).map((candidate) => candidate.id);
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    if (reviewedBaseline) setBaseline(reviewedBaseline);
    try {
      await onSave(buildCardSave(reviewedBaseline ?? baseline, form, level, { mentionAll, mentionedUserIds }));
    } catch (error) {
      if (error instanceof ApiError) {
        // entry_locked is its own 409: telling the user "someone edited this"
        // would send them into the wrong conflict flow.
        setSaveError(error.code === 'entry_locked' ? 'locked' :
          error.code === 'revision_conflict' || error.status === 409 ? 'conflict' :
          error.status === 401 ? 'session' : error.status === 403 ? 'forbidden' : error.status === 404 ? 'missing' : 'network');
      } else setSaveError('network');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const errorMessages: Record<SaveError, string> = {
    conflict: t('This card changed while you were editing. Your draft is safe.'),
    session: t('Your session has expired. Sign in again to save this draft.'),
    forbidden: t('You no longer have permission to edit this card. Your draft is still here.'),
    missing: t('This card is no longer available. Your draft is still here.'),
    network: t('Your draft is safe. Check your connection and try again.'),
    locked: t('This card was locked by a teammate. Your draft is safe.')
  };

  const levels: Array<{ value: LogLevel; label: string; hint: string; dot: string }> = [
    { value: 1, label: t('Milestone'), hint: t('Major deadline'), dot: 'bg-amber-400' },
    { value: 2, label: t('Phase checkpoint'), hint: t('Stage goal'), dot: 'bg-indigo-500' },
    { value: 3, label: t('Task detail'), hint: t('Execution detail'), dot: 'bg-slate-400' }
  ];
  const formatDate = (date: string): string => new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  const dateLabel = formatDate(baseline.weekStartDate);

  return (
    <div ref={overlayRef} className="sp-modal-backdrop fixed inset-0 z-[3000] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-lg sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }} onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      const dialogs = overlayRef.current?.querySelectorAll<HTMLElement>('[role="dialog"]');
      const activeDialog = dialogs?.[dialogs.length - 1] ?? dialogRef.current;
      const focusables = Array.from(activeDialog?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])
        .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
      if (!focusables.length) { event.preventDefault(); activeDialog?.focus(); return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const focused = document.activeElement;
      if (event.shiftKey && (focused === first || !focusables.includes(focused as HTMLElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (focused === last || !focusables.includes(focused as HTMLElement))) { event.preventDefault(); first.focus(); }
    }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="sp-dialog flex max-h-[min(90vh,820px)] w-full max-w-[780px] flex-col overflow-hidden rounded-[2rem] border border-white/70 bg-white/90 shadow-[0_32px_100px_-24px_rgba(15,23,42,0.45)] backdrop-blur-2xl outline-none"
        onFocusCapture={(event) => { if (event.target instanceof HTMLElement) lastEditorFocusRef.current = event.target; }}
      >
        <header className="sp-dialog-header flex shrink-0 items-start justify-between gap-4 px-6 py-5 sm:px-8">
          <div>
            <p className="sp-metadata">{dateLabel}</p>
            <h2 id={titleId} className="mt-1 text-xl font-bold tracking-tight">{existingCardRef.current ? t('Edit card') : t('New card')}</h2>
          </div>
          <button type="button" onClick={requestClose} disabled={saving} className="sp-icon-button flex items-center justify-center transition-colors disabled:opacity-50" aria-label={t('Close dialog')}>
            <i className="fas fa-times text-sm" />
          </button>
        </header>

        <div className="space-y-6 overflow-y-auto px-5 py-6 sm:px-8">
          {locked && <section role="status" className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-100/80 p-4 text-sm text-slate-700">
            <i className="fas fa-lock mt-0.5 text-xs text-slate-500" />
            <div>
              <p className="font-semibold text-slate-900">{t('This card is locked')}</p>
              <p className="mt-1 leading-6 text-slate-600">{t('Locked cards cannot be moved, edited, or deleted. Unlock it from the timeline to make changes.')}</p>
            </div>
          </section>}
          {saveError && <section role="alert" className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-950">
            <p className="font-semibold">{saveError === 'conflict' ? errorMessages.conflict : t('Could not save this card')}</p>
            <p className="mt-1 leading-6 text-amber-900/80">{saveError === 'conflict' ? t('Review the latest version before replacing it with your draft.') : errorMessages[saveError]}</p>
            {saveError === 'locked' && <p className="mt-2 text-xs leading-5">{t('A teammate locked this card while you were editing. Close the dialog to see its locked version.')}</p>}
            {saveError === 'conflict' && (latestVersion ? <div className="mt-3 rounded-xl border border-amber-200/75 bg-white/75 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span className="font-semibold">{t('Latest saved version')}</span><span>{formatDate(latestVersion.weekStartDate)} · {levels.find((option) => option.value === latestVersion.level)?.label}</span></div>
              <div className="max-h-40 space-y-2 overflow-y-auto whitespace-pre-wrap break-words text-slate-700"><p className="font-semibold text-slate-900">{latestVersion.author}</p>{latestVersion.summary && <p><span className="font-semibold">{t('Overview')}: </span>{latestVersion.summary}</p>}{latestVersion.notes && <p><span className="font-semibold">{t('Details')}: </span>{latestVersion.notes}</p>}</div>
              <button type="button" disabled={fieldsLocked || saving} onClick={() => setReplacementCandidate(captureCardBaseline(latestVersion.weekStartDate, latestVersion))} className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">{t('Replace with my draft')}</button>
            </div> : <p className="mt-2 text-xs leading-5">{t('The latest version is unavailable. Refresh the task before trying again.')}</p>)}
          </section>}
          <section>
            <label className="mb-2 block text-xs font-bold text-slate-600" htmlFor={`${titleId}-name`}>{t('Card title')}</label>
            <div className="relative">
              <input
                id={`${titleId}-name`}
                ref={authorRef}
                value={form.author}
                onChange={(event) => onChange('author', event.currentTarget)}
                onSelect={(event) => !composingRef.current && updateTrigger('author', event.currentTarget.value, event.currentTarget.selectionStart ?? 0)}
                onKeyDown={(event) => handleFieldKeyDown(event, 'author')}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={(event) => onCompositionEnd('author', event.currentTarget)}
                readOnly={fieldsLocked || saving}
                placeholder={t('e.g. Launch MVP')}
                className="w-full rounded-2xl border border-slate-200 bg-white/75 px-4 py-3.5 text-base font-semibold text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
              />
              {renderSuggestions('author')}
            </div>
          </section>

          <section>
            <p className="mb-2 text-xs font-bold text-slate-600">{t('Timeline level')}</p>
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-100/85 p-1.5">
              {levels.map((option) => (
                <button key={option.value} type="button" disabled={fieldsLocked || saving} onClick={() => setLevel(option.value)} className={`rounded-xl px-2 py-2.5 text-left transition-all sm:px-3 ${level === option.value ? 'bg-white shadow-sm ring-1 ring-slate-200/80' : 'hover:bg-white/55'}`} aria-pressed={level === option.value}>
                  <span className="flex items-center gap-2 text-xs font-bold text-slate-800"><span className={`h-2 w-2 rounded-full ${option.dot}`} />{option.label}</span>
                  <span className="mt-1 block pl-4 text-[11px] text-slate-400">{option.hint}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="grid gap-5 sm:grid-cols-2">
            {(['summary', 'notes'] as const).map((field) => (
              <section key={field}>
                <label className="mb-2 block text-xs font-bold text-slate-600" htmlFor={`${titleId}-${field}`}>{field === 'summary' ? t('Overview') : t('Details')}</label>
                <div className="relative">
                  <textarea
                    id={`${titleId}-${field}`}
                    ref={field === 'summary' ? summaryRef : notesRef}
                    value={form[field]}
                    onChange={(event) => onChange(field, event.currentTarget)}
                    onSelect={(event) => !composingRef.current && updateTrigger(field, event.currentTarget.value, event.currentTarget.selectionStart ?? 0)}
                    onKeyDown={(event) => handleFieldKeyDown(event, field)}
                    onCompositionStart={() => { composingRef.current = true; }}
                    onCompositionEnd={(event) => onCompositionEnd(field, event.currentTarget)}
                    readOnly={fieldsLocked || saving}
                    placeholder={field === 'summary' ? t('What needs to happen at this point?') : t('Add context, blockers, or owners…')}
                    className="min-h-[150px] w-full resize-y rounded-2xl border border-slate-200 bg-white/75 px-4 py-3.5 text-sm leading-6 text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                  />
                  {renderSuggestions(field)}
                </div>
              </section>
            ))}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-slate-200/80 bg-white/75 px-5 py-4 sm:px-8">
          <p className="text-xs text-slate-500"><span className="font-bold text-indigo-600">@</span> {t('Mention a teammate or everyone')}</p>
          <div className="flex items-center gap-2">
            {!fieldsLocked && <button type="button" onClick={() => void handleSave()} disabled={saving || saveError === 'conflict' || saveError === 'missing'} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-200 transition-colors hover:bg-indigo-700 disabled:opacity-60">{saving ? t('Saving…') : t('Save card')}</button>}
          </div>
        </footer>
      </div>
      <AppDialog open={notice !== null} title={notice?.title ?? ''} message={notice?.message} tone="warning" cancelLabel={t('Close')} onCancel={() => setNotice(null)} />
      <AppDialog open={confirmDiscard} title={t('Discard changes?')} message={t('Your edits to this card have not been saved.')} tone="warning" confirmLabel={t('Discard')} cancelLabel={t('Keep editing')} onConfirm={() => { setConfirmDiscard(false); onBack(); }} onCancel={() => setConfirmDiscard(false)} />
      <AppDialog open={replacementCandidate !== null} title={t('Replace latest card?')} message={t('The latest saved content will be replaced with your draft. This may overwrite a teammate’s changes.')} tone="warning" confirmLabel={t('Replace and save')} cancelLabel={t('Keep editing')} onConfirm={() => { const reviewed = replacementCandidate; setReplacementCandidate(null); if (reviewed) void handleSave(reviewed); }} onCancel={() => setReplacementCandidate(null)} />
    </div>
  );
};

export default LogEditor;
