import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException
} from '@nestjs/common';
import type { Project, ProjectRole, Workspace, WorkspaceRole } from '@prisma/client';

/**
 * Workspace-level context attached by {@link WorkspaceRolesGuard}.
 */
export interface WorkspaceContext {
  workspace: Workspace;
  workspaceRole: WorkspaceRole;
}

export interface ProjectContext extends WorkspaceContext {
  project: Project;
  projectRole: ProjectRole;
}

/**
 * Extracts the workspace context attached by {@link WorkspaceRolesGuard}.
 *
 * Usage:  @WorkspaceContext() ctx: WorkspaceContext
 */
export const WorkspaceContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkspaceContext => {
    const req = ctx.switchToHttp().getRequest<{ workspaceCtx?: WorkspaceContext }>();
    if (!req.workspaceCtx) {
      throw new ForbiddenException({
        code: 'no_workspace_context',
        message: 'Workspace context missing; route must declare @WorkspaceRoles().'
      });
    }
    return req.workspaceCtx;
  }
);

export const ProjectContextParam = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ProjectContext => {
    const req = ctx.switchToHttp().getRequest<{ projectCtx?: ProjectContext }>();
    if (!req.projectCtx) {
      throw new ForbiddenException({
        code: 'no_project_context',
        message: 'Project context missing; route must declare @ProjectRoles().'
      });
    }
    return req.projectCtx;
  }
);
