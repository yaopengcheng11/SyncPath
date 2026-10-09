// Permission constants and capability checks.
//
// Source of truth: docs/SYNCPATH_DEVELOPMENT_FRAMEWORK_ACCEPTANCE.md §7.1
// ("每条请求验证 '身份有效 → 工作区成员 → 项目可见 → 操作允许 → 对象状态允许'").
//
// Permissions are namespaced strings of the form "<resource>:<action>".
// Add new entries here when introducing new capabilities; do not sprinkle
// string literals through handlers.

import {
  ProjectRole,
  WorkspaceRole,
  projectRoleAtLeast,
  workspaceRoleAtLeast
} from './roles';

export const PERMISSIONS = [
  // Workspace-level
  'workspace:read',
  'workspace:update',
  'workspace:delete',
  'workspace:manage_members',
  'workspace:invite_members',

  // Project-level
  'project:create',
  'project:read',
  'project:update',
  'project:delete',
  'project:archive',
  'project:manage_members',

  // Progress entries (WorkLog in legacy terminology)
  'progress_entry:create',
  'progress_entry:read',
  'progress_entry:update',
  'progress_entry:delete',

  // Comments (R0 must-have)
  'comment:create',
  'comment:read',
  'comment:update_own',
  'comment:delete_own'
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Default workspace-level permission matrix. Project Lead/Editor/Viewer
 * are layered on top — see {@link projectPermissionsFor}.
 *
 * Owners inherit everything. Admins inherit everything except destructive
 * workspace-level actions. Members get read + invite-only.
 */
const WORKSPACE_MATRIX: Record<WorkspaceRole, ReadonlySet<Permission>> = {
  Owner: new Set<Permission>([
    'workspace:read', 'workspace:update', 'workspace:delete',
    'workspace:manage_members', 'workspace:invite_members',
    'project:create', 'project:read', 'project:update', 'project:delete',
    'project:archive', 'project:manage_members',
    'progress_entry:create', 'progress_entry:read',
    'progress_entry:update', 'progress_entry:delete',
    'comment:create', 'comment:read', 'comment:update_own', 'comment:delete_own'
  ]),
  Admin: new Set<Permission>([
    'workspace:read', 'workspace:update',
    'workspace:manage_members', 'workspace:invite_members',
    'project:create', 'project:read', 'project:update', 'project:delete',
    'project:archive', 'project:manage_members',
    'progress_entry:create', 'progress_entry:read',
    'progress_entry:update', 'progress_entry:delete',
    'comment:create', 'comment:read', 'comment:update_own', 'comment:delete_own'
  ]),
  Member: new Set<Permission>([
    'workspace:read',
    'workspace:invite_members',
    'project:create', 'project:read',
    'progress_entry:create', 'progress_entry:read',
    'progress_entry:update', 'progress_entry:delete',
    'comment:create', 'comment:read', 'comment:update_own', 'comment:delete_own'
  ])
};

const PROJECT_MATRIX: Record<ProjectRole, ReadonlySet<Permission>> = {
  Lead: new Set<Permission>([
    'project:read', 'project:update', 'project:delete', 'project:archive',
    'project:manage_members',
    'progress_entry:create', 'progress_entry:read',
    'progress_entry:update', 'progress_entry:delete',
    'comment:create', 'comment:read', 'comment:update_own', 'comment:delete_own'
  ]),
  Editor: new Set<Permission>([
    'project:read', 'project:update',
    'progress_entry:create', 'progress_entry:read',
    'progress_entry:update', 'progress_entry:delete',
    'comment:create', 'comment:read', 'comment:update_own', 'comment:delete_own'
  ]),
  Viewer: new Set<Permission>([
    'project:read',
    'progress_entry:read',
    'comment:read'
  ])
};

export function workspacePermissionsFor(role: WorkspaceRole): ReadonlySet<Permission> {
  return WORKSPACE_MATRIX[role];
}

export function projectPermissionsFor(role: ProjectRole): ReadonlySet<Permission> {
  return PROJECT_MATRIX[role];
}

/**
 * Capability union for a user with both a workspace role and (optionally) a
 * project role. Project role grants take precedence over the workspace
 * baseline for project-scoped permissions.
 */
export function capabilitiesFor(input: {
  workspaceRole: WorkspaceRole;
  projectRole?: ProjectRole;
}): ReadonlySet<Permission> {
  const merged = new Set<Permission>(WORKSPACE_MATRIX[input.workspaceRole]);
  if (input.projectRole) {
    for (const p of PROJECT_MATRIX[input.projectRole]) {
      merged.add(p);
    }
  }
  return merged;
}

export function can(
  capabilities: ReadonlySet<Permission>,
  permission: Permission
): boolean {
  return capabilities.has(permission);
}

/**
 * Convenient guard: returns true iff the workspace role is at least the
 * supplied minimum. Used by handlers that don't need the full capability
 * matrix (e.g. /api/v1/workspaces list endpoints).
 */
export function hasWorkspaceAuthority(
  actual: WorkspaceRole,
  minimum: WorkspaceRole
): boolean {
  return workspaceRoleAtLeast(actual, minimum);
}

export function hasProjectAuthority(
  actual: ProjectRole,
  minimum: ProjectRole
): boolean {
  return projectRoleAtLeast(actual, minimum);
}
