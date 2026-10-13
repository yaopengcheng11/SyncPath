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
import HeaderActions from './components/HeaderActions';
import ProjectFormDialog, { type ProjectDraft } from './components/ProjectFormDialog';
import ShareDialog, { type ShareTarget } from './components/ShareDialog';
import SharedContentView from './components/SharedContentView';
import ReceivedSharesView from './components/ReceivedSharesView';
import TimelineHistoryPanel from './components/TimelineHistoryPanel';
import MentionsTimelineView from './components/MentionsTimelineView';
import { parseShareRoute, receivedShareHash } from './components/sharedContentState';
import { apiClient, ApiError } from './services/api';
import { useI18n } from './i18n';
import type {
  PublicEntry,
  PublicProject,
  PublicUser,
  PublicWorkspace
} from '@syncpath/api-client';
import { useApiData } from './hooks/useApiData';
import { useProjectCollaboration } from './hooks/useProjectCollaboration';
import { useMentionInbox } from './hooks/useMentionInbox';
import { useThemePreference } from './hooks/useThemePreference';
import type { WorkLog } from './types';
import { entryDraftToChanges } from './utils/entryDraft';
import { cardClipboard, type ClipboardCard } from './utils/cardClipboard';

type UndoEntry =
  | { kind: 'move'; items: { id: string; title: string; oldDate: string; newDate: string }[] }
  | { kind: 'paste'; items: { id: string; title: string }[] };

/** Keep the stack shallow — undoing across a long session is not a real workflow. */
const UNDO_LIMIT = 20;

const PROJECT_COLORS = ['#6366f1', '#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#3b82f6'];

type View = 'dashboard' | 'project-form' | 'timeline' | 'multi-timeline' | 'editor' | 'mentions-timeline';

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
  useThemePreference();
  const api = useApiData();
  const [shareRoute, setShareRoute] = useState(() => parseShareRoute(window.location.hash));
  const [expiredUserId, setExpiredUserId] = useState<string | null>(null);

  const navigate = useCallback((hash: string): void => {
    window.location.hash = hash;
    setShareRoute(parseShareRoute(hash));
  }, []);
  const expireSession = useCallback((): void => {
    if (api.user) setExpiredUserId(api.user.id);
    api.invalidateSession();
  }, [api.user, api.invalidateSession]);

  useEffect(() => {
    const update = (): void => setShareRoute(parseShareRoute(window.location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  if (api.user === undefined) {
    return <LoadingScreen />;
  }
  if (api.user === null || api.user.id === expiredUserId) {
    const externalShare = shareRoute.kind === 'shared' && shareRoute.source.kind === 'token';
    return (
      <AuthScreen
        key={shareRoute.kind !== 'home' ? 'share-auth' : 'normal-auth'}
        initialMode={externalShare && expiredUserId === null ? 'signup' : 'login'}
        sharedAccess={shareRoute.kind !== 'home'}
        onAuthSuccess={async () => {
          // The cookie was set by the AuthScreen's POST; probe /me to
          // capture the real PublicUser and load workspaces.
          const session = await apiClient.me();
          await api.signIn(session.user);
          setExpiredUserId(null);
        }}
      />
    );
  }

  if (shareRoute.kind === 'shared') {
    const source = shareRoute.source;
    return (
      <SharedContentView
        key={JSON.stringify([api.user.id, source])}
        source={source}
        user={api.user}
        onExit={() => navigate('#/received-shares')}
        onSignOut={api.signOut}
        onSessionExpired={expireSession}
      />
    );
  }

  if (shareRoute.kind === 'received-list') {
    return <ReceivedSharesView
      key={api.user.id}
      user={api.user}
      onOpenReceipt={(id) => navigate(receivedShareHash(id))}
      onExit={() => navigate('')}
      onSignOut={api.signOut}
      onSessionExpired={expireSession}
    />;
  }

  return <AppMain key={api.user.id} api={api} user={api.user} onOpenReceivedShares={() => navigate('#/received-shares')} />;
};

const LoadingScreen: React.FC = () => {
  const { t } = useI18n();
  return (
    <div className="sp-app-shell min-h-screen flex items-center justify-center">
      <div className="sp-metadata text-sm animate-pulse">
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
  onOpenReceivedShares: () => void;
}> = ({ api, user, onOpenReceivedShares }) => {
  const { t } = useI18n();
  const mentionInbox = useMentionInbox(user.id, api.invalidateSession);
  const [view, setView] = useState<View>('dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedMultiIds, setSelectedMultiIds] = useState<string[]>([]);
  const [activeLogDate, setActiveLogDate] = useState<string | null>(null);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);
  const [activeLogLevel, setActiveLogLevel] = useState<1 | 2 | 3>(3);
  const [showMembers, setShowMembers] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [showTimelineHistory, setShowTimelineHistory] = useState(false);
  const [showWorkspaceMembers, setShowWorkspaceMembers] = useState(false);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceSettingsId, setWorkspaceSettingsId] = useState<string | null>(null);
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

  const handleDeleteTask = useCallback(async (projectId: string) => {
    await api.deleteProject(projectId);
    cardClipboard.clear();
    setSelectedMultiIds((ids) => ids.filter((id) => id !== projectId));
    if (selectedProjectId === projectId) {
      setSelectedProjectId(null);
      setView('dashboard');
      setShowTimelineHistory(false);
    }
  }, [api, selectedProjectId]);

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


  const handleWorkspaceDeleted = useCallback(
    (workspaceId: string) => {
      cardClipboard.clear();
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
    setShowTimelineHistory(false);
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
  // Moving cards and pasting copies can be undone. Permanent deletion clears
  // the stack; text inputs keep the browser's native Ctrl+Z.
  const undoStack = useRef<UndoEntry[]>([]);
  useEffect(() => { undoStack.current = []; }, [selectedProjectId]);
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

    return null;
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
    let deleted = 0;
    for (const id of ids) {
      try {
        await api.deleteEntry(selectedProjectId, id, known.get(id)?.revision);
        undoStack.current = [];
        cardClipboard.clear();
        deleted += 1;
      } catch (err) {
        failed.push({
          id,
          conflict: err instanceof ApiError && err.code === 'revision_conflict'
        });
      }
    }
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

  const handleOpenMentionEntry = useCallback(async (item: import('@syncpath/api-client').MentionTimelineItem) => {
    try {
      const visibleProjects = await api.refreshProjects(item.workspace.id);
      if (!visibleProjects.some((project) => project.id === item.project.id)) throw new Error(t('This task is no longer available.'));
      const entries = await api.refreshEntries(item.project.id);
      if (!entries.some((entry) => entry.id === item.entry.id)) throw new Error(t('This card is no longer available.'));
      setSelectedWorkspaceId(item.workspace.id);
      setSelectedProjectId(item.project.id);
      setActiveLogDate(item.entry.weekStartDate);
      setActiveLogId(item.entry.id);
      setActiveLogLevel(item.entry.level === 'primary' ? 1 : item.entry.level === 'secondary' ? 2 : 3);
      setShowTimelineHistory(false);
      setView('editor');
    } catch (error) {
      setSystemMessage({ title: t('Unable to open mention'), message: error instanceof Error ? error.message : t('Please try again.'), type: 'warning' });
    }
  }, [api, t]);

  // ─── Render ────────────────────────────────────────────────────────

  const taskContext = (view === 'timeline' || view === 'editor') ? activeProject : undefined;
  const headerWorkspace = taskContext
    ? activeWorkspace
    : workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
  const canManageHeaderWorkspace = headerWorkspace?.role === 'Owner' || headerWorkspace?.role === 'Admin';
  const shareTargets: ShareTarget[] = [];
  if (headerWorkspace && canManageHeaderWorkspace) {
    shareTargets.push({ kind: 'workspace', id: headerWorkspace.id, name: headerWorkspace.name });
  }
  if (taskContext && (taskContext.myRole === 'Lead' || canManageHeaderWorkspace)) {
    shareTargets.push({ kind: 'project', id: taskContext.id, name: taskContext.name });
  }
  const headerActions = <HeaderActions
    key="header-actions"
    user={user}
    inbox={mentionInbox}
    onOpenMention={handleOpenMention}
    onOpenReceivedShares={onOpenReceivedShares}
    onOpenMentionsTimeline={() => { setShowTimelineHistory(false); setView('mentions-timeline'); }}
    onSignOut={() => { void handleLogout(); }}
    onShare={shareTargets.length ? () => setShareTarget(shareTargets[shareTargets.length - 1]) : undefined}
    presence={taskContext ? <ProjectPresence
      key={taskContext.id}
      collaborators={collaboration.collaborators}
      connected={collaboration.connected}
      currentUser={user}
      currentAction={collaboration.selfPresence.action}
      currentTargetId={collaboration.selfPresence.targetId}
      entryTitles={entryTitles}
    /> : undefined}
  />;
  const workspacePanels = <>
    {showWorkspaceMembers && headerWorkspace && <WorkspaceMembersPanel
      key={headerWorkspace.id}
      workspaceId={headerWorkspace.id}
      workspaceName={headerWorkspace.name}
      currentUserId={user.id}
      canManage={canManageHeaderWorkspace}
      onClose={() => setShowWorkspaceMembers(false)}
    />}
    {settingsWorkspace && <WorkspaceSettingsPanel
      key={settingsWorkspace.id}
      workspace={settingsWorkspace}
      tasks={api.projects[settingsWorkspace.id] ?? []}
      onDeleteTask={handleDeleteTask}
      onClose={() => setWorkspaceSettingsId(null)}
      onManageMembers={() => { setWorkspaceSettingsId(null); setShowWorkspaceMembers(true); }}
      renameWorkspace={(name) => api.updateWorkspace(settingsWorkspace.id, { name })}
      deleteWorkspace={() => api.deleteWorkspace(settingsWorkspace.id)}
      onUpdated={() => setWorkspaceSettingsId(null)}
      onDeleted={() => handleWorkspaceDeleted(settingsWorkspace.id)}
    />}
  </>;

  if (view === 'mentions-timeline') return <div className="sp-app-shell flex h-screen flex-col overflow-hidden">
    <header className="sp-topbar relative z-[100] flex shrink-0 flex-wrap items-center gap-3 border-b px-5 py-3 sm:px-8">
      <button type="button" onClick={() => setView('dashboard')} aria-label={t('Back to my projects')} className="sp-icon-button"><i className="fas fa-arrow-left" aria-hidden="true" /></button>
      <span className="sp-heading text-sm font-semibold">SyncPath</span>
      {headerActions}
    </header>
    <MentionsTimelineView userId={user.id} onOpenEntry={(item) => void handleOpenMentionEntry(item)} onSessionExpired={api.invalidateSession} />
    <AppDialog open={systemMessage !== null} title={systemMessage?.title ?? ''} message={systemMessage?.message} tone="warning" cancelLabel={t('Close')} onCancel={() => setSystemMessage(null)} />
    {workspacePanels}
    {shareTarget && <ShareDialog target={shareTarget} targets={shareTargets} onClose={() => setShareTarget(null)} />}
  </div>;

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
      <div className="sp-app-shell flex flex-col h-screen overflow-hidden">
        <header className="sp-topbar relative z-[100] px-4 sm:px-8 lg:px-10 py-3 border-b flex flex-wrap gap-3 items-center justify-between shrink-0">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setView('dashboard')}
              aria-label={t('Back to tasks')}
              title={t('Back to tasks')}
              className="sp-icon-button"
            >
              <i className="fas fa-arrow-left" aria-hidden="true"></i>
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <button type="button" onClick={() => { setSelectedWorkspaceId(activeProject.workspaceId); setWorkspaceSettingsId(activeProject.workspaceId); }} className="max-w-[22vw] truncate rounded-md py-1 hover:text-indigo-600" title={t('Project settings')}>{activeWorkspace?.name}</button>
                <span className="text-slate-300" aria-hidden="true">/</span>
                <h2 className="sp-heading max-w-[28vw] truncate text-sm font-semibold">{activeProject.name}</h2>
                <button type="button" onClick={() => setShowProjectSettings(true)} aria-label={t('Task settings')} title={t('Task settings')} className="sp-icon-button"><i className="fas fa-sliders-h text-xs" aria-hidden="true" /></button>
                {canManageMembers && <button type="button" onClick={() => setShowTimelineHistory(true)} aria-label={t('Timeline history')} title={t('Timeline history')} className="sp-icon-button"><i className="fas fa-history text-xs" aria-hidden="true" /></button>}
              </div>
              <p className="sp-metadata mt-0.5 flex items-center gap-2 text-xs">
                <time dateTime={activeProject.startDate}>{activeProject.startDate}</time><span aria-hidden="true">—</span><time dateTime={activeProject.endDate}>{activeProject.endDate}</time>
              </p>
            </div>
          </div>
          {headerActions}
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
            onManageMembers={() => { setShowProjectSettings(false); setShowMembers(true); }}
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
        {workspacePanels}
        {showTimelineHistory && canManageMembers && <TimelineHistoryPanel key={activeProject.id} projectId={activeProject.id} userId={user.id} onClose={() => setShowTimelineHistory(false)} onSessionExpired={api.invalidateSession} />}
        {shareTarget && <ShareDialog target={shareTarget} targets={shareTargets} onClose={() => setShareTarget(null)} />}
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
    <div className="sp-app-shell min-h-screen flex flex-col">
      {/* Top nav */}
      <header className="sp-topbar relative z-50 px-5 sm:px-8 lg:px-10 py-3 border-b flex flex-wrap gap-4 items-center justify-between">
        <div className="flex items-center gap-6">
          <button
            type="button"
            className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            onClick={() => {
              setView('dashboard');
              setSelectedProjectId(null);
            }}
          >
            <span className="sp-brand-mark flex h-9 w-9 items-center justify-center rounded-xl text-sm font-semibold" aria-hidden="true">
              S
            </span>
            <span className="sp-heading text-[15px] font-semibold tracking-tight">
              SyncPath
            </span>
          </button>
        </div>
        {headerActions}
      </header>

      <AppDialog
        open={systemMessage !== null}
        title={systemMessage?.title ?? ''}
        message={systemMessage?.message}
        tone={systemMessage?.type === 'error' ? 'danger' : systemMessage?.type ?? 'info'}
        cancelLabel={t('Understood')}
        onCancel={() => setSystemMessage(null)}
      />


      {/* Workspaces strip */}
      <section className="sp-project-strip px-5 sm:px-8 lg:px-10 py-5 border-b">
        <div className="flex items-center justify-between mb-3">
          <h3 className="sp-metadata text-xs font-medium">
            {t('Projects')}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowWorkspaceForm(true)}
              className="sp-button-secondary inline-flex items-center gap-2 px-3 text-xs font-medium"
              aria-expanded={showWorkspaceForm}
            >
              <i className="fas fa-plus text-[10px]" aria-hidden="true"></i>{t('New Project')}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {workspaces.length === 0 && !api.loading && (
            <p className="sp-metadata text-xs">
              {t('No projects yet. Create one to start tracking milestones.')}
            </p>
          )}
          {workspaces.map((w) => {
            const selected = selectedWorkspaceId === w.id;
            return (
              <div key={w.id} className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setSelectedWorkspaceId(w.id);
                    setSelectedProjectId(null);
                    setSelectedMultiIds([]);
                    setView('dashboard');
                  }}
                  className={`sp-project-chip ${selected ? 'sp-project-chip-active' : ''} max-w-[15rem] truncate px-3.5 text-sm font-medium`}
                  aria-pressed={selected}
                  title={w.name}
                >
                  {w.name}
                </button>
                <button type="button" aria-label={t('Project settings for {{name}}', { name: w.name })} title={t('Project settings')} onClick={() => { setSelectedWorkspaceId(w.id); setWorkspaceSettingsId(w.id); }} className="sp-icon-button"><i className="fas fa-cog text-xs" aria-hidden="true" /></button>
              </div>
            );
          })}
        </div>
        {showWorkspaceForm && (
          <form onSubmit={handleCreateWorkspace} className="sp-task-card mt-4 max-w-xl rounded-xl border p-4">
            <p className="mb-3 text-xs text-slate-500">{t('Projects organize tasks and members. You can create multiple projects.')}</p>
            <label htmlFor="new-project-name" className="mb-2 block text-xs font-medium text-slate-700">{t('Project name')}</label>
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
                className="sp-auth-input min-w-0 flex-1 px-3 py-2 rounded-lg border text-sm outline-none"
              />
              <button type="submit" disabled={creatingWorkspace || !workspaceName.trim()} className="sp-button-primary px-4 text-sm font-medium disabled:opacity-40">
                {creatingWorkspace ? t('Creating…') : t('Create project')}
              </button>
              <button type="button" disabled={creatingWorkspace} onClick={() => setShowWorkspaceForm(false)} className="sp-button-secondary px-4 text-sm font-medium disabled:opacity-40">{t('Cancel')}</button>
            </div>
            {workspaceError && <p id="new-project-error" role="alert" className="mt-3 text-xs text-red-600">{workspaceError}</p>}
          </form>
        )}
      </section>

      {workspacePanels}
      {shareTarget && <ShareDialog target={shareTarget} targets={shareTargets} onClose={() => setShareTarget(null)} />}

      {/* Main content */}
      <main className="flex-1 px-5 py-7 sm:px-8 lg:px-10">
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
  onCreateProject: () => void;
}> = ({
  workspaces,
  selectedWorkspaceId,
  projects,
  selectedMultiIds,
  onSelectProject,
  onToggleMultiSelect,
  onEnterMultiView,
  onCreateProject
}) => {
  const { t } = useI18n();
  const visibleProjects = projects;

  if (workspaces.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-16 sm:py-20">
        <div className="sp-brand-mark w-12 h-12 rounded-2xl flex items-center justify-center text-xl mx-auto mb-5">
          <i className="fas fa-folder-open" aria-hidden="true"></i>
        </div>
        <h2 className="sp-heading text-xl font-semibold mb-3">
          {t('No projects yet')}
        </h2>
        <p className="sp-metadata text-sm leading-6 mb-5">
          {t('Projects group your tasks and members. Create your first one to begin.')}
        </p>
        <p className="text-xs font-medium text-indigo-600">{t('Use New Project above to begin.')}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2.5">
          <h2 className="sp-heading text-lg font-semibold">{t('Tasks')}</h2>
          <span className="sp-metadata text-xs tabular-nums">{visibleProjects.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {selectedMultiIds.length >= 2 && (
            <button
              onClick={onEnterMultiView}
              className="sp-button-secondary px-3 text-xs font-medium"
            >
              {t('Compare')} ({selectedMultiIds.length})
            </button>
          )}
          <button
            onClick={onCreateProject}
            className="sp-button-primary inline-flex items-center gap-2 px-3.5 text-xs font-medium"
          >
            <i className="fas fa-plus text-[10px]" aria-hidden="true"></i> {t('New Task')}
          </button>
        </div>
      </div>

      {visibleProjects.length === 0 ? (
        <div className="sp-task-card flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">
          {t('No tasks in this project yet.')}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleProjects.map((p) => {
            const checked = selectedMultiIds.includes(p.id);
            return (
              <div
                key={p.id}
                className="sp-task-card group relative rounded-2xl border transition-colors"
                data-selected={checked}
              >
                <button
                  onClick={() => onToggleMultiSelect(p.id)}
                  type="button"
                  className={`sp-task-card-selection absolute top-4 right-4 z-10 flex h-6 w-6 items-center justify-center rounded-md border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                    checked
                      ? 'bg-indigo-600 border-indigo-600'
                      : 'border-slate-200 hover:border-slate-400'
                  }`}
                  aria-label={t('Select for multi-view')}
                  aria-pressed={checked}
                >
                  {checked && (
                    <i className="fas fa-check text-white text-[10px]" aria-hidden="true"></i>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onSelectProject(p.id)}
                  className="flex min-h-[205px] w-full flex-col rounded-2xl p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  aria-label={`${t('Open task')} ${p.name}`}
                >
                  <div className="mb-3 flex items-center gap-2.5 pr-7">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} aria-hidden="true" />
                    <h3 className="sp-heading line-clamp-2 text-[15px] font-semibold leading-6 break-words">{p.name}</h3>
                  </div>
                  <p className="sp-metadata flex flex-wrap items-center gap-1.5 text-xs tabular-nums">
                    <i className="far fa-calendar mr-0.5 text-[11px]" aria-hidden="true" />
                    <time dateTime={p.startDate}>{p.startDate}</time><span aria-hidden="true">—</span><time dateTime={p.endDate}>{p.endDate}</time>
                  </p>
                  {p.description && (
                    <p className="sp-metadata mt-3 line-clamp-2 text-sm leading-6">
                      {p.description}
                    </p>
                  )}
                  <div className="mt-auto flex w-full items-center gap-2 pt-5 text-xs">
                    <span className="sp-metadata min-w-0 truncate">
                      {t(p.visibility === 'workspace' ? 'All project members' : 'Task members only')}
                    </span>
                    {p.myRole && (
                      <span className="shrink-0 rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                        {t(p.myRole)}
                      </span>
                    )}
                    <i className="fas fa-arrow-right ml-auto shrink-0 text-[11px] text-slate-400 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AppV2;
