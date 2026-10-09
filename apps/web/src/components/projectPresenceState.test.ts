import { describe, expect, it } from 'vitest';
import type { Collaborator } from '../types';
import { deriveProjectOnlineUsers, isProjectMemberOnline } from './projectPresenceState';

const currentUser = { id: 'self', username: 'owner', displayName: 'Owner' };
const person = (userId: string, username = userId, extra: Partial<Collaborator> = {}): Collaborator => ({
  userId, username, clientId: 1, color: '#123456', action: 'Viewing', ...extra
});

describe('project online people', () => {
  it('includes the connected current user once and retains their local editing activity', () => {
    const users = deriveProjectOnlineUsers([person('self', 'owner'), person('teammate')], true, currentUser, 'Editing', 'card-1');
    expect(users).toHaveLength(2);
    expect(users[0]).toMatchObject({ userId: 'self', isSelf: true, action: 'Editing', targetId: 'card-1' });
    expect(users[1].isSelf).toBe(false);
  });

  it('does not expose a stale room snapshot or count self while disconnected', () => {
    expect(deriveProjectOnlineUsers([person('teammate')], false, currentUser)).toEqual([]);
  });

  it('deduplicates multiple connections of one account with the latest activity', () => {
    const users = deriveProjectOnlineUsers([
      person('teammate'),
      person('teammate', 'teammate', { action: 'Editing', targetId: 'card-2', displayName: 'Teammate' })
    ], true, currentUser);
    expect(users).toHaveLength(2);
    expect(users[1]).toMatchObject({ displayName: 'Teammate', action: 'Editing', targetId: 'card-2' });
  });

  it('keeps separate accounts when their visual client IDs and usernames collide', () => {
    const users = deriveProjectOnlineUsers([person('Aa', 'same'), person('BB', 'same')], true, currentUser);
    expect(users.map((user) => user.userId)).toEqual(['self', 'Aa', 'BB']);
    expect(isProjectMemberOnline({ id: 'unrelated', username: 'same' }, users)).toBe(false);
    expect(isProjectMemberOnline({ id: 'BB', username: 'same' }, users)).toBe(true);
  });

  it('supports username-only legacy collaborators without counting self twice', () => {
    const users = deriveProjectOnlineUsers([
      person('', 'owner', { userId: undefined }),
      person('', 'legacy', { userId: undefined }),
      person('', 'legacy', { userId: undefined, action: 'Editing' })
    ], true, currentUser);
    expect(users).toHaveLength(2);
    expect(isProjectMemberOnline({ id: 'member-legacy', username: 'legacy' }, users)).toBe(true);
    expect(isProjectMemberOnline({ id: 'offline', username: 'offline' }, users)).toBe(false);
  });
});
