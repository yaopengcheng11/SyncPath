import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../identity/current-user.decorator';
import { CreatedShareLink, PublicShareLink, ReceivedShare, ResolveShareLinkBody, SharedContent } from './dto';
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
  @ApiHeader({ name: 'X-SyncPath-User-Id', required: false, description: 'Expected authenticated user ID; rejects a session changed by another browser tab.' })
  @ApiOperation({ summary: 'Resolve shared read-only content after authentication; token is sent in the body.' })
  @ApiResponse({ status: 200, type: SharedContent })
  resolve(@Body() body: ResolveShareLinkBody, @CurrentUser() user: User, @Headers('x-syncpath-user-id') expectedUserId?: string): Promise<SharedContent> {
    this.assertExpectedUser(user, expectedUserId);
    return this.sharing.resolve(body?.token, user);
  }

  @Get('received-shares')
  @ApiHeader({ name: 'X-SyncPath-User-Id', required: false, description: 'Expected authenticated user ID; rejects a session changed by another browser tab.' })
  @ApiOperation({ summary: 'List shares previously opened by the authenticated recipient, including unavailable snapshots.' })
  @ApiResponse({ status: 200, type: [ReceivedShare] })
  listReceived(@CurrentUser() user: User, @Headers('x-syncpath-user-id') expectedUserId?: string): Promise<ReceivedShare[]> {
    this.assertExpectedUser(user, expectedUserId);
    return this.sharing.listReceived(user);
  }

  @Post('received-shares/:id/resolve')
  @HttpCode(200)
  @ApiHeader({ name: 'X-SyncPath-User-Id', required: false, description: 'Expected authenticated user ID; rejects a session changed by another browser tab.' })
  @ApiOperation({ summary: 'Reopen a recipient-owned receipt after rechecking the original share link.' })
  @ApiResponse({ status: 200, type: SharedContent })
  resolveReceived(@Param('id') id: string, @CurrentUser() user: User, @Headers('x-syncpath-user-id') expectedUserId?: string): Promise<SharedContent> {
    this.assertExpectedUser(user, expectedUserId);
    return this.sharing.resolveReceived(id, user);
  }

  private assertExpectedUser(user: User, expectedUserId: string | undefined): void {
    // The session cookie remains the only authentication source. The optional
    // header binds a response/receipt side effect to the UI's current identity.
    if (expectedUserId !== undefined && expectedUserId !== user.id) throw new UnauthorizedException('Session changed');
  }
}
