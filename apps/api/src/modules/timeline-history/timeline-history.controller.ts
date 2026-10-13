import { BadRequestException, Controller, Get, Headers, Param, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { ProjectRoles, ProjectRolesGuard } from '../../common/rbac/guards';
import { CurrentUser } from '../identity/current-user.decorator';
import { TimelineVersionDetail, TimelineVersionPage } from './dto';
import { TimelineHistoryService } from './timeline-history.service';

@ApiTags('timeline-history')
@Controller('projects/:projectId/timeline-versions')
@UseGuards(ProjectRolesGuard)
@ProjectRoles('Lead')
export class TimelineHistoryController {
  constructor(private readonly history: TimelineHistoryService) {}

  @Get()
  @ApiHeader({ name: 'X-SyncPath-User-Id', required: false })
  @ApiQuery({ name: 'beforeVersion', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({ summary: 'List immutable timeline versions (task Lead or project administrator only).' })
  @ApiOkResponse({ type: TimelineVersionPage })
  list(@Param('projectId') projectId: string, @CurrentUser() user: User, @Headers('x-syncpath-user-id') expectedUserId?: string, @Query('beforeVersion') beforeVersion?: string, @Query('limit') limit?: string): Promise<TimelineVersionPage> {
    this.checkUser(user, expectedUserId);
    const before = beforeVersion === undefined ? undefined : this.integer(beforeVersion, 0, Number.MAX_SAFE_INTEGER);
    const size = limit === undefined ? 20 : this.integer(limit, 1, 50);
    return this.history.list(projectId, before, size);
  }

  @Get(':versionId')
  @ApiHeader({ name: 'X-SyncPath-User-Id', required: false })
  @ApiOperation({ summary: 'Inspect a historical timeline snapshot and its field changes.' })
  @ApiOkResponse({ type: TimelineVersionDetail })
  detail(@Param('projectId') projectId: string, @Param('versionId') versionId: string, @CurrentUser() user: User, @Headers('x-syncpath-user-id') expectedUserId?: string): Promise<TimelineVersionDetail> {
    this.checkUser(user, expectedUserId);
    return this.history.detail(projectId, versionId);
  }

  private checkUser(user: User, expected?: string): void { if (expected !== undefined && expected !== user.id) throw new UnauthorizedException('Session changed'); }
  private integer(value: string, min: number, max: number): number {
    const parsed = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new BadRequestException({ code: 'invalid_pagination', message: 'Pagination parameters are outside the allowed integer range.' });
    return parsed;
  }
}
