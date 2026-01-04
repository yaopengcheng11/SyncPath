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

// Helper to get storage key based on username
const getStorageKey = (username: string) => `roadmap_data_v1_${username}`;

// Assign a persistent color to the user for the session
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
  systemMessage: null
};

export const App: React.FC = () => {
  // Initialize with default state. User data is loaded in handleAuthSuccess
  const [state, setState] = useState<AppState>(DEFAULT_STATE);

  // Undo/Redo History State
  const [history, setHistory] = useState<{ past: AppState[]; future: AppState[] }>({ past: [], future: [] });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pendingLogLevel, setPendingLogLevel] = useState<LogLevel>(3);
  const [showExportSelector, setShowExportSelector] = useState(false);
  const [showRoomInput, setShowRoomInput] = useState(false);
  const [roomInput, setRoomInput] = useState('');
  const [roomMode, setRoomMode] = useState<'create' | 'join'>('create');
  const [isRoomConnecting, setIsRoomConnecting] = useState(false);
  
  // New Project State
  const [newProj, setNewProj] = useState<Partial<Project>>({
    name: '',
    personnel: '',
    description: '',
    startDate: '',
    endDate: '',
    holidayRegion: 'CN'
  });
  const [isGenerating, setIsGenerating] = useState(false);

  // --- Live Collaboration Hook ---
  // We define a handler to merge remote data into local state
  const handleRemoteUpdate = useCallback((data: { projects: Project[]; logs: Record<string, Record<string, WorkLog[]>> }) => {
    setState(current => {
      // Logic to UNLOCK projects if the user is now part of the team in a live session.
      const username = current.currentUser?.username.toLowerCase() || '';
      
      const teamProjectIds = data.projects
        .filter(p => p.personnel.toLowerCase().includes(username))
        .map(p => p.id);

      // Remove team projects from the readonly list
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

      // 1. Filter Projects based on Team Membership
      const keptProjects = current.projects.filter(p => {
        // Check if the personnel string includes the username (case-insensitive)
        return p.personnel.toLowerCase().includes(username);
      });

      const removedCount = current.projects.length - keptProjects.length;

      // 2. Identify kept IDs to clean up logs
      const keptIdsSet = new Set(keptProjects.map(p => p.id));
      const newLogs = { ...current.logs };
      
      // Remove logs for projects that were deleted
      Object.keys(newLogs).forEach(projId => {
        if (!keptIdsSet.has(projId)) {
          delete newLogs[projId];
        }
      });

      // 3. Mark kept projects as Read-Only
      const newReadOnlyIds = [...(current.readonlyProjectIds || [])];
      keptProjects.forEach(p => {
        if (!newReadOnlyIds.includes(p.id)) {
          newReadOnlyIds.push(p.id);
        }
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
        systemMessage: {
          title: 'Session Ended',
          message: message,
          type: 'warning'
        }
      };
    });
  }, []);

  const { isConnected, currentRoom, peersCount, collaborators, isHost, connect, disconnect, broadcast, updatePresence } = useLiveCollaboration({
    onRemoteUpdate: handleRemoteUpdate,
    onRoomClosed: handleHostClosedRoom
  });

  // --- Presence & Activity Broadcast ---
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
      // Show author/objective as target, or date if empty
      target = log?.author || state.activeLogDate; 
      targetId = state.activeLogId || '';
    }

    updatePresence({ action, target, targetId });
  }, [state.view, state.selectedProjectId, state.activeLogId, state.activeLogDate, isConnected, updatePresence, state.projects, state.logs]);


  // --- Smart Merge Logic (Reusable for Import) ---
  const smartMerge = useCallback((local: AppState, imported: AppState): AppState => {
    const mergedProjects = [...local.projects];
    // 1. Merge Projects
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

    // 2. Merge Logs
    const mergedLogs: Record<string, Record<string, WorkLog[]>> = { ...local.logs };
    const allProjectIds = new Set([
      ...Object.keys(local.logs),
      ...Object.keys(imported.logs)
    ]);

    allProjectIds.forEach(projId => {
      const localProjectLogsMap = new Map<string, WorkLog>();
      if (local.logs[projId]) {
        Object.values(local.logs[projId]).flat().forEach(log => {
          localProjectLogsMap.set(log.id, log);
        });
      }

      const importedProjectLogsMap = new Map<string, WorkLog>();
      if (imported.logs[projId]) {
        Object.values(imported.logs[projId]).flat().forEach(log => {
          importedProjectLogsMap.set(log.id, log);
        });
      }

      const finalLogsMap = new Map<string, WorkLog>(localProjectLogsMap);
      importedProjectLogsMap.forEach((impLog, logId) => {
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

  // Sync to User-Scoped LocalStorage
  useEffect(() => {
    if (state.currentUser) {
      const key = getStorageKey(state.currentUser.username);
      // We only save the data parts, preserving the active session user
      const dataToSave = {
        projects: state.projects,
        logs: state.logs,
        view: state.view,
        selectedProjectId: state.selectedProjectId,
        selectedMultiIds: state.selectedMultiIds,
        readonlyProjectIds: state.readonlyProjectIds || [] // Save readonly state
      };
      localStorage.setItem(key, JSON.stringify(dataToSave));
    }
  }, [state]);

  // Helper to wrap state updates that should be undoable AND broadcastable
  const modifyState = useCallback((reducer: (prev: AppState) => AppState) => {
    setState(current => {
      const nextState = reducer(current);
      if (JSON.stringify(nextState) === JSON.stringify(current)) return current;

      setHistory(prevHist => ({
        past: [...prevHist.past, current].slice(-50),
        future: []
      }));
      
      // BROADCAST TO PEERS
      // We don't check isConnected here because broadcast inside hook handles the check safely
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

  // Keyboard Shortcuts
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

    // Export specific project
    if (targetProjectId) {
      const currentProject = state.projects.find(p => p.id === targetProjectId);
      if (currentProject) {
        exportState = {
          ...state,
          projects: [currentProject],
          logs: { [currentProject.id]: state.logs[currentProject.id] || {} },
          // When importing a single project back, having selectedProjectId ensures context is clear
          selectedProjectId: currentProject.id,
          view: 'timeline',
          currentUser: state.currentUser // Preserve user
        };
        const safeName = currentProject.name
          .replace(/[<>:"/\\|?*]/g, '')
          .replace(/\s+/g, '_');
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

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

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
        
      } catch (error) {
        alert("Error parsing file.");
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handleJoinRoom = async () => {
    if (roomInput.trim() && state.currentUser) {
      setIsRoomConnecting(true);
      
      const initialData = {
        projects: state.projects,
        logs: state.logs
      };

      // Generate a session color for the user
      const userColor = getUserColor(state.currentUser.username);
      const userInfo = { 
        username: state.currentUser.username, 
        color: userColor 
      };

      const success = await connect(roomInput.trim(), roomMode, initialData, userInfo);
      setIsRoomConnecting(false);
      
      if (success) {
        setShowRoomInput(false);
      } else {
        alert("Room not found or no active peers. Ensure someone else has already created '" + roomInput.trim() + "' and is online. In P2P mode, rooms disappear when all users leave.");
      }
    }
  };

  const handleAddProject = async () => {
    if (!newProj.name || !newProj.startDate || !newProj.endDate) {
      alert("Please fill in Title, Start Date, and End Date.");
      return;
    }

    setIsGenerating(true);
    
    // Fetch Holidays if region is selected
    let fetchedHolidays: HolidayData[] = [];
    if (newProj.holidayRegion && newProj.holidayRegion !== 'NONE') {
      try {
        fetchedHolidays = await fetchPublicHolidays(newProj.holidayRegion, newProj.startDate!, newProj.endDate!);
      } catch (e) {
        console.error("Failed to fetch holidays", e);
      }
    }

    const projectId = Math.random().toString(36).substr(2, 9);
    
    const project: Project = {
      id: projectId,
      name: newProj.name!,
      personnel: newProj.personnel || 'Team',
      description: newProj.description || '',
      startDate: newProj.startDate!,
      endDate: newProj.endDate!,
      holidayRegion: newProj.holidayRegion || 'CN',
      storedHolidays: fetchedHolidays,
      color: PROJECT_COLORS[state.projects.length % PROJECT_COLORS.length],
      updatedAt: Date.now()
    };

    let generatedLogs: Record<string, WorkLog[]> = {};

    if (newProj.description) {
      try {
        const aiLogsRaw = await generateRoadmap(newProj.description, newProj.startDate!, newProj.endDate!);
        
        aiLogsRaw.forEach((rawLog) => {
          const dateObj = parseSafeDate(rawLog.date);
          const weekStart = getStartOfWeek(dateObj);
          const dateBucket = formatDate(weekStart);

          const newLog: WorkLog = {
            id: Math.random().toString(36).substr(2, 9),
            author: rawLog.author || 'AI',
            level: (rawLog.level as LogLevel) || 3,
            weekStartDate: dateBucket,
            summary: rawLog.summary,
            notes: `Generated from: ${rawLog.date}`,
            goals: rawLog.goals.map((gStr) => ({
              id: Math.random().toString(36).substr(2, 9),
              title: gStr,
              status: 'pending',
              description: ''
            })),
            createdAt: Date.now(),
            updatedAt: Date.now()
          };

          if (!generatedLogs[dateBucket]) {
            generatedLogs[dateBucket] = [];
          }
          generatedLogs[dateBucket].push(newLog);
        });
      } catch (error) {
        console.error("AI Generation failed", error);
      }
    }

    setIsGenerating(false);

    modifyState(prev => ({ 
      ...prev, 
      projects: [...prev.projects, project], 
      logs: { ...prev.logs, [projectId]: generatedLogs },
      selectedProjectId: projectId, 
      view: 'timeline' 
    }));
    
    setNewProj({ name: '', personnel: '', description: '', startDate: '', endDate: '', holidayRegion: 'CN' });
  };

  const handleDeleteProject = (projectId: string) => {
    if (window.confirm("Delete this project and all its history?")) {
      setState(current => {
        const newLogs = { ...current.logs };
        delete newLogs[projectId];
        const newSelection = (current.selectedMultiIds || []).filter(id => id !== projectId);
        const newReadonly = (current.readonlyProjectIds || []).filter(id => id !== projectId);
        
        const nextState: AppState = {
          ...current,
          projects: current.projects.filter(p => p.id !== projectId),
          logs: newLogs,
          selectedMultiIds: newSelection,
          readonlyProjectIds: newReadonly,
          selectedProjectId: null,
          view: 'dashboard'
        };
        setHistory(h => ({ past: [...h.past, current].slice(-50), future: [] }));
        broadcast(nextState.projects, nextState.logs);
        return nextState;
      });
    }
  };

  const handleUpdateProject = (id: string, updates: Partial<Project>) => {
    modifyState(prev => ({
      ...prev,
      projects: prev.projects.map(p => p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p)
    }));
  };

  const handleSelectProject = (id: string) => {
    setState(prev => ({ ...prev, selectedProjectId: id, view: 'timeline' }));
  };

  const handleToggleMultiSelect = (id: string) => {
    setState(prev => {
       const currentSelection = prev.selectedMultiIds || [];
       if (currentSelection.includes(id)) {
         return { ...prev, selectedMultiIds: currentSelection.filter(sid => sid !== id) };
       } else {
         return { ...prev, selectedMultiIds: [...currentSelection, id] };
       }
    });
  };

  const handleEnterMultiView = () => {
    if (!state.selectedMultiIds || state.selectedMultiIds.length === 0) return;
    setState(prev => ({ ...prev, view: 'multi-timeline' }));
  };

  const handleSelectDate = (dateStr: string, logId?: string, level?: LogLevel) => {
    if (level) setPendingLogLevel(level);
    setState(prev => ({ ...prev, activeLogDate: dateStr, activeLogId: logId || null, view: 'editor' }));
  };

  // --- Batch Operations for Better Sync ---

  const handleMoveLogs = useCallback((moves: {id: string, oldDate: string, newDate: string}[]) => {
     if (!state.selectedProjectId || moves.length === 0) return;
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
  }, [state.selectedProjectId, modifyState]);
  
  const handleCopyLogs = useCallback((copies: {id: string, oldDate: string, newDate: string}[]) => {
     if (!state.selectedProjectId || copies.length === 0) return;

     modifyState(prev => {
        const projectId = prev.selectedProjectId!;
        const projectLogs = { ...(prev.logs[projectId] || {}) };

        copies.forEach(({ id, oldDate, newDate }) => {
            const sourceList = projectLogs[oldDate];
            if (!sourceList) return;
            const logToCopy = sourceList.find(l => l.id === id);
            if (!logToCopy) return;

            const newGoals = logToCopy.goals.map(g => ({
                ...g,
                id: Math.random().toString(36).substr(2, 9)
            }));

            const newLog: WorkLog = {
                ...logToCopy,
                id: Math.random().toString(36).substr(2, 9),
                weekStartDate: newDate,
                goals: newGoals,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            
            projectLogs[newDate] = [...(projectLogs[newDate] || []), newLog];
        });
        
        return { ...prev, logs: { ...prev.logs, [projectId]: projectLogs } };
     });
  }, [state.selectedProjectId, modifyState]);

  const handleDeleteLogs = useCallback((logIds: string[]) => {
    if (!state.selectedProjectId || logIds.length === 0) return;
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
            if (filteredList.length === 0) {
                delete currentProjectLogs[dateKey];
            } else {
                currentProjectLogs[dateKey] = filteredList;
            }
            changed = true;
         }
      });

      if (!changed) return prev;

      currentAllLogs[projectId] = currentProjectLogs;
      return { ...prev, logs: currentAllLogs, activeLogId: null, activeLogDate: null };
    });
  }, [state.selectedProjectId, modifyState]);

  const handlePasteLogs = useCallback((pastedLogs: WorkLog[], targetDateStr: string | null) => {
    if (!state.selectedProjectId || pastedLogs.length === 0) return;

    const logsWithNewIds = pastedLogs.map(log => ({
        ...log,
        newId: Math.random().toString(36).substr(2, 9),
        newGoals: log.goals.map(g => ({ ...g, id: Math.random().toString(36).substr(2, 9) }))
    }));

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
             const newDate = new Date(originalDate);
             newDate.setDate(originalDate.getDate() + offsetDays);
             newDateStr = formatDate(newDate);
          }

          const newLog: WorkLog = {
              ...log,
              id: newId,
              weekStartDate: newDateStr,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              goals: newGoals,
              isLocked: false 
          };

          const existingLogs = projectLogs[newDateStr] || [];
          projectLogs[newDateStr] = [...existingLogs, newLog];
      });

      return { ...prev, logs: { ...prev.logs, [projectId]: projectLogs } };
    });
  }, [state.selectedProjectId, modifyState]);

  const handleToggleLock = useCallback((logId: string, dateStr: string) => {
    if (!state.selectedProjectId) return;
    modifyState(prev => {
      const projectId = prev.selectedProjectId!;
      const projectLogs = { ...prev.logs[projectId] };
      if (!projectLogs[dateStr]) return prev;
      
      const logIndex = projectLogs[dateStr].findIndex(l => l.id === logId);
      if (logIndex === -1) return prev;

      const updatedLog = { ...projectLogs[dateStr][logIndex], isLocked: !projectLogs[dateStr][logIndex].isLocked };
      const newDateLogs = [...projectLogs[dateStr]];
      newDateLogs[logIndex] = updatedLog;
      
      projectLogs[dateStr] = newDateLogs;
      return { ...prev, logs: { ...prev.logs, [projectId]: projectLogs } };
    });
  }, [state.selectedProjectId, modifyState]);

  const handleSaveLog = (log: WorkLog) => {
    if (!state.selectedProjectId) return;
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
    if (saved) {
       loadedState = JSON.parse(saved);
    }
    
    // Merge user data and ensure color exists
    const fullUser: User = { 
      ...user, 
      color: user.color || getUserColor(user.username) 
    };

    setState({
       ...loadedState,
       currentUser: fullUser,
       view: 'dashboard', 
       selectedProjectId: null,
       readonlyProjectIds: loadedState.readonlyProjectIds || []
    });
  };

  const handleLogout = () => {
    if (isConnected) disconnect();
    setState(DEFAULT_STATE);
  };

  const activeProject = useMemo(() => state.projects.find(p => p.id === state.selectedProjectId), [state.projects, state.selectedProjectId]);
  const activeProjectLogs = useMemo(() => (state.selectedProjectId ? state.logs[state.selectedProjectId] : {}) || {}, [state.logs, state.selectedProjectId]);
  const activeLog = state.activeLogDate && state.activeLogId ? activeProjectLogs[state.activeLogDate]?.find(l => l.id === state.activeLogId) : undefined;
  const multiViewProjects = useMemo(() => state.projects.filter(p => state.selectedMultiIds?.includes(p.id)), [state.projects, state.selectedMultiIds]);
  const isAdmin = state.currentUser?.role === 'admin';
  const isActiveProjectReadOnly = useMemo(() => {
     if (!activeProject) return false;
     return !isAdmin || (state.readonlyProjectIds || []).includes(activeProject.id);
  }, [isAdmin, activeProject, state.readonlyProjectIds]);

  if (!state.currentUser) {
    return <AuthScreen onAuthSuccess={handleAuthSuccess} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-white animate-in fade-in duration-500">
      <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".json" />
      
      {/* System Message Modal (NEW) */}
      {state.systemMessage && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[3000] flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={(e) => e.stopPropagation()}
        >
           <div 
             className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md p-8 text-center"
             onClick={e => e.stopPropagation()}
           >
              <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-6">
                <i className="fas fa-exclamation-triangle"></i>
              </div>
              <h3 className="text-xl font-black text-slate-800 mb-4">{state.systemMessage.title}</h3>
              <p className="text-sm text-slate-500 font-medium mb-8 whitespace-pre-wrap leading-relaxed">
                 {state.systemMessage.message}
              </p>
              <button 
                onClick={() => setState(p => ({...p, systemMessage: null}))}
                className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-slate-800 transition-all shadow-xl"
              >
                Understood
              </button>
           </div>
        </div>
      )}

      {/* Room Input Modal */}
      {showRoomInput && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[2000] flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => { if(!isRoomConnecting) setShowRoomInput(false); }}
        >
          <div 
            className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm overflow-hidden p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4">
                <i className="fas fa-tower-broadcast"></i>
              </div>
              <h3 className="text-xl font-black text-slate-800 tracking-tight">Live Session</h3>
              <p className="text-xs text-slate-500 font-medium mt-1">Real-time team collaboration.</p>
            </div>

            <div className="flex bg-slate-50 p-1 rounded-xl mb-6">
              <button 
                onClick={() => setRoomMode('create')}
                disabled={isRoomConnecting}
                className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${roomMode === 'create' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Create Room
              </button>
              <button 
                onClick={() => setRoomMode('join')}
                disabled={isRoomConnecting}
                className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${roomMode === 'join' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Join Room
              </button>
            </div>
            
            <div className="space-y-4">
              <input 
                autoFocus
                type="text" 
                placeholder="Enter Room Name (e.g. team-alpha)" 
                className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none font-bold text-slate-800 text-center"
                value={roomInput}
                onChange={e => setRoomInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !isRoomConnecting && handleJoinRoom()}
                disabled={isRoomConnecting}
              />
              <button 
                onClick={handleJoinRoom}
                disabled={isRoomConnecting || !roomInput.trim()}
                className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:scale-[1.02] transition-transform shadow-lg disabled:opacity-70 disabled:hover:scale-100 flex items-center justify-center gap-2"
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

      {/* Export Selector Modal */}
      {showExportSelector && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center animate-in fade-in duration-200"
          onClick={() => setShowExportSelector(false)}
        >
          <div 
            className="bg-white rounded-[2.5rem] shadow-2xl max-w-lg w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-10">
              <h3 className="text-2xl font-black text-slate-800 mb-2">Export Data</h3>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-8">Select project to export as JSON</p>

              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                <button 
                  onClick={() => executeJSONExport(null)}
                  className="w-full text-left p-4 rounded-2xl bg-slate-50 hover:bg-indigo-50 border border-slate-100 hover:border-indigo-100 transition-all group flex items-center gap-4"
                >
                   <div className="w-10 h-10 rounded-xl bg-slate-200 group-hover:bg-indigo-200 flex items-center justify-center text-slate-500 group-hover:text-indigo-600 transition-colors">
                     <i className="fas fa-database"></i>
                   </div>
                   <div>
                     <h4 className="font-black text-slate-800 text-sm">Full System Backup</h4>
                     <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">All Projects & Settings</p>
                   </div>
                </button>

                <div className="h-px bg-slate-100 my-4"></div>

                {state.projects.length === 0 && (
                   <p className="text-center text-slate-400 text-xs py-4">No individual projects available.</p>
                )}

                {state.projects.map(p => (
                   <button 
                    key={p.id}
                    onClick={() => executeJSONExport(p.id)}
                    className="w-full text-left p-4 rounded-2xl hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-all flex items-center gap-4"
                  >
                     <div className="w-3 h-10 rounded-full" style={{ backgroundColor: p.color }}></div>
                     <div>
                       <h4 className="font-black text-slate-800 text-sm leading-tight">{p.name}</h4>
                       <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wide">{p.personnel}</p>
                     </div>
                     <i className="fas fa-download ml-auto text-slate-300"></i>
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-slate-50 p-6 flex justify-end">
               <button onClick={() => setShowExportSelector(false)} className="px-6 py-3 text-slate-400 font-black text-[10px] uppercase tracking-widest hover:text-slate-600 transition-all">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      {state.view !== 'multi-timeline' && (
        <nav className="px-12 py-8 flex items-center justify-between border-b border-slate-50">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setState(p => ({ ...p, view: 'dashboard', selectedProjectId: null }))}>
              <div className="w-9 h-9 bg-slate-900 rounded-xl flex items-center justify-center text-white text-[12px] font-black shadow-lg shadow-slate-200 transition-all">S</div>
              <span className="font-black text-slate-800 tracking-tighter text-sm">SyncPath</span>
            </div>
            
            <div className="h-6 w-px bg-slate-100 hidden md:block"></div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Roadmap Management</p>
          </div>

          <div className="flex items-center gap-4">
            
            {/* Live Collaboration Status & List */}
            {!isConnected ? (
              <button 
                onClick={() => setShowRoomInput(true)}
                className="px-4 py-2 rounded-full border border-slate-200 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-colors flex items-center gap-2 text-slate-500"
              >
                <div className="w-2 h-2 rounded-full bg-slate-300"></div> Live
              </button>
            ) : (
              <div className="flex items-center gap-3 pr-2">
                {/* Active Collaborators List */}
                <div className="flex -space-x-2 mr-2">
                  {collaborators.map(c => (
                    <div key={c.clientId} className="relative group cursor-help">
                      <div 
                        className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-white text-[10px] font-bold shadow-sm"
                        style={{ backgroundColor: c.color }}
                      >
                        {c.username.charAt(0).toUpperCase()}
                      </div>
                      {/* Tooltip for User Activity */}
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-max max-w-[200px] bg-slate-800 text-white text-[10px] rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                        <span className="font-bold">{c.username}</span>
                        <div className="opacity-75 font-medium">
                          {c.action} {c.target && <span className="italic text-slate-300">{c.target}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="w-8 h-8 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-slate-400 text-[9px] font-bold shadow-sm">
                    You
                  </div>
                </div>

                <button 
                  onClick={disconnect}
                  className={`px-4 py-2 rounded-full border border-emerald-100 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-red-50 hover:text-red-500 hover:border-red-100 transition-all group ${isHost ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}
                  title={isHost ? 'End Session' : 'Disconnect'}
                >
                  <div className={`w-2 h-2 rounded-full animate-pulse group-hover:bg-red-500 ${isHost ? 'bg-amber-500' : 'bg-emerald-500'}`}></div> 
                  <span className="hidden lg:inline">{currentRoom}{isHost ? ' (Host)' : ''}</span>
                  <span className="hidden group-hover:inline ml-1">Disconnect</span>
                </button>
              </div>
            )}

            {/* User Info / Logout */}
            <div className="flex items-center gap-3 mr-4 pl-4 border-l border-slate-100">
              <div className="text-right hidden sm:block">
                 <p className="text-xs font-bold text-slate-700">{state.currentUser.username}</p>
                 <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest">{isAdmin ? 'Administrator' : 'Guest Access'}</p>
              </div>
              <button 
                onClick={handleLogout}
                className="w-10 h-10 rounded-full bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-red-500 transition-all flex items-center justify-center"
                title="Logout"
              >
                <i className="fas fa-sign-out-alt"></i>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={() => setShowExportSelector(true)} className="w-10 h-10 rounded-full border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 transition-all" title="Export Data"><i className="fas fa-file-arrow-down"></i></button>
              {isAdmin && (
                <button onClick={handleImportClick} className="w-10 h-10 rounded-full border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 transition-all group relative" title="Merge Data">
                  <i className="fas fa-file-arrow-up group-hover:text-indigo-600"></i>
                  <div className="absolute -bottom-8 bg-slate-800 text-white text-[9px] font-black px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">Merge</div>
                </button>
              )}
            </div>
            {isAdmin && (
              <button onClick={() => setState(p => ({ ...p, view: 'project-form' }))} className="px-6 py-3 bg-slate-900 text-white rounded-full font-black text-[10px] uppercase tracking-[0.2em] shadow-md ml-2">New Project</button>
            )}
          </div>
        </nav>
      )}

      <div className="flex-1 flex-col relative overflow-hidden flex">
        {state.view === 'dashboard' && (
          <div className="flex-1 p-12 overflow-y-auto relative">
             {/* Floating Action Button for Multi-View */}
            {state.selectedMultiIds && state.selectedMultiIds.length > 0 && (
              <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-10 fade-in duration-300">
                <button 
                  onClick={handleEnterMultiView}
                  className="bg-slate-900 text-white px-8 py-4 rounded-full shadow-2xl flex items-center gap-4 hover:scale-105 transition-transform"
                >
                  <span className="font-black text-xs uppercase tracking-widest">Compare {state.selectedMultiIds.length} Projects</span>
                  <i className="fas fa-arrow-right"></i>
                </button>
              </div>
            )}

            <div className="max-w-6xl mx-auto">
              <header className="mb-16">
                <h2 className="text-5xl font-black text-slate-800 tracking-tighter mb-3">Roadmaps</h2>
                <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.3em]">Master scheduling hub.</p>
              </header>
              {state.projects.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
                  {state.projects.map(p => {
                    const isSelected = state.selectedMultiIds?.includes(p.id);
                    const isReadOnly = (state.readonlyProjectIds || []).includes(p.id);
                    return (
                      <div key={p.id} onClick={() => handleSelectProject(p.id)} className="group bg-white border border-slate-100 p-8 rounded-[3rem] shadow-sm hover:shadow-2xl transition-all cursor-pointer relative">
                        {/* Selection Checkbox */}
                        <div 
                          onClick={(e) => { e.stopPropagation(); handleToggleMultiSelect(p.id); }}
                          className={`absolute top-8 left-8 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all z-20 ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-transparent hover:border-indigo-300'}`}
                        >
                          <i className="fas fa-check text-[10px]"></i>
                        </div>
                        
                        {/* Read Only Indicator */}
                        {isReadOnly && (
                          <div className="absolute top-8 right-8 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 z-10" title="Read Only">
                             <i className="fas fa-lock text-xs"></i>
                          </div>
                        )}

                        <div className="absolute top-12 left-0 w-1.5 h-12 rounded-r-full" style={{ backgroundColor: p.color }}></div>
                        {isAdmin && !isReadOnly && (
                          <button onClick={(e) => { e.stopPropagation(); handleDeleteProject(p.id); }} className="absolute top-8 right-8 w-10 h-10 rounded-full flex items-center justify-center text-slate-300 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100 z-10"><i className="fas fa-trash-alt"></i></button>
                        )}
                        <div className="flex justify-between items-start mb-10 pl-8"><div className="w-14 h-14 bg-slate-50 rounded-[1.25rem] flex items-center justify-center text-slate-300 text-2xl group-hover:bg-indigo-50 transition-colors"><i className="fas fa-layer-group"></i></div></div>
                        <h3 className="text-2xl font-black text-slate-800 mb-2 leading-tight">{p.name}</h3>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-8">{p.personnel}</p>
                        <div className="flex items-center gap-3 text-[10px] font-black text-slate-300 border-t border-slate-50 pt-6"><i className="far fa-clock"></i><span>{p.startDate} — {p.endDate}</span></div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-32 bg-slate-50/50 rounded-[4rem] border-2 border-dashed border-slate-100">
                  <div className="w-24 h-24 bg-white rounded-[2.5rem] flex items-center justify-center text-slate-200 text-4xl mx-auto mb-8"><i className="fas fa-rocket"></i></div>
                  <h3 className="text-2xl font-black text-slate-400 mb-12">No active roadmaps.</h3>
                  {isAdmin && (
                    <button onClick={() => setState(p => ({ ...p, view: 'project-form' }))} className="px-12 py-5 bg-slate-900 text-white rounded-full font-black text-[10px] uppercase tracking-[0.2em] shadow-2xl">Start Project</button>
                  )}
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
            onPasteLogs={handlePasteLogs}
            readOnly={isActiveProjectReadOnly}
            collaborators={collaborators}
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
           />
        )}

        {state.view === 'project-form' && isAdmin && (
          <div className="flex-1 overflow-y-auto p-12 flex flex-col items-center">
             <div className="w-full max-w-2xl bg-white p-10 rounded-[2.5rem] shadow-sm border border-slate-100">
                <header className="flex items-center justify-between mb-8">
                  <h2 className="text-3xl font-black text-slate-800 tracking-tight">New Project</h2>
                  <button onClick={() => setState(p => ({...p, view: 'dashboard'}))} className="w-10 h-10 rounded-full hover:bg-slate-50 flex items-center justify-center text-slate-400 transition-colors"><i className="fas fa-times"></i></button>
                </header>
                
                <div className="space-y-8">
                   <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Project Name</label>
                      <input value={newProj.name} onChange={e => setNewProj(p => ({...p, name: e.target.value}))} placeholder="e.g. Q4 Marketing Campaign" className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none font-bold text-slate-800 transition-all" />
                   </div>
                   
                   <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Lead / Team</label>
                      <input value={newProj.personnel} onChange={e => setNewProj(p => ({...p, personnel: e.target.value}))} placeholder="e.g. Design Team" className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none font-bold text-slate-800 transition-all" />
                   </div>

                   <div className="grid grid-cols-2 gap-6">
                      <div>
                         <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Start Date</label>
                         <input type="date" value={newProj.startDate} onChange={e => setNewProj(p => ({...p, startDate: e.target.value}))} className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none font-bold text-slate-800 transition-all" />
                      </div>
                      <div>
                         <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">End Date</label>
                         <input type="date" value={newProj.endDate} onChange={e => setNewProj(p => ({...p, endDate: e.target.value}))} className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none font-bold text-slate-800 transition-all" />
                      </div>
                   </div>

                   <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Holiday Calendar</label>
                      <div className="flex gap-3">
                        {(['CN', 'US', 'NONE'] as const).map(region => (
                           <button
                             key={region}
                             onClick={() => setNewProj(p => ({...p, holidayRegion: region}))}
                             className={`flex-1 py-4 rounded-xl border-2 text-xs font-bold transition-all ${
                               newProj.holidayRegion === region 
                                 ? 'border-slate-800 bg-slate-900 text-white' 
                                 : 'border-slate-100 bg-slate-50 text-slate-400 hover:bg-white hover:border-slate-200'
                             }`}
                           >
                             {region === 'CN' ? '🇨🇳 China' : region === 'US' ? '🇺🇸 USA' : 'No Holidays'}
                           </button>
                        ))}
                      </div>
                   </div>
                   
                   <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">AI Context (Optional)</label>
                      <textarea 
                        value={newProj.description} 
                        onChange={e => setNewProj(p => ({...p, description: e.target.value}))} 
                        placeholder="Describe the project goals to auto-generate a roadmap..." 
                        className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none font-medium text-slate-600 transition-all min-h-[120px]" 
                      />
                   </div>

                   <button 
                     onClick={handleAddProject} 
                     disabled={isGenerating}
                     className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-200 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                   >
                     {isGenerating ? <><i className="fas fa-magic fa-spin"></i> Generating...</> : 'Create Project'}
                   </button>
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