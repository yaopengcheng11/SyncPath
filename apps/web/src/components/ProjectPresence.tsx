import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Collaborator } from '../types';
import { useI18n } from '../i18n';
import { deriveProjectOnlineUsers, type OnlineProjectUser, type PresenceCurrentUser } from './projectPresenceState';

interface ProjectPresenceProps {
  collaborators: Collaborator[];
  connected: boolean;
  currentUser: PresenceCurrentUser;
  currentAction?: string;
  currentTargetId?: string;
  entryTitles?: Record<string, string>;
}

const ProjectPresence: React.FC<ProjectPresenceProps> = ({
  collaborators,
  connected,
  currentUser,
  currentAction,
  currentTargetId,
  entryTitles = {}
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const users = useMemo(
    () => deriveProjectOnlineUsers(collaborators, connected, currentUser, currentAction, currentTargetId),
    [collaborators, connected, currentUser, currentAction, currentTargetId]
  );

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const activity = (user: OnlineProjectUser): string => {
    const editing = user.action === 'Editing';
    const title = user.targetId ? entryTitles[user.targetId]?.trim() : undefined;
    return title
      ? t(editing ? 'Editing {{title}}' : 'Viewing {{title}}', { title })
      : t(editing ? 'Editing a card' : 'Viewing this task');
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        {connected && (
          <span className="hidden sm:flex -space-x-2" aria-hidden="true">
            {users.slice(0, 3).map((user) => (
              <span key={user.key} className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[10px] font-black text-white" style={{ backgroundColor: user.color }}>
                {(user.displayName || user.username).slice(0, 1).toUpperCase()}
              </span>
            ))}
          </span>
        )}
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`} aria-hidden="true" />
        <span className="whitespace-nowrap">{connected ? t('{{count}} online', { count: users.length }) : t('Reconnecting')}</span>
        <i className="fas fa-chevron-down text-[9px]" aria-hidden="true" />
      </button>
      {open && (
        <section id={panelId} aria-label={t('Online in this task')} className="absolute right-0 top-full z-[200] mt-3 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-black text-slate-800">{t('Online in this task')}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">{t('Online means this task is open.')}</p>
          </div>
          {connected ? (
            <ul className="max-h-72 overflow-y-auto p-2">
              {users.map((user) => (
                <li key={user.key} className="flex items-center gap-3 rounded-xl px-2 py-3">
                  <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black text-white" style={{ backgroundColor: user.color }} aria-hidden="true">
                    {(user.displayName || user.username).slice(0, 1).toUpperCase()}
                    <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-bold text-slate-800" title={user.displayName || user.username}>{user.displayName || user.username}</p>
                      {user.isSelf && <span className="shrink-0 text-[10px] font-bold text-indigo-500">{t('You')}</span>}
                    </div>
                    <p className="truncate text-xs text-slate-500" title={activity(user)}>{activity(user)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-5 text-sm leading-6 text-slate-500" role="status">{t('Online status is temporarily unavailable. Reconnecting…')}</p>
          )}
        </section>
      )}
    </div>
  );
};

export default ProjectPresence;
