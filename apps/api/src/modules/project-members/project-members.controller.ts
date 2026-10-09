import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../identity/current-user.decorator';
import type { Project, User } from '@prisma/client';
import { ProjectRolesGuard, ProjectRoles, ProjectContextParam } from '../../common/rbac/guards';
import { ProjectMembersService } from './project-members.service';
import { CollaborationService } from '../collaboration/collaboration.service';
import {
  ChangeRoleBody,
  InviteMemberBody,
  type PublicProjectMember
} from './dto';

@ApiTags('project_members')
@Controller('projects/:projectId/members')
@UseGuards(ProjectRolesGuard)
@ProjectRoles('Lead', 'Editor', 'Viewer')
export class ProjectMembersController {
  constructor(
    private readonly members: ProjectMembersService,
    private readonly collaboration: CollaborationService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List project members (Lead/Editor/Viewer).' })
  async list(
    @ProjectContextParam() ctx: { project: { id: string } }
  ): Promise<PublicProjectMember[]> {
    return this.members.list({ project: ctx.project as never });
  }

  @Post()
  @HttpCode(201)
  @ProjectRoles('Lead')
  @ApiOperation({ summary: 'Invite a user to this project (Lead only).' })
  async invite(
    @CurrentUser() user: User,
    @ProjectContextParam() ctx: { project: Project; workspaceRole: 'Owner' | 'Admin' | 'Member'; projectRole: 'Lead' | 'Editor' | 'Viewer' },
    @Param('projectId') _projectId: string,
    @Body() body: InviteMemberBody
  ): Promise<{ id: string; userId: string; role: string }> {
    const member = await this.members.invite({
      project: ctx.project,
      workspaceRole: ctx.workspaceRole,
      projectRole: ctx.projectRole,
      userId: body.userId,
      identifier: body.identifier,
      role: body.role
    });
    this.collaboration.publish({ projectId: ctx.project.id, type: 'membership.updated', actor: user, data: { action: 'invited', userId: member.userId } });
    return { id: member.id, userId: member.userId, role: member.role };
  }

  @Patch(':userId')
  @ProjectRoles('Lead')
  @ApiOperation({ summary: 'Change a member’s role (Lead only).' })
  async changeRole(
    @CurrentUser() user: User,
    @ProjectContextParam() ctx: { project: Project; workspaceRole: 'Owner' | 'Admin' | 'Member'; projectRole: 'Lead' | 'Editor' | 'Viewer' },
    @Param('userId') userId: string,
    @Body() body: ChangeRoleBody
  ): Promise<{ id: string; userId: string; role: string }> {
    const member = await this.members.changeRole({
      project: ctx.project,
      workspaceRole: ctx.workspaceRole,
      projectRole: ctx.projectRole,
      targetUserId: userId,
      role: body.role
    });
    this.collaboration.publish({ projectId: ctx.project.id, type: 'membership.updated', actor: user, data: { action: 'role_changed', userId: member.userId } });
    return { id: member.id, userId: member.userId, role: member.role };
  }

  @Delete(':userId')
  @HttpCode(204)
  @ProjectRoles('Lead')
  @ApiOperation({ summary: 'Remove a member from this project (Lead only).' })
  async remove(
    @CurrentUser() user: User,
    @ProjectContextParam() ctx: { project: Project; workspaceRole: 'Owner' | 'Admin' | 'Member'; projectRole: 'Lead' | 'Editor' | 'Viewer' },
    @Param('userId') userId: string
  ): Promise<void> {
    await this.members.remove({
      project: ctx.project,
      workspaceRole: ctx.workspaceRole,
      projectRole: ctx.projectRole,
      targetUserId: userId
    });
    this.collaboration.publish({ projectId: ctx.project.id, type: 'membership.updated', actor: user, data: { action: 'removed', userId } });
    this.collaboration.revoke(ctx.project.id, userId);
  }
}
