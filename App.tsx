import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AppState, WorkLog, Project, LogLevel, Goal } from './types';
import Timeline from './components/Timeline';
import LogEditor from './components/LogEditor';
import MultiTimelineView from './components/MultiTimelineView';
import { useLiveCollaboration } from './hooks/useLiveCollaboration';
import { getStartOfWeek, formatDate, parseSafeDate } from './utils/dateUtils';

const PROJECT_COLORS = ['#6366f1', '#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#3b82f6'];

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem('roadmap_multi_sync_state_v12');
    const defaultState = {
      projects: [],
      selectedProjectId: null,
      selectedMultiIds: [],
      logs: {},
      activeLogDate: null,
      activeLogId: null,
      view: 'dashboard' as const,
      userMode: 'admin' as const
    };
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...defaultState, ...parsed, userMode: 'admin' }; // Always default to admin on reload or keep saved preference
    }
    return defaultState;
  });

  // Undo/Redo History State
  const [history, setHistory] = useState<{ past: AppState[]; future: AppState[] }>({ past: [], future: [] });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pendingLogLevel, setPendingLogLevel] = useState<LogLevel>(3);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [roomInput, setRoomInput] = useState('');
  const [showExportSelector, setShowExportSelector] = useState(false);
  
  // New Project State
  const [newProj, setNewProj] = useState<Partial<Project>>({
    name: '',
    personnel: '',
    description: '',
    startDate: '',
    endDate: ''
  });
  const [isGenerating, setIsGenerating] = useState(false);

  // Dashboard Selection state (sync with AppState for persistence if needed, or keeping it strictly in AppState)
  // We use state.selectedMultiIds from AppState.

  // --- Smart Merge Logic (Reusable for Import & Live Sync) ---
  const smartMerge = useCallback((local: AppState, imported: AppState): AppState => {
    const mergedProjects = [...local.projects];
    
    // 1. Merge Projects
    imported.projects.forEach(impProj => {
      const existingIdx = mergedProjects.findIndex(p => p.id === impProj.id);
      if (existingIdx === -1) {
        mergedProjects.push(impProj);
      } else {
        const localProj = mergedProjects[existingIdx];
        if ((impProj.updatedAt || 0) > (localProj.updatedAt || 0)) {
          mergedProjects[existingIdx] = impProj;
        }
      }
    });

    // 2. Merge Logs
    // Refactored to handle logs moved between dates (buckets)
    const mergedLogs: Record<string, Record<string, WorkLog[]>> = { ...local.logs };
    
    // Identify all projects involved in either local or imported state
    const allProjectIds = new Set([
      ...Object.keys(local.logs),
      ...Object.keys(imported.logs)
    ]);

    allProjectIds.forEach(projId => {
      // Helper to flatten logs into a Map<LogID, Log>
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

      // Merge Logic: Start with local logs
      const finalLogsMap = new Map<string, WorkLog>(localProjectLogsMap);

      // Iterate imported logs and merge/overwrite based on timestamps
      importedProjectLogsMap.forEach((impLog, logId) => {
        const localLog = finalLogsMap.get(logId);
        
        if (!localLog) {
          // New log from import
          finalLogsMap.set(logId, impLog);
        } else {
          // Conflict: Compare timestamps
          const impTime = impLog.updatedAt || impLog.createdAt || 0;
          const localTime = localLog.updatedAt || localLog.createdAt || 0;
          
          if (impTime > localTime) {
             finalLogsMap.set(logId, impLog);
          }
          // Else keep local (it's newer)
        }
      });

      // Reconstruct the date-bucket structure
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
      // Don't force view reset for live sync to allow seamless editing
    };
  }, []);

  // --- Live Collaboration Hook ---
  const handleRemoteUpdate = useCallback((remoteState: AppState) => {
    setState(current => smartMerge(current, remoteState));
  }, [smartMerge]);

  const { isConnected, peersCount, roomName, connect, disconnect, broadcast } = useLiveCollaboration({
    currentState: state,
    onRemoteUpdate: handleRemoteUpdate
  });

  // Sync to LocalStorage
  useEffect(() => {
    localStorage.setItem('roadmap_multi_sync_state_v12', JSON.stringify(state));
  }, [state]);

  // Helper to wrap state updates that should be undoable AND broadcasted
  const modifyState = useCallback((reducer: (prev: AppState) => AppState) => {
    setState(current => {
      const nextState = reducer(current);
      if (JSON.stringify(nextState) === JSON.stringify(current)) return current;

      setHistory(prevHist => ({
        past: [...prevHist.past, current].slice(-50),
        future: []
      }));
      
      // Broadcast change if connected
      if (isConnected) {
        broadcast(nextState);
      }
      
      return nextState;
    });
  }, [isConnected, broadcast]);

  const undo = useCallback(() => {
    if (history.past.length === 0) return;
    const previous = history.past[history.past.length - 1];
    setHistory({ past: history.past.slice(0, -1), future: [state, ...history.future] });
    setState(previous);
    if (isConnected) broadcast(previous);
  }, [history, state, isConnected, broadcast]);

  const redo = useCallback(() => {
    if (history.future.length === 0) return;
    const next = history.future[0];
    setHistory({ past: [...history.past, state], future: history.future.slice(1) });
    setState(next);
    if (isConnected) broadcast(next);
  }, [history, state, isConnected, broadcast]);

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
          view: 'timeline'
        };
        filename = `${currentProject.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
      }
    }

    // Format JSON with indentation (2 spaces)
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

  const handleAddProject = async () => {
    if (!newProj.name || !newProj.startDate || !newProj.endDate) {
      alert("Please fill in Title, Start Date, and End Date.");
      return;
    }

    setIsGenerating(true);
    
    // Create Project ID
    const projectId = Math.random().toString(36).substr(2, 9);
    
    const project: Project = {
      id: projectId,
      name: newProj.name!,
      personnel: newProj.personnel || 'Team',
      description: newProj.description || '',
      startDate: newProj.startDate!,
      endDate: newProj.endDate!,
      color: PROJECT_COLORS[state.projects.length % PROJECT_COLORS.length],
      updatedAt: Date.now()
    };

    let generatedLogs: Record<string, WorkLog[]> = {};

    // AI Generation Logic
    if (newProj.description) {
      try {
        // const aiLogsRaw = await generateRoadmap(newProj.description, newProj.startDate!, newProj.endDate!);
        
        // // Transform AI logs to WorkLog format and bucket by date
        // aiLogsRaw.forEach((rawLog) => {
        //   // Normalize date to start of week (Monday) to match timeline bucketing
        //   const dateObj = parseSafeDate(rawLog.date);
        //   const weekStart = getStartOfWeek(dateObj);
        //   const dateBucket = formatDate(weekStart);

        //   const newLog: WorkLog = {
        //     id: Math.random().toString(36).substr(2, 9),
        //     author: rawLog.author || 'AI',
        //     level: (rawLog.level as LogLevel) || 3,
        //     weekStartDate: dateBucket,
        //     summary: rawLog.summary,
        //     notes: `Generated from: ${rawLog.date}`,
        //     goals: rawLog.goals.map((gStr) => ({
        //       id: Math.random().toString(36).substr(2, 9),
        //       title: gStr,
        //       status: 'pending',
        //       description: ''
        //     })),
        //     createdAt: Date.now(),
        //     updatedAt: Date.now()
        //   };

        //   if (!generatedLogs[dateBucket]) {
        //     generatedLogs[dateBucket] = [];
        //   }
        //   generatedLogs[dateBucket].push(newLog);
        // });
      } catch (error) {
        console.error("AI Generation failed", error);
        // Continue creating project without logs
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
    
    setNewProj({ name: '', personnel: '', description: '', startDate: '', endDate: '' });
  };

  const handleDeleteProject = (projectId: string) => {
    if (window.confirm("Delete this project and all its history?")) {
      // Direct setState for deletion, but wrap in broadcast logic if needed
      setState(current => {
        const newLogs = { ...current.logs };
        delete newLogs[projectId];
        // Remove from selection if present
        const newSelection = (current.selectedMultiIds || []).filter(id => id !== projectId);
        
        const nextState: AppState = {
          ...current,
          projects: current.projects.filter(p => p.id !== projectId),
          logs: newLogs,
          selectedMultiIds: newSelection,
          selectedProjectId: null,
          view: 'dashboard'
        };
        setHistory(h => ({ past: [...h.past, current].slice(-50), future: [] }));
        
        if (isConnected) broadcast(nextState); // Broadcast deletion
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

  const handleMoveLog = (logId: string, oldDate: string, newDate: string) => {
    if (!state.selectedProjectId) return;
    modifyState(prev => {
      const projectId = prev.selectedProjectId!;
      const projectLogs = { ...prev.logs[projectId] };
      const logToMove = projectLogs[oldDate]?.find(l => l.id === logId);
      if (!logToMove || logToMove.isLocked) return prev;
      
      const updatedLog = { ...logToMove, weekStartDate: newDate, updatedAt: Date.now() };

      projectLogs[oldDate] = projectLogs[oldDate].filter(l => l.id !== logId);
      if (projectLogs[oldDate].length === 0) delete projectLogs[oldDate];
      
      projectLogs[newDate] = [...(projectLogs[newDate] || []), updatedLog];
      return { ...prev, logs: { ...prev.logs, [projectId]: projectLogs } };
    });
  };
  
  const handleCopyLog = (logId: string, oldDate: string, newDate: string) => {
    if (!state.selectedProjectId) return;
    modifyState(prev => {
      const projectId = prev.selectedProjectId!;
      const projectLogs = { ...prev.logs[projectId] };
      const logToCopy = projectLogs[oldDate]?.find(l => l.id === logId);
      if (!logToCopy) return prev;
      
      // Deep Copy Logic
      const newLog: WorkLog = {
        ...logToCopy,
        id: Math.random().toString(36).substr(2, 9),
        weekStartDate: newDate,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        goals: logToCopy.goals.map(g => ({
          ...g,
          id: Math.random().toString(36).substr(2, 9)
        }))
      };

      projectLogs[newDate] = [...(projectLogs[newDate] || []), newLog];
      return { ...prev, logs: { ...prev.logs, [projectId]: projectLogs } };
    });
  };

  const handleDeleteLog = useCallback((logId: string, dateStr: string) => {
    if (!state.selectedProjectId) return;
    modifyState(prev => {
      const projectId = prev.selectedProjectId!;
      const currentAllLogs = { ...prev.logs };
      const currentProjectLogs = { ...(currentAllLogs[projectId] || {}) };
      if (currentProjectLogs[dateStr]) {
        currentProjectLogs[dateStr] = currentProjectLogs[dateStr].filter(l => l.id !== logId);
        if (currentProjectLogs[dateStr].length === 0) delete currentProjectLogs[dateStr];
        currentAllLogs[projectId] = currentProjectLogs;
        return { ...prev, logs: currentAllLogs, activeLogId: null, activeLogDate: null };
      }
      return prev;
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

  const activeProject = useMemo(() => state.projects.find(p => p.id === state.selectedProjectId), [state.projects, state.selectedProjectId]);
  const activeProjectLogs = useMemo(() => (state.selectedProjectId ? state.logs[state.selectedProjectId] : {}) || {}, [state.logs, state.selectedProjectId]);
  const activeLog = state.activeLogDate && state.activeLogId ? activeProjectLogs[state.activeLogDate]?.find(l => l.id === state.activeLogId) : undefined;
  
  const multiViewProjects = useMemo(() => state.projects.filter(p => state.selectedMultiIds?.includes(p.id)), [state.projects, state.selectedMultiIds]);

  const isAdmin = state.userMode === 'admin';

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".json" />
      
      {/* Connection Modal */}
      {showConnectModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center animate-in fade-in duration-200">
           <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full">
             <h3 className="text-xl font-black text-slate-800 mb-2">Connect Live</h3>
             <p className="text-slate-500 text-xs mb-6">Enter a room name to join your team. Everyone in this room will see changes instantly.</p>
             <input 
               autoFocus
               value={roomInput}
               onChange={(e) => setRoomInput(e.target.value)}
               onKeyDown={(e) => { if(e.key === 'Enter') { connect(roomInput); setShowConnectModal(false); } }}
               placeholder="e.g. team-alpha-24"
               className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-6 font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
             />
             <div className="flex gap-3">
               <button onClick={() => { connect(roomInput); setShowConnectModal(false); }} className="flex-1 bg-slate-900 text-white py-3 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg">Join Room</button>
               <button onClick={() => setShowConnectModal(false)} className="px-6 py-3 text-slate-400 font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 rounded-xl transition-all">Cancel</button>
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
                {/* Full Backup Option */}
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

      {/* Navigation (Hidden in Multi-View to provide a cleaner specific header) */}
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
            {/* User Mode Toggle */}
            <div className="flex bg-slate-100 rounded-full p-1 mr-4">
              <button 
                onClick={() => setState(p => ({ ...p, userMode: 'admin' }))}
                className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${isAdmin ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Admin
              </button>
              <button 
                onClick={() => setState(p => ({ ...p, userMode: 'guest' }))}
                className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${!isAdmin ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Guest
              </button>
            </div>

            {/* Live Connect Button */}
            <button 
              onClick={() => isConnected ? disconnect() : setShowConnectModal(true)}
              className={`
                flex items-center gap-2 px-5 py-2.5 rounded-full border transition-all mr-4
                ${isConnected 
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-red-50 hover:border-red-200 hover:text-red-500 group' 
                  : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}
              `}
            >
              {isConnected ? (
                <>
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse group-hover:bg-red-500"></div>
                  <span className="text-[10px] font-black uppercase tracking-widest group-hover:hidden">{roomName} • {peersCount} Peer{peersCount !== 1 ? 's' : ''}</span>
                  <span className="text-[10px] font-black uppercase tracking-widest hidden group-hover:inline">Disconnect</span>
                </>
              ) : (
                <>
                  <i className="fas fa-bolt text-xs"></i>
                  <span className="text-[10px] font-black uppercase tracking-widest">Go Live</span>
                </>
              )}
            </button>

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
                    return (
                      <div key={p.id} onClick={() => handleSelectProject(p.id)} className="group bg-white border border-slate-100 p-8 rounded-[3rem] shadow-sm hover:shadow-2xl transition-all cursor-pointer relative">
                        {/* Selection Checkbox */}
                        <div 
                          onClick={(e) => { e.stopPropagation(); handleToggleMultiSelect(p.id); }}
                          className={`absolute top-8 left-8 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all z-20 ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-transparent hover:border-indigo-300'}`}
                        >
                          <i className="fas fa-check text-[10px]"></i>
                        </div>

                        <div className="absolute top-12 left-0 w-1.5 h-12 rounded-r-full" style={{ backgroundColor: p.color }}></div>
                        {isAdmin && (
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
            onMoveLog={handleMoveLog} 
            onCopyLog={handleCopyLog}
            onDeleteLog={handleDeleteLog} 
            onToggleLock={handleToggleLock}
            onUpdateProject={(updates) => handleUpdateProject(activeProject.id, updates)}
            readOnly={!isAdmin} 
          />
        )}

        {state.view === 'multi-timeline' && (
          <MultiTimelineView 
             projects={multiViewProjects}
             logs={state.logs}
             onBack={() => setState(prev => ({ ...prev, view: 'dashboard' }))}
          />
        )}

        {state.view === 'project-form' && (
          <div className="fixed inset-0 bg-white/95 backdrop-blur-2xl z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-xl h-full max-h-screen overflow-y-auto py-10">
              <div className="mb-10 text-center"><h3 className="text-5xl font-black text-slate-800 mb-4 tracking-tighter">Initialize</h3><p className="text-slate-400 font-bold text-[10px] uppercase tracking-[0.4em]">Project constraints.</p></div>
              <div className="space-y-8">
                <div>
                  <label className="block text-[10px] font-black text-slate-300 uppercase tracking-widest mb-3">Project Title</label>
                  <input type="text" placeholder="e.g. Q4 Growth Sprint" className="w-full px-0 py-3 bg-transparent border-b-2 border-slate-100 focus:border-indigo-600 outline-none text-2xl font-black" value={newProj.name} onChange={e => setNewProj({...newProj, name: e.target.value})} />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-300 uppercase tracking-widest mb-3">Personnel / Team</label>
                  <input type="text" placeholder="e.g. Design & Eng" className="w-full px-0 py-3 bg-transparent border-b-2 border-slate-100 focus:border-indigo-600 outline-none text-xl font-bold" value={newProj.personnel} onChange={e => setNewProj({...newProj, personnel: e.target.value})} />
                </div>
                 <div>
                  <label className="block text-[10px] font-black text-slate-300 uppercase tracking-widest mb-3 flex justify-between">
                    <span>Context & Description</span>
                    <span className="text-indigo-400"><i className="fas fa-magic mr-1"></i>AI Enabled</span>
                  </label>
                  <textarea 
                    placeholder="Describe the project goal. We will use this to generate an initial roadmap for you..." 
                    className="w-full px-4 py-4 bg-slate-50 rounded-2xl border-2 border-transparent focus:border-indigo-100 focus:bg-white outline-none text-sm font-medium leading-relaxed resize-none h-32 transition-all" 
                    value={newProj.description} 
                    onChange={e => setNewProj({...newProj, description: e.target.value})} 
                  />
                </div>
                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <label className="block text-[10px] font-black text-slate-300 uppercase tracking-widest mb-3">Start Date</label>
                    <input type="date" className="w-full px-0 py-3 bg-transparent border-b-2 border-slate-100 focus:border-indigo-600 outline-none text-lg font-bold" value={newProj.startDate} onChange={e => setNewProj({...newProj, startDate: e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">End Date</label>
                    <input type="date" className="w-full px-0 py-3 bg-transparent border-b-2 border-slate-100 focus:border-indigo-600 outline-none text-lg font-bold" value={newProj.endDate} onChange={e => setNewProj({...newProj, endDate: e.target.value})} />
                  </div>
                </div>
                <div className="pt-8 flex gap-6">
                  <button 
                    onClick={handleAddProject} 
                    disabled={isGenerating}
                    className="flex-1 py-6 bg-slate-900 text-white rounded-full font-black text-[10px] uppercase tracking-[0.3em] shadow-xl disabled:opacity-70 disabled:cursor-wait transition-all flex items-center justify-center gap-3"
                  >
                    {isGenerating ? (
                      <>
                        <i className="fas fa-circle-notch fa-spin"></i>
                        Generating Roadmap...
                      </>
                    ) : (
                      <>
                        Deploy Roadmap
                        {newProj.description && <i className="fas fa-magic text-indigo-400"></i>}
                      </>
                    )}
                  </button>
                  <button 
                    onClick={() => { setState(p => ({ ...p, view: 'dashboard' })); setNewProj({ name: '', personnel: '', description: '', startDate: '', endDate: '' }); }} 
                    disabled={isGenerating}
                    className="px-10 py-6 border-2 border-slate-50 text-slate-300 rounded-full font-black text-[10px] uppercase tracking-[0.2em] hover:bg-slate-50 transition-all disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {state.view === 'editor' && state.activeLogDate && (
          <LogEditor 
            dateStr={state.activeLogDate} 
            initialLog={activeLog} 
            initialLevel={pendingLogLevel} 
            onSave={handleSaveLog} 
            onBack={() => setState(prev => ({ ...prev, view: 'timeline', activeLogId: null, activeLogDate: null }))}
            readOnly={!isAdmin} 
          />
        )}
      </div>
    </div>
  );
};

export default App;