import React, { useCallback, useEffect, useState } from 'react';
import type { ProjectRole, PublicProjectMember } from '@syncpath/api-client';
import { apiClient } from '../services/api';
import AppDialog from './AppDialog';
import { useI18n } from '../i18n';
import { isProjectMemberOnline, type OnlineProjectUser } from './projectPresenceState';

interface ProjectMembersPanelProps {
  projectId: string;
  projectName: string;
  currentUserId: string;
  canManage: boolean;
  onlineUsers?: OnlineProjectUser[];
  presenceConnected?: boolean;
  onClose: () => void;
}

const ROLES: ProjectRole[] = ['Lead', 'Editor', 'Viewer'];

const ProjectMembersPanel: React.FC<ProjectMembersPanelProps> = ({
  projectId,
  projectName,
  currentUserId,
  canManage,
  onlineUsers = [],
  presenceConnected = false,
  onClose
}) => {
  const { t } = useI18n();
  const [members, setMembers] = useState<PublicProjectMember[]>([]);
  const [identifier, setIdentifier] = useState('');
  const [inviteRole, setInviteRole] = useState<ProjectRole>('Editor');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PublicProjectMember | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMembers(await apiClient.listProjectMembers(projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Unable to load members.'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const invite = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!identifier.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiClient.inviteProjectMember(projectId, {
        identifier: identifier.trim(),
        role: inviteRole
      });
      setIdentifier('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Unable to invite member.'));
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (member: PublicProjectMember, role: ProjectRole): Promise<void> => {
    setError(null);
    try {
      await apiClient.changeProjectMemberRole(projectId, member.user.id, role);
      setMembers((current) => current.map((item) =>
        item.user.id === member.user.id ? { ...item, role } : item
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Unable to change role.'));
    }
  };

  const remove = async (member: PublicProjectMember): Promise<void> => {
    setError(null);
    try {
      await apiClient.removeProjectMember(projectId, member.user.id);
      setMembers((current) => current.filter((item) => item.user.id !== member.user.id));
      setPendingRemoval(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Unable to remove member.'));
    }
  };

  return (
    <div className="fixed inset-0 z-[3000] bg-slate-950/40 backdrop-blur-sm flex justify-end" onMouseDown={onClose}>
      <aside
        className="w-full max-w-xl h-full bg-white shadow-2xl flex flex-col"
        onMouseDown={(event) => event.stopPropagation()}
        aria-label={t('Task members and permissions')}
      >
        <header className="px-8 py-7 border-b border-slate-100 flex items-start justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-500">{t('Team access')}</p>
            <h2 className="text-2xl font-black text-slate-900 mt-1">{t('Task members and permissions')}</h2>
            <p className="text-sm text-slate-500 mt-1">{projectName}</p>
            <p className="text-xs text-slate-500 mt-2 leading-5">{t('Project membership and task membership are managed separately. Invite project members here to collaborate on this task.')}</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-xl hover:bg-slate-100 text-slate-400" aria-label={t('Close members panel')}>
            <i className="fas fa-times"></i>
          </button>
        </header>

        <div className="px-8 py-5 border-b border-slate-100 bg-slate-50/70 grid grid-cols-3 gap-3 text-xs">
          <RoleHint role={t('Lead')} text={t('Task settings, members and all content')} />
          <RoleHint role={t('Editor')} text={t('Create and edit task content')} />
          <RoleHint role={t('Viewer')} text={t('Read-only access to task content')} />
        </div>

        {canManage && (
          <form onSubmit={invite} className="px-8 py-6 border-b border-slate-100">
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">{t('Invite by username or email')}</label>
            <div className="flex gap-2">
              <input
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="name@company.com"
                className="min-w-0 flex-1 px-4 py-3 rounded-xl border border-slate-200 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50"
              />
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as ProjectRole)}
                className="px-3 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-600"
              >
                {ROLES.map((role) => <option key={role} value={role}>{t(role)}</option>)}
              </select>
              <button disabled={saving || !identifier.trim()} className="px-5 rounded-xl bg-slate-900 text-white text-xs font-black disabled:opacity-40">
                {saving ? t('Inviting…') : t('Invite')}
              </button>
            </div>
          </form>
        )}

        {error && <div className="mx-8 mt-5 px-4 py-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>}

        <div className="flex-1 overflow-y-auto px-8 py-6">
          <p className="mb-4 text-xs leading-5 text-slate-500" role="status">
            {presenceConnected
              ? t('Online means this task is open.') + ' ' + t('Offline means this task is not currently open.')
              : t('Online status is temporarily unavailable. Reconnecting…')}
          </p>
          {loading ? (
            <p className="text-sm text-slate-400">{t('Loading members…')}</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-slate-400">{t('No task members yet.')}</p>
          ) : (
            <div className="space-y-3">
              {members.map((member) => {
                const isSelf = member.user.id === currentUserId;
                const online = presenceConnected && isProjectMemberOnline(member.user, onlineUsers);
                return (
                  <div key={member.user.id} className="flex items-center gap-4 p-4 border border-slate-100 rounded-2xl">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-black">
                      {(member.user.displayName || member.user.username).slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-black text-sm text-slate-800 truncate">{member.user.displayName || member.user.username}</p>
                        {isSelf && <span className="text-[9px] font-black uppercase text-indigo-500">{t('You')}</span>}
                      </div>
                      <p className="text-xs text-slate-400 truncate">@{member.user.username} · {member.user.email}</p>
                      <p className={`mt-1 flex items-center gap-1.5 text-[10px] font-bold ${online ? 'text-emerald-600' : 'text-slate-400'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-300'}`} aria-hidden="true" />
                        {t(!presenceConnected ? 'Status unavailable' : online ? 'Online' : 'Offline')}
                      </p>
                    </div>
                    <select
                      value={member.role}
                      disabled={!canManage || isSelf}
                      onChange={(event) => void changeRole(member, event.target.value as ProjectRole)}
                      className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-black disabled:bg-slate-50"
                    >
                      {ROLES.map((role) => <option key={role} value={role}>{t(role)}</option>)}
                    </select>
                    {canManage && !isSelf && (
                      <button onClick={() => setPendingRemoval(member)} className="w-9 h-9 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600" aria-label={`${t('Remove')} ${member.user.username}`}>
                        <i className="fas fa-user-minus"></i>
                      </button>
                    )}
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
        title={t('Remove task member?')}
        message={pendingRemoval ? t('Remove @{{username}} from {{project}}? They will no longer be able to access this task.', { username: pendingRemoval.user.username, project: projectName }) : undefined}
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

const RoleHint: React.FC<{ role: string; text: string }> = ({ role, text }) => (
  <div>
    <p className="font-black text-slate-700">{role}</p>
    <p className="text-[10px] leading-4 text-slate-400 mt-1">{text}</p>
  </div>
);

export default ProjectMembersPanel;
