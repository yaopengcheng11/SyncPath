// apps/web/src/hooks/useApiData.ts
//
// Lightweight React hook that mirrors the small subset of data the SPA
// needs from the SyncPath API. We intentionally avoid React Query for
// R0/G1 — the request volume is low and we already have a fetch wrapper.
// Replace with TanStack Query when DEV-006 lands the OpenAPI-generated
// react-query hooks (the wiring point is `apiClient` here).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, ApiError } from '../services/api';
import type {
  PublicEntry,
  PublicProject,
  PublicUser,
  PublicWorkspace
} from '@syncpath/api-client';

interface ApiDataState {
  /** Result of the bootstrap /me probe; null while loading, undefined when the user is not signed in. */
  user: PublicUser | null | undefined;
  workspaces: PublicWorkspace[];
  projects: Record<string, PublicProject[]>; // by workspaceId
  entries: Record<string, PublicEntry[]>;     // by projectId
  loading: boolean;
  error: string | null;
}

const EMPTY_STATE: ApiDataState = {
  user: undefined,
  workspaces: [],
  projects: {},
  entries: {},
  loading: false,
  error: null
};

/**
 * Boot-time authentication + data fetch.
 *
 *  - On mount: probe /api/v1/sessions/me. If it succeeds we already have
 *    a valid cookie; otherwise the user is signed out.
 *  - After sign-in (login/register) the consumer calls {@link ApiData.signIn}.
 *  - Mutations (createProject, createEntry, etc.) update the cache in place
 *    so the UI reflects the change without a full reload.
 */
export interface ApiData extends ApiDataState {
  signIn: (user: PublicUser) => Promise<void>;
  signOut: () => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  createWorkspace: (
    body: Parameters<typeof apiClient.createWorkspace>[0]
  ) => Promise<PublicWorkspace>;
  updateWorkspace: (
    workspaceId: string,
    body: Parameters<typeof apiClient.updateWorkspace>[1]
  ) => Promise<PublicWorkspace>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  refreshProjects: (workspaceId: string) => Promise<PublicProject[]>;
  refreshEntries: (projectId: string) => Promise<PublicEntry[]>;
  createProject: (
    workspaceId: string,
    body: {
      name: string;
      description?: string;
      startDate: string;
      endDate: string;
      color?: string;
      holidayRegion?: 'CN' | 'US' | 'NONE';
      visibility?: 'private' | 'workspace';
    }
  ) => Promise<PublicProject>;
  updateProject: (
    projectId: string,
    body: Parameters<typeof apiClient.updateProject>[1]
  ) => Promise<PublicProject>;
  deleteProject: (projectId: string) => Promise<void>;
  createEntry: (
    projectId: string,
    body: {
      weekStartDate: string;
      title: string;
      level: 'primary' | 'secondary' | 'minor';
      summary?: string;
      notes?: string;
      mentionAll?: boolean;
      mentionedUserIds?: string[];
      status?: 'pending' | 'completed';
    }
  ) => Promise<PublicEntry>;
  updateEntry: (projectId: string, entryId: string, body: Parameters<typeof apiClient.updateEntry>[1]) => Promise<PublicEntry>;
  deleteEntry: (projectId: string, entryId: string, expectedRevision?: number) => Promise<void>;
  importLegacyJson: (
    body: Record<string, unknown>,
    opts?: { accept?: boolean; workspaceName?: string }
  ) => Promise<unknown>;
}

export function useApiData(): ApiData {
  const [state, setState] = useState<ApiDataState>(EMPTY_STATE);
  // Track in-flight requests so we don't trigger React updates after unmount.
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const safeSet = useCallback(
    (updater: (prev: ApiDataState) => ApiDataState) => {
      if (!aliveRef.current) return;
      setState(updater);
    },
    []
  );

  const probe = useCallback(async (): Promise<PublicUser | null> => {
    safeSet((s) => ({ ...s, loading: true, error: null }));
    try {
      const session = await apiClient.me();
      safeSet((s) => ({ ...s, user: session.user, loading: false }));
      return session.user;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        safeSet((s) => ({ ...s, user: null, loading: false }));
        return null;
      }
      safeSet((s) => ({
        ...s,
        user: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      }));
      return null;
    }
  }, [safeSet]);

  // Run the bootstrap probe exactly once on mount.
  useEffect(() => {
    void probe();
  }, [probe]);

  const signIn = useCallback(
    async (user: PublicUser) => {
      safeSet((s) => ({ ...s, user, error: null }));
      await refreshWorkspacesInternal();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [safeSet]
  );

  const signOut = useCallback(async () => {
    try {
      await apiClient.logout();
    } catch {
      // logout is best-effort; clear local state either way.
    }
    safeSet(() => ({ ...EMPTY_STATE, user: null }));
  }, [safeSet]);

  async function refreshWorkspacesInternal(): Promise<void> {
    safeSet((s) => ({ ...s, loading: true, error: null }));
    try {
      const workspaces = await apiClient.listWorkspaces();
      safeSet((s) => ({ ...s, workspaces, loading: false }));
    } catch (err) {
      safeSet((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      }));
    }
  }

  const refreshWorkspaces = useCallback(async () => {
    await refreshWorkspacesInternal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeSet]);

  const createWorkspace = useCallback(
    async (body: Parameters<typeof apiClient.createWorkspace>[0]): Promise<PublicWorkspace> => {
      const created = await apiClient.createWorkspace(body);
      safeSet((s) => ({
        ...s,
        workspaces: [...s.workspaces.filter((workspace) => workspace.id !== created.id), created],
        error: null
      }));
      return created;
    },
    [safeSet]
  );

  const updateWorkspace = useCallback(
    async (
      workspaceId: string,
      body: Parameters<typeof apiClient.updateWorkspace>[1]
    ): Promise<PublicWorkspace> => {
      const updated = await apiClient.updateWorkspace(workspaceId, body);
      safeSet((s) => ({
        ...s,
        workspaces: s.workspaces.map((workspace) =>
          workspace.id === workspaceId ? updated : workspace
        )
      }));
      return updated;
    },
    [safeSet]
  );

  const deleteWorkspace = useCallback(
    async (workspaceId: string): Promise<void> => {
      await apiClient.deleteWorkspace(workspaceId);
      safeSet((s) => {
        const projectIds = new Set(
          (s.projects[workspaceId] ?? []).map((project) => project.id)
        );
        const projects = { ...s.projects };
        delete projects[workspaceId];
        const entries = { ...s.entries };
        for (const projectId of projectIds) delete entries[projectId];
        return {
          ...s,
          workspaces: s.workspaces.filter((workspace) => workspace.id !== workspaceId),
          projects,
          entries
        };
      });
    },
    [safeSet]
  );

  const refreshProjects = useCallback(
    async (workspaceId: string): Promise<PublicProject[]> => {
      const list = await apiClient.listProjects(workspaceId);
      safeSet((s) => ({ ...s, projects: { ...s.projects, [workspaceId]: list } }));
      return list;
    },
    [safeSet]
  );

  const refreshEntries = useCallback(
    async (projectId: string): Promise<PublicEntry[]> => {
      const list = await apiClient.listEntries(projectId);
      safeSet((s) => ({ ...s, entries: { ...s.entries, [projectId]: list } }));
      return list;
    },
    [safeSet]
  );

  const createProject = useCallback(
    async (
      workspaceId: string,
      body: Parameters<typeof apiClient.createProject>[1]
    ): Promise<PublicProject> => {
      const created = await apiClient.createProject(workspaceId, body);
      safeSet((s) => {
        const existing = s.projects[workspaceId] ?? [];
        return {
          ...s,
          projects: { ...s.projects, [workspaceId]: [...existing, created] },
          workspaces: s.workspaces.map((w) =>
            w.id === workspaceId ? w : w
          )
        };
      });
      return created;
    },
    [safeSet]
  );

  const updateProject = useCallback(
    async (
      projectId: string,
      body: Parameters<typeof apiClient.updateProject>[1]
    ): Promise<PublicProject> => {
      const updated = await apiClient.updateProject(projectId, body);
      safeSet((s) => {
        // The project cache is keyed by workspace id, so rewrite the entry in
        // whichever workspace list actually holds this project.
        const next: typeof s.projects = { ...s.projects };
        for (const [workspaceId, list] of Object.entries(next)) {
          if (list.some((project) => project.id === projectId)) {
            next[workspaceId] = list.map((project) =>
              project.id === projectId ? updated : project
            );
          }
        }
        return { ...s, projects: next };
      });
      return updated;
    },
    [safeSet]
  );

  const deleteProject = useCallback(
    async (projectId: string): Promise<void> => {
      await apiClient.deleteProject(projectId);
      safeSet((s) => {
        const next: typeof s.projects = {};
        for (const [wid, list] of Object.entries(s.projects)) {
          next[wid] = list.filter((p) => p.id !== projectId);
        }
        const entriesNext = { ...s.entries };
        delete entriesNext[projectId];
        return { ...s, projects: next, entries: entriesNext };
      });
    },
    [safeSet]
  );

  const createEntry = useCallback(
    async (
      projectId: string,
      body: Parameters<typeof apiClient.createEntry>[1]
    ): Promise<PublicEntry> => {
      const created = await apiClient.createEntry(projectId, body);
      safeSet((s) => {
        const existing = s.entries[projectId] ?? [];
        return {
          ...s,
          entries: { ...s.entries, [projectId]: [...existing.filter((entry) => entry.id !== created.id), created] }
        };
      });
      return created;
    },
    [safeSet]
  );

  const updateEntry = useCallback(async (projectId: string, entryId: string, body: Parameters<typeof apiClient.updateEntry>[1]) => {
    const updated = await apiClient.updateEntry(entryId, body);
    safeSet((s) => ({ ...s, entries: { ...s.entries, [projectId]: (s.entries[projectId] ?? []).map((e) => e.id === entryId ? updated : e) } }));
    return updated;
  }, [safeSet]);

  const deleteEntry = useCallback(async (projectId: string, entryId: string, expectedRevision?: number) => {
    await apiClient.deleteEntry(entryId, expectedRevision);
    safeSet((s) => ({ ...s, entries: { ...s.entries, [projectId]: (s.entries[projectId] ?? []).filter((e) => e.id !== entryId) } }));
  }, [safeSet]);

  const importLegacyJson = useCallback(
    async (
      body: Record<string, unknown>,
      opts?: { accept?: boolean; workspaceName?: string }
    ): Promise<unknown> => {
      const wrapped = {
        ...body,
        accept: opts?.accept ?? true,
        workspaceName: opts?.workspaceName ?? 'Imported workspace'
      };
      // Direct fetch — the API client's import shape isn't on the typed
      // surface yet (DEV-007 only exposes the legacy mapping server-side).
      const res = await fetch('/api/v1/imports/apply', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wrapped)
      });
      if (!res.ok) {
        throw new Error(`import failed (${res.status})`);
      }
      await refreshWorkspacesInternal();
      // eslint-disable-next-line react-hooks/exhaustive-deps
      return res.json();
    },
    [safeSet]
  );

  return useMemo(
    () => ({
      ...state,
      signIn,
      signOut,
      refreshWorkspaces,
      createWorkspace,
      updateWorkspace,
      deleteWorkspace,
      refreshProjects,
      refreshEntries,
      createProject,
      updateProject,
      deleteProject,
      createEntry,
      updateEntry,
      deleteEntry,
      importLegacyJson
    }),
    [
      state,
      signIn,
      signOut,
      refreshWorkspaces,
      createWorkspace,
      updateWorkspace,
      deleteWorkspace,
      refreshProjects,
      refreshEntries,
      createProject,
      updateProject,
      deleteProject,
      createEntry,
      updateEntry,
      deleteEntry,
      importLegacyJson
    ]
  );
}
