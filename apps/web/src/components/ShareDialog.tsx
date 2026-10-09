import React, { useEffect, useId, useRef, useState } from 'react';
import type { ShareLinkMetadata } from '@syncpath/api-client';
import { apiClient } from '../services/api';
import { useI18n } from '../i18n';
import AppDialog from './AppDialog';
import { createShareUrl } from './sharedContentState';

export interface ShareTarget {
  kind: 'workspace' | 'project';
  id: string;
  name: string;
}

interface ShareState {
  scope: string;
  links: ShareLinkMetadata[];
  loading: boolean;
  busy: boolean;
  url: string;
  currentLinkId: string | null;
  error: string | null;
  copyStatus: 'copied' | 'manual' | null;
}

const ShareDialog: React.FC<{ target: ShareTarget; onClose: () => void }> = ({ target, onClose }) => {
  const { t } = useI18n();
  const scope = `${target.kind}:${target.id}`;
  const titleId = useId();
  const linkInputId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const leaseRef = useRef<{ scope: string; active: boolean; busy: boolean } | null>(null);
  const [state, setState] = useState<ShareState>({ scope, links: [], loading: true, busy: false, url: '', currentLinkId: null, error: null, copyStatus: null });
  const [confirmRevoke, setConfirmRevoke] = useState<ShareLinkMetadata | null>(null);
  const [reload, setReload] = useState(0);
  const visible = state.scope === scope ? state : { ...state, links: [], url: '', currentLinkId: null, loading: true, busy: false, error: null, copyStatus: null };

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!dialogRef.current?.contains(document.activeElement) || event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key === 'Tab') {
        const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]'));
        const first = items[0]; const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    const lease = { scope, active: true, busy: false };
    leaseRef.current = lease;
    setState((current) => current.scope === scope ? { ...current, loading: true, error: null } : { scope, links: [], loading: true, busy: false, url: '', currentLinkId: null, error: null, copyStatus: null });
    setConfirmRevoke(null);
    const load = target.kind === 'workspace' ? apiClient.listWorkspaceShareLinks(target.id) : apiClient.listProjectShareLinks(target.id);
    void load.then((links) => {
      if (lease.active) setState((current) => ({ ...current, links, loading: false }));
    }).catch(() => {
      if (lease.active) setState((current) => ({ ...current, loading: false, error: 'Could not load sharing links. Please try again.' }));
    });
    return () => { lease.active = false; };
  }, [scope, target.kind, target.id, reload]);

  const generate = async (): Promise<void> => {
    const lease = leaseRef.current;
    if (!lease?.active || lease.scope !== scope || lease.busy || visible.loading) return;
    lease.busy = true;
    setState((current) => ({ ...current, busy: true, error: null, copyStatus: null }));
    try {
      const created = target.kind === 'workspace' ? await apiClient.createWorkspaceShareLink(target.id) : await apiClient.createProjectShareLink(target.id);
      if (!lease.active) return;
      const url = createShareUrl(created.token, import.meta.env.VITE_SHARE_BASE_URL || `${window.location.origin}${window.location.pathname}`);
      setState((current) => ({ ...current, links: [{ id: created.id, kind: created.kind, createdAt: created.createdAt, revokedAt: created.revokedAt }, ...current.links.filter((link) => link.id !== created.id)], url, currentLinkId: created.id }));
      // Keep the just-created link even if refreshing management metadata later fails.
      requestAnimationFrame(() => { linkRef.current?.focus(); linkRef.current?.select(); });
    } catch {
      if (lease.active) setState((current) => ({ ...current, error: 'Could not create a sharing link. Please try again.' }));
    } finally {
      lease.busy = false;
      if (lease.active) setState((current) => ({ ...current, busy: false }));
    }
  };

  const copy = async (): Promise<void> => {
    const lease = leaseRef.current;
    const url = visible.url;
    if (!url || !lease?.active) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      if (lease.active) setState((current) => ({ ...current, copyStatus: 'copied' }));
    } catch {
      if (lease.active) {
        linkRef.current?.focus(); linkRef.current?.select();
        setState((current) => ({ ...current, copyStatus: 'manual' }));
      }
    }
  };

  const revoke = async (): Promise<void> => {
    const lease = leaseRef.current;
    const link = confirmRevoke;
    if (!lease?.active || lease.busy || !link) return;
    lease.busy = true;
    setState((current) => ({ ...current, busy: true, error: null }));
    setConfirmRevoke(null);
    try {
      await apiClient.revokeShareLink(link.id);
      if (lease.active) setState((current) => ({ ...current, links: current.links.map((item) => item.id === link.id ? { ...item, revokedAt: new Date().toISOString() } : item), url: current.currentLinkId === link.id ? '' : current.url, currentLinkId: current.currentLinkId === link.id ? null : current.currentLinkId, copyStatus: null }));
    } catch {
      if (lease.active) setState((current) => ({ ...current, error: 'Could not disable this link. Please try again.' }));
    } finally {
      lease.busy = false;
      if (lease.active) setState((current) => ({ ...current, busy: false }));
    }
  };

  return <>
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-2xl outline-none">
        <header className="flex items-start justify-between gap-4 bg-slate-900 px-6 py-5 text-white">
          <div className="min-w-0"><h2 id={titleId} className="text-xl font-bold">{t(target.kind === 'workspace' ? 'Share Project' : 'Share Task')}</h2><p className="mt-1 break-words text-sm text-indigo-200">{target.name}</p></div>
          <button type="button" onClick={onClose} aria-label={t('Close dialog')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"><i className="fas fa-times" /></button>
        </header>
        <div className="overflow-y-auto p-6">
          <p className="text-sm leading-6 text-slate-600">{t(target.kind === 'workspace' ? 'Recipients can view this project and all active tasks, including tasks limited to task members, after registering or signing in. They cannot make changes.' : 'Recipients can view only this task after registering or signing in. They cannot make changes.')}</p>
          <button type="button" onClick={() => { void generate(); }} disabled={visible.busy || visible.loading} className="mt-5 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{visible.busy ? t('Working…') : t('Generate sharing link')}</button>
          {visible.url && <div className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
            <label htmlFor={linkInputId} className="text-xs font-bold text-slate-700">{t('Read-only sharing link')}</label>
            <div className="mt-2 flex flex-wrap gap-2"><input ref={linkRef} id={linkInputId} readOnly value={visible.url} onFocus={(event) => event.target.select()} className="min-w-0 flex-1 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-indigo-400" /><button type="button" onClick={() => { void copy(); }} className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-indigo-700 shadow-sm">{t('Copy link')}</button></div>
            <p className="mt-2 text-xs leading-5 text-slate-500">{t('Save this link now. Existing links can only be disabled here; generate a new one to share again.')}</p>
            {visible.copyStatus && <p role="status" aria-live="polite" className="mt-2 text-sm text-indigo-700">{t(visible.copyStatus === 'copied' ? 'Link copied.' : 'Automatic copying is unavailable. The link is selected; please copy it manually.')}</p>}
          </div>}
          {visible.error && <div role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{t(visible.error)}{visible.error === 'Could not load sharing links. Please try again.' && <button type="button" onClick={() => setReload((value) => value + 1)} className="ml-2 font-bold underline">{t('Retry')}</button>}</div>}
          <h3 className="mt-7 text-sm font-bold text-slate-800">{t('Sharing links')}</h3>
          {visible.loading ? <p role="status" className="mt-3 text-sm text-slate-500">{t('Loading…')}</p> : visible.links.length === 0 ? <p className="mt-3 text-sm text-slate-500">{t('No sharing links yet.')}</p> : <ul className="mt-3 divide-y divide-slate-100">
            {visible.links.map((link) => <li key={link.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="text-sm text-slate-700">{t('Created {{date}}', { date: new Date(link.createdAt).toLocaleString() })}</p><p className={`mt-1 text-xs ${link.revokedAt ? 'text-slate-400' : 'text-emerald-600'}`}>{t(link.revokedAt ? 'Disabled' : 'Active · read only')}</p></div>{!link.revokedAt && <button type="button" disabled={visible.busy} onClick={() => setConfirmRevoke(link)} className="shrink-0 rounded-lg border border-red-100 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-40">{t('Disable link')}</button>}</li>)}
          </ul>}
        </div>
      </div>
    </div>
    <AppDialog open={!!confirmRevoke} tone="warning" title={t('Disable this sharing link?')} message={t('People using this link will lose access to the shared content. Other sharing links will stay active.')} confirmLabel={t('Disable link')} cancelLabel={t('Cancel')} onConfirm={() => { void revoke(); }} onCancel={() => setConfirmRevoke(null)} />
  </>;
};

export default ShareDialog;
