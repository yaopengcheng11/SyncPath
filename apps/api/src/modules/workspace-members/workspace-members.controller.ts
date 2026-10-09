import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../identity/current-user.decorator';
import type { User } from '@prisma/client';
import { WorkspaceContext, WorkspaceRolesGuard, WorkspaceRoles } from '../../common/rbac/guards';
import { WorkspaceMembersService } from './workspace-members.service';
import { ChangeWorkspaceRoleBody, InviteWorkspaceMemberBody, type PublicWorkspaceMember } from './dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CollaborationService } from '../collaboration/collaboration.service';

@ApiTags('workspace_members')
@Controller('workspaces/:workspaceId/members')
@UseGuards(WorkspaceRolesGuard)
@WorkspaceRoles('Owner', 'Admin', 'Member')
export class WorkspaceMembersController {
  constructor(
    private readonly members: WorkspaceMembersService,
    private readonly prisma: PrismaService,
    private readonly collaboration: CollaborationService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List workspace members.' })
  list(@Param('workspaceId') workspaceId: string): Promise<PublicWorkspaceMember[]> {
    return this.members.list(workspaceId);
  }

  @Post()
  @HttpCode(201)
  @WorkspaceRoles('Owner', 'Admin')
  @ApiOperation({ summary: 'Invite a workspace member.' })
  async invite(
    @Param('workspaceId') workspaceId: string,
    @WorkspaceContext() ctx: { workspaceRole: 'Owner' | 'Admin' | 'Member' },
    @Body() body: InviteWorkspaceMemberBody
  ) {
    const row = await this.members.invite({ workspaceId, actorRole: ctx.workspaceRole, ...body });
    return { id: row.id, userId: row.userId, role: row.role };
  }

  @Patch(':userId')
  @WorkspaceRoles('Owner', 'Admin')
  @ApiOperation({ summary: 'Change a workspace member role.' })
  async changeRole(
    @Param('workspaceId') workspaceId: string,
    @Param('userId') targetUserId: string,
    @WorkspaceContext() ctx: { workspaceRole: 'Owner' | 'Admin' | 'Member' },
    @Body() body: ChangeWorkspaceRoleBody
  ) {
    const row = await this.members.changeRole({ workspaceId, targetUserId, actorRole: ctx.workspaceRole, role: body.role });
    return { id: row.id, userId: row.userId, role: row.role };
  }

  @Delete(':userId')
  @HttpCode(204)
  @WorkspaceRoles('Owner', 'Admin')
  @ApiOperation({ summary: 'Remove a workspace member.' })
  async remove(
    @Param('workspaceId') workspaceId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() actor: User,
    @WorkspaceContext() ctx: { workspaceRole: 'Owner' | 'Admin' | 'Member' }
  ): Promise<void> {
    await this.members.remove({ workspaceId, targetUserId, actorRole: ctx.workspaceRole, actor });

    // A workspace revoke invalidates every project stream owned by the
    // removed member. Send the notice before terminating each SSE connection
    // so the web client can clear its cache instead of retrying blindly.
    const projects = await this.prisma.project.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true }
    });
    for (const project of projects) {
      this.collaboration.publish({
        projectId: project.id,
        type: 'membership.updated',
        actor,
        data: { action: 'workspace_removed', userId: targetUserId }
      });
      this.collaboration.revoke(project.id, targetUserId);
    }
  }
}
