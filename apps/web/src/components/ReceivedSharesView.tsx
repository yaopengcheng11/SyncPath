import React, { useEffect, useRef, useState } from 'react';
import type { PublicUser, ReceivedShare } from '@syncpath/api-client';
import { apiClient } from '../services/api';
import { LanguageSwitcher, useI18n } from '../i18n';
import { classifySharedContentError, startSharedContentPolling } from './sharedContentState';

interface ReceivedSharesSnapshot {
  userId: string;
  shares: ReceivedShare[] | null;
  busy: boolean;
  error: boolean;
}

const ReceivedSharesView: React.FC<{
  user: PublicUser;
  onOpenReceipt: (receiptId: string) => void;
  onExit: () => void;
  onSignOut: () => Promise<void>;
  onSessionExpired: () => void;
}> = ({ user, onOpenReceipt, onExit, onSignOut, onSessionExpired }) => {
  const { t, locale } = useI18n();
  const [snapshot, setSnapshot] = useState<ReceivedSharesSnapshot>({ userId: user.id, shares: null, busy: true, error: false });
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const [reload, setReload] = useState(0);
  const pollerRef = useRef<ReturnType<typeof startSharedContentPolling<ReceivedShare[]>> | null>(null);
  const signOutBusyRef = useRef(false);
  const sessionExpiredRef = useRef(onSessionExpired);
  sessionExpiredRef.current = onSessionExpired;

  useEffect(() => {
    const userId = user.id;
    setSnapshot({ userId, shares: null, busy: true, error: false });
    const poller = startSharedContentPolling<ReceivedShare[]>({
      load: async (signal) => {
        if (!navigator.onLine) throw new Error('Offline');
        return apiClient.listReceivedShares({ signal, expectedUserId: userId });
      },
      onData: (shares) => {
        if (navigator.onLine && !signOutBusyRef.current) setSnapshot({ userId, shares, busy: false, error: false });
      },
      onError: (error) => {
        setSnapshot({ userId, shares: null, busy: false, error: true });
        if (classifySharedContentError(error) === 'signin') sessionExpiredRef.current();
      },
      onBusy: (busy) => setSnapshot((current) => current.userId === userId ? { ...current, busy } : current),
      intervalMs: 15_000
    });
    pollerRef.current = poller;
    const offline = (): void => setSnapshot({ userId, shares: null, busy: false, error: true });
    const online = (): void => poller.refresh();
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, [user.id, reload]);

  const visible = snapshot.userId === user.id && !signingOut;
  const shares = visible ? snapshot.shares : null;
  const error = visible && snapshot.error;

  const leave = (): void => {
    pollerRef.current?.stop();
    setSnapshot({ userId: user.id, shares: null, busy: false, error: false });
    onExit();
  };

  const open = (share: ReceivedShare): void => {
    if (share.status !== 'active') return;
    pollerRef.current?.stop();
    setSnapshot({ userId: user.id, shares: null, busy: false, error: false });
    onOpenReceipt(share.id);
  };

  const signOut = async (): Promise<void> => {
    if (signOutBusyRef.current) return;
    signOutBusyRef.current = true;
    setSigningOut(true);
    setSignOutError(false);
    pollerRef.current?.stop();
    setSnapshot({ userId: user.id, shares: null, busy: false, error: false });
    try { await onSignOut(); }
    catch { setSignOutError(true); setReload((value) => value + 1); }
    finally { signOutBusyRef.current = false; setSigningOut(false); }
  };

  return <div className="flex min-h-screen flex-col bg-slate-50 text-slate-800">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-lg font-black text-white">S</span>
        <div className="min-w-0"><p className="text-xs font-bold text-indigo-600">SyncPath</p><h1 className="text-lg font-bold">{t('Received shares')}</h1></div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-2 max-w-[180px] truncate text-xs text-slate-500">{user.displayName || user.username}</span>
        <LanguageSwitcher compact />
        <button type="button" onClick={() => pollerRef.current?.refresh()} disabled={snapshot.busy || signingOut} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold hover:bg-slate-50 disabled:opacity-40">{t('Refresh')}</button>
        <button type="button" onClick={leave} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold hover:bg-slate-50">{t('Back to my projects')}</button>
        <button type="button" onClick={() => { void signOut(); }} disabled={signingOut} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{t('Sign Out')}</button>
      </div>
    </header>
    {signOutError && <p role="alert" className="m-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{t('Could not sign out. Please try again.')}</p>}
    <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-8">
      <p className="mb-6 text-sm leading-6 text-slate-500">{t('Shares you open while signed in are saved here. You can return at any time to view them.')}</p>
      {!shares ? <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center">
        {error ? <><span className="mb-4 text-2xl text-slate-400"><i className="fas fa-cloud" /></span><p role="alert" className="max-w-md text-sm leading-6 text-slate-600">{t('Could not load received shares. Please check your connection and try again.')}</p><button type="button" onClick={() => pollerRef.current?.refresh()} disabled={snapshot.busy} className="mt-5 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-40">{t('Retry')}</button></> : <p role="status" className="text-sm text-slate-500"><i className="fas fa-circle-notch fa-spin mr-2" />{t(signingOut ? 'Working…' : 'Loading received shares…')}</p>}
      </div> : shares.length === 0 ? <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center">
        <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-2xl text-indigo-500"><i className="fas fa-inbox" /></span>
        <h2 className="text-base font-bold">{t('No received shares yet.')}</h2>
        <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">{t('Open a sharing link from a colleague while signed in, and it will appear here.')}</p>
      </div> : <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shares.map((share) => <li key={share.id} className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-600"><i className={`fas ${share.kind === 'workspace' ? 'fa-folder' : 'fa-tasks'}`} />{t(share.kind === 'workspace' ? 'Project' : 'Task')}</span>
            <span className={`text-xs ${share.status === 'active' ? 'text-emerald-600' : 'text-slate-400'}`}>{t(share.status === 'active' ? 'Active · read only' : 'Unavailable')}</span>
          </div>
          <h2 className="break-words text-base font-bold text-slate-800">{share.name}</h2>
          {share.kind === 'project' && <p className="mt-2 break-words text-xs leading-5 text-slate-500">{t('In project: {{name}}', { name: share.workspaceName })}</p>}
          <p className="mt-4 break-words text-sm text-slate-600">{t('Shared by {{name}}', { name: share.sharedBy.displayName?.trim() && share.sharedBy.displayName.trim() !== share.sharedBy.username ? `${share.sharedBy.displayName.trim()} (${share.sharedBy.username})` : share.sharedBy.username })}</p>
          <p className="mt-2 text-xs leading-5 text-slate-400">{t('First received {{date}}', { date: new Date(share.receivedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US') })}</p>
          {share.status !== 'active' && <p className="mt-3 text-xs leading-5 text-slate-500">{t('This share is no longer available.')}</p>}
          <button type="button" onClick={() => open(share)} disabled={share.status !== 'active'} className="sp-button-secondary mt-5 w-full border border-slate-200 px-4 py-2 disabled:cursor-not-allowed disabled:opacity-40">{t('View share')}</button>
        </li>)}
      </ul>}
    </main>
  </div>;
};

export default ReceivedSharesView;
