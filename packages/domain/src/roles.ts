// Workspace-level roles.
//
// Source of truth: docs/SYNCPATH_DEVELOPMENT_FRAMEWORK_ACCEPTANCE.md §7.1
// ("MVP 工作区角色 Owner / Admin / Member；项目角色 Lead / Editor / Viewer").
// Order matters — ranks are compared lexicographically where needed, and the
// Owner rank must outrank Admin which must outrank Member.

export const WORKSPACE_ROLES = ['Owner', 'Admin', 'Member'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PROJECT_ROLES = ['Lead', 'Editor', 'Viewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const PROJECT_VISIBILITY = ['private', 'workspace'] as const;
export type ProjectVisibility = (typeof PROJECT_VISIBILITY)[number];

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === 'string'
    && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string'
    && (PROJECT_ROLES as readonly string[]).includes(value);
}

// Rank helper — higher = stronger authority.
const WORKSPACE_RANK: Record<WorkspaceRole, number> = {
  Owner: 3,
  Admin: 2,
  Member: 1
};

const PROJECT_RANK: Record<ProjectRole, number> = {
  Lead: 3,
  Editor: 2,
  Viewer: 1
};

export function workspaceRoleAtLeast(
  actual: WorkspaceRole,
  minimum: WorkspaceRole
): boolean {
  return WORKSPACE_RANK[actual] >= WORKSPACE_RANK[minimum];
}

export function projectRoleAtLeast(
  actual: ProjectRole,
  minimum: ProjectRole
): boolean {
  return PROJECT_RANK[actual] >= PROJECT_RANK[minimum];
}
