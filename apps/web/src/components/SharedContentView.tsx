import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PublicEntry, PublicUser, SharedContent } from '@syncpath/api-client';
import { apiClient } from '../services/api';
import { LanguageSwitcher, useI18n } from '../i18n';
import Timeline from './Timeline';
import { classifySharedContentError, sharedContentScope, sharedEntriesToLogs, sharedProjectToTimeline, startSharedContentPolling, type SharedContentError, type SharedContentSource } from './sharedContentState';

interface SharedSnapshot {
  scope: string;
  content: SharedContent | null;
  busy: boolean;
  error: SharedContentError | null;
}

const errorKeys: Record<SharedContentError, string> = {
  signin: 'Your session has expired. Sign in again to view this share.',
  unavailable: 'This sharing link is unavailable or has been disabled.',
  network: 'Cannot check access right now. Shared content is hidden until the connection is restored.'
};

const SharedContentView: React.FC<{ source: SharedContentSource; user: PublicUser; onExit: () => void; onSignOut: () => Promise<void>; onSessionExpired: () => void }> = ({ source, user, onExit, onSignOut, onSessionExpired }) => {
  const { t } = useI18n();
  const scope = sharedContentScope(user.id, source);
  const [snapshot, setSnapshot] = useState<SharedSnapshot>({ scope, content: null, busy: true, error: null });
  const [selection, setSelection] = useState<{ scope: string; taskId: string | null; entryId: string | null }>({ scope, taskId: null, entryId: null });
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const [reload, setReload] = useState(0);
  const pollerRef = useRef<ReturnType<typeof startSharedContentPolling<SharedContent>> | null>(null);
  const signOutBusyRef = useRef(false);
  const sessionExpiredRef = useRef(onSessionExpired);
  sessionExpiredRef.current = onSessionExpired;
  const sourceKind = source.kind;
  const sourceId = source.kind === 'token' ? source.token : source.receiptId;

  useEffect(() => {
    setSnapshot({ scope, content: null, busy: true, error: null });
    setSelection({ scope, taskId: null, entryId: null });
    const poller = startSharedContentPolling<SharedContent>({
      load: async (signal) => {
        if (!navigator.onLine) throw new Error('Offline');
        const options = { signal, expectedUserId: user.id };
        return sourceKind === 'token' ? apiClient.resolveShareLink(sourceId, options) : apiClient.resolveReceivedShare(sourceId, options);
      },
      onData: (content) => {
        if (navigator.onLine && !signOutBusyRef.current) setSnapshot({ scope, content, busy: false, error: null });
      },
      onError: (error) => {
        const kind = classifySharedContentError(error);
        setSnapshot({ scope, content: null, busy: false, error: kind });
        if (kind === 'signin') sessionExpiredRef.current();
      },
      onBusy: (busy) => setSnapshot((current) => current.scope === scope ? { ...current, busy } : current)
    });
    pollerRef.current = poller;
    const offline = (): void => { setSnapshot({ scope, content: null, busy: false, error: 'network' }); };
    const online = (): void => { poller.refresh(); };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, [scope, sourceKind, sourceId, user.id, reload]);

  const content = snapshot.scope === scope && !signingOut ? snapshot.content : null;
  const error = snapshot.scope === scope ? snapshot.error : null;
  const task = content?.kind === 'project' ? content.projects[0] : content?.projects.find((project) => project.id === (selection.scope === scope ? selection.taskId : null));
  const entry = content && selection.scope === scope && task ? content.entries.find((item) => item.id === selection.entryId && item.projectId === task.id) : undefined;
  const logs = useMemo(() => task && content ? sharedEntriesToLogs(content.entries, task.id) : {}, [task, content]);
  const timelineProject = useMemo(() => task ? sharedProjectToTimeline(task) : null, [task]);

  const leave = (): void => {
    pollerRef.current?.stop();
    setSnapshot({ scope, content: null, busy: false, error: null });
    onExit();
  };

  const signOut = async (): Promise<void> => {
    if (signOutBusyRef.current) return;
    signOutBusyRef.current = true;
    setSigningOut(true);
    setSignOutError(false);
    pollerRef.current?.stop();
    setSnapshot({ scope, content: null, busy: false, error: null });
    try { await onSignOut(); }
    catch { setSignOutError(true); setReload((value) => value + 1); }
    finally { signOutBusyRef.current = false; setSigningOut(false); }
  };

  return <div className="flex min-h-screen flex-col bg-slate-50 text-slate-800">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-8">
      <div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-lg font-black text-white">S</span><div className="min-w-0"><p className="text-xs font-bold text-indigo-600">{t('Shared view · read only')}</p><h1 className="break-words text-lg font-bold">{content ? (task?.name ?? content.workspace.name) : t('Shared content')}</h1></div></div>
      <div className="flex flex-wrap items-center justify-end gap-2"><span className="mr-2 max-w-[180px] truncate text-xs text-slate-500">{user.displayName || user.username}</span><LanguageSwitcher compact /><button type="button" onClick={() => pollerRef.current?.refresh()} disabled={snapshot.busy || signingOut} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold hover:bg-slate-50 disabled:opacity-40">{t('Refresh')}</button><button type="button" onClick={leave} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold hover:bg-slate-50">{t('Exit shared view')}</button><button type="button" onClick={() => { void signOut(); }} disabled={signingOut} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{t('Sign Out')}</button></div>
    </header>
    {signOutError && <p role="alert" className="m-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{t('Could not sign out. Please try again.')}</p>}
    {!content ? <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-2xl text-indigo-500"><i className={`fas ${error ? 'fa-link' : 'fa-circle-notch fa-spin'}`} /></span>
      {error ? <><p role="alert" className="text-base leading-7 text-slate-600">{t(errorKeys[error])}</p><div className="mt-6 flex flex-wrap justify-center gap-3"><button type="button" onClick={() => pollerRef.current?.refresh()} disabled={snapshot.busy} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-40">{t('Retry')}</button>{error === 'signin' && <button type="button" onClick={() => { void signOut(); }} disabled={signingOut} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold">{t('Sign in again')}</button>}</div></> : <p role="status" className="text-sm text-slate-500">{t(signingOut ? 'Working…' : 'Loading shared content…')}</p>}
    </main> : task && timelineProject ? <main className="flex flex-1 flex-col p-3 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">{content.kind === 'workspace' && <button type="button" onClick={() => setSelection({ scope, taskId: null, entryId: null })} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold"><i className="fas fa-arrow-left mr-2" />{t('Back to tasks')}</button>}<p className="text-xs leading-5 text-slate-500">{t('You can view cards, but cannot add, edit, or move them.')}</p></div>
      {task.description && <p className="mb-4 whitespace-pre-wrap text-sm text-slate-600">{task.description}</p>}
      <Timeline key={`${scope}:${task.id}`} project={timelineProject} logs={logs} readOnly suspended={!!entry} className="min-h-[600px] flex-1" onSelectDate={(_date, entryId) => { if (entryId && content.entries.some((item) => item.id === entryId && item.projectId === task.id)) setSelection({ scope, taskId: task.id, entryId }); }} />
    </main> : <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-8">
      <p className="mb-6 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-700">{t('This project is shared for viewing only. Select a task to see its cards.')}</p>
      <h2 className="mb-4 text-lg font-bold">{t('Tasks')}</h2>
      {content.projects.length === 0 ? <p className="rounded-xl bg-white p-6 text-sm text-slate-500">{t('This project has no active tasks.')}</p> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{content.projects.map((project) => <button type="button" key={project.id} onClick={() => setSelection({ scope, taskId: project.id, entryId: null })} className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md"><span className="mb-4 block h-1.5 w-12 rounded-full" style={{ backgroundColor: project.color }} /><h3 className="break-words font-bold text-slate-800">{project.name}</h3>{project.description && <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-slate-500">{project.description}</p>}<p className="mt-4 text-xs text-slate-400">{project.startDate} → {project.endDate}</p><span className="mt-4 inline-block rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">{t('Read only')}</span></button>)}</div>}
    </main>}
    {entry && <ReadOnlyEntryDetails key={entry.id} entry={entry} onClose={() => setSelection((current) => ({ ...current, entryId: null }))} />}
  </div>;
};

const ReadOnlyEntryDetails: React.FC<{ entry: PublicEntry; onClose: () => void }> = ({ entry, onClose }) => {
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
      if (event.key === 'Tab') { event.preventDefault(); dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keydown); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);

  return <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <article ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] bg-white p-6 shadow-2xl outline-none sm:p-8">
      <header className="mb-6 flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-xs font-bold text-indigo-600">{t('Read only')}</p><h2 id={titleId} className="mt-2 break-words text-xl font-bold text-slate-900">{entry.title}</h2></div><button type="button" onClick={onClose} aria-label={t('Close dialog')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"><i className="fas fa-times" /></button></header>
      <dl className="mb-6 flex flex-wrap gap-6 text-sm"><div><dt className="text-xs text-slate-400">{t('Date')}</dt><dd className="mt-1 text-slate-700">{entry.weekStartDate}</dd></div><div><dt className="text-xs text-slate-400">{t('Status')}</dt><dd className="mt-1 text-slate-700">{t(entry.status === 'completed' ? 'Completed' : 'Pending')}</dd></div><div><dt className="text-xs text-slate-400">{t('Level')}</dt><dd className="mt-1 text-slate-700">{t(entry.level === 'primary' ? 'Primary' : entry.level === 'secondary' ? 'Secondary' : 'Minor')}</dd></div></dl>
      <section><h3 className="text-sm font-bold text-slate-800">{t('Summary')}</h3><p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm leading-7 text-slate-600">{entry.summary || t('No summary.')}</p></section>
      <section className="mt-6"><h3 className="text-sm font-bold text-slate-800">{t('Notes')}</h3><p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm leading-7 text-slate-600">{entry.notes || t('No notes.')}</p></section>
    </article>
  </div>;
};

export default SharedContentView;
