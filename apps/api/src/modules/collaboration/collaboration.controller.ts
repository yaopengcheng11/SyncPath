import { Body, Controller, Delete, HttpCode, Param, Post, Query, Sse, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import type { User } from '@prisma/client';
import { CurrentUser } from '../identity/current-user.decorator';
import { ProjectContextParam, ProjectRoles, ProjectRolesGuard } from '../../common/rbac/guards';
import { CollaborationService } from './collaboration.service';

class PresenceBody {
  @ApiProperty({ required: false, example: 'Editing' })
  action?: string;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  targetId?: string | null;

  @ApiProperty({ required: false, description: 'Opaque token identifying this browser connection.' })
  clientId?: string;
}

@ApiTags('collaboration')
@Controller('projects/:projectId')
@UseGuards(ProjectRolesGuard)
@ProjectRoles('Lead', 'Editor', 'Viewer')
export class CollaborationController {
  constructor(private readonly collaboration: CollaborationService) {}

  @Sse('events')
  @ApiExcludeEndpoint()
  events(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @ProjectContextParam() _ctx: unknown
  ): Observable<{ type: string; data: unknown; id?: string }> {
    return this.collaboration.stream(projectId, user.id);
  }

  @Post('presence')
  @HttpCode(204)
  @ApiExcludeEndpoint()
  heartbeat(
    @CurrentUser() user: User,
    @ProjectContextParam() ctx: { project: { id: string } },
    @Body() body: PresenceBody
  ): void {
    this.collaboration.heartbeat({ projectId: ctx.project.id, user, action: body.action, targetId: body.targetId, clientId: body.clientId });
  }

  @Delete('presence')
  @HttpCode(204)
  @ApiExcludeEndpoint()
  leave(
    @CurrentUser() user: User,
    @ProjectContextParam() ctx: { project: { id: string } },
    @Query('clientId') clientId?: string
  ): void {
    this.collaboration.leave(ctx.project.id, user, clientId);
  }
}
