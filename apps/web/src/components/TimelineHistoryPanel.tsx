import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PublicEntry, TimelineChange, TimelineVersionDetail, TimelineVersionsPage } from '@syncpath/api-client';
import { apiClient } from '../services/api';
import { useI18n } from '../i18n';
import Timeline from './Timeline';
import { classifySharedContentError, sharedEntriesToLogs, startSharedContentPolling, type SharedContentError } from './sharedContentState';
import { appendTimelineVersionPage, mergeTimelineVersionPages } from './timelineHistoryState';

export interface TimelineHistoryPanelProps {
  projectId: string;
  projectName?: string;
  userId: string;
  onClose: () => void;
  onSessionExpired?: () => void;
}

interface HistorySnapshot {
  scope: string;
  page: TimelineVersionsPage | null;
  busy: boolean;
  error: SharedContentError | null;
}

const ACTION_KEYS: Record<string, string> = {
  baseline: 'Initial timeline snapshot',
  'entry.created': 'Added a card',
  'entry.updated': 'Updated a card',
  'entry.deleted': 'Deleted a card',
  'entry.imported': 'Imported cards',
  'project.updated': 'Updated task settings',
  'project.deleted': 'Deleted the task'
};

const FIELD_KEYS: Record<string, string> = {
  title: 'Title', name: 'Task name', description: 'Description', weekStartDate: 'Date',
  startDate: 'Start Date', endDate: 'End Date', summary: 'Summary', notes: 'Notes',
  status: 'Status', level: 'Level', isLocked: 'Card lock', mentionAll: 'Mention everyone',
  mentionedUserIds: 'Mentioned people', color: 'Color', visibility: 'Visibility',
  holidayRegion: 'Holiday region', created: 'Added card', deleted: 'Deleted card',
  deletedAt: 'Deleted', entries: 'Cards'
};

const TimelineHistoryPanel: React.FC<TimelineHistoryPanelProps> = ({ projectId, projectName, userId, onClose, onSessionExpired }) => {
  const { t, locale } = useI18n();
  const scope = JSON.stringify([userId, projectId]);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const sessionExpiredRef = useRef(onSessionExpired);
  sessionExpiredRef.current = onSessionExpired;
  const [snapshot, setSnapshot] = useState<HistorySnapshot>({ scope, page: null, busy: true, error: null });
  const [selection, setSelection] = useState<{ scope: string; versionId: string | null }>({ scope, versionId: null });
  const [detailState, setDetailState] = useState<{ scope: string; versionId: string | null; detail: TimelineVersionDetail | null; busy: boolean; error: SharedContentError | null }>({ scope, versionId: null, detail: null, busy: false, error: null });
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [detailReload, setDetailReload] = useState(0);
  const pollerRef = useRef<ReturnType<typeof startSharedContentPolling<TimelineVersionsPage>> | null>(null);
  const pagingRef = useRef<AbortController | null>(null);
  const liveScopeRef = useRef(scope);
  liveScopeRef.current = scope;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    const keydown = (event: KeyboardEvent): void => {
      if (!panelRef.current?.contains(document.activeElement) || event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const controls = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]')];
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keydown); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);

  useEffect(() => {
    setSnapshot({ scope, page: null, busy: true, error: null });
    setSelection({ scope, versionId: null });
    setDetailState({ scope, versionId: null, detail: null, busy: false, error: null });
    setSelectedEntryId(null);
    setMoreError(false);
    const hide = (error: unknown): void => {
      const kind = classifySharedContentError(error);
      pagingRef.current?.abort();
      setSnapshot({ scope, page: null, busy: false, error: kind });
      setSelection({ scope, versionId: null });
      setDetailState({ scope, versionId: null, detail: null, busy: false, error: kind });
      setSelectedEntryId(null);
      if (kind === 'signin') sessionExpiredRef.current?.();
    };
    const poller = startSharedContentPolling<TimelineVersionsPage>({
      load: (signal) => {
        if (!navigator.onLine) throw new Error('Offline');
        return apiClient.listTimelineVersions(projectId, { signal, expectedUserId: userId, limit: 20 });
      },
      onData: (page) => {
        if (!navigator.onLine) return;
        setSnapshot((current) => ({ scope, page: current.scope === scope && current.page ? mergeTimelineVersionPages(current.page, page) : page, busy: false, error: null }));
        setSelection((current) => current.scope !== scope || current.versionId === null ? { scope, versionId: page.items[0]?.id ?? null } : current);
      },
      onError: hide,
      onBusy: (busy) => setSnapshot((current) => current.scope === scope ? { ...current, busy } : current),
      intervalMs: 15_000
    });
    pollerRef.current = poller;
    const offline = (): void => hide(new Error('Offline'));
    const online = (): void => { poller.refresh(); };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      poller.stop();
      pagingRef.current?.abort();
      if (pollerRef.current === poller) pollerRef.current = null;
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, [scope, projectId, userId]);

  const page = snapshot.scope === scope ? snapshot.page : null;
  const listError = snapshot.scope === scope ? snapshot.error : null;
  const versionId = selection.scope === scope ? selection.versionId : null;
  useEffect(() => {
    setSelectedEntryId(null);
    if (!versionId || !page) { setDetailState({ scope, versionId, detail: null, busy: false, error: null }); return; }
    let live = true;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 10_000);
    setDetailState({ scope, versionId, detail: null, busy: true, error: null });
    void apiClient.getTimelineVersion(projectId, versionId, { signal: controller.signal, expectedUserId: userId }).then((detail) => {
      if (live && !controller.signal.aborted && navigator.onLine) setDetailState({ scope, versionId, detail, busy: false, error: null });
    }).catch((error: unknown) => {
      if (!live) return;
      const kind = classifySharedContentError(error);
      setDetailState({ scope, versionId, detail: null, busy: false, error: kind });
      if (kind === 'signin' || kind === 'unavailable') {
        pagingRef.current?.abort();
        setSnapshot({ scope, page: null, busy: false, error: kind });
        if (kind === 'signin') sessionExpiredRef.current?.();
      }
    }).finally(() => clearTimeout(deadline));
    return () => { live = false; clearTimeout(deadline); controller.abort(); };
    // Immutable snapshots need reloading only on version selection, or after access was lost.
  }, [scope, versionId, !!page, projectId, userId, detailReload]);

  const detail = page && detailState.scope === scope && detailState.versionId === versionId ? detailState.detail : null;
  const detailError = detailState.scope === scope && detailState.versionId === versionId ? detailState.error : null;
  const logs = useMemo(() => detail ? sharedEntriesToLogs(detail.snapshot.entries, projectId) : {}, [detail, projectId]);
  const timelineProject = useMemo(() => detail ? { ...detail.snapshot.project, description: detail.snapshot.project.description ?? '', holidayRegion: 'NONE' as const } : null, [detail]);
  const selectedEntry = detail?.snapshot.entries.find((entry) => entry.id === selectedEntryId);
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }), [locale]);
  const formatTime = (value: string): string => { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : formatter.format(date); };
  const errorMessage = (error: SharedContentError): string => t(error === 'signin' ? 'Your session has expired. Sign in again.' : error === 'unavailable' ? 'You no longer have access to this timeline history.' : 'Cannot check access right now. Timeline history is hidden until the connection is restored.');

  const loadMore = async (): Promise<void> => {
    if (!page || page.nextBeforeVersion === null || pagingRef.current) return;
    const beforeVersion = page.nextBeforeVersion;
    const controller = new AbortController();
    pagingRef.current = controller;
    const deadline = setTimeout(() => controller.abort(), 10_000);
    setLoadingMore(true);
    setMoreError(false);
    try {
      const older = await apiClient.listTimelineVersions(projectId, { beforeVersion, limit: 20, signal: controller.signal, expectedUserId: userId });
      if (controller.signal.aborted || liveScopeRef.current !== scope || !navigator.onLine) return;
      setSnapshot((current) => current.scope === scope && current.page?.nextBeforeVersion === beforeVersion ? { ...current, page: appendTimelineVersionPage(current.page, older) } : current);
    } catch (error) {
      if (controller.signal.aborted || liveScopeRef.current !== scope) return;
      const kind = classifySharedContentError(error);
      if (kind === 'signin' || kind === 'unavailable') {
        setSnapshot({ scope, page: null, busy: false, error: kind });
        setDetailState({ scope, versionId: null, detail: null, busy: false, error: kind });
        if (kind === 'signin') sessionExpiredRef.current?.();
      } else if (!controller.signal.aborted) setMoreError(true);
    } finally {
      clearTimeout(deadline);
      if (pagingRef.current === controller) { pagingRef.current = null; setLoadingMore(false); }
    }
  };

  return <div className="sp-modal-backdrop fixed inset-0 z-[3000] flex justify-end bg-slate-950/40 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="sp-side-panel flex h-full w-full max-w-[1180px] flex-col bg-white shadow-2xl outline-none">
    <header className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7"><div className="min-w-0"><h2 id={titleId} className="text-xl font-bold tracking-tight text-slate-900">{t('Timeline history')}</h2>{(projectName || detail?.snapshot.project.name) && <p className="mt-1 truncate text-sm text-slate-500">{projectName || detail?.snapshot.project.name}</p>}</div><div className="flex shrink-0 items-center gap-2"><button type="button" onClick={() => pollerRef.current?.refresh()} disabled={snapshot.busy} aria-label={t('Refresh history')} title={t('Refresh history')} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><i className={`fas ${snapshot.busy ? 'fa-circle-notch fa-spin' : 'fa-sync-alt'}`} aria-hidden="true" /></button><button type="button" onClick={onClose} aria-label={t('Close timeline history')} className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200"><i className="fas fa-times" aria-hidden="true" /></button></div></header>
    <p className="border-b border-indigo-100 bg-indigo-50/70 px-5 py-3 text-xs leading-6 text-indigo-700 sm:px-7">{t('History starts with the recorded baseline. Earlier edits cannot be reconstructed.')}</p>
    {listError ? <div role="alert" className="flex flex-1 flex-col items-center justify-center px-6 text-center"><i className="fas fa-history mb-4 text-2xl text-slate-300" aria-hidden="true" /><p className="max-w-md text-sm leading-7 text-slate-500">{errorMessage(listError)}</p><button type="button" onClick={() => pollerRef.current?.refresh()} disabled={snapshot.busy} className="mt-5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{t('Retry')}</button></div>
      : !page ? <div role="status" className="flex flex-1 items-center justify-center text-sm text-slate-500"><i className="fas fa-circle-notch fa-spin mr-2" aria-hidden="true" />{t('Loading timeline history…')}</div>
      : page.items.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center p-6 text-center"><i className="fas fa-history mb-4 text-2xl text-slate-300" aria-hidden="true" /><h3 className="text-base font-semibold text-slate-700">{t('No recorded versions yet.')}</h3><p className="mt-2 max-w-md text-sm leading-7 text-slate-500">{t('The next timeline change will save a baseline and its first version.')}</p></div>
      : <div className="grid min-h-0 flex-1 grid-rows-[minmax(150px,28vh)_1fr] md:grid-cols-[280px_minmax(0,1fr)] md:grid-rows-1"><nav aria-label={t('Timeline versions')} className="overflow-y-auto border-b border-slate-200 bg-slate-50/70 p-3 md:border-b-0 md:border-r"><ol className="space-y-2">{page.items.map((version) => <li key={version.id}><button type="button" onClick={() => setSelection({ scope, versionId: version.id })} aria-current={version.id === versionId ? 'true' : undefined} className={`w-full rounded-xl border p-3.5 text-left transition ${version.id === versionId ? 'border-indigo-200 bg-white shadow-sm' : 'border-transparent hover:border-slate-200 hover:bg-white'}`}><div className="mb-2 flex items-center justify-between gap-2"><span className={`text-xs font-bold ${version.id === versionId ? 'text-indigo-600' : 'text-slate-500'}`}>{version.version === 0 ? t('Baseline') : t('Version {{number}}', { number: version.version })}</span>{version.id === page.items[0].id && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600">{t('Latest')}</span>}</div><p className="text-sm font-semibold text-slate-700">{t(ACTION_KEYS[version.action] ?? version.action)}</p><p className="mt-2 truncate text-xs text-slate-500">{version.actor ? version.actor.displayName || `@${version.actor.username}` : t('Baseline snapshot')}</p><time dateTime={version.createdAt} className="mt-1 block text-[11px] leading-5 text-slate-400">{formatTime(version.createdAt)}</time></button></li>)}</ol>{moreError && <p role="alert" className="mt-3 text-xs leading-6 text-red-600">{t('Could not load older versions. Try again.')}</p>}{page.nextBeforeVersion !== null && <button type="button" onClick={() => { void loadMore(); }} disabled={loadingMore} className="mt-3 w-full rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-semibold text-slate-600 hover:border-indigo-200 disabled:opacity-40">{loadingMore ? t('Loading…') : t('Load older versions')}</button>}</nav>
        <main className="min-w-0 overflow-y-auto p-5 sm:p-6">{detailError ? <div role="alert" className="flex min-h-[320px] flex-col items-center justify-center text-center"><p className="max-w-md text-sm leading-7 text-slate-500">{errorMessage(detailError)}</p><button type="button" onClick={() => setDetailReload((value) => value + 1)} className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">{t('Retry')}</button></div> : !detail || !timelineProject ? <div role="status" className="flex min-h-[320px] items-center justify-center text-sm text-slate-500"><i className="fas fa-circle-notch fa-spin mr-2" aria-hidden="true" />{t('Loading version…')}</div> : <>
          <div className="mb-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold text-slate-900">{detail.version === 0 ? t('Baseline') : t('Version {{number}}', { number: detail.version })}</h3><span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">{t('Read only')}</span></div><p className="mt-2 text-sm text-slate-600">{detail.actor ? t('Changed by {{name}}', { name: detail.actor.displayName ? `${detail.actor.displayName} (@${detail.actor.username})` : `@${detail.actor.username}` }) : t('Initial timeline snapshot')}</p><time dateTime={detail.createdAt} className="mt-1 block text-xs text-slate-400">{formatTime(detail.createdAt)}</time></div>
          {detail.changes.length > 0 && <section className="mb-6" aria-label={t('What changed')}><h4 className="mb-3 text-sm font-semibold text-slate-700">{t('What changed')}</h4><div className="space-y-3">{detail.changes.map((change, index) => <HistoryChange key={`${change.entityId}:${change.field}:${index}`} change={change} />)}</div></section>}
          <section aria-label={t('Timeline at this version')}><div className="mb-3 flex items-center justify-between gap-3"><h4 className="text-sm font-semibold text-slate-700">{t('Timeline at this version')}</h4><p className="text-xs text-slate-400">{t('{{count}} cards', { count: detail.snapshot.entries.length })}</p></div><div className="overflow-hidden rounded-xl border border-slate-200"><Timeline key={`${scope}:${detail.id}`} project={timelineProject} logs={logs} readOnly autoScale className="h-[420px]" onSelectDate={(_date, entryId) => { if (entryId && detail.snapshot.entries.some((entry) => entry.id === entryId)) setSelectedEntryId(entryId); }} /></div></section>
          {selectedEntry && <HistoryEntryDetails entry={selectedEntry} onClose={() => setSelectedEntryId(null)} />}
          {detail.snapshot.entries.length > 0 && <section className="mt-5"><h4 className="mb-3 text-sm font-semibold text-slate-700">{t('Cards in this version')}</h4><div className="space-y-2">{detail.snapshot.entries.map((entry) => <button type="button" key={entry.id} onClick={() => setSelectedEntryId(entry.id)} className={`flex w-full items-start justify-between gap-4 rounded-xl border px-4 py-3 text-left text-sm transition ${selectedEntryId === entry.id ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 hover:border-indigo-200'}`}><span className="break-words font-medium text-slate-700">{entry.title}</span><time className="shrink-0 text-xs text-slate-400">{entry.weekStartDate}</time></button>)}</div></section>}
        </>}</main></div>}
  </section></div>;
};

const HistoryChange: React.FC<{ change: TimelineChange }> = ({ change }) => {
  const { t } = useI18n();
  const format = (value: string | null): string => {
    if (value === null || value === '') return t('Not set');
    if (change.field === 'isLocked') return t(value === 'true' ? 'Locked' : 'Unlocked');
    if (change.field === 'mentionAll') return t(value === 'true' ? 'Yes' : 'No');
    const labels: Record<string, string> = { completed: 'Completed', pending: 'Pending', primary: 'Milestone', secondary: 'Phase checkpoint', minor: 'Task detail', private: 'Task members only', workspace: 'All project members', active: 'Active', archived: 'Archived' };
    return ['status', 'level', 'visibility'].includes(change.field) ? t(labels[value] ?? value) : value;
  };
  return <article className="overflow-hidden rounded-xl border border-slate-200"><header className="border-b border-slate-100 bg-slate-50 px-4 py-2.5"><p className="break-words text-xs text-slate-500">{t(change.entity === 'task' ? 'Task' : 'Card')} · {change.title}</p><h5 className="mt-1 text-sm font-semibold text-slate-700">{t(FIELD_KEYS[change.field] ?? change.field)}</h5></header><div className="grid sm:grid-cols-2"><div className="border-b border-slate-100 px-4 py-3 sm:border-b-0 sm:border-r"><p className="mb-1.5 text-[11px] font-semibold text-red-500">{t('Before')}</p><p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{format(change.before)}</p></div><div className="px-4 py-3"><p className="mb-1.5 text-[11px] font-semibold text-emerald-600">{t('After')}</p><p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{format(change.after)}</p></div></div></article>;
};

const HistoryEntryDetails: React.FC<{ entry: PublicEntry; onClose: () => void }> = ({ entry, onClose }) => {
  const { t } = useI18n();
  return <section className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4"><header className="mb-3 flex items-start justify-between gap-3"><div><p className="text-xs text-indigo-500">{t('Card in this version')}</p><h4 className="mt-1 break-words text-base font-semibold text-slate-800">{entry.title}</h4></div><button type="button" onClick={onClose} aria-label={t('Close card details')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white"><i className="fas fa-times" aria-hidden="true" /></button></header><p className="mb-4 text-xs text-slate-500">{entry.weekStartDate} · {t(entry.status === 'completed' ? 'Completed' : 'Pending')} · {t(entry.level === 'primary' ? 'Milestone' : entry.level === 'secondary' ? 'Phase checkpoint' : 'Task detail')}</p><h5 className="text-xs font-semibold text-slate-600">{t('Summary')}</h5><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">{entry.summary || t('No summary.')}</p><h5 className="mt-4 text-xs font-semibold text-slate-600">{t('Notes')}</h5><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">{entry.notes || t('No notes.')}</p></section>;
};

export default TimelineHistoryPanel;
