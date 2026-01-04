import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AppState, WorkLog, Project, LogLevel, Goal, HolidayData, User } from './types';
import Timeline from './components/Timeline';
import LogEditor from './components/LogEditor';
import MultiTimelineView from './components/MultiTimelineView';
import AuthScreen from './components/AuthScreen';
import { generateRoadmap } from './services/geminiService';
import { fetchPublicHolidays } from './services/holidayService';
import { getStartOfWeek, formatDate, parseSafeDate } from './utils/dateUtils';
import { useLiveCollaboration } from './hooks/useLiveCollaboration';

const PROJECT_COLORS = ['#6366f1', '#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#3b82f6'];

const getStorageKey = (username: string) => `roadmap_data_v1_${username}`;

const getUserColor = (username: string) => {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c = (hash & 0x00ffffff).toString(16).toUpperCase();
  return '#' + '00000'.substring(0, 6 - c.length) + c;
};

const DEFAULT_STATE: AppState = {
  projects: [],
  selectedProjectId: null,
  selectedMultiIds: [],
  logs: {},
  activeLogDate: null,
  activeLogId: null,
  view: 'dashboard',
  currentUser: null,
  readonlyProjectIds: [],
  systemMessage: null,
  theme: 'light'
};

export const App: React.FC = () => {
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [history, setHistory] = useState<{ past: AppState[]; future: AppState[] }>({ past: [], future: [] });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pendingLogLevel, setPendingLogLevel] = useState<LogLevel>(3);
  const [showExportSelector, setShowExportSelector] = useState(false);
  const [showRoomInput, setShowRoomInput] = useState(false);
  const [roomInput, setRoomInput] = useState('');
  const [roomMode, setRoomMode] = useState<'create' | 'join'>('create');
  const [isRoomConnecting, setIsRoomConnecting] = useState(false);
  const [liveToast, setLiveToast] = useState<{user: string, message: string, color?: string} | null>(null);

  const [newProj, setNewProj] = useState<Partial<Project>>({
    name: '',
    personnel: '',
    description: '',
    startDate: '',
    endDate: '',
    holidayRegion: 'CN'
  });
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (state.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [state.theme]);

  const handleRemoteUpdate = useCallback((data: { projects: Project[]; logs: Record<string, Record<string, WorkLog[]>> }) => {
    setState(current => {
      const username = current.currentUser?.username.toLowerCase() || '';
      const teamProjectIds = data.projects
        .filter(p => p.personnel.toLowerCase().includes(username))
        .map(p => p.id);

      const updatedReadonlyIds = (current.readonlyProjectIds || []).filter(
        id => !teamProjectIds.includes(id)
      );

      return {
        ...current,
        projects: data.projects,
        logs: data.logs,
        readonlyProjectIds: updatedReadonlyIds
      };
    });
  }, []);

  const handleHostClosedRoom = useCallback(() => {
    setState(current => {
      const username = current.currentUser?.username.toLowerCase() || '';
      const keptProjects = current.projects.filter(p => p.personnel.toLowerCase().includes(username));
      const removedCount = current.projects.length - keptProjects.length;
      const keptIdsSet = new Set(keptProjects.map(p => p.id));
      const newLogs = { ...current.logs };
      
      Object.keys(newLogs).forEach(projId => {
        if (!keptIdsSet.has(projId)) { delete newLogs[projId]; }
      });

      const newReadOnlyIds = [...(current.readonlyProjectIds || [])];
      keptProjects.forEach(p => {
        if (!newReadOnlyIds.includes(p.id)) { newReadOnlyIds.push(p.id); }
      });

      let message = "The Host has ended the live session.";
      if (removedCount > 0) message += `\n\n• ${removedCount} project(s) removed (You are not in the Team).`;
      if (keptProjects.length > 0) message += `\n• ${keptProjects.length} project(s) retained as Read-Only.`;

      return {
        ...current,
        projects: keptProjects,
        logs: newLogs,
        readonlyProjectIds: newReadOnlyIds,
        selectedProjectId: null,
        selectedMultiIds: [],
        view: 'dashboard',
        systemMessage: { title: 'Session Ended', message: message, type: 'warning' }
      };
    });
  }, []);

  const handleRemoteNotification = useCallback((username: string, message: string) => {
    const color = getUserColor(username);
    setLiveToast({ user: username, message, color });
    setTimeout(() => {
        setLiveToast(current => (current?.user === username && current?.message === message ? null : current));
    }, 4000);
  }, []);

  const { isConnected, currentRoom, peersCount, collaborators, isHost, connect, disconnect, broadcast, updatePresence, sendNotification } = useLiveCollaboration({
    onRemoteUpdate: handleRemoteUpdate,
    onRoomClosed: handleHostClosedRoom,
    onNotification: handleRemoteNotification
  });

  useEffect(() => {
    if (!isConnected) return;

    let action = 'Viewing';
    let target = '';
    let targetId = '';

    if (state.view === 'dashboard') {
      action = 'Browsing';
      target = 'Dashboard';
    } else if (state.view === 'multi-timeline') {
      action = 'Comparing';
      target = 'Projects';
    } else if (state.view === 'project-form') {
      action = 'Creating';
      target = 'New Project';
    } else if (state.view === 'timeline' && state.selectedProjectId) {
      const proj = state.projects.find(p => p.id === state.selectedProjectId);
      action = 'Viewing';
      target = proj?.name || 'Timeline';
      targetId = state.selectedProjectId;
    } else if (state.view === 'editor' && state.activeLogDate && state.selectedProjectId) {
      const logs = state.logs[state.selectedProjectId]?.[state.activeLogDate] || [];
      const log = logs.find(l => l.id === state.activeLogId);
      action = 'Editing';
      target = log?.author || state.activeLogDate; 
      targetId = state.activeLogId || '';
    }

    updatePresence({ action, target, targetId });
  }, [state.view, state.selectedProjectId, state.activeLogId, state.activeLogDate, isConnected, updatePresence]);


  const smartMerge = useCallback((local: AppState, imported: AppState): AppState => {
    const mergedProjects = [...local.projects];
    imported.projects.forEach(impProj => {
      const p = impProj as Project;
      const existingIdx = mergedProjects.findIndex(proj => proj.id === p.id);
      if (existingIdx === -1) {
        mergedProjects.push(p);
      } else {
        const localProj = mergedProjects[existingIdx];
        if ((p.updatedAt || 0) > (localProj.updatedAt || 0)) {
          mergedProjects[existingIdx] = p;
        }
      }
    });

    const mergedLogs: Record<string, Record<string, WorkLog[]>> = { ...local.logs };
    const allProjectIds = new Set([
      ...Object.keys(local.logs),
      ...Object.keys(imported.logs)
    ]);

    allProjectIds.forEach(projId => {
      const localProjectLogsMap = new Map<string, WorkLog>();
      if (local.logs[projId]) {
        (Object.values(local.logs[projId]).flat() as WorkLog[]).forEach(log => {
          localProjectLogsMap.set(log.id, log);
        });
      }

      const importedProjectLogsMap = new Map<string, WorkLog>();
      if (imported.logs[projId]) {
        (Object.values(imported.logs[projId]).flat() as WorkLog[]).forEach(log => {
          importedProjectLogsMap.set(log.id, log);
        });
      }

      const finalLogsMap = new Map<string, WorkLog>(localProjectLogsMap);
      importedProjectLogsMap.forEach((impLog: WorkLog, logId: string) => {
        const localLog = finalLogsMap.get(logId);
        if (!localLog) {
          finalLogsMap.set(logId, impLog);
        } else {
          const impTime = impLog.updatedAt || impLog.createdAt || 0;
          const localTime = localLog.updatedAt || localLog.createdAt || 0;
          if (impTime > localTime) {
             finalLogsMap.set(logId, impLog);
          }
        }
      });

      const newProjectLogsStructure: Record<string, WorkLog[]> = {};
      finalLogsMap.forEach(log => {
        const dateKey = log.weekStartDate;
        if (!newProjectLogsStructure[dateKey]) {
          newProjectLogsStructure[dateKey] = [];
        }
        newProjectLogsStructure[dateKey].push(log);
      });
      mergedLogs[projId] = newProjectLogsStructure;
    });

    return {
      ...local,
      projects: mergedProjects,
      logs: mergedLogs,
    };
  }, []);

  useEffect(() => {
    if (state.currentUser) {
      const key = getStorageKey(state.currentUser.username);
      const dataToSave = {
        projects: state.projects,
        logs: state.logs,
        view: state.view,
        selectedProjectId: state.selectedProjectId,
        selectedMultiIds: state.selectedMultiIds,
        readonlyProjectIds: state.readonlyProjectIds || [],
        theme: state.theme
      };
      localStorage.setItem(key, JSON.stringify(dataToSave));
    }
  }, [state]);

  const modifyState = useCallback((reducer: (prev: AppState) => AppState) => {
    setState(current => {
      const nextState = reducer(current);
      if (JSON.stringify(nextState) === JSON.stringify(current)) return current;

      setHistory(prevHist => ({
        past: [...prevHist.past, current].slice(-50),
        future: []
      }));
      
      broadcast(nextState.projects, nextState.logs);
      return nextState;
    });
  }, [broadcast]);

  const undo = useCallback(() => {
    if (history.past.length === 0) return;
    const previous = history.past[history.past.length - 1];
    setHistory({ past: history.past.slice(0, -1), future: [state, ...history.future] });
    setState(previous);
    broadcast(previous.projects, previous.logs);
  }, [history, state, broadcast]);

  const redo = useCallback(() => {
    if (history.future.length === 0) return;
    const next = history.future[0];
    setHistory({ past: [...history.past, state], future: history.future.slice(1) });
    setState(next);
    broadcast(next.projects, next.logs);
  }, [history, state, broadcast]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }

      if (e.key.toLowerCase() === 'f') {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  const executeJSONExport = (targetProjectId: string | null) => {
    let exportState = state;
    let filename = `syncpath_backup_${new Date().toISOString().slice(0, 10)}.json`;

    if (targetProjectId) {
      const currentProject = state.projects.find(p => p.id === targetProjectId);
      if (currentProject) {
        exportState = {
          ...state,
          projects: [currentProject],
          logs: { [currentProject.id]: state.logs[currentProject.id] || {} },
          selectedProjectId: currentProject.id,
          view: 'timeline',
          currentUser: state.currentUser 
        };
        const safeName = currentProject.name.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_');
        filename = `${safeName}.json`;
      }
    }

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportState, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", filename);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    setShowExportSelector(false);
  };

  const handleImportClick = () => { fileInputRef.current?.click(); };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsedData = JSON.parse(e.target?.result as string);
        if (!parsedData.projects || !parsedData.logs) {
          alert("Invalid data file format.");
          return;
        }
        modifyState(prev => {
          const mergedState = smartMerge(prev, parsedData);
          return { ...mergedState, view: 'dashboard', selectedProjectId: null };
        });
        alert("Data merged successfully! Newer versions of projects and logs have been preserved.");
      } catch (error) { alert("Error parsing file."); }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handleJoinRoom = async () => {
    if (roomInput.trim() && state.currentUser) {
      setIsRoomConnecting(true);
      const initialData = { projects: state.projects, logs: state.logs };
      const userColor = getUserColor(state.currentUser.username);
      const userInfo = { username: state.currentUser.username, color: userColor };
      const success = await connect(roomInput.trim(), roomMode, initialData, userInfo);
      setIsRoomConnecting(false);
      if (success) { setShowRoomInput(false); } 
      else { alert("Room not found or no active peers. Ensure someone else has already created '" + roomInput.trim() + "' and is online. In P2P mode, rooms disappear when all users leave."); }
    }
  };

  const handleAddProject = async () => {
    if (!newProj.name || !newProj.startDate || !newProj.endDate) { alert("Please fill in Title, Start Date, and End Date."); return; }
    setIsGenerating(true);
    let fetchedHolidays: HolidayData[] = [];
    if (newProj.holidayRegion && newProj.holidayRegion !== 'NONE') {
      try { fetchedHolidays = await fetchPublicHolidays(newProj.holidayRegion, newProj.startDate!, newProj.endDate!); } 
      catch (e) { console.error("Failed to fetch holidays", e); }
    }
    const projectId = Math.random().toString(36).substr(2, 9);
    const project: Project = {
      id: projectId, name: newProj.name!, personnel: newProj.personnel || 'Team', description: newProj.description || '',
      startDate: newProj.startDate!, endDate: newProj.endDate!, holidayRegion: newProj.holidayRegion || 'CN',
      storedHolidays: fetchedHolidays, color: PROJECT_COLORS[state.projects.length % PROJECT_COLORS.length], updatedAt: Date.now()
    };
    let generatedLogs: Record<string, WorkLog[]> = {};
    if (newProj.description) {
      try {
        const aiLogsRaw = await generateRoadmap(newProj.description, newProj.startDate!, newProj.endDate!);
        aiLogsRaw.forEach((rawLog) => {
          const dateBucket = formatDate(getStartOfWeek(parseSafeDate(rawLog.date)));
          const newLog: WorkLog = {
            id: Math.random().toString(36).substr(2, 9), author: rawLog.author || 'AI', level: (rawLog.level as LogLevel) || 3,
            weekStartDate: dateBucket, summary: rawLog.summary, notes: `Generated from: ${rawLog.date}`,
            goals: rawLog.goals.map((gStr) => ({ id: Math.random().toString(36).substr(2, 9), title: gStr, status: 'pending', description: '' })),
            createdAt: Date.now(), updatedAt: Date.now(), status: 'pending' // Default pending
          };
          if (!generatedLogs[dateBucket]) { generatedLogs[dateBucket] = []; }
          generatedLogs[dateBucket].push(newLog);
        });
      } catch (error) { console.error("AI Generation failed", error); }
    }
    setIsGenerating(false);
    modifyState(prev => ({ ...prev, projects: [...prev.projects, project], logs: { ...prev.logs, [projectId]: generatedLogs }, selectedProjectId: projectId, view: 'timeline' }));
    setNewProj({ name: '', personnel: '', description: '', startDate: '', endDate: '', holidayRegion: 'CN' });
  };

  const handleDeleteProject = (projectId: string) => {
    if (window.confirm("Delete this project and all its history?")) {
      setState(current => {
        const newLogs = { ...current.logs }; delete newLogs[projectId];
        const newSelection = (current.selectedMultiIds || []).filter(id => id !== projectId);
        const newReadonly = (current.readonlyProjectIds || []).filter(id => id !== projectId);
        const nextState: AppState = {
          ...current, projects: current.projects.filter(p => p.id !== projectId), logs: newLogs,
          selectedMultiIds: newSelection, readonlyProjectIds: newReadonly, selectedProjectId: null, view: 'dashboard'
        };
        setHistory(h => ({ past: [...h.past, current].slice(-50), future: [] }));
        broadcast(nextState.projects, nextState.logs);
        return nextState;
      });
    }
  };

  const handleUpdateProject = (id: string, updates: Partial<Project>) => {
    modifyState(prev => ({ ...prev, projects: prev.projects.map(p => p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p) }));
  };

  const handleSelectProject = (id: string) => { setState(prev => ({ ...prev, selectedProjectId: id, view: 'timeline' })); };
  const handleToggleMultiSelect = (id: string) => { setState(prev => { const currentSelection = prev.selectedMultiIds || []; return { ...prev, selectedMultiIds: currentSelection.includes(id) ? currentSelection.filter(sid => sid !== id) : [...currentSelection, id] }; }); };
  const handleEnterMultiView = () => { if (!state.selectedMultiIds || state.selectedMultiIds.length === 0) return; setState(prev => ({ ...prev, view: 'multi-timeline' })); };
  const handleSelectDate = (dateStr: string, logId?: string, level?: LogLevel) => { if (level) setPendingLogLevel(level); setState(prev => ({ ...prev, activeLogDate: dateStr, activeLogId: logId || null, view: 'editor' })); };

  const handleMoveLogs = useCallback((moves: {id: string, oldDate: string, newDate: string}[]) => {
     if (!state.selectedProjectId || moves.length === 0) return;
     let msg = moves.length === 1 ? `moved an item to ${parseSafeDate(moves[0].newDate).toLocaleDateString()}` : `moved ${moves.length} items`;
     sendNotification(msg);
     modifyState(prev => {
        const projectId = prev.selectedProjectId!;
        const projectLogs = { ...(prev.logs[projectId] || {}) };
        moves.forEach(({ id, oldDate, newDate }) => {
            if (!projectLogs[oldDate]) return;
            const logIndex = projectLogs[oldDate].findIndex(l => l.id === id);
            if (logIndex === -1) return;
            const logToMove = projectLogs[oldDate][logIndex];
            if (logToMove.isLocked) return;
            projectLogs[oldDate] = projectLogs[oldDate].filter(l => l.id !== id);
            if (projectLogs[oldDate].length === 0) delete projectLogs[oldDate];
            const updatedLog = { ...logToMove, weekStartDate: newDate, updatedAt: Date.now() };
            projectLogs[newDate] = [...(projectLogs[newDate] || []), updatedLog];
        });
        return { ...prev, logs: { ...prev.logs, [projectId]: projectLogs } };
     });
  }, [state.selectedProjectId, state.logs, modifyState, sendNotification]); 
  
  const handleCopyLogs = useCallback((copies: {id: string, oldDate: string, newDate: string}[]) => {
     if (!state.selectedProjectId || copies.length === 0) return;
     sendNotification(`copied ${copies.length} logs`);
     modifyState(prev => {
        const projectId = prev.selectedProjectId!;
        const projectLogs = { ...(prev.logs[projectId] || {}) };
        copies.forEach(({ id, oldDate, newDate }) => {
            const sourceList = projectLogs[oldDate];
            if (!sourceList) return;
            const logToCopy = sourceList.find(l => l.id === id);
            if (!logToCopy) return;
            const newGoals = logToCopy.goals.map(g => ({ ...g, id: Math.random().toString(36).substr(2, 9) }));
            const newLog: WorkLog = { ...logToCopy, id: Math.random().toString(36).substr(2, 9), weekStartDate: newDate, goals: newGoals, createdAt: Date.now(), updatedAt: Date.now() };
            projectLogs[newDate] = [...(projectLogs[newDate] || []), newLog];
        });
        return { ...prev, logs: { ...prev.logs, [projectId]: projectLogs } };
     });
  }, [state.selectedProjectId, modifyState, sendNotification]);

  const handleDeleteLogs = useCallback((logIds: string[]) => {
    if (!state.selectedProjectId || logIds.length === 0) return;
    sendNotification(`deleted ${logIds.length} items`);
    const idSet = new Set(logIds);
    modifyState(prev => {
      const projectId = prev.selectedProjectId!;
      const currentAllLogs = { ...prev.logs };
      const currentProjectLogs = { ...(currentAllLogs[projectId] || {}) };
      let changed = false;
      Object.keys(currentProjectLogs).forEach(dateKey => {
         const originalList = currentProjectLogs[dateKey];
         const filteredList = originalList.filter(l => !idSet.has(l.id));
         if (originalList.length !== filteredList.length) {
            if (filteredList.length === 0) { delete currentProjectLogs[dateKey]; } 
            else { currentProjectLogs[dateKey] = filteredList; }
            changed = true;
         }
      });
      if (!changed) return prev;
      currentAllLogs[projectId] = currentProjectLogs;
      return { ...prev, logs: currentAllLogs, activeLogId: null, activeLogDate: null };
    });
  }, [state.selectedProjectId, modifyState, sendNotification]);

  const handlePasteLogs = useCallback((pastedLogs: WorkLog[], targetDateStr: string | null) => {
    if (!state.selectedProjectId || pastedLogs.length === 0) return;
    sendNotification(`pasted ${pastedLogs.length} items`);
    const logsWithNewIds = pastedLogs.map(log => ({ ...log, newId: Math.random().toString(36).substr(2, 9), newGoals: log.goals.map(g => ({ ...g, id: Math.random().toString(36).substr(2, 9) })) }));
    modifyState(prev => {
      const projectId = prev.selectedProjectId!;
      const projectLogs = { ...prev.logs[projectId] };
      let offsetDays = 0;
      if (targetDateStr) {
         const sorted = [...pastedLogs].sort((a, b) => parseSafeDate(a.weekStartDate).getTime() - parseSafeDate(b.weekStartDate).getTime());
         const firstLogDate = parseSafeDate(sorted[0].weekStartDate);
         const targetDate = parseSafeDate(targetDateStr);
         const oneDay = 24 * 60 * 60 * 1000;
         offsetDays = Math.round((targetDate.getTime() - firstLogDate.getTime()) / oneDay);
      }
      logsWithNewIds.forEach(({ newId, newGoals, ...log }) => {
          let newDateStr = log.weekStartDate;
          if (offsetDays !== 0) {
             const originalDate = parseSafeDate(log.weekStartDate);
             const calcDate = new Date(originalDate);
             calcDate.setDate(originalDate.getDate() + offsetDays);
             newDateStr = formatDate(calcDate);
          }
          const newLog: WorkLog = { ...log, id: newId, weekStartDate: newDateStr, createdAt: Date.now(), updatedAt: Date.now(), goals: newGoals, isLocked: false };
          const existingLogs = projectLogs[newDateStr] || [];
          projectLogs[newDateStr] = [...existingLogs, newLog];
      });
      return { ...prev, logs: { ...prev.logs, [projectId]: projectLogs } };
    });
  }, [state.selectedProjectId, modifyState, sendNotification]);

  const handleToggleLock = useCallback((logId: string, dateStr: string) => {
    if (!state.selectedProjectId) return;
    modifyState(prev => {
      const projectId = prev.selectedProjectId!;
      const projectLogs = { ...prev.logs[projectId] };
      if (!projectLogs[dateStr]) return prev;
      const logIndex = projectLogs[dateStr].findIndex(l => l.id === logId);
      if (logIndex === -1) return prev;
      const updatedLog = { ...projectLogs[dateStr][logIndex], isLocked: !projectLogs[dateStr][logIndex].isLocked };
      projectLogs[dateStr] = [...projectLogs[dateStr]];
      projectLogs[dateStr][logIndex] = updatedLog;
      return { ...prev, logs: { ...prev.logs, [projectId]: projectLogs } };
    });
  }, [state.selectedProjectId, modifyState]);

  const handleToggleStatus = useCallback((logId: string, dateStr: string) => {
    if (!state.selectedProjectId) return;
    modifyState(prev => {
      const projectId = prev.selectedProjectId!;
      const projectLogs = { ...prev.logs[projectId] };
      if (!projectLogs[dateStr]) return prev;
      const logIndex = projectLogs[dateStr].findIndex(l => l.id === logId);
      if (logIndex === -1) return prev;
      const currentStatus = projectLogs[dateStr][logIndex].status;
      const updatedLog = { 
        ...projectLogs[dateStr][logIndex], 
        status: currentStatus === 'completed' ? 'pending' : 'completed',
        updatedAt: Date.now()
      } as WorkLog;
      projectLogs[dateStr] = [...projectLogs[dateStr]];
      projectLogs[dateStr][logIndex] = updatedLog;
      return { ...prev, logs: { ...prev.logs, [projectId]: projectLogs } };
    });
  }, [state.selectedProjectId, modifyState]);

  const handleSaveLog = (log: WorkLog) => {
    if (!state.selectedProjectId) return;
    const isNew = !log.createdAt; 
    sendNotification(`${isNew ? 'created' : 'updated'} log "${log.author}"`);
    modifyState(prev => {
      const projectId = prev.selectedProjectId!;
      const projectLogs = prev.logs[projectId] || {};
      const dateLogs = projectLogs[log.weekStartDate] || [];
      const updatedDateLogs = log.id && dateLogs.find(l => l.id === log.id) ? dateLogs.map(l => l.id === log.id ? log : l) : [...dateLogs, log];
      return { ...prev, logs: { ...prev.logs, [projectId]: { ...projectLogs, [log.weekStartDate]: updatedDateLogs } }, view: 'timeline', activeLogId: null, activeLogDate: null };
    });
  };

  const handleAuthSuccess = (user: User) => {
    const key = getStorageKey(user.username);
    const saved = localStorage.getItem(key);
    let loadedState = DEFAULT_STATE;
    if (saved) { loadedState = JSON.parse(saved); }
    const fullUser: User = { ...user, color: user.color || getUserColor(user.username) };
    setState({ 
      ...loadedState, 
      currentUser: fullUser, 
      view: 'dashboard', 
      selectedProjectId: null, 
      readonlyProjectIds: loadedState.readonlyProjectIds || [],
      theme: loadedState.theme || 'light'
    });
  };

  const handleLogout = () => { if (isConnected) disconnect(); setState(DEFAULT_STATE); };

  const activeProject = useMemo(() => state.projects.find(p => p.id === state.selectedProjectId), [state.projects, state.selectedProjectId]);
  const activeProjectLogs = useMemo(() => (state.selectedProjectId ? state.logs[state.selectedProjectId] : {}) || {}, [state.logs, state.selectedProjectId]);
  const activeLog = state.activeLogDate && state.activeLogId ? activeProjectLogs[state.activeLogDate]?.find(l => l.id === state.activeLogId) : undefined;
  const multiViewProjects = useMemo(() => state.projects.filter(p => state.selectedMultiIds?.includes(p.id)), [state.projects, state.selectedMultiIds]);
  const isAdmin = state.currentUser?.role === 'admin';
  const isActiveProjectReadOnly = useMemo(() => { if (!activeProject) return false; return !isAdmin || (state.readonlyProjectIds || []).includes(activeProject.id); }, [isAdmin, activeProject, state.readonlyProjectIds]);

  if (!state.currentUser) { return <AuthScreen onAuthSuccess={handleAuthSuccess} />; }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 animate-in fade-in duration-500 relative transition-colors duration-300">
      <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".json" />
      
      {liveToast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 bg-slate-800/90 dark:bg-white/90 backdrop-blur-md text-white dark:text-slate-900 px-5 py-3 rounded-full shadow-2xl z-[3000] flex items-center gap-3 animate-in slide-in-from-top-5 fade-in duration-300 pointer-events-none border border-white/10 dark:border-slate-200">
            <div 
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-white border border-white/20 shadow-inner" 
              style={{backgroundColor: liveToast.color}}
            >
                {liveToast.user.charAt(0).toUpperCase()}
            </div>
            <span className="text-xs font-medium">
                <span className="font-bold text-slate-100 dark:text-slate-800 mr-1">{liveToast.user}</span>
                <span className="text-slate-300 dark:text-slate-600">{liveToast.message}</span>
            </span>
        </div>
      )}

      {/* System Message Modal (omitted for brevity, unchanged) */}
      {state.systemMessage && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[3000] flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={(e) => e.stopPropagation()}
        >
           <div 
             className="bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl w-full max-md p-8 text-center border dark:border-slate-800"
             onClick={e => e.stopPropagation()}
           >
              <div className="w-16 h-16 bg-amber-50 dark:bg-amber-900/30 text-amber-500 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-6">
                <i className="fas fa-exclamation-triangle"></i>
              </div>
              <h3 className="text-xl font-black text-slate-800 dark:text-slate-100 mb-4">{state.systemMessage.title}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium mb-8 whitespace-pre-wrap leading-relaxed">
                 {state.systemMessage.message}
              </p>
              <button 
                onClick={() => setState(p => ({...p, systemMessage: null}))}
                className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:opacity-90 transition-all shadow-xl"
              >
                Understood
              </button>
           </div>
        </div>
      )}

      {/* Room Input Modal (omitted, unchanged) */}
      {showRoomInput && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[2000] flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => { if(!isRoomConnecting) setShowRoomInput(false); }}
        >
          <div 
            className="bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl w-full max-w-sm overflow-hidden p-8 border dark:border-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4">
                <i className="fas fa-tower-broadcast"></i>
              </div>
              <h3 className="text-xl font-black text-slate-800 dark:text-slate-100 tracking-tight">Live Session</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-1">Real-time team collaboration.</p>
            </div>

            <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-xl mb-6">
              <button 
                onClick={() => setRoomMode('create')}
                disabled={isRoomConnecting}
                className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${roomMode === 'create' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-300' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}
              >
                Create Room
              </button>
              <button 
                onClick={() => setRoomMode('join')}
                disabled={isRoomConnecting}
                className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${roomMode === 'join' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-300' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}
              >
                Join Room
              </button>
            </div>
            
            <div className="space-y-4">
              <input 
                autoFocus
                type="text" 
                placeholder="Enter Room Name" 
                className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl focus:bg-white dark:focus:bg-slate-800 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 dark:focus:ring-indigo-900/30 outline-none font-bold text-slate-800 dark:text-slate-100 text-center"
                value={roomInput}
                onChange={e => setRoomInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !isRoomConnecting && handleJoinRoom()}
                disabled={isRoomConnecting}
              />
              <button 
                onClick={handleJoinRoom}
                disabled={isRoomConnecting || !roomInput.trim()}
                className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:scale-[1.02] transition-transform shadow-lg disabled:opacity-70 disabled:hover:scale-100 flex items-center justify-center gap-2"
              >
                {isRoomConnecting ? (
                  <>
                    <i className="fas fa-circle-notch fa-spin"></i>
                    {roomMode === 'create' ? 'Creating...' : 'Searching...'}
                  </>
                ) : (
                  <span>{roomMode === 'create' ? 'Start Session' : 'Connect'}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Selector Modal (omitted, unchanged) */}
      {showExportSelector && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center animate-in fade-in duration-200" onClick={() => setShowExportSelector(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl max-w-lg w-full overflow-hidden border dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
            <div className="p-10">
              <h3 className="text-2xl font-black text-slate-800 dark:text-slate-100 mb-2">Export Data</h3>
              <p className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase tracking-widest mb-8">Select project to export as JSON</p>
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                <button onClick={() => executeJSONExport(null)} className="w-full text-left p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-slate-700 border border-slate-100 dark:border-slate-700 hover:border-indigo-100 transition-all group flex items-center gap-4">
                   <div className="w-10 h-10 rounded-xl bg-slate-200 dark:bg-slate-700 group-hover:bg-indigo-200 dark:group-hover:bg-slate-600 flex items-center justify-center text-slate-500 dark:text-slate-400 group-hover:text-indigo-600 transition-colors"><i className="fas fa-database"></i></div>
                   <div><h4 className="font-black text-slate-800 dark:text-slate-100 text-sm">Full System Backup</h4><p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wide">All Projects & Settings</p></div>
                </button>
                <div className="h-px bg-slate-100 dark:bg-slate-800 my-4"></div>
                {state.projects.length === 0 && (<p className="text-center text-slate-400 dark:text-slate-600 text-xs py-4">No individual projects available.</p>)}
                {state.projects.map(p => (
                   <button key={p.id} onClick={() => executeJSONExport(p.id)} className="w-full text-left p-4 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 border border-transparent hover:border-slate-100 dark:border-slate-700 transition-all flex items-center gap-4">
                     <div className="w-3 h-10 rounded-full" style={{ backgroundColor: p.color }}></div>
                     <div><h4 className="font-black text-slate-800 dark:text-slate-100 text-sm leading-tight">{p.name}</h4><p className="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wide">{p.personnel}</p></div>
                     <i className="fas fa-download ml-auto text-slate-300 dark:text-slate-600"></i>
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-850 p-6 flex justify-end">
               <button onClick={() => setShowExportSelector(false)} className="px-6 py-3 text-slate-400 dark:text-slate-500 font-black text-[10px] uppercase tracking-widest hover:text-slate-600 dark:hover:text-slate-300 transition-all">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Navigation (omitted for brevity, unchanged) */}
      {state.view !== 'multi-timeline' && (
        <nav className="px-12 py-8 flex items-center justify-between border-b border-slate-50 dark:border-slate-800 sticky top-0 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md z-40">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setState(p => ({ ...p, view: 'dashboard', selectedProjectId: null }))}>
              <div className="w-9 h-9 bg-slate-900 dark:bg-white rounded-xl flex items-center justify-center text-white dark:text-slate-900 text-[12px] font-black shadow-lg shadow-slate-200 dark:shadow-none transition-all">S</div>
              <span className="font-black text-slate-800 dark:text-slate-100 tracking-tighter text-sm uppercase">SyncPath</span>
            </div>
            <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 hidden md:block mx-2"></div>
            <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.3em] whitespace-nowrap">Roadmap Management</p>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => setState(prev => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }))} className="w-10 h-10 rounded-full bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-amber-400 hover:text-amber-500 hover:border-amber-400 dark:hover:border-amber-400 transition-all shadow-md group shrink-0" title="Toggle Dark/Light Mode"><i className={`fas ${state.theme === 'dark' ? 'fa-sun' : 'fa-moon'} text-base group-active:scale-90 transition-transform`}></i></button>
            {!isConnected ? (
              <button onClick={() => setShowRoomInput(true)} className="px-4 py-2 rounded-full border border-slate-200 dark:border-slate-700 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2 text-slate-500 dark:text-slate-400"><div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600"></div> Live</button>
            ) : (
              <div className="flex items-center gap-3 pr-2 border border-slate-100 dark:border-slate-800 p-2 rounded-full bg-white dark:bg-slate-900">
                <div className="flex -space-x-2 mr-2">
                  {collaborators.map(c => (
                    <div key={c.clientId} className="relative group cursor-help">
                      <div className="w-8 h-8 rounded-full border-2 border-white dark:border-slate-900 flex items-center justify-center text-white text-[10px] font-bold shadow-sm" style={{ backgroundColor: c.color }}>{c.username.charAt(0).toUpperCase()}</div>
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-max max-w-[200px] bg-slate-800 text-white text-[10px] rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50"><span className="font-bold">{c.username}</span><div className="opacity-75 font-medium">{c.action} {c.target && <span className="italic text-slate-300">{c.target}</span>}</div></div>
                    </div>
                  ))}
                  <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 border-2 border-white dark:border-slate-900 flex items-center justify-center text-slate-400 text-[9px] font-bold shadow-sm">You</div>
                </div>
                <button onClick={disconnect} className={`px-4 py-2 rounded-full border border-emerald-100 dark:border-emerald-900/50 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-red-50 hover:text-red-500 hover:border-red-100 transition-all group ${isHost ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400' : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'}`} title={isHost ? 'End Session' : 'Disconnect'}><div className={`w-2 h-2 rounded-full animate-pulse group-hover:bg-red-500 ${isHost ? 'bg-amber-500' : 'bg-emerald-500'}`}></div><span className="hidden lg:inline">{currentRoom}{isHost ? ' (Host)' : ''}</span><span className="hidden group-hover:inline ml-1">Disconnect</span></button>
              </div>
            )}
            <div className="flex items-center gap-3 pl-4 border-l border-slate-100 dark:border-slate-800">
              <div className="text-right hidden sm:block"><p className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-tighter">{state.currentUser.username}</p><p className="text-[8px] font-black text-slate-300 dark:text-slate-600 uppercase tracking-widest">{isAdmin ? 'Administrator' : 'Guest Access'}</p></div>
              <button onClick={handleLogout} className="w-10 h-10 rounded-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-red-500 transition-all flex items-center justify-center shrink-0" title="Logout"><i className="fas fa-sign-out-alt text-base"></i></button>
            </div>
            <div className="flex items-center gap-2 mx-2">
              <button onClick={() => setShowExportSelector(true)} className="w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all" title="Export Data"><i className="fas fa-file-arrow-down"></i></button>
              {isAdmin && (<button onClick={handleImportClick} className="w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all group relative" title="Merge Data"><i className="fas fa-file-arrow-up group-hover:text-indigo-600"></i><div className="absolute -bottom-8 bg-slate-800 text-white text-[9px] font-black px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">Merge</div></button>)}
            </div>
            {isAdmin && (<button onClick={() => setState(p => ({ ...p, view: 'project-form' }))} className="px-5 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] shadow-md hover:opacity-90 transition-opacity whitespace-nowrap">New Project</button>)}
          </div>
        </nav>
      )}

      <div className="flex-1 flex-col relative overflow-hidden flex">
        {state.view === 'dashboard' && (
          <div className="flex-1 p-12 overflow-y-auto relative bg-white dark:bg-slate-950">
             {/* Floating Action Button for Multi-View */}
            {state.selectedMultiIds && state.selectedMultiIds.length > 0 && (
              <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-10 fade-in duration-300">
                <button onClick={handleEnterMultiView} className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-8 py-4 rounded-full shadow-2xl flex items-center gap-4 hover:scale-105 transition-transform">
                  <span className="font-black text-xs uppercase tracking-widest">Compare {state.selectedMultiIds.length} Projects</span><i className="fas fa-arrow-right"></i>
                </button>
              </div>
            )}

            <div className="max-w-6xl mx-auto">
              <header className="mb-16">
                <h2 className="text-5xl font-black text-slate-800 dark:text-white tracking-tighter mb-3">Roadmaps</h2>
                <p className="text-slate-400 dark:text-slate-500 text-[10px] font-black uppercase tracking-[0.3em]">Master scheduling hub.</p>
              </header>
              {state.projects.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
                  {state.projects.map(p => {
                    const isSelected = state.selectedMultiIds?.includes(p.id);
                    const isReadOnly = (state.readonlyProjectIds || []).includes(p.id);
                    return (
                      <div key={p.id} onClick={() => handleSelectProject(p.id)} className="group bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-8 rounded-[3rem] shadow-sm hover:shadow-2xl transition-all cursor-pointer relative">
                        <div onClick={(e) => { e.stopPropagation(); handleToggleMultiSelect(p.id); }} className={`absolute top-8 left-8 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all z-20 ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-transparent hover:border-indigo-300 dark:hover:border-indigo-500'}`}><i className="fas fa-check text-[10px]"></i></div>
                        {isReadOnly && (<div className="absolute top-8 right-8 w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 z-10" title="Read Only"><i className="fas fa-lock text-xs"></i></div>)}
                        <div className="absolute top-12 left-0 w-1.5 h-12 rounded-r-full" style={{ backgroundColor: p.color }}></div>
                        {isAdmin && !isReadOnly && (<button onClick={(e) => { e.stopPropagation(); handleDeleteProject(p.id); }} className="absolute top-8 right-8 w-10 h-10 rounded-full flex items-center justify-center text-slate-300 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100 z-10"><i className="fas fa-trash-alt"></i></button>)}
                        <div className="flex justify-between items-start mb-10 pl-8"><div className="w-14 h-14 bg-slate-50 dark:bg-slate-800 rounded-[1.25rem] flex items-center justify-center text-slate-300 dark:text-slate-600 text-2xl group-hover:bg-indigo-50 dark:group-hover:bg-slate-700 transition-colors"><i className="fas fa-layer-group"></i></div></div>
                        <h3 className="text-2xl font-black text-slate-800 dark:text-white mb-2 leading-tight">{p.name}</h3>
                        <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] mb-8">{p.personnel}</p>
                        <div className="flex items-center gap-3 text-[10px] font-black text-slate-300 dark:text-slate-600 border-t border-slate-50 dark:border-slate-800 pt-6"><i className="far fa-clock"></i><span>{p.startDate} — {p.endDate}</span></div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-32 bg-slate-50/50 dark:bg-slate-900/50 rounded-[4rem] border-2 border-dashed border-slate-100 dark:border-slate-800">
                  <div className="w-24 h-24 bg-white dark:bg-slate-800 rounded-[2.5rem] flex items-center justify-center text-slate-200 dark:text-slate-700 text-4xl mx-auto mb-8"><i className="fas fa-rocket"></i></div>
                  <h3 className="text-2xl font-black text-slate-400 dark:text-slate-500 mb-12">No active roadmaps.</h3>
                  {isAdmin && (<button onClick={() => setState(p => ({ ...p, view: 'project-form' }))} className="px-12 py-5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-full font-black text-[10px] uppercase tracking-[0.2em] shadow-2xl">Start Project</button>)}
                </div>
              )}
            </div>
          </div>
        )}

        {state.view === 'timeline' && activeProject && (
          <Timeline
            logs={activeProjectLogs}
            project={activeProject}
            onSelectDate={handleSelectDate}
            onMoveLogs={handleMoveLogs}
            onCopyLogs={handleCopyLogs}
            onUpdateProject={(updates) => handleUpdateProject(activeProject.id, updates)}
            onDeleteLogs={handleDeleteLogs}
            onToggleLock={handleToggleLock}
            onToggleStatus={handleToggleStatus}
            onPasteLogs={handlePasteLogs}
            readOnly={isActiveProjectReadOnly}
            collaborators={collaborators}
            onInteraction={(action, logId) => {
               const target = logId ? 'Log Item' : activeProject?.name || 'Timeline';
               const tId = logId || activeProject?.id || '';
               updatePresence({ action, target, targetId: tId });
            }}
          />
        )}

        {state.view === 'editor' && state.activeLogDate && (
           <LogEditor 
             dateStr={state.activeLogDate}
             initialLog={activeLog}
             initialLevel={pendingLogLevel}
             onSave={handleSaveLog}
             onBack={() => setState(p => ({ ...p, view: 'timeline', activeLogId: null, activeLogDate: null }))}
             readOnly={isActiveProjectReadOnly}
             project={activeProject} 
           />
        )}

        {state.view === 'project-form' && isAdmin && (
          <div className="flex-1 overflow-y-auto p-12 flex flex-col items-center bg-white dark:bg-slate-950">
             <div className="w-full max-w-2xl bg-white dark:bg-slate-900 p-10 rounded-[2.5rem] shadow-sm border border-slate-100 dark:border-slate-800">
                <header className="flex items-center justify-between mb-8">
                  <h2 className="text-3xl font-black text-slate-800 dark:text-white tracking-tight">New Project</h2>
                  <button onClick={() => setState(p => ({...p, view: 'dashboard'}))} className="w-10 h-10 rounded-full hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400 transition-colors"><i className="fas fa-times"></i></button>
                </header>
                
                <div className="space-y-8">
                   <div>
                      <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 ml-2">Project Name</label>
                      <input value={newProj.name} onChange={e => setNewProj(p => ({...p, name: e.target.value}))} placeholder="e.g. Q4 Marketing Campaign" className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl focus:bg-white dark:focus:bg-slate-800 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 dark:focus:ring-indigo-900/30 outline-none font-bold text-slate-800 dark:text-slate-100 transition-all" />
                   </div>
                   <div>
                      <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 ml-2">Lead / Team</label>
                      <input value={newProj.personnel} onChange={e => setNewProj(p => ({...p, personnel: e.target.value}))} placeholder="e.g. Design Team" className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl focus:bg-white dark:focus:bg-slate-800 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 dark:focus:ring-indigo-900/30 outline-none font-bold text-slate-800 dark:text-slate-100 transition-all" />
                   </div>
                   <div className="grid grid-cols-2 gap-6">
                      <div><label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 ml-2">Start Date</label><input type="date" value={newProj.startDate} onChange={e => setNewProj(p => ({...p, startDate: e.target.value}))} className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl focus:bg-white dark:focus:bg-slate-800 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 dark:focus:ring-indigo-900/30 outline-none font-bold text-slate-800 dark:text-slate-100 transition-all" /></div>
                      <div><label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 ml-2">End Date</label><input type="date" value={newProj.endDate} onChange={e => setNewProj(p => ({...p, endDate: e.target.value}))} className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl focus:bg-white dark:focus:bg-slate-800 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 dark:focus:ring-indigo-900/30 outline-none font-bold text-slate-800 dark:text-slate-100 transition-all" /></div>
                   </div>
                   <div>
                      <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 ml-2">Holiday Calendar</label>
                      <div className="flex gap-3">
                        {(['CN', 'US', 'NONE'] as const).map(region => (
                           <button key={region} onClick={() => setNewProj(p => ({...p, holidayRegion: region}))} className={`flex-1 py-4 rounded-xl border-2 text-xs font-bold transition-all ${newProj.holidayRegion === region ? 'border-slate-800 bg-slate-900 dark:bg-white dark:border-white dark:text-slate-900 text-white' : 'border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-400 hover:bg-white dark:hover:bg-slate-700 hover:border-slate-200'}`}>{region === 'CN' ? '🇨🇳 China' : region === 'US' ? '🇺🇸 USA' : 'No Holidays'}</button>
                        ))}
                      </div>
                   </div>
                   <div>
                      <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 ml-2">AI Context (Optional)</label>
                      <textarea value={newProj.description} onChange={e => setNewProj(p => ({...p, description: e.target.value}))} placeholder="Describe the project goals to auto-generate a roadmap..." className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl focus:bg-white dark:focus:bg-slate-800 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 dark:focus:ring-indigo-900/30 outline-none font-medium text-slate-600 dark:text-slate-300 transition-all min-h-[120px]" />
                   </div>
                   <button onClick={handleAddProject} disabled={isGenerating} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-200 dark:shadow-none disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2">{isGenerating ? <><i className="fas fa-magic fa-spin"></i> Generating...</> : 'Create Project'}</button>
                </div>
             </div>
          </div>
        )}

        {state.view === 'multi-timeline' && (
          <MultiTimelineView 
            projects={multiViewProjects}
            logs={state.logs}
            onBack={() => setState(p => ({ ...p, view: 'dashboard' }))}
          />
        )}
      </div>
    </div>
  );
};