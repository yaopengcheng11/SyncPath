import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MentionTimelineItem, MentionTimelineResponse } from '@syncpath/api-client';
import { apiClient } from '../services/api';
import { useI18n } from '../i18n';
import Timeline from './Timeline';
import { classifySharedContentError, startSharedContentPolling, type SharedContentError } from './sharedContentState';
import { mentionSourceCaption, mentionedItemsToTimeline, mentionedTimelineItems, mentionsTimelineScope } from './mentionsTimelineState';

export interface MentionsTimelineViewProps {
  userId: string;
  onOpenEntry: (item: MentionTimelineItem) => void;
  onSessionExpired?: () => void;
}

interface MentionSnapshot {
  scope: string;
  content: MentionTimelineResponse | null;
  busy: boolean;
  error: SharedContentError | null;
}

const MentionsTimelineView: React.FC<MentionsTimelineViewProps> = ({ userId, onOpenEntry, onSessionExpired }) => {
  const { t } = useI18n();
  const [workspaceIds, setWorkspaceIds] = useState<string[] | null>(null);
  const scope = mentionsTimelineScope(userId, workspaceIds);
  const [snapshot, setSnapshot] = useState<MentionSnapshot>({ scope, content: null, busy: true, error: null });
  const [choices, setChoices] = useState<{ userId: string; items: MentionTimelineResponse['workspaces'] }>({ userId, items: [] });
  const [selection, setSelection] = useState<{ scope: string; entryId: string | null }>({ scope, entryId: null });
  const pollerRef = useRef<ReturnType<typeof startSharedContentPolling<MentionTimelineResponse>> | null>(null);
  const sessionExpiredRef = useRef(onSessionExpired);
  sessionExpiredRef.current = onSessionExpired;

  useEffect(() => {
    setSnapshot({ scope, content: null, busy: true, error: null });
    setSelection({ scope, entryId: null });
    const poller = startSharedContentPolling<MentionTimelineResponse>({
      load: (signal) => {
        if (!navigator.onLine) throw new Error('Offline');
        return apiClient.getMentionsTimeline({ workspaceIds: workspaceIds ?? undefined, expectedUserId: userId, signal });
      },
      onData: (content) => {
        if (!navigator.onLine) return;
        setSnapshot({ scope, content, busy: false, error: null });
        setChoices({ userId, items: content.workspaces });
      },
      onError: (error) => {
        const kind = classifySharedContentError(error);
        setSnapshot({ scope, content: null, busy: false, error: kind });
        setChoices({ userId, items: [] });
        setSelection({ scope, entryId: null });
        if (kind === 'signin') sessionExpiredRef.current?.();
      },
      onBusy: (busy) => setSnapshot((current) => current.scope === scope ? { ...current, busy } : current),
      intervalMs: 15_000
    });
    pollerRef.current = poller;
    const offline = (): void => {
      setSnapshot({ scope, content: null, busy: false, error: 'network' });
      setChoices({ userId, items: [] });
      setSelection({ scope, entryId: null });
    };
    const online = (): void => { poller.refresh(); };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
    // `scope` contains the normalized selection so changes cancel old requests.
  }, [scope, userId]);

  const content = snapshot.scope === scope ? snapshot.content : null;
  const error = snapshot.scope === scope ? snapshot.error : null;
  const busy = snapshot.scope !== scope || snapshot.busy;
  const available = choices.userId === userId ? choices.items : [];
  const items = useMemo(() => mentionedTimelineItems(content?.items ?? [], workspaceIds), [content, scope]);
  const timeline = useMemo(() => mentionedItemsToTimeline(items, userId, t('My mentions timeline')), [items, userId, t]);
  const selected = selection.scope === scope ? items.find((item) => item.entry.id === selection.entryId) : undefined;

  const toggleWorkspace = (id: string): void => {
    setWorkspaceIds((previous) => {
      const current = new Set(previous ?? available.map((workspace) => workspace.id));
      if (current.has(id)) current.delete(id); else current.add(id);
      return [...current].sort();
    });
  };

  return <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-50/50 px-4 py-5 sm:px-8 sm:py-6">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-xl font-bold tracking-tight text-slate-900">{t('My mentions timeline')}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{t('Cards that currently mention you, across the projects you can access.')}</p></div>
      <button type="button" onClick={() => pollerRef.current?.refresh()} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-indigo-200 hover:text-indigo-600 disabled:opacity-40"><i className={`fas ${busy ? 'fa-circle-notch fa-spin' : 'fa-sync-alt'}`} aria-hidden="true" />{t('Refresh')}</button>
    </div>
    <section aria-label={t('Filter projects')} className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-2"><span className="mr-2 text-xs font-semibold text-slate-500">{t('Projects')}</span><button type="button" onClick={() => setWorkspaceIds(null)} aria-pressed={workspaceIds === null} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${workspaceIds === null ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-indigo-50'}`}>{t('All projects')}</button>{available.map((workspace) => <label key={workspace.id} className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${workspaceIds === null || workspaceIds.includes(workspace.id) ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500'}`}><input type="checkbox" checked={workspaceIds === null || workspaceIds.includes(workspace.id)} onChange={() => toggleWorkspace(workspace.id)} className="h-3.5 w-3.5 accent-indigo-600" /><span className="max-w-[220px] truncate">{workspace.name}</span></label>)}</div>
      {workspaceIds !== null && workspaceIds.length === 0 && <p className="mt-3 text-xs text-slate-500">{t('Select at least one project to see your mentions.')}</p>}
    </section>
    {error ? <div role="alert" className="flex min-h-[360px] flex-1 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 text-center"><i className="fas fa-at mb-4 text-2xl text-slate-300" aria-hidden="true" /><p className="max-w-md text-sm leading-7 text-slate-500">{t(error === 'signin' ? 'Your session has expired. Sign in again.' : error === 'unavailable' ? 'These mentions are no longer available.' : 'Cannot check access right now. Mentioned content is hidden until the connection is restored.')}</p><button type="button" onClick={() => pollerRef.current?.refresh()} disabled={busy} className="mt-5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{t('Retry')}</button></div>
      : !content ? <div role="status" className="flex min-h-[360px] flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm text-slate-500"><i className="fas fa-circle-notch fa-spin mr-2" aria-hidden="true" />{t('Loading mentioned cards…')}</div>
      : !timeline.project ? <div className="flex min-h-[360px] flex-1 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 text-center"><span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-xl font-bold text-indigo-400">@</span><h2 className="text-base font-semibold text-slate-700">{t('No mentioned cards in these projects.')}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{t('When a card mentions you or everyone, it will appear here.')}</p></div>
      : <><div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><p>{t('{{count}} mentioned cards', { count: items.length })}</p><span>{t('Read only · Open a card to go to its task')}</span></div><div className="flex min-h-[580px] flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white"><Timeline key={scope} project={timeline.project} logs={timeline.logs} readOnly autoScale suspended={!!selected} className="min-h-[580px] flex-1" onSelectDate={(_date, entryId) => { if (entryId && items.some((item) => item.entry.id === entryId)) setSelection({ scope, entryId }); }} /></div>
        <section className="mt-5" aria-label={t('Mentioned cards')}><h2 className="mb-3 text-sm font-semibold text-slate-600">{t('Mentioned cards')}</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <button key={item.entry.id} type="button" onClick={() => setSelection({ scope, entryId: item.entry.id })} className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-indigo-300 hover:shadow-sm"><p className="mb-2 truncate text-xs text-slate-400">{mentionSourceCaption(item)}</p><h3 className="break-words text-sm font-semibold text-slate-800">{item.entry.title}</h3><p className="mt-2 text-xs text-slate-500">{item.entry.weekStartDate} · {t(item.entry.status === 'completed' ? 'Completed' : 'Pending')}</p></button>)}</div></section></>}
    {selected && <MentionDetails key={`${scope}:${selected.entry.id}`} item={selected} onClose={() => setSelection({ scope, entryId: null })} onOpen={() => onOpenEntry(selected)} />}
  </main>;
};

const MentionDetails: React.FC<{ item: MentionTimelineItem; onClose: () => void; onOpen: () => void }> = ({ item, onClose, onOpen }) => {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const keydown = (event: KeyboardEvent): void => {
      if (!dialogRef.current?.contains(document.activeElement) || event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const buttons = [...dialogRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
      const first = buttons[0]; const last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keydown); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  const entry = item.entry;
  return <div className="fixed inset-0 z-[3100] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><article ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl outline-none sm:p-8"><header className="mb-6 flex items-start justify-between gap-4"><div className="min-w-0"><p className="break-words text-xs font-semibold text-indigo-600">{mentionSourceCaption(item)}</p><h2 id={titleId} className="mt-2 break-words text-xl font-bold text-slate-900">{entry.title}</h2></div><button type="button" onClick={onClose} aria-label={t('Close dialog')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><i className="fas fa-times" aria-hidden="true" /></button></header><dl className="mb-6 flex flex-wrap gap-6 text-sm"><div><dt className="text-xs text-slate-400">{t('Date')}</dt><dd className="mt-1 text-slate-700">{entry.weekStartDate}</dd></div><div><dt className="text-xs text-slate-400">{t('Status')}</dt><dd className="mt-1 text-slate-700">{t(entry.status === 'completed' ? 'Completed' : 'Pending')}</dd></div><div><dt className="text-xs text-slate-400">{t('Level')}</dt><dd className="mt-1 text-slate-700">{t(entry.level === 'primary' ? 'Milestone' : entry.level === 'secondary' ? 'Phase checkpoint' : 'Task detail')}</dd></div></dl><section><h3 className="text-sm font-semibold text-slate-800">{t('Summary')}</h3><p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm leading-7 text-slate-600">{entry.summary || t('No summary.')}</p></section><section className="mt-5"><h3 className="text-sm font-semibold text-slate-800">{t('Notes')}</h3><p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm leading-7 text-slate-600">{entry.notes || t('No notes.')}</p></section><footer className="mt-7 flex justify-end"><button type="button" onClick={onOpen} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">{t('Open original card')}<i className="fas fa-arrow-right text-xs" aria-hidden="true" /></button></footer></article></div>;
};

export default MentionsTimelineView;
