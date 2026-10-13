import { BadRequestException, Controller, Get, Headers, HttpCode, Param, Patch, Query, Sse, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiHeader, ApiOkResponse, ApiOperation, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { Observable } from 'rxjs';
import { CurrentUser } from '../identity/current-user.decorator';
import { ProjectContextParam, ProjectRoles, ProjectRolesGuard } from '../../common/rbac/guards';
import { CollaborationService } from '../collaboration/collaboration.service';
import { MentionsService } from './mentions.service';
import { MentionTimelineContent } from './timeline.dto';

class MentionCandidateResponse {
  @ApiProperty() id!: string;
  @ApiProperty() username!: string;
  @ApiProperty({ type: String, nullable: true }) displayName!: string | null;
}

class MentionProjectResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

class MentionEntryResponse {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() date!: string;
}

class MentionNotificationResponse {
  @ApiProperty() id!: string;
  @ApiProperty() workspaceId!: string;
  @ApiProperty({ type: MentionProjectResponse }) project!: MentionProjectResponse;
  @ApiProperty({ type: MentionEntryResponse }) entry!: MentionEntryResponse;
  @ApiProperty({ type: MentionCandidateResponse }) actor!: MentionCandidateResponse;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: String, nullable: true }) readAt!: string | null;
}

@ApiTags('mentions')
@Controller('projects/:projectId/mention-candidates')
@UseGuards(ProjectRolesGuard)
@ProjectRoles('Lead', 'Editor', 'Viewer')
export class MentionCandidatesController {
  constructor(private readonly mentions: MentionsService) {}

  @Get()
  @ApiOperation({ summary: 'List users eligible to be mentioned in this project.' })
  @ApiOkResponse({ type: MentionCandidateResponse, isArray: true })
  list(@ProjectContextParam() ctx: { project: Parameters<MentionsService['candidates']>[0] }) {
    return this.mentions.candidates(ctx.project);
  }
}

@ApiTags('mentions')
@Controller('notifications')
export class MentionNotificationsController {
  constructor(
    private readonly mentions: MentionsService,
    private readonly collaboration: CollaborationService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List mentions addressed to the signed-in user.' })
  @ApiOkResponse({ type: MentionNotificationResponse, isArray: true })
  list(@CurrentUser() user: User) {
    return this.mentions.listForUser(user.id);
  }

  @Sse('events')
  @ApiExcludeEndpoint()
  events(@CurrentUser() user: User): Observable<{ type: string; data: unknown }> {
    return this.collaboration.streamMentions(user.id);
  }

  @Patch(':id/read')
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark one of the signed-in user’s mentions as read.' })
  async markRead(@CurrentUser() user: User, @Param('id') id: string): Promise<void> {
    await this.mentions.markRead(user.id, id);
  }
}

@ApiTags('mentions')
@Controller('mentions')
export class MentionTimelineController {
  constructor(private readonly mentions: MentionsService) {}

  @Get('timeline')
  @ApiHeader({ name: 'X-SyncPath-User-Id', required: false })
  @ApiQuery({ name: 'workspaceIds', required: false, type: String, description: 'Comma separated project IDs; omitted means all projects, empty means none.' })
  @ApiOperation({ summary: 'Combine the signed-in user’s currently accessible mentioned cards on one timeline.' })
  @ApiOkResponse({ type: MentionTimelineContent })
  timeline(@CurrentUser() user: User, @Headers('x-syncpath-user-id') expectedUserId?: string, @Query('workspaceIds') workspaceIds?: string): Promise<MentionTimelineContent> {
    if (expectedUserId !== undefined && expectedUserId !== user.id) throw new UnauthorizedException('Session changed');
    let selected: string[] | undefined;
    if (workspaceIds !== undefined) {
      if (typeof workspaceIds !== 'string') throw new BadRequestException({ code: 'invalid_workspace_filter', message: 'workspaceIds must be comma-separated IDs.' });
      selected = workspaceIds === '' ? [] : [...new Set(workspaceIds.split(','))];
      if (selected.length > 100 || selected.some((id) => !/^[a-zA-Z0-9_-]{1,100}$/.test(id))) throw new BadRequestException({ code: 'invalid_workspace_filter', message: 'workspaceIds must contain at most 100 valid IDs.' });
    }
    return this.mentions.timeline(user.id, selected);
  }
}
