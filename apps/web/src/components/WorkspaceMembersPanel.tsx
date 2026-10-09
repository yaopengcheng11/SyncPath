import React, { useCallback, useEffect, useState } from 'react';
import type { PublicWorkspaceMember, WorkspaceRole } from '@syncpath/api-client';
import { apiClient } from '../services/api';
import AppDialog from './AppDialog';
import { useI18n } from '../i18n';

interface Props {
  workspaceId: string;
  workspaceName: string;
  currentUserId: string;
  canManage: boolean;
  onClose: () => void;
}

const ROLES: WorkspaceRole[] = ['Owner', 'Admin', 'Member'];

const WorkspaceMembersPanel: React.FC<Props> = ({ workspaceId, workspaceName, currentUserId, canManage, onClose }) => {
  const { t } = useI18n();
  const [members, setMembers] = useState<PublicWorkspaceMember[]>([]);
  const [identifier, setIdentifier] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('Member');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PublicWorkspaceMember | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMembers(await apiClient.listWorkspaceMembers(workspaceId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Unable to load project members.'));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, t]);

  useEffect(() => { void load(); }, [load]);

  const invite = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!identifier.trim() || saving) return;
    setSaving(true);
    try {
      await apiClient.inviteWorkspaceMember(workspaceId, { identifier: identifier.trim(), role });
      setIdentifier('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Unable to invite member.'));
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (member: PublicWorkspaceMember, nextRole: WorkspaceRole): Promise<void> => {
    try {
      await apiClient.changeWorkspaceMemberRole(workspaceId, member.user.id, nextRole);
      setMembers((current) => current.map((item) => item.user.id === member.user.id ? { ...item, role: nextRole } : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Unable to change project role.'));
    }
  };

  const remove = async (member: PublicWorkspaceMember): Promise<void> => {
    try {
      await apiClient.removeWorkspaceMember(workspaceId, member.user.id);
      setMembers((current) => current.filter((item) => item.user.id !== member.user.id));
      setPendingRemoval(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Unable to remove project member.'));
    }
  };

  return (
    <div className="fixed inset-0 z-[3000] bg-slate-950/40 backdrop-blur-sm flex justify-end" onMouseDown={onClose}>
      <aside className="w-full max-w-xl h-full bg-white shadow-2xl flex flex-col" onMouseDown={(event) => event.stopPropagation()}>
        <header className="px-8 py-7 border-b border-slate-100 flex items-start justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-500">{t('Project access')}</p>
            <h2 className="text-2xl font-black text-slate-900 mt-1">{t('Project members')}</h2>
            <p className="text-sm text-slate-500 mt-1">{workspaceName}</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-xl hover:bg-slate-100 text-slate-400" aria-label={t('Close project members panel')}><i className="fas fa-times"></i></button>
        </header>
        <div className="px-8 py-5 border-b border-slate-100 bg-slate-50/70 grid grid-cols-3 gap-3 text-xs">
          <RoleHint role={t('Owner')} text={t('Full project control and ownership')} />
          <RoleHint role={t('Admin')} text={t('Manage members and tasks')} />
          <RoleHint role={t('Member')} text={t('Participate in project tasks')} />
        </div>
        {canManage && (
          <form onSubmit={invite} className="px-8 py-6 border-b border-slate-100">
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">{t('Invite by username or email')}</label>
            <div className="flex gap-2">
              <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="name@company.com" className="min-w-0 flex-1 px-4 py-3 rounded-xl border border-slate-200 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50" />
              <select value={role} onChange={(event) => setRole(event.target.value as WorkspaceRole)} className="px-3 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-600">
                {ROLES.map((item) => <option key={item} value={item}>{t(item)}</option>)}
              </select>
              <button disabled={saving || !identifier.trim()} className="px-5 rounded-xl bg-slate-900 text-white text-xs font-black disabled:opacity-40">{saving ? t('Inviting…') : t('Invite')}</button>
            </div>
          </form>
        )}
        {error && <div className="mx-8 mt-5 px-4 py-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {loading ? <p className="text-sm text-slate-400">{t('Loading members…')}</p> : (
            <div className="space-y-3">
              {members.map((member) => {
                const isSelf = member.user.id === currentUserId;
                return (
                  <div key={member.user.id} className="flex items-center gap-4 p-4 border border-slate-100 rounded-2xl">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-black">{(member.user.displayName || member.user.username).slice(0, 1).toUpperCase()}</div>
                    <div className="min-w-0 flex-1"><p className="font-black text-sm text-slate-800 truncate">{member.user.displayName || member.user.username} {isSelf && <span className="text-[9px] text-indigo-500 uppercase">{t('You')}</span>}</p><p className="text-xs text-slate-400 truncate">@{member.user.username} · {member.user.email}</p></div>
                    <select value={member.role} disabled={!canManage || isSelf} onChange={(event) => void changeRole(member, event.target.value as WorkspaceRole)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-black disabled:bg-slate-50">
                      {ROLES.map((item) => <option key={item} value={item}>{t(item)}</option>)}
                    </select>
            {canManage && !isSelf && <button onClick={() => setPendingRemoval(member)} className="w-9 h-9 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600" aria-label={`${t('Remove')} ${member.user.username}`}><i className="fas fa-user-minus"></i></button>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
      <AppDialog
        open={pendingRemoval !== null}
        tone="danger"
        title={t('Remove team member?')}
        message={pendingRemoval ? t('Remove @{{username}} from {{workspace}}? They will lose access to this project and its tasks.', { username: pendingRemoval.user.username, workspace: workspaceName }) : undefined}
        confirmLabel={t('Remove member')}
        cancelLabel={t('Keep member')}
        onConfirm={() => {
          if (pendingRemoval) void remove(pendingRemoval);
        }}
        onCancel={() => setPendingRemoval(null)}
      />
    </div>
  );
};

const RoleHint: React.FC<{ role: string; text: string }> = ({ role, text }) => <div><p className="font-black text-slate-700">{role}</p><p className="text-[10px] leading-4 text-slate-400 mt-1">{text}</p></div>;

export default WorkspaceMembersPanel;
