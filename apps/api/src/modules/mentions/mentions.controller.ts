import { Controller, Get, HttpCode, Param, Patch, Sse, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { Observable } from 'rxjs';
import { CurrentUser } from '../identity/current-user.decorator';
import { ProjectContextParam, ProjectRoles, ProjectRolesGuard } from '../../common/rbac/guards';
import { CollaborationService } from '../collaboration/collaboration.service';
import { MentionsService } from './mentions.service';

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
