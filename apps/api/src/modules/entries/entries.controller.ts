import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../identity/current-user.decorator';
import { ProjectRolesGuard } from '../../common/rbac/guards';
import { ProjectRoles, ProjectContextParam } from '../../common/rbac/guards';
import type { User } from '@prisma/client';
import { EntriesService } from './entries.service';
import { CollaborationService } from '../collaboration/collaboration.service';
import {
  CreateEntryBody,
  PublicEntry,
  UpdateEntryBody,
  toPublicEntry
} from './dto';

/**
 * Routes nested under a project path. The ProjectRolesGuard enforces the
 * caller's role and attaches project + workspace context to the request.
 *
 * List + get-one are open to Viewers; create/update/delete require Editor+.
 */
@ApiTags('entries')
@Controller('projects/:projectId/entries')
@UseGuards(ProjectRolesGuard)
@ProjectRoles('Lead', 'Editor', 'Viewer')
export class ProjectEntriesController {
  constructor(
    private readonly entries: EntriesService,
    private readonly collaboration: CollaborationService
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List progress entries for a project (optional ?from & ?to).'
  })
  async list(
    @ProjectContextParam() ctx: { project: { id: string } },
    @Query('from') from?: string,
    @Query('to') to?: string
  ): Promise<PublicEntry[]> {
    const rows = await this.entries.listForProject({
      projectId: ctx.project.id,
      from,
      to
    });
    return rows.map(toPublicEntry);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a progress entry.' })
  @ProjectRoles('Lead', 'Editor')
  async create(
    @CurrentUser() user: User,
    @ProjectContextParam() ctx: { project: { id: string; startDate: Date; endDate: Date } },
    @Body() body: CreateEntryBody
  ): Promise<PublicEntry> {
    const entry = await this.entries.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      project: ctx.project as any,
      user,
      body
    });
    this.collaboration.publish({ projectId: entry.projectId, type: 'entry.created', actor: user, data: { entryId: entry.id } });
    return toPublicEntry(entry);
  }
}

/**
 * Routes keyed by the entry id directly. Used for PATCH and DELETE so that
 * the URL doesn't leak the projectId (we already resolve the project from
 * the entry itself).
 *
 * Every method carries an explicit @ProjectRoles() so the ProjectRolesGuard
 * never falls through to "no metadata → allow" (RV-01).
 */
@ApiTags('entries')
@Controller('entries')
@UseGuards(ProjectRolesGuard)
export class EntryActionsController {
  constructor(
    private readonly entries: EntriesService,
    private readonly collaboration: CollaborationService
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a progress entry by id.' })
  @ProjectRoles('Lead', 'Editor', 'Viewer')
  async getOne(@Param('id') id: string): Promise<PublicEntry> {
    const entry = await this.entries.getById(id);
    return toPublicEntry(entry);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a progress entry (revision-checked via expectedRevision).'
  })
  @ProjectRoles('Lead', 'Editor')
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: UpdateEntryBody
  ): Promise<PublicEntry> {
    const entry = await this.entries.getById(id);
    const updated = await this.entries.update({ entry, user, changes: body });
    this.collaboration.publish({ projectId: updated.projectId, type: 'entry.updated', actor: user, data: { entryId: updated.id } });
    return toPublicEntry(updated);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Soft-delete a progress entry (revision-checked via expectedRevision).'
  })
  @ApiQuery({
    name: 'expectedRevision',
    required: false,
    description: 'Optimistic-lock revision of the card the caller last saw.'
  })
  @HttpCode(204)
  @ProjectRoles('Lead', 'Editor')
  async remove(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Query('expectedRevision') expectedRevision?: string
  ): Promise<void> {
    const entry = await this.entries.getById(id);
    const parsed =
      expectedRevision === undefined || expectedRevision === ''
        ? undefined
        : Number(expectedRevision);
    if (parsed !== undefined && !Number.isInteger(parsed)) {
      throw new ConflictException({
        code: 'invalid_expected_revision',
        message: 'expectedRevision must be an integer.'
      });
    }
    await this.entries.softDelete({ entry, expectedRevision: parsed });
    this.collaboration.publish({ projectId: entry.projectId, type: 'entry.deleted', actor: user, data: { entryId: entry.id } });
  }
}
