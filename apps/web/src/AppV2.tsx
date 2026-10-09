// apps/web/src/AppV2.tsx
//
// Session-authenticated team workspace. The API owns projects and card
// revisions; SSE refreshes live data while editors preserve local drafts.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AuthScreen from './components/AuthScreen';
import Timeline from './components/Timeline';
import LogEditor from './components/LogEditor';
import MultiTimelineView from './components/MultiTimelineView';
import ProjectMembersPanel from './components/ProjectMembersPanel';
import ProjectPresence from './components/ProjectPresence';
import { deriveProjectOnlineUsers } from './components/projectPresenceState';
import ProjectSettingsPanel from './components/ProjectSettingsPanel';
import WorkspaceMembersPanel from './components/WorkspaceMembersPanel';
import WorkspaceSettingsPanel from './components/WorkspaceSettingsPanel';
import AppDialog, { type AppDialogTone } from './components/AppDialog';
import MentionInbox from './components/MentionInbox';
import ProjectFormDialog, { type ProjectDraft } from './components/ProjectFormDialog';
import ShareDialog from './components/ShareDialog';
import SharedContentView from './components/SharedContentView';
import { apiClient, ApiError } from './services/api';
import { LanguageSwitcher, useI18n } from './i18n';
import type {
  PublicEntry,
  PublicProject,
  PublicUser,
  PublicWorkspace
} from '@syncpath/api-client';
import { useApiData } from './hooks/useApiData';
import { useProjectCollaboration } from './hooks/useProjectCollaboration';
import type { WorkLog } from './types';
import { entryDraftToChanges } from './utils/entryDraft';
import { type ClipboardCard } from './utils/cardClipboard';
import type { LogLevel } from './types';

/** A card snapshot rich enough to recreate it after an undo of a delete. */
interface UndoCard {
  title: string;
  level: LogLevel;
  weekStartDate: string;
  summary?: string;
  notes?: string;
  status?: 'pending' | 'completed';
  mentionAll?: boolean;
  mentionedUserIds?: string[];
}

type UndoEntry =
  | { kind: 'move'; items: { id: string; title: string; oldDate: string; newDate: string }[] }
  | { kind: 'delete'; items: UndoCard[] }
  | { kind: 'paste'; items: { id: string; title: string }[] };

/** Keep the stack shallow — undoing across a long session is not a real workflow. */
const UNDO_LIMIT = 20;

function toUndoCard(entry: PublicEntry): UndoCard {
  return {
    title: entry.title,
    level: entry.level === 'primary' ? 1 : entry.level === 'secondary' ? 2 : 3,
    weekStartDate: entry.weekStartDate,
    summary: entry.summary ?? undefined,
    notes: entry.notes ?? undefined,
    status: entry.status,
    mentionAll: entry.mentionAll,
    mentionedUserIds: entry.mentionedUserIds
  };
}

const PROJECT_COLORS = ['#6366f1', '#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#3b82f6'];

type View = 'dashboard' | 'project-form' | 'timeline' | 'multi-timeline' | 'editor';

function apiUserToAppUser(user: PublicUser): {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  role: 'admin' | 'guest';
  color: string;
} {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName ?? undefined,
    role: 'admin',
    color: hashColor(user.username)
  };
}

function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c = (hash & 0x00ffffff).toString(16).toUpperCase();
  return '#' + '00000'.substring(0, 6 - c.length) + c;
}

function apiProjectToAppProject(p: PublicProject): {
  id: string;
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  color: string;
} {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    startDate: p.startDate,
    endDate: p.endDate,
    color: p.color
  };
}

function entryToWorkLog(e: PublicEntry): WorkLog {
  return {
    id: e.id,
    author: e.title, // legacy: title is the Key Objective
    level: e.level === 'primary' ? 1 : e.level === 'secondary' ? 2 : 3,
    weekStartDate: e.weekStartDate,
    summary: e.summary ?? '',
    notes: e.notes ?? '',
    mentionAll: e.mentionAll,
    mentionedUserIds: e.mentionedUserIds,
    goals: [],
    createdAt: Date.parse(e.createdAt),
    updatedAt: Date.parse(e.updatedAt),
    status: e.status === 'completed' ? 'completed' : 'pending',
    isLocked: e.isLocked,
    revision: e.revision
  };
}

function entriesToLogsByWeek(entries: PublicEntry[]): Record<string, WorkLog[]> {
  const byWeek: Record<string, WorkLog[]> = {};
  for (const e of entries) {
    const log = entryToWorkLog(e);
    (byWeek[log.weekStartDate] ??= []).push(log);
  }
  return byWeek;
}

/**
 * Top-level shell: decides which sub-tree to render based on the auth
 * state. We split the auth gate from the main app so that hooks inside
 * the main app don't run before login (the previous monolithic render
 * violated React's "same hooks in same order" rule when the user state
 * transitioned from undefined → null → PublicUser; RV-03).
 */
const AppV2: React.FC = () => {
  const api = useApiData();
  const [shareToken, setShareToken] = useState(() => readShareToken());

  useEffect(() => {
    const update = (): void => setShareToken(readShareToken());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  if (api.user === undefined) {
    return <LoadingScreen />;
  }
  if (api.user === null) {
    return (
      <AuthScreen
        key={shareToken !== null ? 'share-auth' : 'normal-auth'}
        initialMode={shareToken !== null ? 'signup' : 'login'}
        sharedAccess={shareToken !== null}
        onAuthSuccess={async () => {
          // The cookie was set by the AuthScreen's POST; probe /me to
          // capture the real PublicUser and load workspaces.
          const session = await apiClient.me();
          await api.signIn(session.user);
        }}
      />
    );
  }

  if (shareToken !== null) {
    return (
      <SharedContentView
        key={`${api.user.id}:${shareToken}`}
        token={shareToken}
        user={api.user}
        onExit={() => {
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
          setShareToken(null);
        }}
        onSignOut={api.signOut}
      />
    );
  }

  return <AppMain api={api} user={api.user} />;
};

function readShareToken(): string | null {
  const prefix = '#/share/';
  return window.location.hash.startsWith(prefix) ? window.location.hash.slice(prefix.length) : null;
}

const LoadingScreen: React.FC = () => {
  const { t } = useI18n();
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-slate-400 text-sm font-bold uppercase tracking-widest animate-pulse">
        {t('Loading…')}
      </div>
    </div>
  );
};

/**
 * Authenticated app. All hooks below this point run only when the user
 * is signed in, so their count is stable across renders.
 */
const AppMain: React.FC<{
  api: ReturnType<typeof useApiData>;
  user: PublicUser;
}> = ({ api, user }) => {
  const { t } = useI18n();
  const [view, setView] = useState<View>('dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedMultiIds, setSelectedMultiIds] = useState<string[]>([]);
  const [activeLogDate, setActiveLogDate] = useState<string | null>(null);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);
  const [activeLogLevel, setActiveLogLevel] = useState<1 | 2 | 3>(3);
  const [showMembers, setShowMembers] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [showWorkspaceMembers, setShowWorkspaceMembers] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ kind: 'workspace' | 'project'; id: string; name: string } | null>(null);
  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceSettingsId, setWorkspaceSettingsId] = useState<string | null>(null);
  const [pendingProjectDelete, setPendingProjectDelete] = useState<PublicProject | null>(null);
  // Carries its own tone and title: the same channel reports hard failures and
  // routine confirmations (locking a card is a success, not a red alert).
  const [timelineMessage, setTimelineMessage] = useState<{
    title: string;
    message: string;
    tone: AppDialogTone;
  } | null>(null);
  const [systemMessage, setSystemMessage] = useState<{
    title: string;
    message: string;
    type: 'info' | 'warning' | 'error';
  } | null>(null);

  const appUser = useMemo(() => apiUserToAppUser(user), [user]);

  // Auto-load workspaces once we know the user is signed in.
  const workspacesLoadedRef = useRef(false);
  useEffect(() => {
    if (user && !workspacesLoadedRef.current) {
      workspacesLoadedRef.current = true;
      void api.refreshWorkspaces();
    }
  }, [user, api]);

  // Load projects when the workspace selection changes. Effect depends
  // on the (stable) refresh function and the selection id, not on the
  // whole `api` object — that would re-trigger on every state update.
  const workspaces: PublicWorkspace[] = api.workspaces;
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  useEffect(() => {
    if (workspaces.length === 0) {
      if (selectedWorkspaceId !== null) setSelectedWorkspaceId(null);
      return;
    }
    if (!selectedWorkspaceId || !workspaces.some((workspace) => workspace.id === selectedWorkspaceId)) {
      setSelectedWorkspaceId(workspaces[0].id);
    }
  }, [workspaces, selectedWorkspaceId]);

  useEffect(() => {
    if (selectedWorkspaceId) {
      void api.refreshProjects(selectedWorkspaceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkspaceId]);

  // Load entries when the project selection changes.
  useEffect(() => {
    if (selectedProjectId) {
      void api.refreshEntries(selectedProjectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  const handleLogout = useCallback(async () => {
    await api.signOut();
    setView('dashboard');
    setSelectedProjectId(null);
    setSelectedMultiIds([]);
    workspacesLoadedRef.current = false;
  }, [api]);

  // (No conditional returns below this point — see AppV2 for the
  // auth gate that renders <LoadingScreen> / <AuthScreen> instead of
  // mounting this component.)

  // ─── Computed data ─────────────────────────────────────────────────

  const projects: PublicProject[] = useMemo(() => {
    const out: PublicProject[] = [];
    for (const list of Object.values(api.projects)) {
      out.push(...list);
    }
    return out;
  }, [api.projects]);

  const activeProject: PublicProject | undefined = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  const activeWorkspace: PublicWorkspace | undefined = useMemo(() => {
    if (activeProject) {
      return workspaces.find((w) => w.id === activeProject.workspaceId);
    }
    return workspaces.find((w) => w.id === selectedWorkspaceId);
  }, [workspaces, activeProject, selectedWorkspaceId]);

  const settingsWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === workspaceSettingsId),
    [workspaces, workspaceSettingsId]
  );

  const activeProjectLogs: Record<string, WorkLog[]> = useMemo(() => {
    if (!selectedProjectId) return {};
    const entries = api.entries[selectedProjectId] ?? [];
    return entriesToLogsByWeek(entries);
  }, [selectedProjectId, api.entries]);

  const collaboration = useProjectCollaboration({
    projectId: view === 'timeline' || view === 'editor' ? selectedProjectId : null,
    refreshEntries: api.refreshEntries
  });
  const handlePresenceInteraction = useCallback((action: string, logId: string | null) => {
    void collaboration.updatePresence(action, logId ?? undefined);
  }, [collaboration.updatePresence]);

  const activeLog: WorkLog | undefined = useMemo(() => {
    if (!activeLogId) return undefined;
    return Object.values(activeProjectLogs).flat().find((log) => log.id === activeLogId);
  }, [activeProjectLogs, activeLogId]);

  const canEditActiveProject = activeProject?.myRole === 'Lead' || activeProject?.myRole === 'Editor'
    || activeWorkspace?.role === 'Owner' || activeWorkspace?.role === 'Admin';
  useEffect(() => {
    if (view !== 'timeline' && view !== 'editor') return;
    const editing = view === 'editor' && canEditActiveProject && !activeLog?.isLocked;
    void collaboration.updatePresence(editing ? 'Editing' : 'Viewing', view === 'editor' ? activeLogId ?? undefined : undefined);
  }, [view, activeLogId, activeLog?.isLocked, canEditActiveProject, collaboration.updatePresence]);

  const onlineUsers = useMemo(() => deriveProjectOnlineUsers(
    collaboration.collaborators, collaboration.connected, user,
    collaboration.selfPresence.action, collaboration.selfPresence.targetId
  ), [collaboration.collaborators, collaboration.connected, collaboration.selfPresence, user]);
  const entryTitles = useMemo(() => Object.fromEntries(
    (selectedProjectId ? api.entries[selectedProjectId] ?? [] : []).map((entry) => [entry.id, entry.title])
  ), [selectedProjectId, api.entries]);

  // ─── Handlers ──────────────────────────────────────────────────────

  const handleCreateWorkspace = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const name = workspaceName.trim();
    if (!name || creatingWorkspace) return;
    setCreatingWorkspace(true);
    setWorkspaceError(null);
    try {
      const created = await api.createWorkspace({ name });
      // The POST response enters the shared cache, so list refresh failures
      // cannot hide a confirmed project or turn its creation into a retry.
      setWorkspaceName('');
      setShowWorkspaceForm(false);
      setSelectedWorkspaceId(created.id);
      setSelectedProjectId(null);
      setSelectedMultiIds([]);
      setView('dashboard');
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : t('Could not create this project. Your name is kept here. Please try again.'));
    } finally {
      setCreatingWorkspace(false);
    }
  };

  const handleAddProject = useCallback(async (draft: ProjectDraft) => {
    const wsId = activeWorkspace?.id ?? selectedWorkspaceId;
    if (!wsId) throw new Error(t('Select a project first'));
    const created = await api.createProject(wsId, {
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      holidayRegion: 'NONE',
      color: PROJECT_COLORS[projects.length % PROJECT_COLORS.length]
    });
    setSelectedProjectId(created.id);
    setView('timeline');
  }, [activeWorkspace, selectedWorkspaceId, api, projects.length, t]);

  const handleDeleteProject = useCallback((projectId: string) => {
    const project = projects.find((item) => item.id === projectId);
    if (project) setPendingProjectDelete(project);
  }, [projects]);

  // Persist project settings. On a 409 the panel needs the freshest copy to
  // show side by side, so re-read it here before letting the error through.
  const handleSaveProjectSettings = useCallback(async (
    projectId: string,
    body: {
      name: string;
      description: string;
      startDate: string;
      endDate: string;
      color: string;
      visibility: 'private' | 'workspace';
      expectedRevision: number;
    }
  ) => {
    try {
      await api.updateProject(projectId, body);
      if (activeWorkspace) await api.refreshProjects(activeWorkspace.id).catch(() => undefined);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'revision_conflict') {
        if (activeWorkspace) await api.refreshProjects(activeWorkspace.id).catch(() => undefined);
      }
      throw err;
    }
  }, [api, activeWorkspace]);

  const confirmDeleteProject = useCallback(async () => {
    if (!pendingProjectDelete) return;
    const projectId = pendingProjectDelete.id;
    try {
      await api.deleteProject(projectId);
      setPendingProjectDelete(null);
      if (selectedProjectId === projectId) {
        setSelectedProjectId(null);
        setView('dashboard');
      }
    } catch (err) {
      setPendingProjectDelete(null);
      setSystemMessage({
        title: t('Unable to delete task'),
        message: err instanceof Error ? err.message : t('Please try again.'),
        type: 'error'
      });
    }
  }, [api, pendingProjectDelete, selectedProjectId, t]);

  const handleWorkspaceArchived = useCallback(
    (workspaceId: string) => {
      setWorkspaceSettingsId(null);
      setShowWorkspaceMembers(false);
      if (selectedWorkspaceId === workspaceId) {
        setSelectedWorkspaceId(null);
        setSelectedProjectId(null);
        setSelectedMultiIds([]);
        setView('dashboard');
      }
    },
    [selectedWorkspaceId]
  );

  const handleSelectProject = useCallback((id: string) => {
    setSelectedProjectId(id);
    setView('timeline');
  }, []);

  const handleSaveLog = useCallback(
    async (log: WorkLog) => {
      if (!selectedProjectId) throw new Error(t('This task is no longer available.'));
      try {
        // A deleted card must remain an update attempt, never become a duplicate.
        if (activeLogId || log.revision !== undefined) {
          await api.updateEntry(selectedProjectId, log.id, entryDraftToChanges(log));
        } else {
          await api.createEntry(selectedProjectId, {
            weekStartDate: log.weekStartDate,
            title: log.author,
            level:
              log.level === 1
                ? 'primary'
                : log.level === 2
                  ? 'secondary'
                  : 'minor',
            summary: log.summary || undefined,
            notes: log.notes || undefined,
            mentionAll: log.mentionAll ?? false,
            mentionedUserIds: log.mentionedUserIds ?? [],
            status: log.status === 'completed' ? 'completed' : 'pending'
          });
        }
        // The mutation already updates the cache. A failed subsequent read must
        // not make a confirmed create look unsaved and cause a duplicate retry.
        setView('timeline');
        setActiveLogDate(null);
        setActiveLogId(null);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'revision_conflict') {
          await api.refreshEntries(selectedProjectId).catch(() => undefined);
        }
        throw err;
      }
    },
    [selectedProjectId, activeLogId, api, t]
  );

  // ── Undo ────────────────────────────────────────────────────────────────
  // A bounded in-memory stack for the operations you actually regret: moving
  // cards, deleting them, and pasting copies. Text edits are deliberately not
  // here — the card editor's own inputs keep the browser's native Ctrl+Z.
  const undoStack = useRef<UndoEntry[]>([]);
  const pushUndo = useCallback((entry: UndoEntry) => {
    const next = [...undoStack.current, entry];
    undoStack.current = next.slice(-UNDO_LIMIT);
  }, []);

  const handlePasteLogs = useCallback(
    async (cards: ClipboardCard[], targetDate: string | null) => {
      if (!selectedProjectId) return;
      const created: { id: string; title: string }[] = [];
      const failed: string[] = [];
      for (const card of cards) {
        try {
          const entry = await api.createEntry(selectedProjectId, {
            // Paste where the user clicked on the timeline; otherwise duplicate
            // the source card in place.
            weekStartDate: targetDate ?? card.weekStartDate,
            title: card.title,
            level: card.level === 1 ? 'primary' : card.level === 2 ? 'secondary' : 'minor',
            summary: card.summary,
            notes: card.notes,
            mentionAll: card.mentionAll ?? false,
            mentionedUserIds: card.mentionedUserIds ?? [],
            status: card.status ?? 'pending'
          });
          created.push({ id: entry.id, title: entry.title });
        } catch {
          failed.push(card.title);
        }
      }
      if (created.length > 0) {
        pushUndo({ kind: 'paste', items: created });
        await api.refreshEntries(selectedProjectId).catch(() => undefined);
      }
      if (failed.length > 0) {
        setTimelineMessage({
          title: t('Some cards could not be pasted'),
          message: t('{{done}} of {{total}} cards pasted. {{failed}} could not be created.{{detail}}', {
            done: created.length,
            total: cards.length,
            failed: failed.length,
            detail: failed.length > 0 ? ` — ${failed.join('、')}` : ''
          }),
          tone: 'warning'
        });
      }
    },
    [api, selectedProjectId, pushUndo, setTimelineMessage, t]
  );

  const handleUndo = useCallback((): string | null => {
    const projectId = selectedProjectId;
    if (!projectId) return null;
    const entry = undoStack.current[undoStack.current.length - 1];
    if (!entry) return null;
    // Drop the entry up front: if the inverse fails we must not replay it
    // forever, and a stale revision is exactly what failure means here.
    undoStack.current = undoStack.current.slice(0, -1);

    if (entry.kind === 'paste') {
      for (const item of entry.items) {
        const current = (api.entries[projectId] ?? []).find((e) => e.id === item.id);
        if (current) void api.deleteEntry(projectId, item.id, current.revision).catch(() => undefined);
      }
      void api.refreshEntries(projectId).catch(() => undefined);
      return t('Undid paste of {{count}} cards', { count: entry.items.length });
    }

    if (entry.kind === 'move') {
      for (const item of entry.items) {
        // Read the revision now, not the one from when the move happened.
        const current = (api.entries[projectId] ?? []).find((e) => e.id === item.id);
        if (!current) continue;
        void api
          .updateEntry(projectId, item.id, {
            weekStartDate: item.oldDate,
            expectedRevision: current.revision
          })
          .catch(() => undefined);
      }
      void api.refreshEntries(projectId).catch(() => undefined);
      return t('Undid move of {{count}} cards', { count: entry.items.length });
    }

    // delete: the rows are soft-deleted, so restore by recreating them. The
    // restored cards get fresh ids — the originals stay in the audit trail.
    void (async () => {
      for (const card of entry.items) {
        try {
          await api.createEntry(projectId, {
            weekStartDate: card.weekStartDate,
            title: card.title,
            level: card.level === 1 ? 'primary' : card.level === 2 ? 'secondary' : 'minor',
            summary: card.summary,
            notes: card.notes,
            mentionAll: card.mentionAll ?? false,
            mentionedUserIds: card.mentionedUserIds ?? [],
            status: card.status ?? 'pending'
          });
        } catch {
          /* leave it out; the next refresh reflects reality */
        }
      }
      await api.refreshEntries(projectId).catch(() => undefined);
    })();
    return t('Restored {{count}} cards', { count: entry.items.length });
  }, [api, selectedProjectId, t]);

  const handleMoveLogs = useCallback(async (moves: { id: string; oldDate: string; newDate: string }[]) => {
    if (!selectedProjectId) return;
    // Move every card even if one of them conflicts: aborting mid-loop used to
    // leave the timeline half-moved with a single generic error and no way to
    // tell which cards actually landed.
    const failed: { id: string; conflict: boolean }[] = [];
    const applied: { id: string; title: string; oldDate: string; newDate: string }[] = [];
    let moved = 0;
    for (const move of moves) {
      const entry = (api.entries[selectedProjectId] ?? []).find((item) => item.id === move.id);
      if (!entry) continue;
      try {
        await api.updateEntry(selectedProjectId, move.id, {
          weekStartDate: move.newDate,
          expectedRevision: entry.revision
        });
        applied.push({
          id: move.id,
          title: entry.title,
          oldDate: move.oldDate ?? entry.weekStartDate,
          newDate: move.newDate
        });
        moved += 1;
      } catch (err) {
        failed.push({ id: move.id, conflict: err instanceof ApiError && err.code === 'revision_conflict' });
      }
    }
    if (applied.length > 0) pushUndo({ kind: 'move', items: applied });
    if (failed.length === 0) return;
    await api.refreshEntries(selectedProjectId).catch(() => undefined);
    const total = moved + failed.length;
    const names = failed
      .map(({ id }) => (api.entries[selectedProjectId] ?? []).find((item) => item.id === id)?.title)
      .filter((title): title is string => Boolean(title));
    const detail = names.length > 0 ? ` — ${names.join('、')}` : '';
    const conflicts = failed.filter((item) => item.conflict).length;
    setTimelineMessage({
      title: conflicts > 0 ? t('Some cards were left in place') : t('Some cards could not be moved'),
      message: conflicts > 0
        ? t('{{moved}} of {{total}} cards moved. {{conflicts}} changed by a teammate at the same time and was left in place.{{detail}}', {
            moved, total, conflicts, detail
          })
        : t('{{moved}} of {{total}} cards moved. {{failed}} could not be moved.{{detail}}', {
            moved, total, failed: failed.length, detail
          }),
      tone: 'warning'
    });
  }, [api, selectedProjectId, t]);

  const handleDeleteLogs = useCallback(async (ids: string[]) => {
    if (!selectedProjectId) return;
    // Send each card's revision so a card a teammate just edited is reported
    // instead of being silently dropped, and report partial outcomes.
    const known = new Map(
      (api.entries[selectedProjectId] ?? []).map((entry) => [entry.id, entry] as const)
    );
    const failed: { id: string; conflict: boolean }[] = [];
    const removed: UndoCard[] = [];
    let deleted = 0;
    for (const id of ids) {
      try {
        await api.deleteEntry(selectedProjectId, id, known.get(id)?.revision);
        const entry = known.get(id);
        if (entry) removed.push(toUndoCard(entry));
        deleted += 1;
      } catch (err) {
        failed.push({
          id,
          conflict: err instanceof ApiError && err.code === 'revision_conflict'
        });
      }
    }
    if (removed.length > 0) pushUndo({ kind: 'delete', items: removed });
    if (failed.length === 0) return;
    await api.refreshEntries(selectedProjectId).catch(() => undefined);
    const total = deleted + failed.length;
    const names = failed
      .map(({ id }) => known.get(id)?.title)
      .filter((title): title is string => Boolean(title));
    const detail = names.length > 0 ? ` — ${names.join('、')}` : '';
    const conflicts = failed.filter((item) => item.conflict).length;
    setTimelineMessage({
      title: conflicts > 0 ? t('Some cards were kept') : t('Some cards could not be deleted'),
      message: conflicts > 0
        ? t('{{moved}} of {{total}} cards deleted. {{conflicts}} changed by a teammate and were kept.{{detail}}', {
            moved: deleted, total, conflicts, detail
          })
        : t('{{moved}} of {{total}} cards deleted. {{failed}} could not be deleted.{{detail}}', {
            moved: deleted, total, failed: failed.length, detail
          }),
      tone: 'warning'
    });
  }, [api, selectedProjectId, t]);

  /**
   * Locking is a first-class, server-enforced flag: EntriesService rejects any
   * content/date change while it is set, so this only ever sends the toggle.
   * A card that vanished or was locked by someone else in between answers 409
   * / 404, which we surface rather than silently ignoring.
   */
  const handleToggleLock = useCallback(
    async (logId: string) => {
      if (!selectedProjectId) return;
      const current = (api.entries[selectedProjectId] ?? []).find((entry) => entry.id === logId);
      if (!current || current.revision === undefined) return;
      try {
        await api.updateEntry(selectedProjectId, logId, {
          isLocked: !current.isLocked,
          expectedRevision: current.revision
        });
        const locking = !current.isLocked;
        setTimelineMessage({
          title: locking ? t('Card locked') : t('Card unlocked'),
          message: locking
            ? t('It can no longer be moved, edited, or deleted. Unlock it any time to make changes again.')
            : t('It can be moved and edited again.'),
          tone: 'success'
        });
      } catch (err) {
        await api.refreshEntries(selectedProjectId).catch(() => undefined);
        setTimelineMessage({
          title: t('Could not change the lock'),
          message: err instanceof ApiError && err.status === 409
            ? t('This card changed while you were locking it. Try again.')
            : t('Could not change the lock on this card.'),
          tone: 'danger'
        });
      }
    },
    [api, selectedProjectId, t]
  );

  const handleSelectDate = useCallback(
    (dateStr: string, logId?: string, level?: 1 | 2 | 3) => {
      setActiveLogDate(dateStr);
      setActiveLogId(logId ?? null);
      setActiveLogLevel(level ?? 3);
      setView('editor');
    },
    []
  );

  const handleEnterMultiView = useCallback(() => {
    if (selectedMultiIds.length === 0) return;
    setView('multi-timeline');
  }, [selectedMultiIds]);

  const handleOpenMention = useCallback(async (notification: import('@syncpath/api-client').PublicMentionNotification) => {
    try {
      setSelectedWorkspaceId(notification.workspaceId);
      const visibleProjects = await api.refreshProjects(notification.workspaceId);
      if (!visibleProjects.some((project) => project.id === notification.project.id)) {
        throw new Error(t('This task is no longer available.'));
      }
      await api.refreshEntries(notification.project.id);
      setSelectedProjectId(notification.project.id);
      setActiveLogDate(notification.entry.date);
      setActiveLogId(notification.entry.id);
      setActiveLogLevel(3);
      setView('editor');
    } catch (error) {
      setSystemMessage({
        title: t('Unable to open mention'),
        message: error instanceof Error ? error.message : t('Please try again.'),
        type: 'warning'
      });
    }
  }, [api, t]);

  // ─── Render ────────────────────────────────────────────────────────

  if (view === 'multi-timeline' && appUser !== null) {
    const _ = appUser;
    const selected = projects.filter((p) => selectedMultiIds.includes(p.id));
    return (
      <MultiTimelineView
        projects={selected.map((p) => ({
          id: p.id,
          name: p.name,
          personnel: '',
          color: p.color,
          startDate: p.startDate,
          endDate: p.endDate
        }))}
        logs={Object.fromEntries(
          selected.map((p) => [p.id, entriesToLogsByWeek(api.entries[p.id] ?? [])])
        )}
        onBack={() => setView('dashboard')}
      />
    );
  }

  if ((view === 'timeline' || view === 'editor') && activeProject) {
    const canManageMembers = activeProject.myRole === 'Lead' || activeWorkspace?.role === 'Owner' || activeWorkspace?.role === 'Admin';
    const canEditCards = activeProject.myRole === 'Lead' || activeProject.myRole === 'Editor' || activeWorkspace?.role === 'Owner' || activeWorkspace?.role === 'Admin';
    return (
      <div className="flex flex-col h-screen bg-slate-50 overflow-hidden">
        <header className="relative z-[100] px-4 sm:px-8 lg:px-12 py-4 border-b border-slate-200 bg-white shadow-sm flex flex-wrap gap-3 items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <MentionInbox onOpen={handleOpenMention} align="left" />
            <button
              onClick={() => setView('dashboard')}
              aria-label={t('Back to tasks')}
              title={t('Back to tasks')}
              className="w-10 h-10 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center justify-center text-slate-500 transition-all"
            >
              <i className="fas fa-arrow-left"></i>
            </button>
            <div>
              <p className="max-w-[40vw] truncate text-[10px] font-bold text-slate-500 tracking-wide">
                {activeWorkspace?.name} <span aria-hidden="true">›</span> {activeProject.name}
              </p>
              <h2 className="max-w-[40vw] truncate text-xl sm:text-2xl font-black text-slate-800 tracking-tight">
                {activeProject.name}
              </h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {activeProject.startDate} → {activeProject.endDate}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
            {canManageMembers && <button
              onClick={() => setShareTarget({ kind: 'project', id: activeProject.id, name: activeProject.name })}
              className="px-4 py-2 rounded-full border border-indigo-200 text-[10px] font-black uppercase tracking-widest hover:bg-indigo-50 transition-colors flex items-center gap-2 text-indigo-600"
            ><i className="fas fa-share-alt" />{t('Share Task')}</button>}
            <button
              onClick={() => setShowProjectSettings(true)}
              className="px-4 py-2 rounded-full border border-slate-200 text-[10px] font-black uppercase tracking-widest hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 transition-colors flex items-center gap-2 text-slate-500"
            >
              <i className="fas fa-sliders-h"></i>
              {t('Settings')}
            </button>
            <button
              onClick={() => setShowMembers(true)}
              className="px-4 py-2 rounded-full border border-slate-200 text-[10px] font-black uppercase tracking-widest hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 transition-colors flex items-center gap-2 text-slate-500"
            >
              <i className="fas fa-users"></i>
              {t('Members')}
            </button>
            <ProjectPresence
              key={activeProject.id}
              collaborators={collaboration.collaborators}
              connected={collaboration.connected}
              currentUser={user}
              currentAction={collaboration.selfPresence.action}
              currentTargetId={collaboration.selfPresence.targetId}
              entryTitles={entryTitles}
            />
            <button
              onClick={handleLogout}
              className="px-4 py-2 rounded-full border border-slate-200 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-colors flex items-center gap-2 text-slate-500"
            >
              {t('Sign out')}
            </button>
            <LanguageSwitcher compact />
          </div>
        </header>
        <div className={`flex-1 overflow-hidden ${view === 'editor' ? 'pointer-events-none' : ''}`}>
          <Timeline
            project={{
              id: activeProject.id,
              name: activeProject.name,
              personnel: '',
              startDate: activeProject.startDate,
              endDate: activeProject.endDate,
              color: activeProject.color
            }}
            logs={activeProjectLogs}
            onSelectDate={handleSelectDate}
            onMoveLogs={handleMoveLogs}
            onDeleteLogs={handleDeleteLogs}
            onPasteLogs={handlePasteLogs}
            onUndo={handleUndo}
            onToggleLock={(logId) => void handleToggleLock(logId)}
            collaborators={collaboration.collaborators}
            onInteraction={handlePresenceInteraction}
            readOnly={view === 'editor' || !canEditCards}
            suspended={view === 'editor'}
            className="h-full w-full"
          />
        </div>
        {view === 'editor' && activeLogDate && (
          <LogEditor
            key={`${activeProject.id}:${activeLogId ?? activeLogDate}`}
            projectId={activeProject.id}
            currentUserId={user.id}
            dateStr={activeLogDate}
            initialLog={activeLog}
            initialLevel={activeLog?.level ?? activeLogLevel}
            onSave={handleSaveLog}
            readOnly={!canEditCards}
            locked={activeLog?.isLocked === true}
            onBack={() => {
              setView('timeline');
              setActiveLogDate(null);
              setActiveLogId(null);
            }}
          />
        )}
        {showProjectSettings && (
          <ProjectSettingsPanel
            project={activeProject}
            canEdit={canEditCards}
            onSave={handleSaveProjectSettings}
            onClose={() => setShowProjectSettings(false)}
          />
        )}
        {showMembers && (
          <ProjectMembersPanel
            projectId={activeProject.id}
            projectName={activeProject.name}
            currentUserId={user.id}
            onlineUsers={onlineUsers}
            presenceConnected={collaboration.connected}
            canManage={canManageMembers}
            onClose={() => setShowMembers(false)}
          />
        )}
        {shareTarget && <ShareDialog target={shareTarget} onClose={() => setShareTarget(null)} />}
        <AppDialog
          open={timelineMessage !== null}
          tone={timelineMessage?.tone ?? 'info'}
          title={timelineMessage?.title ?? ''}
          message={timelineMessage?.message ?? ''}
          cancelLabel={t('Close')}
          onCancel={() => setTimelineMessage(null)}
        />
        <AppDialog
          open={systemMessage !== null}
          title={systemMessage?.title ?? ''}
          message={systemMessage?.message}
          tone={systemMessage?.type === 'error' ? 'danger' : systemMessage?.type ?? 'info'}
          cancelLabel={t('Understood')}
          onCancel={() => setSystemMessage(null)}
        />
      </div>
    );
  }

  // Dashboard + project form.
  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Top nav */}
      <header className="relative z-50 px-5 sm:px-8 lg:px-12 py-6 border-b border-slate-50 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div
            className="flex items-center gap-3 cursor-pointer"
            onClick={() => {
              setView('dashboard');
              setSelectedProjectId(null);
            }}
          >
            <div className="w-9 h-9 bg-slate-900 rounded-xl flex items-center justify-center text-white text-[12px] font-black shadow-lg shadow-slate-200">
              S
            </div>
            <span className="font-black text-slate-800 tracking-tighter text-sm">
              SyncPath
            </span>
          </div>
          <div className="h-6 w-px bg-slate-100 hidden md:block"></div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">
            {t('Team planning')}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <MentionInbox onOpen={handleOpenMention} />
          <div className="flex items-center gap-2 px-3 py-1 bg-slate-50 rounded-full">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: appUser?.color ?? '#94a3b8' }}
            ></div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">
              {appUser?.username}
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 rounded-full border border-slate-200 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-colors text-slate-500"
          >
            {t('Sign out')}
          </button>
          <LanguageSwitcher compact />
        </div>
      </header>

      <AppDialog
        open={systemMessage !== null}
        title={systemMessage?.title ?? ''}
        message={systemMessage?.message}
        tone={systemMessage?.type === 'error' ? 'danger' : systemMessage?.type ?? 'info'}
        cancelLabel={t('Understood')}
        onCancel={() => setSystemMessage(null)}
      />

      <AppDialog
        open={pendingProjectDelete !== null}
        tone="danger"
        title={`${t('Delete')} ${pendingProjectDelete?.name ?? t('task')}?`}
        message={t('This will hide the task and its timeline history from the project. The action can be audited, but the task will no longer be available to the team.')}
        confirmLabel={t('Delete task')}
        cancelLabel={t('Keep task')}
        onConfirm={() => void confirmDeleteProject()}
        onCancel={() => setPendingProjectDelete(null)}
      />

      {/* Workspaces strip */}
      <section className="px-5 sm:px-8 lg:px-12 py-5 border-b border-slate-50 bg-slate-50/50">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">
            {t('Projects')}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowWorkspaceForm(true)}
              className="px-4 py-2 rounded-xl border border-indigo-200 text-xs font-black text-indigo-600 hover:bg-indigo-50 transition-colors"
              aria-expanded={showWorkspaceForm}
            >
              <i className="fas fa-plus mr-2"></i>{t('New Project')}
            </button>
            <button
              onClick={() => void api.refreshWorkspaces()}
              className="w-8 h-8 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
              title={t('Refresh projects')}
              aria-label={t('Refresh projects')}
            >
              <i className="fas fa-sync-alt text-[11px]"></i>
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {workspaces.length === 0 && !api.loading && (
            <p className="text-xs text-slate-400 italic">
              {t('No projects yet. Create one to start tracking milestones.')}
            </p>
          )}
          {workspaces.map((w) => {
            const selected = selectedWorkspaceId === w.id;
            const canManage = w.role === 'Owner' || w.role === 'Admin';
            return (
              <div key={w.id} className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setSelectedWorkspaceId(w.id);
                    setSelectedProjectId(null);
                    setSelectedMultiIds([]);
                    setView('dashboard');
                  }}
                  className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                    selected
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {w.name}{' '}
                  <span
                    className="ml-1 text-[9px] uppercase tracking-widest opacity-60"
                    title={w.role === 'Owner' ? t('You are the owner of this project') : `${t('Your project role')}: ${t(w.role)}`}
                  >
                    {t(w.role)}
                  </span>
                </button>
                {selected && canManage && (
                  <button
                    onClick={() => {
                      setSelectedWorkspaceId(w.id);
                      setSelectedProjectId(null);
                      setView('dashboard');
                      setWorkspaceSettingsId(w.id);
                    }}
                    className={`w-8 h-8 rounded-lg border transition-colors ${
                      selected
                        ? 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
                        : 'border-slate-200 bg-white text-slate-400 hover:text-indigo-600 hover:border-indigo-200'
                    }`}
                    title={`${t('Manage project')} ${w.name}`}
                    aria-label={`${t('Manage project')} ${w.name}`}
                  >
                    <i className="fas fa-cog text-[11px]"></i>
                  </button>
                )}
                {selected && canManage && <button
                  onClick={() => setShareTarget({ kind: 'workspace', id: w.id, name: w.name })}
                  className="px-3 h-8 rounded-lg border border-indigo-200 bg-white text-xs font-bold text-indigo-600 hover:bg-indigo-50 transition-colors"
                  title={`${t('Share Project')} ${w.name}`}
                  aria-label={`${t('Share Project')} ${w.name}`}
                ><i className="fas fa-share-alt mr-1" />{t('Share Project')}</button>}
              </div>
            );
          })}
        </div>
        {showWorkspaceForm && (
          <form onSubmit={handleCreateWorkspace} className="mt-4 max-w-xl rounded-2xl border border-indigo-100 bg-white p-4">
            <p className="mb-3 text-xs text-slate-500">{t('Projects organize tasks and members. You can create multiple projects.')}</p>
            <label htmlFor="new-project-name" className="mb-2 block text-xs font-bold text-slate-700">{t('Project name')}</label>
            <div className="flex flex-wrap gap-2">
              <input
                id="new-project-name"
                autoFocus
                required
                maxLength={120}
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                placeholder={t('Project name')}
                disabled={creatingWorkspace}
                aria-invalid={workspaceError ? true : undefined}
                aria-describedby={workspaceError ? 'new-project-error' : undefined}
                className="min-w-0 flex-1 px-4 py-2 rounded-xl border border-slate-200 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50"
              />
              <button type="submit" disabled={creatingWorkspace || !workspaceName.trim()} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-black text-xs disabled:opacity-40">
                {creatingWorkspace ? t('Creating…') : t('Create project')}
              </button>
              <button type="button" disabled={creatingWorkspace} onClick={() => setShowWorkspaceForm(false)} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 disabled:opacity-40">{t('Cancel')}</button>
            </div>
            {workspaceError && <p id="new-project-error" role="alert" className="mt-3 text-xs text-red-600">{workspaceError}</p>}
          </form>
        )}
      </section>

      {showWorkspaceMembers && activeWorkspace && (
        <WorkspaceMembersPanel
          workspaceId={activeWorkspace.id}
          workspaceName={activeWorkspace.name}
          currentUserId={user.id}
          canManage={activeWorkspace.role === 'Owner' || activeWorkspace.role === 'Admin'}
          onClose={() => setShowWorkspaceMembers(false)}
        />
      )}
      {shareTarget && <ShareDialog target={shareTarget} onClose={() => setShareTarget(null)} />}

      {settingsWorkspace && (
        <WorkspaceSettingsPanel
          workspace={settingsWorkspace}
          onClose={() => setWorkspaceSettingsId(null)}
          onManageMembers={() => {
            setWorkspaceSettingsId(null);
            setShowWorkspaceMembers(true);
          }}
          renameWorkspace={(name) => api.updateWorkspace(settingsWorkspace.id, { name })}
          archiveWorkspace={() => api.deleteWorkspace(settingsWorkspace.id)}
          onUpdated={() => setWorkspaceSettingsId(null)}
          onArchived={() => handleWorkspaceArchived(settingsWorkspace.id)}
        />
      )}

      {/* Main content */}
      <main className="flex-1 px-5 py-8 sm:px-8 lg:px-12">
          <Dashboard
            workspaces={workspaces}
            selectedWorkspaceId={selectedWorkspaceId}
            projects={
              selectedWorkspaceId
                ? api.projects[selectedWorkspaceId] ?? []
                : projects
            }
            onSelectProject={handleSelectProject}
            onToggleMultiSelect={(id) =>
              setSelectedMultiIds((prev) =>
                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
              )
            }
            onEnterMultiView={handleEnterMultiView}
            onDeleteProject={handleDeleteProject}
            onCreateProject={() => {
              if (!selectedWorkspaceId && workspaces.length > 0) {
                setSelectedWorkspaceId(workspaces[0].id);
              }
              setView('project-form');
            }}
            selectedMultiIds={selectedMultiIds}
          />
        {view === 'project-form' && activeWorkspace && (
          <ProjectFormDialog
            workspace={activeWorkspace}
            onSubmit={handleAddProject}
            onClose={() => setView('dashboard')}
          />
        )}
        {api.error && (
          <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-xl text-xs">
            {api.error}
          </div>
        )}
      </main>
    </div>
  );
};

// ─── Sub-views (kept small; could move to components/) ────────────────────

const Dashboard: React.FC<{
  workspaces: PublicWorkspace[];
  selectedWorkspaceId: string | null;
  projects: PublicProject[];
  selectedMultiIds: string[];
  onSelectProject: (id: string) => void;
  onToggleMultiSelect: (id: string) => void;
  onEnterMultiView: () => void;
  onDeleteProject: (id: string) => void;
  onCreateProject: () => void;
}> = ({
  workspaces,
  selectedWorkspaceId,
  projects,
  selectedMultiIds,
  onSelectProject,
  onToggleMultiSelect,
  onEnterMultiView,
  onDeleteProject,
  onCreateProject
}) => {
  const { t } = useI18n();
  const visibleProjects = projects;
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);

  if (workspaces.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-6">
          <i className="fas fa-folder-open"></i>
        </div>
        <h2 className="text-xl font-black text-slate-800 mb-3">
          {t('No projects yet')}
        </h2>
        <p className="text-sm text-slate-500 mb-6">
          {t('Projects group your tasks and members. Create your first one to begin.')}
        </p>
        <p className="text-xs font-bold text-indigo-600">{t('Use New Project above to begin.')}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">
            {selectedWorkspace ? t('Tasks in {{project}}', { project: selectedWorkspace.name }) : t('Tasks')}
          </h2>
          <p className="mt-1 text-xs text-slate-500">{t('Projects organize tasks and members. You can create multiple projects.')}</p>
        </div>
        <div className="flex items-center gap-3">
          {selectedMultiIds.length >= 2 && (
            <button
              onClick={onEnterMultiView}
              className="px-4 py-2 rounded-xl border border-indigo-200 text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:bg-indigo-50"
            >
              {t('Compare')} ({selectedMultiIds.length})
            </button>
          )}
          <button
            onClick={onCreateProject}
            className="px-5 py-2 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all"
          >
            <i className="fas fa-plus mr-2"></i> {t('New Task')}
          </button>
        </div>
      </div>

      {visibleProjects.length === 0 ? (
        <div className="bg-slate-50 rounded-2xl p-12 text-center text-sm text-slate-400">
          {t('No tasks in this project yet.')}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleProjects.map((p) => {
            const checked = selectedMultiIds.includes(p.id);
            return (
              <div
                key={p.id}
                className="bg-white rounded-2xl border border-slate-200 hover:border-slate-300 transition-all shadow-sm p-5 relative"
              >
                <button
                  onClick={() => onToggleMultiSelect(p.id)}
                  className={`absolute top-3 right-3 w-6 h-6 rounded-md border-2 transition-all ${
                    checked
                      ? 'bg-slate-900 border-slate-900'
                      : 'border-slate-200 hover:border-slate-400'
                  }`}
                  aria-label={t('Select for multi-view')}
                >
                  {checked && (
                    <i className="fas fa-check text-white text-[10px]"></i>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onSelectProject(p.id)}
                  className="block w-full pr-5 text-left rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-4"
                  aria-label={`${t('Open task')} ${p.name}`}
                >
                  <div
                    className="w-3 h-3 rounded-full mb-3"
                    style={{ backgroundColor: p.color }}
                  ></div>
                  <h3 className="font-black text-slate-800 text-sm leading-tight mb-1">
                    {p.name}
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {p.startDate} → {p.endDate}
                  </p>
                  {p.description && (
                    <p className="text-xs text-slate-500 mt-2 line-clamp-2">
                      {p.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-3 text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                    <span className="px-1.5 py-0.5 bg-slate-50 rounded">
                      {t(p.visibility === 'workspace' ? 'All project members' : 'Task members only')}
                    </span>
                    {p.myRole && (
                      <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded">
                        {t(p.myRole)}
                      </span>
                    )}
                  </div>
                </button>
                {(p.myRole === 'Lead' || workspaces.some((workspace) => workspace.id === p.workspaceId && (workspace.role === 'Owner' || workspace.role === 'Admin'))) && <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteProject(p.id);
                  }}
                  className="mt-3 text-[10px] font-bold text-red-400 hover:text-red-600 transition-colors"
                >
                  <i className="fas fa-trash mr-1"></i> {t('Delete')}
                </button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AppV2;
