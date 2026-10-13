import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import type { Project, ProjectRole, User, Workspace, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  newProjectId,
  newProgressEntryId,
  newProjectMemberId
} from '@syncpath/domain';
import { parseSafeDate } from '../../common/dates';
import { TimelineHistoryService } from '../timeline-history/timeline-history.service';

export interface ProjectListItem {
  project: Project;
  myRole: ProjectRole | null;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService, private readonly history: TimelineHistoryService) {}

  /**
   * List projects in a workspace the user can see. The "visible" set is:
   *   - private + workspace member
   *   - workspace-visibility + any workspace member
   *
   * Caller's own project role is returned alongside so the UI can show
   * "Lead / Editor / Viewer" badges without a second round-trip.
   */
  async listForUser(input: {
    workspaceId: string;
    user: User;
  }): Promise<ProjectListItem[]> {
    const membership = await this.prisma.membership.findUnique({
      where: {
        workspaceId_userId: { workspaceId: input.workspaceId, userId: input.user.id }
      }
    });
    if (!membership) {
      throw new NotFoundException({
        code: 'workspace_not_found',
        message: 'Workspace not found or inaccessible.'
      });
    }

    const projects = await this.prisma.project.findMany({
      where: {
        workspaceId: input.workspaceId,
        deletedAt: null,
        OR: [
          { visibility: 'workspace' },
          { visibility: 'private', members: { some: { userId: input.user.id } } }
        ]
      },
      orderBy: { createdAt: 'asc' }
    });

    const memberRows = await this.prisma.projectMember.findMany({
      where: {
        projectId: { in: projects.map((p) => p.id) },
        userId: input.user.id
      }
    });
    const memberMap = new Map<string, ProjectRole>(
      memberRows.map((m) => [m.projectId, m.role])
    );

    return projects.map((project) => ({
      project,
      myRole: memberMap.get(project.id) ?? null
    }));
  }

  async create(input: {
    workspaceId: string;
    workspaceRole: WorkspaceRole;
    user: User;
    body: {
      name: string;
      description?: string;
      startDate: string;
      endDate: string;
      visibility?: 'private' | 'workspace';
      color?: string;
      holidayRegion?: 'CN' | 'US' | 'NONE';
    };
  }): Promise<{ project: Project; myRole: ProjectRole }> {
    const name = (input.body.name ?? '').trim();
    if (!name) {
      throw new ConflictException({ code: 'invalid_name', message: 'Project name is required.' });
    }
    const startDate = parseSafeDate(input.body.startDate);
    const endDate = parseSafeDate(input.body.endDate);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new ConflictException({
        code: 'invalid_dates',
        message: 'startDate and endDate must be YYYY-MM-DD.'
      });
    }
    if (endDate.getTime() < startDate.getTime()) {
      throw new ConflictException({
        code: 'invalid_range',
        message: 'endDate must be on or after startDate.'
      });
    }
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: input.workspaceId }
    });
    if (!workspace || workspace.deletedAt) {
      throw new NotFoundException({
        code: 'workspace_not_found',
        message: 'Workspace not found or inaccessible.'
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          id: newProjectId(),
          workspaceId: workspace.id,
          creatorId: input.user.id,
          name,
          description: input.body.description ?? null,
          startDate,
          endDate,
          visibility: input.body.visibility ?? 'workspace',
          color: input.body.color ?? '#6366f1',
          holidayRegion: input.body.holidayRegion ?? 'NONE'
        }
      });
      // Creator becomes Lead by default.
      await tx.projectMember.create({
        data: {
          id: newProjectMemberId(),
          projectId: project.id,
          userId: input.user.id,
          role: 'Lead'
        }
      });
      return { project, myRole: 'Lead' as ProjectRole };
    });
  }

  async getById(input: {
    projectId: string;
    user: User;
    /** Optional URL workspace id; used to reject cross-workspace path forgery
     *  on the `/workspaces/:workspaceId/projects/:id` shape. */
    expectedWorkspaceId?: string;
  }): Promise<{ project: Project; myRole: ProjectRole | null; workspaceRole: WorkspaceRole }> {
    const project = await this.prisma.project.findUnique({
      where: { id: input.projectId },
      include: { workspace: true }
    });
    if (!project || project.deletedAt) {
      throw new NotFoundException({
        code: 'project_not_found',
        message: 'Project not found or inaccessible.'
      });
    }
    // RV-10 (complete): a soft-deleted parent workspace hides its children
    // too. We never reveal that the project exists — same 404 envelope as
    // for a missing record.
    if (project.workspace.deletedAt) {
      throw new NotFoundException({
        code: 'project_not_found',
        message: 'Project not found or inaccessible.'
      });
    }
    // URL/path forgery guard (RV-02): when the route shape carries a
    // workspace id we must match it to the project's actual workspace.
    if (
      input.expectedWorkspaceId &&
      input.expectedWorkspaceId !== project.workspaceId
    ) {
      throw new NotFoundException({
        code: 'project_not_found',
        message: 'Project not found or inaccessible.'
      });
    }
    const workspaceMembership = await this.prisma.membership.findUnique({
      where: {
        workspaceId_userId: { workspaceId: project.workspaceId, userId: input.user.id }
      }
    });
    if (!workspaceMembership) {
      throw new NotFoundException({
        code: 'project_not_found',
        message: 'Project not found or inaccessible.'
      });
    }
    // Visibility: private projects require an explicit project_members row.
    if (project.visibility === 'private') {
      const member = await this.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: project.id, userId: input.user.id } }
      });
      if (!member && workspaceMembership.role === 'Member') {
        throw new NotFoundException({
          code: 'project_not_found',
          message: 'Project not found or inaccessible.'
        });
      }
    }
    if (workspaceMembership.role === 'Owner' || workspaceMembership.role === 'Admin') {
      // Workspace Owner / Admin outrank per-project roles for read/write —
      // they can act as project Lead. The actual project_members row, if any,
      // is still authoritative for finer-grained operations like Lead-only
      // delete (handled in `assertCanWrite`).
      return {
        project,
        myRole: 'Lead',
        workspaceRole: workspaceMembership.role
      };
    }
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: input.user.id } }
    });
    return { project, myRole: member?.role ?? null, workspaceRole: workspaceMembership.role };
  }

  /**
   * Verify the caller has one of the required project roles. Owner /
   * Admin outrank; everyone else needs a project_members row.
   *
   * Returns 403 ForbiddenException (not 409) when the caller is
   * authenticated but lacks permission — docs §6.1 / §7.2 require
   * 403 for insufficient privileges. 409 is reserved for state
   * conflicts (optimistic lock failures, slug taken, etc.).
   */
  async assertCanWrite(input: {
    project: Project;
    user: User;
    required: ProjectRole[];
  }): Promise<void> {
    const { myRole, workspaceRole } = await this.getById({
      projectId: input.project.id,
      user: input.user
    });
    if (workspaceRole === 'Owner') return;
    if (!myRole || !input.required.some((r) => r === myRole)) {
      throw new ForbiddenException({
        code: 'insufficient_project_role',
        message: `One of [${input.required.join(', ')}] required; caller has ${
          myRole ?? 'none'
        }.`
      });
    }
  }

  async update(input: {
    project: Project;
    expectedRevision: number;
    user: User;
    changes: Partial<{
      name: string;
      description: string;
      startDate: string;
      endDate: string;
      visibility: 'private' | 'workspace';
      status: 'active';
      color: string;
      holidayRegion: 'CN' | 'US' | 'NONE';
    }>;
  }): Promise<Project> {
    await this.assertCanWrite({ project: input.project, user: input.user, required: ['Lead', 'Editor'] });
    if (input.changes.status !== undefined && input.changes.status !== 'active') {
      throw new BadRequestException({
        code: 'unsupported_project_status',
        message: 'Archiving is no longer supported. Permanently delete the task instead.'
      });
    }
    if (input.expectedRevision !== input.project.revision) {
      throw new ConflictException({
        code: 'revision_conflict',
        message: `expectedRevision ${input.expectedRevision} does not match current ${input.project.revision}.`
      });
    }

    const data: Record<string, unknown> = {
      revision: input.project.revision + 1
    };
    if (input.changes.name !== undefined) data.name = input.changes.name.trim();
    if (input.changes.description !== undefined) data.description = input.changes.description;
    if (input.changes.startDate !== undefined) {
      const d = parseSafeDate(input.changes.startDate);
      if (Number.isNaN(d.getTime())) {
        throw new ConflictException({ code: 'invalid_dates', message: 'Invalid startDate.' });
      }
      data.startDate = d;
    }
    if (input.changes.endDate !== undefined) {
      const d = parseSafeDate(input.changes.endDate);
      if (Number.isNaN(d.getTime())) {
        throw new ConflictException({ code: 'invalid_dates', message: 'Invalid endDate.' });
      }
      data.endDate = d;
    }
    // Same rule create() enforces: without this an update could invert the
    // timeline range that create() refuses to accept.
    const nextStart = (data.startDate as Date | undefined) ?? input.project.startDate;
    const nextEnd = (data.endDate as Date | undefined) ?? input.project.endDate;
    if (nextEnd.getTime() < nextStart.getTime()) {
      throw new ConflictException({
        code: 'invalid_range',
        message: 'endDate must be on or after startDate.'
      });
    }
    if (input.changes.visibility !== undefined) data.visibility = input.changes.visibility;
    if (input.changes.status !== undefined) data.status = input.changes.status;
    if (input.changes.color !== undefined) data.color = input.changes.color;
    if (input.changes.holidayRegion !== undefined) data.holidayRegion = input.changes.holidayRegion;

    if (Object.keys(data).length === 1) {
      // Only the revision was going to bump; return the unchanged row.
      return input.project;
    }

    // Atomic CAS update (RV-08): the WHERE clause includes the expected
    // revision, so two concurrent writers cannot both succeed — the
    // second one's affected-rows count is 0 and we surface 409.
    return this.prisma.$transaction(async (tx) => {
      const context = await this.history.begin(tx, input.project.id);
      const result = await tx.project.updateMany({
        where: {
          id: input.project.id,
          revision: input.project.revision,
          deletedAt: null
        },
        data
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'revision_conflict',
          message: `expectedRevision ${input.expectedRevision} no longer matches current revision.`
        });
      }
      await this.history.record(tx, context, input.user, 'project.updated');
      return tx.project.findUniqueOrThrow({ where: { id: input.project.id } });
    });
  }

  async delete(input: { project: Project; user: User }): Promise<void> {
    await this.assertCanWrite({
      project: input.project,
      user: input.user,
      required: ['Lead']
    });
    await this.prisma.$transaction(async (tx) => {
      await this.history.lock(tx, input.project.id);
      const links = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM share_links WHERE project_id = ${input.project.id} ORDER BY id FOR UPDATE
      `;
      await tx.receivedShare.deleteMany({ where: { linkId: { in: links.map((link) => link.id) } } });
      const result = await tx.project.deleteMany({
        where: { id: input.project.id, revision: input.project.revision, deletedAt: null }
      });
      if (result.count === 0) {
        throw new ConflictException({ code: 'revision_conflict', message: 'The task changed while you were reviewing it.' });
      }
    });
  }
}

/** Type-narrowing helper: pick only the IDs we need from a parsed entry. */
export interface ParsedProgressEntry {
  id: string;
  projectId: string;
  weekStartDate: string;
  authorId: string;
  title: string;
  level: 'primary' | 'secondary' | 'minor';
  summary?: string;
  notes?: string;
  status?: 'pending' | 'completed';
  revision?: number;
}

/** Convenience builder for legacy imports. Exported so the imports module
 *  doesn't have to duplicate the UUID helpers. */
export function buildProgressEntryId(): string {
  return newProgressEntryId();
}
