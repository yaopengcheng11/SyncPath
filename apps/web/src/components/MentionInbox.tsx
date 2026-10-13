import React, { useEffect, useId, useRef } from 'react';
import type { PublicMentionNotification } from '@syncpath/api-client';
import type { MentionInboxModel } from '../hooks/useMentionInbox';
import { useI18n } from '../i18n';

interface MentionInboxProps {
  inbox: MentionInboxModel;
  onOpen: (notification: PublicMentionNotification) => void | Promise<void>;
  align?: 'left' | 'right';
}

const MentionInbox: React.FC<MentionInboxProps> = ({ inbox, onOpen, align = 'right' }) => {
  const { t, locale } = useI18n();
  const { items, open, error, loading, unread, setOpen } = inbox;
  const containerRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      bellRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, setOpen]);

  const openItem = async (item: PublicMentionNotification): Promise<void> => {
    setOpen(false);
    bellRef.current?.focus();
    if (!await inbox.markRead(item.id)) return;
    await onOpen(item);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={bellRef}
        type="button"
        onClick={inbox.toggle}
        className="sp-icon-button relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
        aria-label={t('Notifications')}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        title={t('Notifications')}
      >
        <i className="fas fa-bell text-sm" />
        {unread > 0 && <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
          <div ref={panelRef} id={panelId} role="dialog" aria-label={t('Notifications')} tabIndex={-1} className={`sp-popover absolute top-12 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/95 shadow-2xl shadow-slate-900/15 backdrop-blur-xl outline-none ${align === 'left' ? 'left-0' : 'right-0'}`}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-bold text-slate-900">{t('Notifications')}</h2>
              <div className="flex items-center gap-2">
                {unread > 0 && <span className="text-xs font-semibold text-indigo-600">{t('{{count}} unread', { count: unread })}</span>}
                <button type="button" onClick={() => { setOpen(false); bellRef.current?.focus(); }} className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={t('Close notifications')}><i className="fas fa-times text-xs" /></button>
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {error && <p className="px-3 py-4 text-sm text-rose-600">{t('Unable to load notifications.')}</p>}
              {!error && loading && items.length === 0 && <p className="px-3 py-7 text-center text-sm text-slate-400">{t('Loading notifications…')}</p>}
              {!error && !loading && items.length === 0 && <p className="px-3 py-7 text-center text-sm text-slate-400">{t('No notifications yet')}</p>}
              {!error && items.map((item) => (
                <button key={item.id} type="button" onClick={() => void openItem(item)} className={`w-full rounded-2xl px-3 py-3 text-left transition-colors hover:bg-indigo-50 ${item.readAt ? '' : 'bg-indigo-50/60'}`}>
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-xs font-bold text-white">@</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-800">{item.actor.displayName || item.actor.username} {t('mentioned you')}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-600">{item.entry.title}</span>
                      <span className="mt-1 block truncate text-[11px] text-slate-400">{item.project.name} · {new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }).format(new Date(item.createdAt))}</span>
                    </span>
                    {!item.readAt && <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-600" />}
                  </div>
                </button>
              ))}
            </div>
          </div>
      )}
    </div>
  );
};

export default MentionInbox;
