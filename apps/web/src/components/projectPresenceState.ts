import type { Collaborator } from '../types';

export interface PresenceCurrentUser {
  id: string;
  username: string;
  displayName?: string | null;
}

export interface OnlineProjectUser {
  key: string;
  userId?: string;
  username: string;
  displayName?: string | null;
  color: string;
  action: string;
  targetId?: string;
  isSelf: boolean;
}

/** The room's connection establishes presence; an old snapshot does not. */
export function deriveProjectOnlineUsers(
  collaborators: Collaborator[],
  connected: boolean,
  currentUser: PresenceCurrentUser,
  currentAction = 'Viewing',
  currentTargetId?: string
): OnlineProjectUser[] {
  if (!connected) return [];

  const users = new Map<string, OnlineProjectUser>();
  const selfKey = `id:${currentUser.id}`;
  users.set(selfKey, {
    key: selfKey,
    userId: currentUser.id,
    username: currentUser.username,
    displayName: currentUser.displayName,
    color: '#6366f1',
    action: currentAction,
    targetId: currentTargetId,
    isSelf: true
  });

  for (const collaborator of collaborators) {
    if (!collaborator.username) continue;
    const isSelf = collaborator.userId
      ? collaborator.userId === currentUser.id
      : collaborator.username === currentUser.username;
    if (isSelf) continue;
    // Legacy rooms have usernames only. API rooms always retain the actual
    // user ID, since the visual client/color hash can collide between users.
    const key = collaborator.userId ? `id:${collaborator.userId}` : `username:${collaborator.username}`;
    users.set(key, {
      key,
      userId: collaborator.userId,
      username: collaborator.username,
      displayName: collaborator.displayName,
      color: collaborator.color,
      action: collaborator.action,
      targetId: collaborator.targetId,
      isSelf: false
    });
  }

  return [...users.values()];
}

export function isProjectMemberOnline(
  member: { id: string; username: string },
  onlineUsers: OnlineProjectUser[]
): boolean {
  return onlineUsers.some((user) => user.userId
    ? user.userId === member.id
    : user.username === member.username);
}
