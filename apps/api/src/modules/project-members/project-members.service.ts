import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import type { Project, ProjectMember, ProjectRole, User, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  newMembershipId,
  newProjectMemberId
} from '@syncpath/domain';

@Injectable()
export class ProjectMembersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(input: { project: Project }): Promise<
    Array<{
      user: { id: string; username: string; email: string; displayName: string | null };
      role: ProjectRole;
      createdAt: string;
    }>
  > {
    const members = await this.prisma.projectMember.findMany({
      where: { projectId: input.project.id },
      include: {
        user: { select: { id: true, username: true, email: true, displayName: true } }
      },
      orderBy: { createdAt: 'asc' }
    });
    return members.map((m) => ({
      user: m.user,
      role: m.role,
      createdAt: m.createdAt.toISOString()
    }));
  }

  /**
   * Invite / add a user to a project. Workspace Owner / Admin and project
   * Lead can add members; everyone else is forbidden.
   *
   * If the user already has a workspace membership, the project role is
   * attached; otherwise we ALSO create a workspace Member so the invited
   * user can at least see the workspace (matching docs §7.1 implicit
   * "private project must have a member in project_members").
   */
  async invite(input: {
    project: Project;
    workspaceRole: WorkspaceRole;
    projectRole: ProjectRole;
    userId?: string;
    identifier?: string;
    role: ProjectRole;
  }): Promise<ProjectMember> {
    if (input.workspaceRole === 'Owner') {
      // Owner bypasses project role check.
    } else if (input.projectRole !== 'Lead' && input.workspaceRole !== 'Admin') {
      throw new ForbiddenException({
        code: 'invite_forbidden',
        message: 'Only project Lead or workspace Owner/Admin can invite.'
      });
    }

    const identifier = input.identifier?.trim();
    const target = input.userId
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
    if (!target || target.status !== 'active') {
      throw new NotFoundException({
        code: 'user_not_found',
        message: 'User not found.'
      });
    }

    const existing = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: { projectId: input.project.id, userId: target.id }
      }
    });
    if (existing) {
      throw new ConflictException({
        code: 'already_member',
        message: 'User is already a member of this project.'
      });
    }

    // Ensure a workspace membership exists so the user can see the project
    // container at all (private projects require project_members; the
    // workspace boundary is the outer check).
    const workspaceMembership = await this.prisma.membership.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: input.project.workspaceId,
          userId: target.id
        }
      }
    });
    if (!workspaceMembership) {
      await this.prisma.membership.create({
        data: {
          id: newMembershipId(),
          workspaceId: input.project.workspaceId,
          userId: target.id,
          role: 'Member'
        }
      });
    }

    return this.prisma.projectMember.create({
      data: {
        id: newProjectMemberId(),
        projectId: input.project.id,
        userId: target.id,
        role: input.role
      }
    });
  }

  async changeRole(input: {
    project: Project;
    workspaceRole: WorkspaceRole;
    projectRole: ProjectRole;
    targetUserId: string;
    role: ProjectRole;
  }): Promise<ProjectMember> {
    if (input.workspaceRole !== 'Owner' && input.workspaceRole !== 'Admin') {
      if (input.projectRole !== 'Lead') {
        throw new ForbiddenException({
          code: 'role_change_forbidden',
          message: 'Only project Lead or workspace Owner/Admin can change roles.'
        });
      }
    }
    const member = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: input.project.id,
          userId: input.targetUserId
        }
      }
    });
    if (!member) {
      throw new NotFoundException({
        code: 'member_not_found',
        message: 'User is not a member of this project.'
      });
    }
    return this.prisma.projectMember.update({
      where: {
        projectId_userId: {
          projectId: input.project.id,
          userId: input.targetUserId
        }
      },
      data: { role: input.role }
    });
  }

  async remove(input: {
    project: Project;
    workspaceRole: WorkspaceRole;
    projectRole: ProjectRole;
    targetUserId: string;
  }): Promise<void> {
    if (input.workspaceRole !== 'Owner' && input.workspaceRole !== 'Admin') {
      if (input.projectRole !== 'Lead') {
        throw new ForbiddenException({
          code: 'remove_forbidden',
          message: 'Only project Lead or workspace Owner/Admin can remove members.'
        });
      }
    }
    await this.prisma.projectMember.deleteMany({
      where: {
        projectId: input.project.id,
        userId: input.targetUserId
      }
    });
  }
}

export type { ProjectMember };
