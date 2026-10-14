import React, { useEffect, useId, useRef, useState } from 'react';
import type { PublicMentionNotification, PublicUser } from '@syncpath/api-client';
import type { useMentionInbox } from '../hooks/useMentionInbox';
import { LanguageSwitcher, useI18n } from '../i18n';
import MentionInbox from './MentionInbox';
import ThemePreferenceControl from './ThemePreferenceControl';

export interface HeaderActionsProps {
  user: PublicUser;
  inbox: ReturnType<typeof useMentionInbox>;
  onOpenMention: (notification: PublicMentionNotification) => void | Promise<void>;
  onOpenReceivedShares: () => void;
  onOpenMentionsTimeline?: () => void;
  onSignOut: () => void;
  onShare?: () => void;
  presence?: React.ReactNode;
}

type OpenMenu = 'settings' | 'account' | null;

const HeaderActions: React.FC<HeaderActionsProps> = ({
  user, inbox, onOpenMention, onOpenReceivedShares, onOpenMentionsTimeline, onSignOut, onShare, presence
}) => {
  const { t } = useI18n();
  const [menu, setMenu] = useState<OpenMenu>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const accountRef = useRef<HTMLButtonElement>(null);
  const settingsId = useId();
  const accountId = useId();

  const closeMenu = (restoreFocus = false): void => {
    if (restoreFocus && menu !== null) (menu === 'settings' ? settingsRef.current : accountRef.current)?.focus();
    setMenu(null);
  };

  const toggleMenu = (next: Exclude<OpenMenu, null>): void => {
    inbox.setOpen(false);
    if (menu === next) closeMenu(true);
    else setMenu(next);
  };

  const choose = (action: () => void): void => {
    closeMenu(true);
    inbox.setOpen(false);
    action();
  };

  useEffect(() => { if (inbox.open) setMenu(null); }, [inbox.open]);

  useEffect(() => {
    if (!menu) return;
    popoverRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      (menu === 'settings' ? settingsRef.current : accountRef.current)?.focus();
      setMenu(null);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menu]);

  const baseActionClass = 'sp-menu-item flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400';
  const actionClass = `${baseActionClass} text-slate-600 hover:bg-indigo-50 hover:text-indigo-700`;

  return <div ref={rootRef} className="relative ml-auto flex max-w-full flex-wrap items-center justify-end gap-2" onBlur={(event) => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setMenu(null);
  }}>
    {onShare && <button type="button" onClick={() => choose(onShare)} className="sp-button-secondary inline-flex h-9 shrink-0 items-center gap-2 px-3 text-xs font-medium"><i className="fas fa-share-alt text-[11px]" aria-hidden="true" />{t('Share')}</button>}
    <MentionInbox inbox={inbox} onOpen={onOpenMention} />
    <button ref={settingsRef} type="button" aria-label={t('Settings')} title={t('Settings')} aria-expanded={menu === 'settings'} aria-controls={menu === 'settings' ? settingsId : undefined} aria-haspopup="dialog" onClick={() => toggleMenu('settings')} className="sp-icon-button shrink-0"><i className="fas fa-cog" aria-hidden="true" /></button>
    {presence && <div onClick={() => { setMenu(null); inbox.setOpen(false); }}>{presence}</div>}
    <button ref={accountRef} type="button" aria-label={t('Account options for {{username}}', { username: user.username })} title={user.username} aria-expanded={menu === 'account'} aria-controls={menu === 'account' ? accountId : undefined} aria-haspopup="dialog" onClick={() => toggleMenu('account')} className="sp-account-control inline-flex h-9 min-w-0 items-center gap-2 rounded-lg px-2 text-xs font-medium">
      <span className="sp-brand-mark flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium" aria-hidden="true">{(user.displayName || user.username).slice(0, 1).toUpperCase()}</span>
      <span className="max-w-[5rem] truncate sm:max-w-[8rem]">{user.username}</span><i className="fas fa-chevron-down text-[9px] text-slate-400" aria-hidden="true" />
    </button>
    {menu && <div ref={popoverRef} id={menu === 'settings' ? settingsId : accountId} role="dialog" aria-label={t(menu === 'settings' ? 'Settings' : 'My account')} className="sp-popover absolute right-0 top-full z-[150] mt-2 max-h-[min(32rem,75vh)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border p-2">
      {menu === 'settings' ? <>
        <div className="px-3 py-2"><h2 className="sp-heading text-sm font-semibold">{t('Website preferences')}</h2></div>
        <div className="mx-3 border-b border-slate-100 py-3"><ThemePreferenceControl /></div>
        <div className="flex items-center justify-between gap-3 px-3 py-3"><span className="sp-metadata text-xs font-medium">{t('Language')}</span><LanguageSwitcher compact /></div>
      </> : <>
        <div className="m-1 mb-2 rounded-lg bg-slate-50 px-3 py-3">
          <div className="flex items-center gap-3">
            <span className="sp-brand-mark flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base font-medium" aria-hidden="true">{(user.displayName || user.username).slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0">
              <h2 className="sp-heading truncate text-sm font-semibold" title={user.displayName || user.username}>{user.displayName || user.username}</h2>
              <p className="sp-metadata mt-0.5 truncate text-xs" title={`@${user.username}`}>@{user.username}</p>
            </div>
          </div>
          <p className="sp-metadata mt-3 break-all text-xs leading-5">{user.email}</p>
        </div>
        {onOpenMentionsTimeline && <button type="button" className={actionClass} onClick={() => choose(onOpenMentionsTimeline)}><i className="fas fa-at w-4 text-center" aria-hidden="true" />{t('My mentions timeline')}</button>}
        <button type="button" className={actionClass} onClick={() => choose(onOpenReceivedShares)}><i className="fas fa-inbox w-4 text-center" aria-hidden="true" />{t('Received shares')}</button>
        <div className="mx-3 my-2 border-t border-slate-100" />
        <button type="button" className={`${baseActionClass} text-rose-600 hover:bg-rose-50 hover:text-rose-700`} onClick={() => choose(onSignOut)}><i className="fas fa-sign-out-alt w-4 text-center" aria-hidden="true" />{t('Sign out')}</button>
      </>}
    </div>}
  </div>;
};

export default HeaderActions;
