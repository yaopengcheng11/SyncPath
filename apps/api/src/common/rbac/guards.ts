import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { Project, ProjectRole, Workspace, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  hasProjectAuthority,
  type Permission
} from '@syncpath/domain';

// Re-export the param decorators so controllers only need one import path.
export {
  WorkspaceContext,
  ProjectContextParam,
  type WorkspaceContext as WorkspaceContextType,
  type ProjectContext as ProjectContextType
} from './project-role.decorator';

/**
 * Key for the required-workspace-role metadata.
 *
 * Usage:
 *   @WorkspaceRoles('Owner', 'Admin', 'Member')
 *   @Get() ...
 */
export const WORKSPACE_ROLES_KEY = 'rbac:workspaceRoles';
export const PROJECT_ROLES_KEY = 'rbac:projectRoles';
export const REQUIRED_PERMISSIONS_KEY = 'rbac:permissions';

export const WorkspaceRoles = (...roles: WorkspaceRole[]) =>
  (target: object, key?: string | symbol, descriptor?: PropertyDescriptor): void => {
    if (descriptor && key !== undefined) {
      Reflect.defineMetadata(WORKSPACE_ROLES_KEY, roles, descriptor.value);
      return;
    }
    Reflect.defineMetadata(WORKSPACE_ROLES_KEY, roles, target);
  };

export const ProjectRoles = (...roles: ProjectRole[]) =>
  (target: object, key?: string | symbol, descriptor?: PropertyDescriptor): void => {
    if (descriptor && key !== undefined) {
      Reflect.defineMetadata(PROJECT_ROLES_KEY, roles, descriptor.value);
      return;
    }
    Reflect.defineMetadata(PROJECT_ROLES_KEY, roles, target);
  };

export const RequirePermissions = (...permissions: Permission[]) =>
  (target: object, key?: string | symbol, descriptor?: PropertyDescriptor): void => {
    if (descriptor && key !== undefined) {
      Reflect.defineMetadata(REQUIRED_PERMISSIONS_KEY, permissions, descriptor.value);
      return;
    }
    Reflect.defineMetadata(REQUIRED_PERMISSIONS_KEY, permissions, target);
  };

/**
 * Loads the workspace + caller's workspace role and enforces the metadata
 * declared by @WorkspaceRoles(). Attaches the context to the request as
 * `req.workspaceCtx`.
 */
@Injectable()
export class WorkspaceRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<WorkspaceRole[] | undefined>(
      WORKSPACE_ROLES_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest & {
      workspaceCtx?: { workspace: Workspace; workspaceRole: WorkspaceRole };
      user?: { id: string };
    }>();
    if (!req.user) {
      throw new ForbiddenException({
        code: 'no_user',
        message: 'Authentication required.'
      });
    }
    const workspaceId = this.extractWorkspaceId(req);
    if (!workspaceId) {
      throw new NotFoundException({
        code: 'workspace_not_found',
        message: 'Workspace id missing from request.'
      });
    }

    const membership = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: req.user.id } },
      include: { workspace: true }
    });
    if (!membership || membership.workspace.deletedAt) {
      // Mask existence: a missing workspace and a non-member return the
      // same 404 to avoid leaking workspace ids (docs §7.2).
      throw new NotFoundException({
        code: 'workspace_not_found',
        message: 'Workspace not found or inaccessible.'
      });
    }
    if (!required.includes(membership.role)) {
      throw new ForbiddenException({
        code: 'insufficient_workspace_role',
        message: `One of [${required.join(', ')}] required; caller has ${membership.role}.`
      });
    }
    req.workspaceCtx = { workspace: membership.workspace, workspaceRole: membership.role };
    return true;
  }

  private extractWorkspaceId(req: FastifyRequest): string | null {
    // Prefer explicit param; fall back to body.workspaceId for POST that
    // creates the workspace-child resource.
    const params = (req as unknown as { params?: Record<string, string> }).params ?? {};
    return params.workspaceId ?? params.workspace_id ?? null;
  }
}

/**
 * Loads the project + caller's project role and enforces the metadata
 * declared by @ProjectRoles(). Implicitly enforces a workspace membership
 * check first.
 *
 * Two URL shapes are supported:
 *   - `/projects/:projectId/...` — direct project id in the path.
 *   - `/entries/:id` — entry id in the path; we look up the owning project
 *     first so the role check has the same context.
 */
@Injectable()
export class ProjectRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<ProjectRole[] | undefined>(
      PROJECT_ROLES_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest & {
      projectCtx?: {
        workspace: Workspace;
        workspaceRole: WorkspaceRole;
        project: Project;
        projectRole: ProjectRole;
      };
      user?: { id: string };
    }>();
    if (!req.user) {
      throw new ForbiddenException({ code: 'no_user', message: 'Authentication required.' });
    }
    const { projectId, ambiguousEntryId } = await this.extractTargetId(req);
    if (!projectId && !ambiguousEntryId) {
      throw new NotFoundException({
        code: 'project_not_found',
        message: 'Project id missing from request.'
      });
    }

    let project: Project & { workspace: Workspace } | null = null;
    if (projectId) {
      project = (await this.prisma.project.findUnique({
        where: { id: projectId },
        include: { workspace: true }
      })) as (Project & { workspace: Workspace }) | null;
      // RV-10 (complete): a soft-deleted parent workspace hides its
      // children. We check here too so the top-level projectRoutes that
      // include the workspace also 404.
      if (project && (project.deletedAt || project.workspace.deletedAt)) {
        project = null;
      }
    } else if (ambiguousEntryId) {
      // First try the project table — `/projects/:id` and `/entries/:id`
      // both use `params.id`, so the same id may refer to either. Project
      // is the much more common case for entry-level routes that decorate
      // a sibling controller (e.g. listing entries of an unknown project).
      project = (await this.prisma.project.findUnique({
        where: { id: ambiguousEntryId },
        include: { workspace: true }
      })) as (Project & { workspace: Workspace }) | null;
      if (!project || project.deletedAt || project.workspace.deletedAt) {
        const entry = await this.prisma.progressEntry.findUnique({
          where: { id: ambiguousEntryId }
        });
        if (!entry || entry.deletedAt) {
          throw new NotFoundException({
            code: 'project_not_found',
            message: 'Project not found or inaccessible.'
          });
        }
        project = (await this.prisma.project.findUnique({
          where: { id: entry.projectId },
          include: { workspace: true }
        })) as (Project & { workspace: Workspace }) | null;
      }
    }
    if (!project || project.deletedAt || project.workspace.deletedAt) {
      throw new NotFoundException({
        code: 'project_not_found',
        message: 'Project not found or inaccessible.'
      });
    }
    const workspaceMembership = await this.prisma.membership.findUnique({
      where: {
        workspaceId_userId: { workspaceId: project.workspaceId, userId: req.user.id }
      }
    });
    if (!workspaceMembership) {
      throw new NotFoundException({
        code: 'project_not_found',
        message: 'Project not found or inaccessible.'
      });
    }

    if (workspaceMembership.role === 'Owner') {
      req.projectCtx = {
        workspace: project.workspace,
        workspaceRole: 'Owner',
        project,
        projectRole: 'Lead'
      };
      return true;
    }

    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: req.user.id } }
    });
    const projectRole: ProjectRole | null =
      workspaceMembership.role === 'Admin' ? 'Lead' : member?.role ?? null;

    if (!projectRole || !required.some((r) => hasProjectAuthority(projectRole!, r))) {
      throw new ForbiddenException({
        code: 'insufficient_project_role',
        message: `One of [${required.join(', ')}] required; caller has ${
          projectRole ?? 'none'
        }.`
      });
    }
    req.projectCtx = {
      workspace: project.workspace,
      workspaceRole: workspaceMembership.role,
      project,
      projectRole
    };
    return true;
  }

  private async extractTargetId(
    req: FastifyRequest
  ): Promise<{ projectId: string | null; ambiguousEntryId: string | null }> {
    const params = (req as unknown as { params?: Record<string, string> }).params ?? {};
    const projectId = params.projectId ?? params.project_id ?? null;
    const entryLikeId = params.id ?? null;
    if (projectId) return { projectId, ambiguousEntryId: null };
    if (!entryLikeId) return { projectId: null, ambiguousEntryId: null };
    // /entries/:id — we don't know yet whether the id belongs to an entry
    // or a project. Resolve at the caller to avoid an extra query here.
    return { projectId: null, ambiguousEntryId: entryLikeId };
  }
}
