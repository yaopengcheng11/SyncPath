import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import type { User, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { newMembershipId } from '@syncpath/domain';

@Injectable()
export class WorkspaceMembersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string) {
    const rows = await this.prisma.membership.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, username: true, email: true, displayName: true } } },
      orderBy: { createdAt: 'asc' }
    });
    return rows.map((row) => ({
      user: row.user,
      role: row.role,
      createdAt: row.createdAt.toISOString()
    }));
  }

  private async resolveUser(input: { userId?: string; identifier?: string }): Promise<User> {
    const identifier = input.identifier?.trim();
    const user = input.userId
      ? await this.prisma.user.findUnique({ where: { id: input.userId } })
      : identifier
        ? await this.prisma.user.findFirst({
            where: {
              OR: [
                { username: { equals: identifier, mode: 'insensitive' } },
                { email: { equals: identifier, mode: 'insensitive' } }
              ]
            }
          })
        : null;
    if (!user || user.status !== 'active') {
      throw new NotFoundException({ code: 'user_not_found', message: 'User not found.' });
    }
    return user;
  }

  private assertCanManage(actorRole: WorkspaceRole, targetRole?: WorkspaceRole): void {
    if (actorRole !== 'Owner' && actorRole !== 'Admin') {
      throw new ForbiddenException({ code: 'workspace_members_forbidden', message: 'Only workspace Owner/Admin can manage members.' });
    }
    if (actorRole === 'Admin' && targetRole === 'Owner') {
      throw new ForbiddenException({ code: 'owner_role_required', message: 'Only the workspace Owner can manage an Owner role.' });
    }
  }

  async invite(input: {
    workspaceId: string;
    actorRole: WorkspaceRole;
    userId?: string;
    identifier?: string;
    role: WorkspaceRole;
  }) {
    this.assertCanManage(input.actorRole, input.role);
    const target = await this.resolveUser(input);
    const workspace = await this.prisma.workspace.findUnique({ where: { id: input.workspaceId } });
    if (!workspace) throw new NotFoundException({ code: 'workspace_not_found', message: 'Workspace not found.' });
    if (input.role === 'Owner' && target.id !== workspace.ownerId) {
      throw new ForbiddenException({ code: 'owner_role_required', message: 'A workspace has one Owner.' });
    }
    const existing = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: target.id } }
    });
    if (existing) {
      throw new ConflictException({ code: 'already_member', message: 'User is already a workspace member.' });
    }
    return this.prisma.membership.create({
      data: { id: newMembershipId(), workspaceId: input.workspaceId, userId: target.id, role: input.role }
    });
  }

  async changeRole(input: {
    workspaceId: string;
    actorRole: WorkspaceRole;
    targetUserId: string;
    role: WorkspaceRole;
  }) {
    this.assertCanManage(input.actorRole, input.role);
    const workspace = await this.prisma.workspace.findUnique({ where: { id: input.workspaceId } });
    if (!workspace) throw new NotFoundException({ code: 'workspace_not_found', message: 'Workspace not found.' });
    if (input.role === 'Owner' && input.targetUserId !== workspace.ownerId) {
      throw new ForbiddenException({ code: 'owner_role_required', message: 'A workspace has one Owner.' });
    }
    const member = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.targetUserId } }
    });
    if (!member) throw new NotFoundException({ code: 'member_not_found', message: 'Workspace member not found.' });
    if (member.role === 'Owner' && input.actorRole !== 'Owner') {
      throw new ForbiddenException({ code: 'owner_role_required', message: 'Only the workspace Owner can change an Owner.' });
    }
    return this.prisma.membership.update({
      where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.targetUserId } },
      data: { role: input.role }
    });
  }

  async remove(input: {
    workspaceId: string;
    actorRole: WorkspaceRole;
    targetUserId: string;
    actor: User;
  }): Promise<void> {
    this.assertCanManage(input.actorRole);
    if (input.actor.id === input.targetUserId && input.actorRole === 'Owner') {
      throw new ForbiddenException({ code: 'owner_required', message: 'The workspace Owner cannot remove themself.' });
    }
    const member = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.targetUserId } }
    });
    if (!member) throw new NotFoundException({ code: 'member_not_found', message: 'Workspace member not found.' });
    if (member.role === 'Owner' && input.actorRole !== 'Owner') {
      throw new ForbiddenException({ code: 'owner_role_required', message: 'Only the workspace Owner can remove an Owner.' });
    }
    await this.prisma.membership.delete({
      where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.targetUserId } }
    });
  }
}
