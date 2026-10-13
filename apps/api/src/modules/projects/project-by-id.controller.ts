import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  UseGuards
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../identity/current-user.decorator';
import { ProjectRolesGuard, ProjectRoles } from '../../common/rbac/guards';
import type { User } from '@prisma/client';
import { ProjectsService } from './projects.service';
import {
  PublicProject,
  UpdateProjectBody,
  toPublicProject
} from './dto';

/**
 * Project-scoped routes that don't include the workspace id in the URL.
 * The ProjectRolesGuard walks the entry → project → workspace chain to
 * resolve the caller's authority.
 */
@ApiTags('projects')
@Controller('projects')
@UseGuards(ProjectRolesGuard)
export class ProjectByIdController {
  constructor(private readonly projects: ProjectsService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a project by id.' })
  @ProjectRoles('Lead', 'Editor', 'Viewer')
  async getOne(
    @CurrentUser() user: User,
    @Param('id') id: string
  ): Promise<PublicProject> {
    const { project, myRole } = await this.projects.getById({
      projectId: id,
      user
    });
    return toPublicProject(project, myRole);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a project (revision-checked via expectedRevision).'
  })
  @ProjectRoles('Lead', 'Editor')
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: UpdateProjectBody
  ): Promise<PublicProject> {
    const { project: current } = await this.projects.getById({
      projectId: id,
      user
    });
    const { expectedRevision, ...changes } = body;
    const updated = await this.projects.update({
      project: current,
      user,
      expectedRevision: expectedRevision ?? 1,
      changes
    });
    const { myRole } = await this.projects.getById({ projectId: id, user });
    return toPublicProject(updated, myRole);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Permanently delete a project and its children (Lead only).' })
  @HttpCode(204)
  @ProjectRoles('Lead')
  async remove(
    @CurrentUser() user: User,
    @Param('id') id: string
  ): Promise<void> {
    const { project } = await this.projects.getById({ projectId: id, user });
    await this.projects.delete({ project, user });
  }
}
