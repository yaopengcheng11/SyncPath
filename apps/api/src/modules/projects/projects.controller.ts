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
import { WorkspaceRolesGuard } from '../../common/rbac/guards';
import { WorkspaceRoles, WorkspaceContext } from '../../common/rbac/guards';
import type { User } from '@prisma/client';
import { ProjectsService } from './projects.service';
import {
  CreateProjectBody,
  PublicProject,
  UpdateProjectBody,
  toPublicProject
} from './dto';

@ApiTags('projects')
@Controller('workspaces/:workspaceId/projects')
@UseGuards(WorkspaceRolesGuard)
@WorkspaceRoles('Owner', 'Admin', 'Member')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({
    summary: 'List projects in a workspace the caller can see.'
  })
  async list(
    @CurrentUser() user: User,
    @Param('workspaceId') workspaceId: string
  ): Promise<PublicProject[]> {
    const items = await this.projects.listForUser({ workspaceId, user });
    return items.map(({ project, myRole }) => toPublicProject(project, myRole));
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create a project. The caller becomes Lead.'
  })
  @WorkspaceRoles('Owner', 'Admin', 'Member')
  async create(
    @CurrentUser() user: User,
    @WorkspaceContext() ctx: { workspaceRole: 'Owner' | 'Admin' | 'Member' },
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateProjectBody
  ): Promise<PublicProject> {
    const { project, myRole } = await this.projects.create({
      workspaceId,
      workspaceRole: ctx.workspaceRole,
      user,
      body
    });
    return toPublicProject(project, myRole);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a project by id within the workspace.' })
  async getOne(
    @CurrentUser() user: User,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string
  ): Promise<PublicProject> {
    const { project, myRole } = await this.projects.getById({
      projectId: id,
      user,
      expectedWorkspaceId: workspaceId
    });
    return toPublicProject(project, myRole);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a project within the workspace.' })
  async update(
    @CurrentUser() user: User,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: UpdateProjectBody
  ): Promise<PublicProject> {
    const { project: current } = await this.projects.getById({
      projectId: id,
      user,
      expectedWorkspaceId: workspaceId
    });
    // Strip expectedRevision before passing to the service.
    const { expectedRevision, ...changes } = body;
    const updated = await this.projects.update({
      project: current,
      user,
      expectedRevision: expectedRevision ?? 1,
      changes
    });
    const { myRole } = await this.projects.getById({
      projectId: id,
      user,
      expectedWorkspaceId: workspaceId
    });
    return toPublicProject(updated, myRole);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a project within the workspace.' })
  async remove(
    @CurrentUser() user: User,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string
  ): Promise<void> {
    const { project } = await this.projects.getById({
      projectId: id,
      user,
      expectedWorkspaceId: workspaceId
    });
    await this.projects.softDelete({ project, user });
  }
}
