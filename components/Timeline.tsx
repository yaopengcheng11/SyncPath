import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { formatDate, parseSafeDate } from '../utils/dateUtils';
import { WorkLog, Project, LogLevel } from '../types';
import html2canvas from 'html2canvas';

interface TimelineProps {
  logs: Record<string, WorkLog[]>;
  project: Project;
  onSelectDate: (dateStr: string, logId?: string, level?: LogLevel) => void;
  onMoveLog?: (logId: string, oldDate: string, newDate: string) => void;
  onUpdateProject?: (updates: Partial<Project>) => void;
  onDeleteLog?: (logId: string, dateStr: string) => void;
  onToggleLock?: (logId: string, dateStr: string) => void;
  readOnly?: boolean;
  autoScale?: boolean;
  className?: string;
}

// Drag State Interface
interface DragState {
  id: string;
  oldDate: string;
  level: LogLevel;
  isLocked: boolean;
}

const Timeline: React.FC<TimelineProps> = ({ 
  logs, 
  project, 
  onSelectDate, 
  onMoveLog, 
  onUpdateProject, 
  onDeleteLog, 
  onToggleLock, 
  readOnly = false,
  autoScale = false,
  className
}) => {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedPercentage, setSelectedPercentage] = useState<number | null>(null);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);
  const [showLevelMenu, setShowLevelMenu] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  
  // Export Options State
  const [exportBg, setExportBg] = useState<'white' | 'transparent'>('white');

  // Pan and Zoom State
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  
  // Drag log state
  const [draggingLog, setDraggingLog] = useState<DragState | null>(null);
  const [dragStartPos, setDragStartPos] = useState<{ x: number, y: number } | null>(null);
  const [hasMovedEnough, setHasMovedEnough] = useState(false);
  const [deleteDirection, setDeleteDirection] = useState<'left' | 'right' | null>(null);
  
  // Visibility State
  const [visibleLevels, setVisibleLevels] = useState<Record<LogLevel, boolean>>({
    1: true,
    2: true,
    3: true
  });

  const [lockedLevels, setLockedLevels] = useState<Record<LogLevel, boolean>>({
    1: false,
    2: false,
    3: false
  });
  
  const lineRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLDivElement>(null); 
  const lastMousePos = useRef({ x: 0, y: 0 });
  
  // Track mount state for autoScale logic
  const mounted = useRef(false);

  const projectStart = useMemo(() => parseSafeDate(project.startDate), [project.startDate]);
  const projectEnd = useMemo(() => parseSafeDate(project.endDate), [project.endDate]);
  const totalDurationMs = projectEnd.getTime() - projectStart.getTime();

  // Current Date reference for past/future split
  const now = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const getPosFromDate = (dateStr: string) => {
    const d = parseSafeDate(dateStr);
    const diff = d.getTime() - projectStart.getTime();
    return (diff / totalDurationMs) * 100;
  };

  const logMarkers = useMemo(() => {
    const rawEntries = (Object.entries(logs) as [string, WorkLog[]][])
      .filter(([dateStr]) => {
        const d = parseSafeDate(dateStr);
        return d >= projectStart && d <= projectEnd;
      })
      .sort((a, b) => a[0].localeCompare(b[0]));

    return rawEntries.map(([dateStr, logList], index) => {
      const filteredList = logList.filter(l => visibleLevels[l.level]);
      if (filteredList.length === 0) return null;
      
      const highestLevelInDate = Math.min(...filteredList.map(l => l.level)) as LogLevel;
      const baseStemHeight = highestLevelInDate === 1 ? 320 : highestLevelInDate === 2 ? 180 : 80;
      const isPast = parseSafeDate(dateStr).getTime() < now.getTime();
      
      return {
        dateStr,
        pos: getPosFromDate(dateStr),
        baseStemHeight,
        isPast,
        logList: [...filteredList].sort((a, b) => (b.level || 3) - (a.level || 3))
      };
    }).filter(m => m !== null) as any[];
  }, [logs, projectStart, projectEnd, totalDurationMs, visibleLevels, now]);

  const skylineHeight = 400 + (Math.max(0, ...logMarkers.map(m => m.logList.length)) * 40);
  
  // Adaptive Height Calculation
  // In Multi-View (autoScale=true), we want a tighter height to allow the content to zoom in more within the card.
  // In Single-View (autoScale=false), we want more vertical breathing room (900 min).
  const adaptiveHeight = Math.max(
    autoScale ? 600 : 900, 
    skylineHeight + (autoScale ? 200 : 350)
  );

  // Consolidated Fit Logic
  const fitToView = useCallback(() => {
    if (!captureRef.current) return;
    const { width: parentWidth, height: parentHeight } = captureRef.current.getBoundingClientRect();
    
    // Determine actual content width. 
    // In Single View (autoScale=false), width is 100% of parent, so we must measure offsetWidth.
    // In Multi View (autoScale=true), width is fixed at 1400px.
    const inner = captureRef.current.querySelector('[data-inner-container="true"]') as HTMLElement;
    const contentWidth = inner ? inner.offsetWidth : 1400;
    const contentHeight = adaptiveHeight;
    
    // Padding logic:
    // Single View (autoScale=false): Generous padding (200px/150px) for aesthetics.
    // Multi View (autoScale=true): Minimal padding (40px) to maximize content visibility in small cards.
    const paddingX = autoScale ? 40 : 200;
    const paddingY = autoScale ? 40 : 150;

    // Use max to prevent division issues on very small screens
    const safeParentWidth = Math.max(parentWidth, paddingX + 20);
    const safeParentHeight = Math.max(parentHeight, paddingY + 20);

    const scaleX = (safeParentWidth - paddingX) / contentWidth;
    const scaleY = (safeParentHeight - paddingY) / contentHeight;

    // Use the smaller scale to ensure containment
    const fitScale = Math.max(0.1, Math.min(scaleX, scaleY));
    
    setTransform({ x: 0, y: 0, scale: fitScale });
  }, [adaptiveHeight, autoScale]);

  // Initial Fit & Auto Scale Logic
  useEffect(() => {
    // We want to run fitToView on initial mount for ALL modes to ensure proper padding.
    // If autoScale is true (multi-view), we also want to react to updates.
    // If autoScale is false (single-view), we only want to run it once on mount to respect subsequent user zooming/panning.
    if (autoScale || !mounted.current) {
        const timer = setTimeout(() => {
            fitToView();
            mounted.current = true;
        }, 50);
        return () => clearTimeout(timer);
    }
  }, [autoScale, fitToView]);

  // Calculate Today's position
  const { todayPos, todayIsWithinRange } = useMemo(() => {
    const diff = now.getTime() - projectStart.getTime();
    const pos = (diff / totalDurationMs) * 100;
    return {
      todayPos: Math.max(0, Math.min(100, pos)),
      todayIsWithinRange: diff >= 0 && diff <= totalDurationMs
    };
  }, [projectStart, totalDurationMs, now]);

  // Strict Delete Logic: If mouse is outside the timeline bar horizontally, it's a delete.
  const getDeleteDirection = useCallback((clientX: number) => {
    if (!lineRef.current) return null;
    const rect = lineRef.current.getBoundingClientRect();
    // No buffer, strict checking
    if (clientX < rect.left) return 'left';
    if (clientX > rect.right) return 'right';
    return null;
  }, []);

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    if (isPanning) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (draggingLog && dragStartPos && !readOnly) {
      if (!hasMovedEnough) {
        const dist = Math.sqrt(Math.pow(e.clientX - dragStartPos.x, 2) + Math.pow(e.clientY - dragStartPos.y, 2));
        if (dist > 5) setHasMovedEnough(true);
      }
      // Check delete zone
      setDeleteDirection(getDeleteDirection(e.clientX));
    }
  }, [isPanning, draggingLog, dragStartPos, hasMovedEnough, getDeleteDirection, readOnly]);

  const handleGlobalMouseUp = useCallback((e: MouseEvent) => {
    if (isPanning) {
        setIsPanning(false);
        return;
    }
    
    if (readOnly) return;

    if (draggingLog && hasMovedEnough) {
      const direction = getDeleteDirection(e.clientX);
      if (direction) {
        // Confirmed Delete
        if (!draggingLog.isLocked && !lockedLevels[draggingLog.level]) {
           onDeleteLog?.(draggingLog.id, draggingLog.oldDate);
        }
      } else if (lineRef.current) {
        // Move Logic
        const rect = lineRef.current.getBoundingClientRect();
        const rawPercentage = (e.clientX - rect.left) / rect.width;
        const percentage = Math.max(0, Math.min(1, rawPercentage));
        const targetTime = projectStart.getTime() + (totalDurationMs * percentage);
        const targetDateStr = formatDate(new Date(targetTime));

        if (targetDateStr && onMoveLog && targetDateStr !== draggingLog.oldDate) {
           if (!draggingLog.isLocked && !lockedLevels[draggingLog.level]) {
              onMoveLog(draggingLog.id, draggingLog.oldDate, targetDateStr);
           }
        }
      }
    }
    setDraggingLog(null);
    setDragStartPos(null);
    setHasMovedEnough(false);
    setDeleteDirection(null);
  }, [draggingLog, hasMovedEnough, lockedLevels, onDeleteLog, onMoveLog, projectStart, totalDurationMs, getDeleteDirection, readOnly, isPanning]);

  useEffect(() => {
    if (draggingLog || isPanning) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [draggingLog, isPanning, handleGlobalMouseMove, handleGlobalMouseUp]);

  const handleAxisClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (readOnly) return;
    if (isPanning || draggingLog || !lineRef.current) return;
    const rect = lineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const time = projectStart.getTime() + (percentage * totalDurationMs);
    const dateStr = formatDate(new Date(time));
    setSelectedDate(dateStr);
    setSelectedPercentage(percentage * 100);
    setShowLevelMenu(false);
  }, [isPanning, draggingLog, projectStart, totalDurationMs, readOnly]);

  // Zoom with Space + Wheel
  const handleWheel = (e: React.WheelEvent) => {
    if (!isSpacePressed) return; // Only zoom if Space is held
    
    // Prevent default page scroll only when zooming
    // e.preventDefault() is not passively supported in React's onWheel for many browsers, 
    // but the intention is handled by logic separation.
    
    const zoomIntensity = 0.05;
    const delta = e.deltaY > 0 ? -zoomIntensity : zoomIntensity;
    setTransform(prev => {
      const newScale = Math.max(0.1, Math.min(5, prev.scale * (1 + delta)));
      return { ...prev, scale: newScale };
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
      
      // Space Navigation (Allowed in ReadOnly)
      if (e.code === 'Space') { 
        setIsSpacePressed(true); 
        if (!isInput) e.preventDefault(); 
      }
      
      if (isInput) return; // Don't trigger shortcuts while typing

      // View Reset (Allowed in ReadOnly)
      if (e.key.toLowerCase() === 'h') fitToView();
      
      // Escape (Allowed in ReadOnly)
      if (e.key === 'Escape') { 
        setSelectedDate(null); 
        setSelectedPercentage(null); 
        setShowLevelMenu(false); 
        setActiveLogId(null);
        setShowProjectSettings(false);
        setShowExportModal(false); // Also close export modal on escape
      }

      // Editing Shortcuts (Blocked in ReadOnly)
      if (readOnly) return;

      // Move Active Log with Arrow Keys
      if (activeLogId && onMoveLog && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        
        // Find the active log object and its date
        let targetLog: WorkLog | null = null;
        let currentDateStr = '';

        for (const [date, list] of Object.entries(logs) as [string, WorkLog[]][]) {
          const found = list.find(l => l.id === activeLogId);
          if (found) {
            targetLog = found;
            currentDateStr = date;
            break;
          }
        }

        if (targetLog && currentDateStr) {
          // Check if log or its level is locked
          if (targetLog.isLocked || lockedLevels[targetLog.level]) return;

          const current = parseSafeDate(currentDateStr);
          const direction = e.key === 'ArrowRight' ? 1 : -1;
          current.setDate(current.getDate() + direction);
          const newDateStr = formatDate(current);

          onMoveLog(activeLogId, currentDateStr, newDateStr);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') { setIsSpacePressed(false); setIsPanning(false); } };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, [activeLogId, logs, onMoveLog, lockedLevels, setIsSpacePressed, setIsPanning, setTransform, setShowLevelMenu, setShowProjectSettings, setSelectedDate, setSelectedPercentage, setActiveLogId, readOnly, fitToView]);

  const executeExport = useCallback(async () => {
    if (!captureRef.current) return;
    setShowExportModal(false);
    setIsExporting(true);
    
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      const EXPORT_WIDTH = 1920; 
      const withAlpha = exportBg === 'transparent';
      const node = captureRef.current;

      const canvas = await html2canvas(node, {
          backgroundColor: withAlpha ? null : '#ffffff',
          scale: 2, 
          logging: false,
          useCORS: true,
          windowWidth: EXPORT_WIDTH, 
          onclone: (clonedDoc) => {
            const wrapper = clonedDoc.querySelector('[data-capture-wrapper]') as HTMLElement;
            const inner = clonedDoc.querySelector('[data-inner-container]') as HTMLElement;
            if (wrapper && inner) {
               wrapper.style.width = `${EXPORT_WIDTH}px`;
               wrapper.style.height = 'auto';
               wrapper.style.overflow = 'visible';
               
               if (withAlpha) {
                 // Explicitly force transparency on the wrapper and inner container
                 wrapper.style.backgroundColor = 'transparent';
                 wrapper.style.background = 'transparent';
                 wrapper.classList.remove('bg-slate-50/10');
                 
                 inner.style.backgroundColor = 'transparent';
                 inner.style.background = 'transparent';
                 inner.classList.remove('bg-white');
               }

               inner.style.transform = 'none';
               inner.style.width = '100%';
               inner.style.height = 'auto';
               inner.style.position = 'relative'; 
            }
            const textElements = clonedDoc.querySelectorAll('.truncate, .line-clamp-2');
            textElements.forEach((el) => {
              const element = el as HTMLElement;
              element.classList.remove('truncate');
              element.classList.remove('line-clamp-2');
              element.style.whiteSpace = 'normal';
              element.style.overflow = 'visible';
              element.style.display = 'block'; 
              element.style.height = 'auto';
              element.style.maxHeight = 'none';
            });
            const cards = clonedDoc.querySelectorAll('.overflow-hidden');
            cards.forEach((el) => { (el as HTMLElement).style.overflow = 'visible'; });
          }
        });
        const link = document.createElement('a');
        link.download = `${project.name.replace(/\s+/g, '-').toLowerCase()}-snapshot.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();

    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to generate export. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [project.name, exportBg]);

  const monthMarkers = useMemo(() => {
    const markers: { label: string, pos: number }[] = [];
    const current = new Date(projectStart);
    current.setDate(1); 
    if (current < projectStart) current.setMonth(current.getMonth() + 1);
    while (current <= projectEnd) {
      markers.push({ label: current.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), pos: getPosFromDate(formatDate(current)) });
      current.setMonth(current.getMonth() + 1);
    }
    return markers;
  }, [projectStart, projectEnd, totalDurationMs]);

  const levelOptions = [
    { level: 1 as LogLevel, label: 'Primary', icon: 'fa-circle', color: 'bg-amber-500' },
    { level: 2 as LogLevel, label: 'Secondary', icon: 'fa-square', color: 'bg-indigo-500' },
    { level: 3 as LogLevel, label: 'Minor', icon: 'fa-diamond', color: 'bg-slate-400' },
  ];

  return (
    <div 
      ref={containerRef}
      className={`w-full flex flex-col overflow-hidden bg-white relative transition-all select-none ${className || 'flex-1'} ${isPanning ? 'cursor-grabbing' : isSpacePressed ? 'cursor-grab' : ''}`}
      onMouseDown={(e) => { 
        if (isSpacePressed && e.button === 0) { setIsPanning(true); lastMousePos.current = { x: e.clientX, y: e.clientY }; } 
      }}
      onClick={() => { if(!readOnly) { setSelectedDate(null); setSelectedPercentage(null); setActiveLogId(null); } }}
      onWheel={handleWheel}
    >
      {/* Project Settings Modal */}
      {!readOnly && showProjectSettings && (
        <div 
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[2000] flex items-center justify-center p-6 animate-in fade-in duration-200"
          onClick={(e) => e.stopPropagation()} 
        >
          {/* ... (Settings modal content unchanged, wrapped in condition) ... */}
          <div 
            className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-10 py-8 border-b border-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-black text-slate-800 tracking-tighter">Configuration</h3>
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Roadmap settings</p>
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); setShowProjectSettings(false); }} 
                className="w-10 h-10 rounded-full hover:bg-slate-50 flex items-center justify-center text-slate-300 transition-all"
              >
                <i className="fas fa-times"></i>
              </button>
            </header>
            <div className="p-10 space-y-8">
              <div className="space-y-6">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Project Name</label>
                  <input 
                    value={project.name}
                    onChange={(e) => onUpdateProject?.({ name: e.target.value })}
                    className="w-full px-5 py-3.5 rounded-2xl bg-white border border-slate-200 text-slate-900 font-bold focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none transition-all shadow-sm" 
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Lead / Team</label>
                  <input 
                    value={project.personnel}
                    onChange={(e) => onUpdateProject?.({ personnel: e.target.value })}
                    className="w-full px-5 py-3.5 rounded-2xl bg-white border border-slate-200 text-slate-900 font-bold focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none transition-all shadow-sm" 
                  />
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Start Date</label>
                    <input 
                      type="date"
                      value={project.startDate}
                      onChange={(e) => onUpdateProject?.({ startDate: e.target.value })}
                      className="w-full px-5 py-3.5 rounded-2xl bg-white border border-slate-200 text-slate-900 font-bold focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none transition-all shadow-sm" 
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">End Date</label>
                    <input 
                      type="date"
                      value={project.endDate}
                      onChange={(e) => onUpdateProject?.({ endDate: e.target.value })}
                      className="w-full px-5 py-3.5 rounded-2xl bg-white border border-slate-200 text-slate-900 font-bold focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none transition-all shadow-sm" 
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 flex gap-4">
                <button 
                  onClick={(e) => { e.stopPropagation(); setShowProjectSettings(false); }} 
                  className="flex-1 py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Export Options Modal */}
      {showExportModal && (
        <div 
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[2000] flex items-center justify-center p-6 animate-in fade-in duration-200"
          onClick={(e) => e.stopPropagation()}
        >
         {/* ... (Export modal content unchanged) ... */}
          <div 
            className="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 p-8 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-6">
              <i className="fas fa-camera"></i>
            </div>
            <h3 className="text-xl font-black text-slate-800 tracking-tight mb-2">Export Snapshot</h3>
            <p className="text-xs text-slate-500 font-medium mb-8 leading-relaxed">Customize your export.</p>
            
            <div className="space-y-6 text-left">
              <div>
                 <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Background</label>
                 <div className="grid grid-cols-2 gap-3">
                   <button 
                     onClick={() => setExportBg('white')}
                     className={`py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all flex items-center justify-center gap-2 ${exportBg === 'white' ? 'border-slate-800 text-slate-800 bg-slate-50' : 'border-slate-100 text-slate-400 hover:border-slate-200'}`}
                   >
                     <div className="w-3 h-3 bg-white border border-slate-200 rounded-full"></div> Standard
                   </button>
                   <button 
                     onClick={() => setExportBg('transparent')}
                     className={`py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all flex items-center justify-center gap-2 ${exportBg === 'transparent' ? 'border-slate-800 text-slate-800 bg-slate-50' : 'border-slate-100 text-slate-400 hover:border-slate-200'}`}
                   >
                     <div className="w-3 h-3 bg-white border border-slate-200 rounded-full relative overflow-hidden">
                        <div className="absolute inset-0 bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIklEQVQIW2NkQAKrVq36zwjjgzhhZWGMYAEYB8RmROaABADeOQ8CXl/xfgAAAABJRU5ErkJggg==')] opacity-30"></div>
                     </div> Alpha
                   </button>
                 </div>
              </div>
            </div>
            
            <button 
                onClick={executeExport}
                className="w-full py-4 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-slate-800 transition-colors shadow-lg mt-8"
              >
                Download PNG
            </button>
            
            <button 
              onClick={() => setShowExportModal(false)}
              className="mt-6 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filters (Outside captureRef) */}
      <div className="absolute top-12 left-12 z-50 flex gap-4">
        {levelOptions.map(opt => (
          <div key={opt.level} className="flex items-center bg-white rounded-2xl border border-slate-100 shadow-xl overflow-hidden transition-all">
            <button onClick={(e) => { e.stopPropagation(); setVisibleLevels(p => ({...p, [opt.level]: !p[opt.level]})); }} className={`flex items-center gap-3 px-4 py-2.5 transition-all ${visibleLevels[opt.level] ? 'opacity-100' : 'opacity-40 grayscale scale-95'}`}>
              <div className={`w-3 h-3 rounded-full ${opt.color}`}></div>
              <span className="text-[10px] font-black text-slate-800 uppercase tracking-widest">{opt.label}</span>
            </button>
            <button onClick={(e) => { e.stopPropagation(); setLockedLevels(p => ({...p, [opt.level]: !p[opt.level]})); }} className={`px-3 py-2.5 border-l border-slate-50 ${lockedLevels[opt.level] ? 'text-indigo-600 bg-indigo-50' : 'text-slate-300'}`}>
              <i className={`fas ${lockedLevels[opt.level] ? 'fa-lock' : 'fa-lock-open'} text-[10px]`}></i>
            </button>
          </div>
        ))}
      </div>

      {/* Visual Content Wrapper - Attached captureRef here */}
      <div 
        ref={captureRef}
        data-capture-wrapper="true"
        className="flex-1 relative overflow-hidden flex items-center justify-center bg-slate-50/10"
      >
        <div 
          data-inner-container="true"
          className="absolute origin-center transition-transform duration-300 ease-out bg-white"
          style={{ 
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`, 
              width: autoScale ? '1400px' : '100%', 
              minWidth: '1400px',
              height: `${adaptiveHeight}px` 
          }}
        >
          <div className="w-full h-full flex flex-col justify-center px-12 relative">
            {/* Log skyline */}
            <div className="relative w-full mb-0 flex flex-col justify-end" style={{ height: `${skylineHeight}px` }}>
              {logMarkers.map((marker) => (
                <div key={marker.dateStr} className="absolute bottom-0 flex flex-col items-center pointer-events-none" style={{ left: `${marker.pos}%`, transform: 'translateX(-50%)' }}>
                  <div className="flex flex-col-reverse items-center pointer-events-auto">
                    {marker.logList.map((log, logIdx) => {
                      const isSelected = activeLogId === log.id;
                      const isPast = marker.isPast;
                      const isLocked = !!log.isLocked || lockedLevels[log.level];
                      const isDraggingThis = draggingLog?.id === log.id;
                      const isDeleting = isDraggingThis && deleteDirection !== null;
                      
                      return (
                        <div 
                          key={log.id}
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => { 
                             e.stopPropagation(); 
                             if (readOnly) return;
                             setActiveLogId(log.id); 
                             if (!isLocked && e.button === 0) { 
                               setDraggingLog({ id: log.id, oldDate: marker.dateStr, level: log.level, isLocked: !!log.isLocked }); 
                               setDragStartPos({ x: e.clientX, y: e.clientY }); 
                             } 
                          }}
                          onDoubleClick={(e) => { 
                              e.stopPropagation(); 
                              // Even readOnly users might want to view details
                              onSelectDate(marker.dateStr, log.id); 
                          }}
                          style={{ marginBottom: logIdx === 0 ? '8px' : '-24px', zIndex: isDraggingThis ? 2000 : (100 - logIdx), transform: isDraggingThis ? `scale(${isDeleting ? 1.05 : 1.05}) translateY(-5px)` : isSelected ? 'scale(1.05) translateY(-5px)' : 'none' }}
                          className={`
                            border p-2.5 rounded-xl shadow-sm transition-all relative overflow-hidden group
                            ${isLocked || readOnly ? (readOnly ? 'cursor-pointer' : 'grayscale-[0.6] cursor-not-allowed') : 'cursor-grab active:cursor-grabbing'}
                            ${isPast && !isSelected ? 'grayscale-[0.5] opacity-75' : 'opacity-100 grayscale-0'}
                            ${isDeleting ? 'bg-red-50 border-red-200 ring-4 ring-red-100' : isSelected ? 'ring-4 ring-indigo-500/30 border-indigo-500 bg-white' : 
                              log.level === 1 ? 'w-48 bg-slate-900 border-slate-900 text-white' : 
                              log.level === 2 ? 'w-44 bg-white border-indigo-100' : 'w-40 bg-slate-50 border-slate-200'}
                          `}
                        >
                          {isDeleting && (
                            <div className="absolute inset-0 flex items-center justify-center bg-red-500/80 backdrop-blur-sm z-50 text-white font-black uppercase text-[10px] tracking-widest animate-in fade-in duration-75">
                              Delete
                            </div>
                          )}
                          <div className="flex items-center gap-2 mb-1 overflow-hidden">
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${log.level === 1 ? 'bg-amber-400' : log.level === 2 ? 'bg-indigo-50' : 'bg-slate-400'}`}></div>
                            <span className={`text-[10px] font-black leading-none truncate uppercase tracking-tight mt-[1px] ${isSelected ? 'text-slate-900' : log.level === 1 ? 'text-amber-100' : 'text-slate-800'}`}>{log.author}</span>
                            {isLocked && <i className="fas fa-lock text-[8px] opacity-50 ml-auto"></i>}
                          </div>
                          
                          <div className={`text-[8px] font-black opacity-60 mb-1.5 flex items-center gap-1 ${log.level === 1 && !isSelected ? 'text-amber-200' : 'text-slate-500'}`}>
                             <i className="far fa-calendar text-[7px]"></i>
                             {parseSafeDate(marker.dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </div>

                          <p className={`text-[9px] line-clamp-2 italic leading-relaxed truncate ${isSelected ? 'text-slate-500' : log.level === 1 ? 'text-slate-300' : 'text-slate-400'}`}>{log.summary || "Pending update..."}</p>
                        </div>
                      );
                    })}
                  </div>
                  <div className={`w-0.5 bg-gradient-to-t transition-all duration-700 ${marker.isPast ? 'opacity-30' : 'opacity-100'}`} style={{ height: `${marker.baseStemHeight}px`, background: `linear-gradient(to top, #f1f5f9, ${marker.logList[0]?.level === 1 ? '#fbbf24' : marker.logList[0]?.level === 2 ? '#6366f1' : '#94a3b8'})` }}></div>
                </div>
              ))}
            </div>

            {/* Axis */}
            <div className="relative w-full pt-4">
              <div className="absolute -top-12 left-0 w-full flex justify-between pointer-events-none">
                {monthMarkers.map((m, idx) => (
                  <div key={idx} className="absolute flex flex-col items-center" style={{ left: `${m.pos}%`, transform: 'translateX(-50%)' }}>
                    <div className="w-px h-6 bg-slate-200 mb-2"></div>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap px-2">{m.label}</span>
                  </div>
                ))}
              </div>

              <div 
                ref={lineRef} 
                onClick={handleAxisClick} 
                className={`relative h-2 w-full rounded-full border border-slate-200/50 ${readOnly ? '' : 'cursor-crosshair'}`}
                style={{ background: `linear-gradient(to right, #cbd5e1 0%, #cbd5e1 ${todayPos}%, #f1f5f9 ${todayPos}%, #f1f5f9 100%)` }}
              >
                {todayIsWithinRange && (
                  <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-[60] flex flex-col items-center pointer-events-none" style={{ left: `${todayPos}%` }}>
                    <div className="w-[2px] h-6 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"></div>
                    <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-red-500 text-white text-[8px] font-black rounded shadow whitespace-nowrap animate-pulse">TODAY</div>
                  </div>
                )}
                {logMarkers.map(m => (
                   <div key={m.dateStr} className={`absolute top-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-lg z-20 transition-all ${m.isPast ? 'opacity-60 grayscale-[0.3]' : 'opacity-100'} ${m.logList[0]?.level === 1 ? 'w-7 h-7 bg-amber-500' : m.logList[0]?.level === 2 ? 'w-6 h-6 bg-indigo-600' : 'w-5 h-5 bg-slate-400'}`} style={{ left: `${m.pos}%`, transform: 'translate(-50%, -50%)' }} />
                ))}
                {!readOnly && selectedPercentage && (
                  <div className="absolute top-1/2 -translate-y-1/2 z-40" style={{ left: `${selectedPercentage}%` }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => setShowLevelMenu(true)} className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-xl transform -translate-x-1/2 -translate-y-16 border-2 border-white"><i class="fas fa-plus"></i></button>
                    {showLevelMenu && (
                      <div className="absolute -translate-x-1/2 -translate-y-[260px] bg-white border border-slate-100 shadow-2xl rounded-2xl p-2 flex flex-col gap-1 min-w-[160px]">
                        {levelOptions.map(opt => (
                          <button key={opt.level} onClick={() => onSelectDate(selectedDate!, undefined, opt.level)} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50">
                            <div className={`w-3 h-3 rounded-full ${opt.color}`}></div>
                            <span className="text-[10px] font-black text-slate-800 uppercase">{opt.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              <div className="mt-10 flex justify-between text-[11px] font-black text-slate-400 uppercase tracking-widest px-2">
                <span>{new Date(project.startDate).toLocaleDateString()}</span>
                <span>{new Date(project.endDate).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {!autoScale && (
      <footer className="px-12 py-5 bg-slate-50 border-t border-slate-100 flex items-center justify-between z-10">
        <div className="flex items-center gap-4"><h2 className="text-sm font-black text-slate-800 tracking-tight">{project.name}</h2><div className="w-px h-6 bg-slate-200"></div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{project.personnel}</p></div>
        <div className="flex items-center gap-4">
          
          <button 
            onClick={() => setShowExportModal(true)}
            disabled={isExporting}
            className="text-[9px] font-black text-emerald-600 uppercase tracking-widest border border-slate-200 px-4 py-2 rounded-full bg-white shadow-sm flex items-center gap-2 hover:bg-emerald-50 transition-colors disabled:opacity-50"
          >
            <i className={`fas ${isExporting ? 'fa-spinner fa-spin' : 'fa-camera'}`}></i> { isExporting ? 'Processing...' : 'Snapshot' }
          </button>
          {!readOnly && (
            <button 
              onClick={(e) => { e.stopPropagation(); setShowProjectSettings(true); }} 
              className="text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-200 px-4 py-2 rounded-full bg-white shadow-sm flex items-center gap-2 hover:bg-slate-50 transition-colors"
            >
              <i className="fas fa-sliders-h"></i> Settings
            </button>
          )}
          <button onClick={fitToView} className="text-[9px] font-black text-slate-400 uppercase tracking-widest border border-slate-200 px-4 py-2 rounded-full bg-white transition-all hover:bg-slate-50 active:translate-y-0.5">Reset View (H)</button>
        </div>
      </footer>
      )}
    </div>
  );
};

export default Timeline;