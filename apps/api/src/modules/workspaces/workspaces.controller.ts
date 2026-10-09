import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../identity/current-user.decorator';
import { WorkspacesService } from './workspaces.service';
import type { CreateWorkspaceBody, PublicWorkspace, UpdateWorkspaceBody } from './dto';
import { toPublicWorkspace } from './dto';

@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  @ApiOperation({ summary: 'List workspaces the caller is a member of.' })
  async list(@CurrentUser() user: User): Promise<PublicWorkspace[]> {
    const items = await this.workspaces.listForUser(user);
    return items.map((i) => toPublicWorkspace(i.workspace, i.membership));
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create a workspace. The caller becomes Owner.'
  })
  async create(
    @CurrentUser() user: User,
    @Body() body: CreateWorkspaceBody
  ): Promise<PublicWorkspace> {
    const { workspace, membership } = await this.workspaces.create(user, body);
    return toPublicWorkspace(workspace, membership);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a single workspace by id.' })
  async getOne(
    @CurrentUser() user: User,
    @Param('id') id: string
  ): Promise<PublicWorkspace> {
    const { workspace, membership } = await this.workspaces
      .getByIdForUser(id, user)
      .catch(() => {
        throw new NotFoundException({
          code: 'workspace_not_found',
          message: 'Workspace not found or inaccessible.'
        });
      });
    return toPublicWorkspace(workspace, membership);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a workspace (Owner/Admin).' })
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: UpdateWorkspaceBody
  ): Promise<PublicWorkspace> {
    const { workspace, membership } = await this.workspaces.rename({
      workspaceId: id,
      user,
      name: body.name
    });
    return toPublicWorkspace(workspace, membership);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Archive a workspace (Owner only). Children are hidden but data is preserved.'
  })
  async remove(
    @CurrentUser() user: User,
    @Param('id') id: string
  ): Promise<void> {
    await this.workspaces.softDelete({ workspaceId: id, user });
  }
}
