import React, { useCallback, useEffect, useState } from 'react';
import type { PublicMentionNotification } from '@syncpath/api-client';
import { apiClient } from '../services/api';
import { useI18n } from '../i18n';

interface MentionInboxProps {
  onOpen: (notification: PublicMentionNotification) => void | Promise<void>;
  align?: 'left' | 'right';
}

const MentionInbox: React.FC<MentionInboxProps> = ({ onOpen, align = 'right' }) => {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<PublicMentionNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setItems(await apiClient.listMentionNotifications());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const source = new EventSource('/api/v1/notifications/events', { withCredentials: true });
    source.addEventListener('mention.created', () => { void refresh(); });
    const interval = window.setInterval(() => { void refresh(); }, 60_000);
    return () => { source.close(); window.clearInterval(interval); };
  }, [refresh]);

  const unread = items.filter((item) => item.readAt === null).length;

  const openItem = async (item: PublicMentionNotification): Promise<void> => {
    setOpen(false);
    if (!item.readAt) {
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row));
      try { await apiClient.markMentionRead(item.id); } catch { void refresh(); }
    }
    await onOpen(item);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen((value) => !value); if (!open) void refresh(); }}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
        aria-label={t('Mentions')}
        aria-expanded={open}
        title={t('Mentions')}
      >
        <i className="fas fa-bell text-sm" />
        {unread > 0 && <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} aria-label={t('Close mentions')} />
          <div className={`absolute top-12 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/95 shadow-2xl shadow-slate-900/15 backdrop-blur-xl ${align === 'left' ? 'left-0' : 'right-0'}`}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-bold text-slate-900">{t('Mentions')}</h2>
              {unread > 0 && <span className="text-xs font-semibold text-indigo-600">{t('{{count}} unread', { count: unread })}</span>}
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {error && <p className="px-3 py-4 text-sm text-rose-600">{t('Unable to load mentions.')}</p>}
              {!error && items.length === 0 && <p className="px-3 py-7 text-center text-sm text-slate-400">{t('No mentions yet')}</p>}
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
        </>
      )}
    </div>
  );
};

export default MentionInbox;
