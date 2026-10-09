/**
 * SyncPath API client (DEV-006).
 *
 * Types are generated from `packages/contracts/openapi.json` via
 * `openapi-typescript` (`npm run generate -w @syncpath/api-client`).
 * The runtime wrapper here is intentionally small: a fetch-based
 * client that targets `${baseUrl}` (default `/api/v1`) and sends the
 * session cookie via `credentials: 'include'`.
 *
 * Conventions:
 *   - Same-origin in dev (Vite proxy) and prod (same-site reverse proxy),
 *     so we never have to handle the token in JS.
 *   - Errors throw {@link ApiError} with the standard envelope parsed out
 *     of the JSON body. Non-JSON failures keep the original message.
 */
import type { components, paths } from './generated';

// ─── Re-exports for downstream apps ─────────────────────────────────────

export type PublicUser = components['schemas']['PublicUser'];
export type SessionResponse = components['schemas']['SessionResponse'];
export type PublicWorkspace = components['schemas']['PublicWorkspace'];
export type CreateWorkspaceBody = { name: string; slug?: string };
export type UpdateWorkspaceBody = { name: string };
export type PublicProject = components['schemas']['PublicProject'];
export type CreateProjectBody = components['schemas']['CreateProjectBody'];
export type UpdateProjectBody = components['schemas']['UpdateProjectBody'];
export type PublicEntry = components['schemas']['PublicEntry'];
export type CreateEntryBody = components['schemas']['CreateEntryBody'];
export type UpdateEntryBody = components['schemas']['UpdateEntryBody'];
export type PublicMentionCandidate = components['schemas']['MentionCandidateResponse'];
export type PublicMentionNotification = components['schemas']['MentionNotificationResponse'];
export type ProjectRole = 'Lead' | 'Editor' | 'Viewer';
export interface PublicProjectMember {
  user: {
    id: string;
    username: string;
    email: string;
    displayName: string | null;
  };
  role: ProjectRole;
  createdAt: string;
}
export type WorkspaceRole = 'Owner' | 'Admin' | 'Member';
export interface PublicWorkspaceMember {
  user: {
    id: string;
    username: string;
    email: string;
    displayName: string | null;
  };
  role: WorkspaceRole;
  createdAt: string;
}
export type RegisterBody = {
  email: string;
  username: string;
  password: string;
  displayName?: string;
};
export type LoginBody = { username: string; password: string };

// ─── Error envelope ─────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Client ─────────────────────────────────────────────────────────────

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  credentials?: RequestCredentials;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;
  private readonly credentials: RequestCredentials;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? '/api/v1').replace(/\/$/, '');
    this.doFetch = opts.fetch ?? fetch.bind(globalThis);
    this.credentials = opts.credentials ?? 'include';
  }

  // ─── sessions ─────────────────────────────────────────────────────

  register(body: RegisterBody): Promise<SessionResponse> {
    return this.request<SessionResponse>('POST', '/sessions/register', body);
  }

  login(body: LoginBody): Promise<SessionResponse> {
    return this.request<SessionResponse>('POST', '/sessions', body);
  }

  me(): Promise<SessionResponse> {
    return this.request<SessionResponse>('GET', '/sessions/me');
  }

  async logout(): Promise<void> {
    await this.request<{ ok: true }>('DELETE', '/sessions/me');
  }

  // ─── workspaces ──────────────────────────────────────────────────

  listWorkspaces(): Promise<PublicWorkspace[]> {
    return this.request<PublicWorkspace[]>('GET', '/workspaces');
  }

  createWorkspace(body: CreateWorkspaceBody): Promise<PublicWorkspace> {
    return this.request<PublicWorkspace>('POST', '/workspaces', body);
  }

  updateWorkspace(
    workspaceId: string,
    body: UpdateWorkspaceBody
  ): Promise<PublicWorkspace> {
    return this.request<PublicWorkspace>('PATCH', `/workspaces/${workspaceId}`, body);
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.request<null>('DELETE', `/workspaces/${workspaceId}`);
  }

  listWorkspaceMembers(workspaceId: string): Promise<PublicWorkspaceMember[]> {
    return this.request<PublicWorkspaceMember[]>('GET', `/workspaces/${workspaceId}/members`);
  }

  inviteWorkspaceMember(
    workspaceId: string,
    body: { identifier: string; role: WorkspaceRole }
  ): Promise<{ id: string; userId: string; role: WorkspaceRole }> {
    return this.request('POST', `/workspaces/${workspaceId}/members`, body);
  }

  changeWorkspaceMemberRole(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole
  ): Promise<{ id: string; userId: string; role: WorkspaceRole }> {
    return this.request('PATCH', `/workspaces/${workspaceId}/members/${userId}`, { role });
  }

  async removeWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
    await this.request<null>('DELETE', `/workspaces/${workspaceId}/members/${userId}`);
  }

  // ─── projects ─────────────────────────────────────────────────────

  listProjects(workspaceId: string): Promise<PublicProject[]> {
    return this.request<PublicProject[]>(
      'GET',
      `/workspaces/${workspaceId}/projects`
    );
  }

  createProject(
    workspaceId: string,
    body: CreateProjectBody
  ): Promise<PublicProject> {
    return this.request<PublicProject>(
      'POST',
      `/workspaces/${workspaceId}/projects`,
      body
    );
  }

  getProject(projectId: string): Promise<PublicProject> {
    return this.request<PublicProject>('GET', `/projects/${projectId}`);
  }

  updateProject(
    projectId: string,
    body: UpdateProjectBody
  ): Promise<PublicProject> {
    return this.request<PublicProject>('PATCH', `/projects/${projectId}`, body);
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.request<null>('DELETE', `/projects/${projectId}`);
  }

  // ─── entries ──────────────────────────────────────────────────────

  listEntries(projectId: string): Promise<PublicEntry[]> {
    return this.request<PublicEntry[]>(
      'GET',
      `/projects/${projectId}/entries`
    );
  }

  createEntry(
    projectId: string,
    body: CreateEntryBody
  ): Promise<PublicEntry> {
    return this.request<PublicEntry>(
      'POST',
      `/projects/${projectId}/entries`,
      body
    );
  }

  updateEntry(entryId: string, body: UpdateEntryBody): Promise<PublicEntry> {
    return this.request<PublicEntry>('PATCH', `/entries/${entryId}`, body);
  }

  async deleteEntry(entryId: string): Promise<void> {
    await this.request<null>('DELETE', `/entries/${entryId}`);
  }

  // ─── project members ─────────────────────────────────────────────

  listProjectMembers(projectId: string): Promise<PublicProjectMember[]> {
    return this.request<PublicProjectMember[]>('GET', `/projects/${projectId}/members`);
  }

  listMentionCandidates(projectId: string): Promise<PublicMentionCandidate[]> {
    return this.request('GET', `/projects/${projectId}/mention-candidates`);
  }

  listMentionNotifications(): Promise<PublicMentionNotification[]> {
    return this.request('GET', '/notifications');
  }

  async markMentionRead(notificationId: string): Promise<void> {
    await this.request<null>('PATCH', `/notifications/${notificationId}/read`);
  }

  inviteProjectMember(
    projectId: string,
    body: { identifier: string; role: ProjectRole }
  ): Promise<{ id: string; userId: string; role: ProjectRole }> {
    return this.request('POST', `/projects/${projectId}/members`, body);
  }

  changeProjectMemberRole(
    projectId: string,
    userId: string,
    role: ProjectRole
  ): Promise<{ id: string; userId: string; role: ProjectRole }> {
    return this.request('PATCH', `/projects/${projectId}/members/${userId}`, { role });
  }

  async removeProjectMember(projectId: string, userId: string): Promise<void> {
    await this.request<null>('DELETE', `/projects/${projectId}/members/${userId}`);
  }

  // ─── internals ────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const init: RequestInit = {
      method,
      credentials: this.credentials,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    let res: Response;
    try {
      res = await this.doFetch(`${this.baseUrl}${path}`, init);
    } catch (err) {
      throw new ApiError(
        err instanceof Error ? err.message : 'Network error',
        0
      );
    }

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // not JSON — leave parsed undefined
      }
    }

    if (!res.ok) {
      const envelope = (parsed ?? {}) as {
        code?: string;
        message?: string;
        details?: unknown;
      };
      throw new ApiError(
        envelope.message ?? `${method} ${path} → ${res.status}`,
        res.status,
        envelope.code,
        envelope.details
      );
    }
    if (res.status === 204) return null as unknown as T;
    return parsed as T;
  }
}

// Silence the unused-import warning: the generated `paths` namespace is
// available for downstream typed wrappers that want to drive individual
// operations by name. Keep the type import so the symbol is reachable.
type _Paths = paths;
