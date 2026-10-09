import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../identity/current-user.decorator';
import { CreatedShareLink, PublicShareLink, ResolveShareLinkBody, SharedContent } from './dto';
import { SharingService } from './sharing.service';

// SessionAuthGuard applies globally. This controller intentionally grants no
// project/workspace membership and exposes no unauthenticated preview route.
@ApiTags('sharing')
@Controller()
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Post('workspaces/:workspaceId/share-links')
  @ApiOperation({ summary: 'Create a read-only share link for a workspace (administrator only).' })
  @ApiResponse({ status: 201, type: CreatedShareLink })
  createWorkspace(@Param('workspaceId') id: string, @CurrentUser() user: User): Promise<CreatedShareLink> {
    return this.sharing.createForWorkspace(id, user);
  }

  @Get('workspaces/:workspaceId/share-links')
  @ApiOperation({ summary: 'List workspace share metadata; raw tokens are never returned.' })
  @ApiResponse({ status: 200, type: [PublicShareLink] })
  listWorkspace(@Param('workspaceId') id: string, @CurrentUser() user: User): Promise<PublicShareLink[]> {
    return this.sharing.listForWorkspace(id, user);
  }

  @Post('projects/:projectId/share-links')
  @ApiOperation({ summary: 'Create a read-only share link for one project (Lead or workspace administrator).' })
  @ApiResponse({ status: 201, type: CreatedShareLink })
  createProject(@Param('projectId') id: string, @CurrentUser() user: User): Promise<CreatedShareLink> {
    return this.sharing.createForProject(id, user);
  }

  @Get('projects/:projectId/share-links')
  @ApiOperation({ summary: 'List project share metadata; raw tokens are never returned.' })
  @ApiResponse({ status: 200, type: [PublicShareLink] })
  listProject(@Param('projectId') id: string, @CurrentUser() user: User): Promise<PublicShareLink[]> {
    return this.sharing.listForProject(id, user);
  }

  @Delete('share-links/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a link using current management permission on its actual target.' })
  revoke(@Param('id') id: string, @CurrentUser() user: User): Promise<void> {
    return this.sharing.revoke(id, user);
  }

  @Post('share-links/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve shared read-only content after authentication; token is sent in the body.' })
  @ApiResponse({ status: 200, type: SharedContent })
  resolve(@Body() body: ResolveShareLinkBody, @CurrentUser() user: User): Promise<SharedContent> {
    return this.sharing.resolve(body?.token, user);
  }
}
