import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { formatDate, parseSafeDate } from '../utils/dateUtils';
import { WorkLog, Project, LogLevel, Collaborator } from '../types';
import html2canvas from 'html2canvas';
import AppDialog from './AppDialog';
import { useI18n } from '../i18n';
import { planTimelineMoves, timelineContentSize, timelineDateAtPosition, timelineDatePosition, timelineDragDays, timelineFitScale } from './timelineGeometry';
import { cardClipboard, type ClipboardCard } from '../utils/cardClipboard';
import { planCollapseToggle, pruneCollapsedIds } from './cardCollapse';

interface TimelineProps {
  logs: Record<string, WorkLog[]>;
  project: Project;
  onSelectDate: (dateStr: string, logId?: string, level?: LogLevel) => void;
  onMoveLogs?: (moves: {id: string, oldDate: string, newDate: string}[]) => void;
  onCopyLogs?: (copies: {id: string, oldDate: string, newDate: string}[]) => void;
  onUpdateProject?: (updates: Partial<Project>) => void;
  onDeleteLogs?: (logIds: string[]) => void;
  onToggleLock?: (logId: string, dateStr: string) => void;
  onPasteLogs?: (logs: ClipboardCard[], targetDate: string | null) => void;
  /** Undo the last card operation. Returns a description, or null if nothing to undo. */
  onUndo?: () => string | null;
  readOnly?: boolean;
  suspended?: boolean;
  autoScale?: boolean;
  className?: string;
  collaborators?: Collaborator[]; // Added prop
  onInteraction?: (action: string, logId: string | null) => void; // New prop for presence updates
}

interface DragState {
  id: string; 
  oldDate: string;
  level: LogLevel;
  isLocked: boolean;
  isCloning: boolean; 
}

interface SelectionBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

const Timeline: React.FC<TimelineProps> = ({ 
  logs, 
  project, 
  onSelectDate, 
  onMoveLogs, 
  onCopyLogs,
  onUpdateProject, 
  onDeleteLogs,
  onToggleLock,
  onPasteLogs,
  onUndo,
  readOnly = false,
  suspended = false,
  autoScale = false,
  className,
  collaborators = [],
  onInteraction
}) => {
  const { t } = useI18n();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedPercentage, setSelectedPercentage] = useState<number | null>(null);
  
  const [selectedLogIds, setSelectedLogIds] = useState<Set<string>>(new Set<string>());
  // Pure view state: which cards are folded to a compact avatar. Not persisted
  // server-side on purpose — collapsing is a "my screen is cluttered" concern,
  // and a teammate's view must not change because of it.
  const [collapsedLogIds, setCollapsedLogIds] = useState<Set<string>>(new Set<string>());
  const [hoveredLogId, setHoveredLogId] = useState<string | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);

  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipTextRef = useRef<HTMLDivElement>(null);
  const toastRef = useRef<HTMLDivElement>(null);

  const [showLevelMenu, setShowLevelMenu] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportBg, setExportBg] = useState<'white' | 'transparent'>('white');
  const [exportError, setExportError] = useState<string | null>(null);

  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [timelineScale, setTimelineScale] = useState(1); // New state for horizontal stretching
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  
  const [draggingLog, setDraggingLog] = useState<DragState | null>(null);
  const [dragStartPos, setDragStartPos] = useState<{ x: number, y: number } | null>(null);
  const [hasMovedEnough, setHasMovedEnough] = useState(false);
  
  const [dragGhostPos, setDragGhostPos] = useState<number | null>(null); 
  const [dragCurrentDate, setDragCurrentDate] = useState<string | null>(null);
  
  const [visibleLevels, setVisibleLevels] = useState<Record<LogLevel, boolean>>({
    1: true, 2: true, 3: true
  });

  const [lockedLevels, setLockedLevels] = useState<Record<LogLevel, boolean>>({
    1: false, 2: false, 3: false
  });
  
  const lineRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLDivElement>(null); 
  const lastMousePos = useRef({ x: 0, y: 0 });
  const ignoreClickRef = useRef(false);
  const mounted = useRef(false);

  const projectStart = useMemo(() => parseSafeDate(project.startDate), [project.startDate]);
  const projectEnd = useMemo(() => parseSafeDate(project.endDate), [project.endDate]);
  const totalDurationMs = projectEnd.getTime() - projectStart.getTime();

  const now = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const getPosFromDate = useCallback((dateStr: string) => {
    return timelineDatePosition(dateStr, project.startDate, project.endDate);
  }, [project.startDate, project.endDate]);

  // Handle Selection Presence Broadcast
  useEffect(() => {
    if (readOnly || !onInteraction || draggingLog) return;
    
    if (selectedLogIds.size > 0) {
       // Selection is viewing; actual edits and moves publish Editing.
       const ids = Array.from(selectedLogIds);
       onInteraction('Viewing', ids[0]);
    } else if (!draggingLog) {
       // If nothing selected and not dragging, revert to Viewing
       onInteraction('Viewing', null);
    }
  }, [selectedLogIds, onInteraction, readOnly, draggingLog]);

  const showToast = (message: string) => {
      if (toastRef.current) {
          toastRef.current.innerText = message;
          toastRef.current.style.opacity = '1';
          toastRef.current.style.transform = 'translate(-50%, 0)';
          setTimeout(() => {
             if (toastRef.current) {
                 toastRef.current.style.opacity = '0';
                 toastRef.current.style.transform = 'translate(-50%, 20px)';
             }
          }, 2000);
      }
  };

  // Mixed selections fold to collapsed (the useful direction when the board is
  // cluttered); a selection that is already fully collapsed expands. See
  // planCollapseToggle for the exact rule.
  const toggleCollapsedLogs = useCallback((ids: string[]): boolean => {
    if (ids.length === 0) return false;
    const plan = planCollapseToggle(collapsedLogIds, ids);
    setCollapsedLogIds(plan.next);
    return plan.willCollapse;
  }, [collapsedLogIds]);

  const copyToClipboardFallback = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        containerRef.current?.focus();
        return successful;
    } catch (err) {
        document.body.removeChild(textArea);
        return false;
    }
  }

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
      const baseStemHeight = highestLevelInDate === 1 ? 200 : highestLevelInDate === 2 ? 120 : 56;
      const isPast = parseSafeDate(dateStr).getTime() < now.getTime();
      
      return {
        dateStr,
        pos: getPosFromDate(dateStr),
        baseStemHeight,
        isPast,
        logList: [...filteredList].sort((a, b) => (b.level || 3) - (a.level || 3))
      };
    }).filter(m => m !== null) as any[];
  }, [logs, projectStart, projectEnd, getPosFromDate, visibleLevels, now]);

  const { skylineHeight, height: adaptiveHeight } = timelineContentSize(Math.max(0, ...logMarkers.map(m => m.logList.length)));

  useEffect(() => {
    const visibleIds = new Set<string>(logMarkers.flatMap(marker => marker.logList.map((log: WorkLog) => log.id)));
    setSelectedLogIds(previous => {
      const next = new Set(Array.from(previous).filter(id => visibleIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [logMarkers]);

  // Drop collapse flags for cards that no longer exist (deleted, or outside the
  // project range). Unlike the selection prune above this reads every log, not
  // just the visible ones: hiding a level must not silently expand its cards.
  useEffect(() => {
    const liveIds = new Set<string>((Object.values(logs) as WorkLog[][]).flat().map(log => log.id));
    setCollapsedLogIds(previous => pruneCollapsedIds(previous, liveIds));
  }, [logs]);

  const fitToView = useCallback(() => {
    if (!captureRef.current) return;
    setTimelineScale(1); // Reset stretch
    
    const { width: parentWidth, height: parentHeight } = captureRef.current.getBoundingClientRect();
    
    const fitScale = timelineFitScale(parentWidth, parentHeight, adaptiveHeight, autoScale);
    setTransform({ x: 0, y: 0, scale: fitScale });
  }, [adaptiveHeight, autoScale]);

  const handleZoomIn = useCallback(() => {
    setTimelineScale(prev => Math.min(30, prev * 1.25));
  }, []);

  const handleZoomOut = useCallback(() => {
    setTimelineScale(prev => Math.max(1, prev / 1.25));
  }, []);

  const moveSelectedLogsByDays = useCallback((days: number): void => {
    if (readOnly || !onMoveLogs || selectedLogIds.size === 0) return;
    const items = Object.entries(logs).flatMap(([date, list]) => list
      .filter(log => selectedLogIds.has(log.id))
      .map(log => ({ id: log.id, date, locked: !!log.isLocked || lockedLevels[log.level] })));
    const moves = planTimelineMoves(items, days, project.startDate, project.endDate);
    if (moves.length > 0) {
      onMoveLogs(moves);
    }
  }, [logs, lockedLevels, onMoveLogs, project.endDate, project.startDate, readOnly, selectedLogIds]);

  useEffect(() => {
    if (autoScale || !mounted.current) {
        const timer = setTimeout(() => {
            fitToView();
            mounted.current = true;
        }, 50);
        return () => clearTimeout(timer);
    }
  }, [autoScale, fitToView]);

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (suspended || showProjectSettings || showExportModal || exportError) return;
      if (!containerRef.current?.contains(document.activeElement)) return;
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT' || activeTag === 'BUTTON' || (document.activeElement as HTMLElement)?.isContentEditable) return;

      if (e.code === 'Space') { setIsSpacePressed(true); e.preventDefault(); }
      if (e.key.toLowerCase() === 'h') fitToView();
      
      // Zoom Shortcuts
      if (e.key === '=' || e.key === '+') { handleZoomIn(); e.preventDefault(); }
      if (e.key === '-') { handleZoomOut(); e.preventDefault(); }

      // Collapse / expand shortcut. Available to viewers too — folding is a
      // local view concern, so a read-only member should get the same tidier
      // board. Guarded against Ctrl/Alt/Shift so browser and IME shortcuts
      // (Ctrl+E, Alt+E, Shift+E …) keep working.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'e') {
        if (selectedLogIds.size > 0) {
          e.preventDefault();
          const ids = Array.from(selectedLogIds);
          const willCollapse = toggleCollapsedLogs(ids);
          showToast(willCollapse ? t('Collapsed {{count}} items', { count: ids.length }) : t('Expanded {{count}} items', { count: ids.length }));
        }
        return;
      }

      if (e.key === 'Escape') { 
        setSelectedDate(null); setSelectedPercentage(null); setShowLevelMenu(false); 
        setSelectedLogIds(new Set<string>()); setShowProjectSettings(false); setShowExportModal(false);
      }
      
      if (!readOnly && onDeleteLogs && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (selectedLogIds.size > 0) {
            e.preventDefault();
            const idsToDelete: string[] = [];
            const ids = Array.from(selectedLogIds);
            
            // Check locks and validity before queuing for delete
            ids.forEach(id => {
                for (const [d, list] of (Object.entries(logs) as [string, WorkLog[]][])) {
                    const found = list.find(l => l.id === id);
                    if (found && !found.isLocked && !lockedLevels[found.level]) {
                        idsToDelete.push(id);
                        break;
                    }
                }
            });

            // No confirmation step: the delete is recorded on the undo stack,
            // so Ctrl+Z brings the cards back.
            if (idsToDelete.length > 0) {
                onDeleteLogs(idsToDelete);
                setSelectedLogIds(new Set<string>());
            }
        }
      }

      if (readOnly) return;
      
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
         e.preventDefault();
         const allIds = new Set<string>();
         logMarkers.forEach(marker => marker.logList.forEach((log: WorkLog) => allIds.add(log.id)));
         setSelectedLogIds(allIds);
      }
      
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (selectedLogIds.size === 0) return;
        const logsToCopy: ClipboardCard[] = [];
        const ids = new Set(selectedLogIds);
        for (const list of (Object.values(logs) as WorkLog[][])) {
            for (const log of list) {
                if (!ids.has(log.id)) continue;
                logsToCopy.push({
                    title: log.author,
                    level: log.level,
                    weekStartDate: log.weekStartDate,
                    summary: log.summary || undefined,
                    notes: log.notes || undefined,
                    status: log.status,
                    mentionAll: log.mentionAll,
                    mentionedUserIds: log.mentionedUserIds
                });
            }
        }
        if (logsToCopy.length > 0) {
            e.preventDefault();
            const count = cardClipboard.write(logsToCopy);
            showToast(t('Copied {{count}} items', { count }));
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        const clipboardCards = cardClipboard.read();
        if (onPasteLogs && clipboardCards.length > 0) {
          e.preventDefault();
          onPasteLogs(clipboardCards, selectedDate || null);
          showToast(t('Pasted {{count}} items', { count: clipboardCards.length }));
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (!onUndo) return;
        e.preventDefault();
        showToast(onUndo() ?? t('Nothing to undo'));
      }

      if (selectedLogIds.size > 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        moveSelectedLogsByDays(e.key === 'ArrowRight' ? 1 : -1);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') { setIsSpacePressed(false); setIsPanning(false); } };
    const handleBlur = () => { setIsSpacePressed(false); setIsPanning(false); };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); window.removeEventListener('blur', handleBlur); };
  }, [logs, logMarkers, onDeleteLogs, lockedLevels, selectedLogIds, readOnly, suspended, showProjectSettings, showExportModal, exportError, fitToView, handleZoomIn, handleZoomOut, moveSelectedLogsByDays, onPasteLogs, onUndo, selectedDate, toggleCollapsedLogs, t]);

  useEffect(() => {
    // Paste is handled on Ctrl+V in the keydown effect above, reading the
    // in-app clipboard. The old system-clipboard JSON listener is gone: it
    // never ran (onPasteLogs was never passed) and it leaked card content into
    // the OS clipboard history.
    return undefined;
  }, []);

  const { todayPos, todayIsWithinRange } = useMemo(() => {
    const diff = now.getTime() - projectStart.getTime();
    const pos = getPosFromDate(formatDate(now));
    return {
      todayPos: Math.max(0, Math.min(100, pos)),
      todayIsWithinRange: diff >= 0 && diff <= totalDurationMs
    };
  }, [projectStart, totalDurationMs, now, getPosFromDate]);

  const handleContainerMouseDown = useCallback((e: React.MouseEvent) => {
    if (suspended || showProjectSettings || showExportModal || exportError || (e.target as HTMLElement).closest('button, input, textarea, select, [role="dialog"]')) return;
    containerRef.current?.focus();
    if (isSpacePressed) {
       setIsPanning(true);
       lastMousePos.current = { x: e.clientX, y: e.clientY };
       return;
    }
    if (!readOnly && e.button === 0 && !draggingLog) {
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey) { setSelectedLogIds(new Set<string>()); }
      setSelectionBox({ startX: e.clientX, startY: e.clientY, currentX: e.clientX, currentY: e.clientY });
      setSelectedDate(null); setSelectedPercentage(null);
    }
  }, [isSpacePressed, readOnly, draggingLog, suspended, showProjectSettings, showExportModal, exportError]);

  const handleLogMouseDown = useCallback((e: React.MouseEvent, log: WorkLog, dateStr: string) => {
    e.stopPropagation(); 
    containerRef.current?.focus();
    if (readOnly || suspended) return;
    if (isSpacePressed) {
      setIsPanning(true);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button === 0) {
      let newSelection = new Set(selectedLogIds);
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        if (newSelection.has(log.id)) { newSelection.delete(log.id); } else { newSelection.add(log.id); }
        setSelectedLogIds(newSelection);
        if (!newSelection.has(log.id)) return;
      } else {
        if (!newSelection.has(log.id)) { newSelection = new Set([log.id]); setSelectedLogIds(newSelection); }
      }
      const isLocked = !!log.isLocked || lockedLevels[log.level];
      if (!isLocked && (onMoveLogs || onCopyLogs)) {
         const isCloning = e.altKey && !!onCopyLogs;
         setDraggingLog({ id: log.id, oldDate: dateStr, level: log.level, isLocked: false, isCloning: isCloning });
         setDragStartPos({ x: e.clientX, y: e.clientY });
         
         // Broadcast Editing status when drag starts
         if (onInteraction) onInteraction('Editing', log.id);
      }
    }
  }, [readOnly, suspended, isSpacePressed, selectedLogIds, lockedLevels, onInteraction, onMoveLogs, onCopyLogs]);

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    if (isPanning) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (selectionBox) {
      setSelectionBox(prev => prev ? { ...prev, currentX: e.clientX, currentY: e.clientY } : null);
      if (containerRef.current) {
        const left = Math.min(selectionBox.startX, e.clientX);
        const top = Math.min(selectionBox.startY, e.clientY);
        const width = Math.abs(e.clientX - selectionBox.startX);
        const height = Math.abs(e.clientY - selectionBox.startY);
        const logElements = containerRef.current.querySelectorAll('[data-log-id]');
        const newSelected = new Set<string>(e.shiftKey || e.metaKey || e.ctrlKey ? selectedLogIds : []);
        logElements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const isOverlapping = left < rect.right && left + width > rect.left && top < rect.bottom && top + height > rect.top;
          if (isOverlapping) { const id = el.getAttribute('data-log-id'); if (id) newSelected.add(id); }
        });
        setSelectedLogIds(newSelected);
      }
      return;
    }
    if (draggingLog && dragStartPos && !readOnly) {
      if (!hasMovedEnough) {
        const dist = Math.sqrt(Math.pow(e.clientX - dragStartPos.x, 2) + Math.pow(e.clientY - dragStartPos.y, 2));
        if (dist > 5) setHasMovedEnough(true);
      }
      if (lineRef.current) {
        const rect = lineRef.current.getBoundingClientRect();
        const days = timelineDragDays(dragStartPos.x, e.clientX, rect.width, project.startDate, project.endDate);
        const ids = selectedLogIds.has(draggingLog.id) ? selectedLogIds : new Set([draggingLog.id]);
        const items = Object.entries(logs).flatMap(([date, list]) => list.filter(log => ids.has(log.id))
          .map(log => ({ id: log.id, date, locked: !!log.isLocked || lockedLevels[log.level] })));
        const moves = planTimelineMoves(items, days, project.startDate, project.endDate);
        const targetDate = moves.find(move => move.id === draggingLog.id)?.newDate ?? draggingLog.oldDate;
        setDragGhostPos(getPosFromDate(targetDate));
        const displayDate = parseSafeDate(targetDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        setDragCurrentDate(displayDate);
      }
    }
  }, [isPanning, draggingLog, dragStartPos, hasMovedEnough, readOnly, project.startDate, project.endDate, selectionBox, selectedLogIds, logs, lockedLevels, getPosFromDate]);

  const handleGlobalMouseUp = useCallback((e: MouseEvent) => {
    if (isPanning) { setIsPanning(false); return; }
    if (selectionBox) {
      const dist = Math.abs(selectionBox.currentX - selectionBox.startX) + Math.abs(selectionBox.currentY - selectionBox.startY);
      if (dist > 5) { ignoreClickRef.current = true; setTimeout(() => { ignoreClickRef.current = false; }, 100); }
      setSelectionBox(null); return;
    }
    if (readOnly) return;
    
    // Broadcast Viewing status when drag ends
    if (draggingLog && onInteraction) {
       onInteraction('Viewing', null);
    }

    if (draggingLog && dragStartPos && hasMovedEnough && lineRef.current) {
      ignoreClickRef.current = true;
      const rect = lineRef.current.getBoundingClientRect();
      const days = timelineDragDays(dragStartPos.x, e.clientX, rect.width, project.startDate, project.endDate);
      const ids = selectedLogIds.has(draggingLog.id) ? selectedLogIds : new Set([draggingLog.id]);
      const items = Object.entries(logs).flatMap(([date, list]) => list.filter(log => ids.has(log.id))
        .map(log => ({ id: log.id, date, locked: !!log.isLocked || lockedLevels[log.level] })));
      const moves = planTimelineMoves(items, days, project.startDate, project.endDate);
      if (draggingLog.isCloning && onCopyLogs) {
        const copies = moves.length > 0 ? moves : items.filter(item => !item.locked)
          .map(item => ({ id: item.id, oldDate: item.date, newDate: item.date }));
        onCopyLogs(copies);
        setSelectedLogIds(new Set<string>());
      } else if (moves.length > 0) {
        onMoveLogs?.(moves);
      }
      setTimeout(() => { ignoreClickRef.current = false; }, 100);
    }
    setDraggingLog(null); setDragStartPos(null); setHasMovedEnough(false); setDragGhostPos(null); setDragCurrentDate(null);
  }, [draggingLog, dragStartPos, hasMovedEnough, lockedLevels, onMoveLogs, onCopyLogs, project.startDate, project.endDate, readOnly, isPanning, selectionBox, selectedLogIds, logs, onInteraction]);

  useEffect(() => {
    if (draggingLog || isPanning || selectionBox) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [draggingLog, isPanning, selectionBox, handleGlobalMouseMove, handleGlobalMouseUp]);

  const handleAxisClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (readOnly) return;
    if (isPanning || draggingLog || selectionBox || !lineRef.current) return;
    const rect = lineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const dateStr = timelineDateAtPosition(percentage, project.startDate, project.endDate);
    setSelectedDate(dateStr);
    setSelectedPercentage(percentage * 100);
    setShowLevelMenu(false);
  }, [isPanning, draggingLog, selectionBox, project.startDate, project.endDate, readOnly]);

  const handleAxisMouseMove = useCallback((e: React.MouseEvent) => {
    if (readOnly || isPanning || draggingLog || selectionBox || !lineRef.current) return;
    const rect = lineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const date = parseSafeDate(timelineDateAtPosition(percentage, project.startDate, project.endDate));
    const displayDate = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' });
    if (tooltipRef.current && tooltipTextRef.current) {
        tooltipRef.current.style.opacity = '1';
        tooltipRef.current.style.left = `${percentage * 100}%`;
        tooltipTextRef.current.innerText = displayDate;
    }
  }, [readOnly, isPanning, draggingLog, selectionBox, project.startDate, project.endDate]);

  const handleAxisMouseLeave = useCallback(() => {
    if (tooltipRef.current) { tooltipRef.current.style.opacity = '0'; }
  }, []);

  const handleWheel = (e: React.WheelEvent) => {
    if (!isSpacePressed) return; 
    const zoomIntensity = 0.05;
    const delta = e.deltaY > 0 ? -zoomIntensity : zoomIntensity;
    setTransform(prev => {
      const newScale = Math.max(0.1, Math.min(5, prev.scale * (1 + delta)));
      return { ...prev, scale: newScale };
    });
  };

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
          scale: 2, logging: false, useCORS: true, windowWidth: EXPORT_WIDTH, 
          onclone: (clonedDoc) => {
            const wrapper = clonedDoc.querySelector('[data-capture-wrapper]') as HTMLElement;
            const inner = clonedDoc.querySelector('[data-inner-container]') as HTMLElement;
            if (wrapper && inner) {
               wrapper.style.width = `${EXPORT_WIDTH}px`; wrapper.style.height = 'auto'; wrapper.style.overflow = 'visible';
               if (withAlpha) {
                 wrapper.style.backgroundColor = 'transparent'; wrapper.style.background = 'transparent'; wrapper.classList.remove('bg-slate-50/10');
                 inner.style.backgroundColor = 'transparent'; inner.style.background = 'transparent'; inner.classList.remove('bg-white');
               }
               inner.style.transform = 'none'; inner.style.width = '100%'; inner.style.height = 'auto'; inner.style.position = 'relative'; 
            }
            const textElements = clonedDoc.querySelectorAll('.truncate, .line-clamp-2');
            textElements.forEach((el) => { (el as HTMLElement).style.whiteSpace = 'normal'; (el as HTMLElement).style.overflow = 'visible'; });
            const cards = clonedDoc.querySelectorAll('.overflow-hidden');
            cards.forEach((el) => { (el as HTMLElement).style.overflow = 'visible'; });
          }
        });
        const link = document.createElement('a');
        link.download = `${project.name.replace(/\s+/g, '-').toLowerCase()}-snapshot.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Failed to generate export. Please try again.');
    } finally { setIsExporting(false); }
  }, [project.name, exportBg]);

  // Dynamic Scale Markers based on Timeline Scale
  const timeScaleMarkers = useMemo(() => {
    const markers: { label: string; subLabel?: string; pos: number; type: 'month' | 'week' | 'day' }[] = [];
    const current = new Date(projectStart);

    // SCALE < 2: Month View (Standard)
    if (timelineScale < 2) {
      current.setDate(1); // Start at beginning of month containing project start
      // Adjust if before start
      if (current > projectStart) current.setMonth(current.getMonth() - 1);
      
      while (current <= projectEnd) {
         if (current >= projectStart) {
            markers.push({ 
               label: current.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), 
               pos: getPosFromDate(formatDate(current)),
               type: 'month'
            });
         }
         current.setMonth(current.getMonth() + 1);
      }
    } 
    // SCALE 2 - 6: Week View
    else if (timelineScale < 6) {
       // Align to Monday
       const day = current.getDay();
       const diff = current.getDate() - day + (day === 0 ? -6 : 1);
       current.setDate(diff);

       while (current <= projectEnd) {
          const endDate = new Date(current);
          endDate.setDate(current.getDate() + 6);
          
          if (endDate >= projectStart) {
             markers.push({
                label: current.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                pos: getPosFromDate(formatDate(current)),
                type: 'week'
             });
          }
          current.setDate(current.getDate() + 7);
       }
    }
    // SCALE >= 6: Day View
    else {
       // Align to start
       while (current <= projectEnd) {
           markers.push({
              label: current.getDate().toString(),
              subLabel: current.toLocaleDateString(undefined, { weekday: 'narrow' }),
              pos: getPosFromDate(formatDate(current)),
              type: 'day'
           });
           current.setDate(current.getDate() + 1);
       }
    }
    return markers;
  }, [projectStart, projectEnd, timelineScale, getPosFromDate]);

  const levelOptions = [
    { level: 1 as LogLevel, label: t('Milestone'), icon: 'fa-circle', color: 'bg-amber-500' },
    { level: 2 as LogLevel, label: t('Phase checkpoint'), icon: 'fa-square', color: 'bg-indigo-500' },
    { level: 3 as LogLevel, label: t('Task detail'), icon: 'fa-diamond', color: 'bg-slate-400' },
  ];

  return (
    <div 
      ref={containerRef}
      tabIndex={0}
      className={`w-full flex flex-col overflow-hidden bg-white relative transition-all select-none outline-none ${className || 'flex-1'} ${isPanning ? 'cursor-grabbing' : isSpacePressed ? 'cursor-grab' : ''}`}
      onMouseDown={handleContainerMouseDown}
      onClick={() => { 
        if (suspended || showProjectSettings || showExportModal || exportError) return;
        if (ignoreClickRef.current) { ignoreClickRef.current = false; return; }
        if(!readOnly && !selectionBox) { setSelectedDate(null); setSelectedPercentage(null); setSelectedLogIds(new Set<string>()); } 
      }}
      onWheel={handleWheel}
    >
      <div ref={toastRef} className="fixed bottom-10 left-1/2 transform translate-y-[20px] -translate-x-1/2 bg-slate-900 text-white px-6 py-3 rounded-full shadow-2xl z-[9999] opacity-0 transition-all duration-300 pointer-events-none">{t('Action Completed')}</div>

      {!readOnly && showProjectSettings && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[2000] flex items-center justify-center p-6 animate-in fade-in duration-200" onClick={(e) => e.stopPropagation()}>
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <header className="px-10 py-8 border-b border-slate-50 flex items-center justify-between">
              <div><h3 className="text-2xl font-black text-slate-800 tracking-tighter">{t('Configuration')}</h3><p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{t('Roadmap settings')}</p></div>
              <button onClick={(e) => { e.stopPropagation(); setShowProjectSettings(false); }} className="w-10 h-10 rounded-full hover:bg-slate-50 flex items-center justify-center text-slate-300 transition-all" aria-label={t('Close')}><i className="fas fa-times"></i></button>
            </header>
            <div className="p-10 space-y-8">
              <div className="space-y-6">
                <div><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t('Task Name')}</label><input value={project.name} onChange={(e) => onUpdateProject?.({ name: e.target.value })} className="w-full px-5 py-3.5 rounded-2xl bg-white border border-slate-200 text-slate-900 font-bold focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none transition-all shadow-sm" /></div>
                <div><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t('Lead / Team')}</label><input value={project.personnel} onChange={(e) => onUpdateProject?.({ personnel: e.target.value })} className="w-full px-5 py-3.5 rounded-2xl bg-white border border-slate-200 text-slate-900 font-bold focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none transition-all shadow-sm" /></div>
                <div className="grid grid-cols-2 gap-6">
                  <div><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t('Start Date')}</label><input type="date" value={project.startDate} onChange={(e) => onUpdateProject?.({ startDate: e.target.value })} className="w-full px-5 py-3.5 rounded-2xl bg-white border border-slate-200 text-slate-900 font-bold focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none transition-all shadow-sm" /></div>
                  <div><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t('End Date')}</label><input type="date" value={project.endDate} onChange={(e) => onUpdateProject?.({ endDate: e.target.value })} className="w-full px-5 py-3.5 rounded-2xl bg-white border border-slate-200 text-slate-900 font-bold focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none transition-all shadow-sm" /></div>
                </div>
              </div>
              <div className="pt-4 flex gap-4"><button onClick={(e) => { e.stopPropagation(); setShowProjectSettings(false); }} className="flex-1 py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg">{t('Done')}</button></div>
            </div>
          </div>
        </div>
      )}

      {showExportModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[2000] flex items-center justify-center p-6 animate-in fade-in duration-200" onClick={(e) => e.stopPropagation()}>
          <div className="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 p-8 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-6"><i className="fas fa-camera"></i></div>
            <h3 className="text-xl font-black text-slate-800 tracking-tight mb-2">{t('Export Snapshot')}</h3>
            <p className="text-xs text-slate-500 font-medium mb-8 leading-relaxed">{t('Customize your export.')}</p>
            <div className="space-y-6 text-left">
              <div><label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">{t('Background')}</label><div className="grid grid-cols-2 gap-3"><button onClick={() => setExportBg('white')} className={`py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all flex items-center justify-center gap-2 ${exportBg === 'white' ? 'border-slate-800 text-slate-800 bg-slate-50' : 'border-slate-100 text-slate-400 hover:border-slate-200'}`}><div className="w-3 h-3 bg-white border border-slate-200 rounded-full"></div> {t('Standard')}</button><button onClick={() => setExportBg('transparent')} className={`py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all flex items-center justify-center gap-2 ${exportBg === 'transparent' ? 'border-slate-800 text-slate-800 bg-slate-50' : 'border-slate-100 text-slate-400 hover:border-slate-200'}`}><div className="w-3 h-3 bg-white border border-slate-200 rounded-full relative overflow-hidden"><div className="absolute inset-0 bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIklEQVQIW2NkQAKrVq36zwjjgzhhZWGMYAEYB8RmROaABADeOQ8CXl/xfgAAAABJRU5ErkJggg==')] opacity-30"></div></div> {t('Alpha')}</button></div></div>
            </div>
            <button onClick={executeExport} className="w-full py-4 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-slate-800 transition-colors shadow-lg mt-8">{t('Download PNG')}</button>
            <button onClick={() => setShowExportModal(false)} className="mt-6 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600">{t('Cancel')}</button>
          </div>
        </div>
      )}

      <AppDialog
        open={exportError !== null}
        tone="danger"
        title={t('Export failed')}
        message={exportError ?? ''}
        cancelLabel={t('Close')}
        onCancel={() => setExportError(null)}
      />

      <div className="absolute top-6 left-6 right-6 z-50 flex flex-wrap gap-2" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
        {levelOptions.map(opt => (
          <div key={opt.level} className="flex items-center bg-white rounded-2xl border border-slate-100 shadow-xl overflow-hidden transition-all">
            <button aria-pressed={visibleLevels[opt.level]} onClick={(e) => { e.stopPropagation(); setVisibleLevels(p => ({...p, [opt.level]: !p[opt.level]})); }} className={`flex items-center gap-2 px-3 py-2.5 transition-all ${visibleLevels[opt.level] ? 'opacity-100' : 'opacity-40 grayscale'}`}><div className={`w-2.5 h-2.5 rounded-full ${opt.color}`}></div><span className="text-xs font-bold text-slate-800">{opt.label}</span></button>
            {!readOnly && onMoveLogs && <button aria-label={t(lockedLevels[opt.level] ? 'Unlock level' : 'Lock level')} title={t(lockedLevels[opt.level] ? 'Unlock level' : 'Lock level')} aria-pressed={lockedLevels[opt.level]} onClick={(e) => { e.stopPropagation(); setLockedLevels(p => ({...p, [opt.level]: !p[opt.level]})); }} className={`px-3 py-2.5 border-l border-slate-50 ${lockedLevels[opt.level] ? 'text-indigo-600 bg-indigo-50' : 'text-slate-300'}`}><i className={`fas ${lockedLevels[opt.level] ? 'fa-lock' : 'fa-lock-open'} text-[10px]`}></i></button>}
          </div>
        ))}
      </div>

      <div ref={captureRef} data-capture-wrapper="true" className="flex-1 relative overflow-hidden flex items-center justify-center bg-slate-50/10">
        {selectionBox && (<div className="absolute z-[150] bg-indigo-500/20 border border-indigo-500 pointer-events-none" style={{ left: Math.min(selectionBox.startX, selectionBox.currentX) - (captureRef.current?.getBoundingClientRect().left || 0), top: Math.min(selectionBox.startY, selectionBox.currentY) - (captureRef.current?.getBoundingClientRect().top || 0), width: Math.abs(selectionBox.currentX - selectionBox.startX), height: Math.abs(selectionBox.currentY - selectionBox.startY) }}></div>)}

        <div data-inner-container="true" className="absolute origin-center transition-transform duration-300 ease-out bg-white" style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`, width: autoScale ? '1400px' : `${100 * timelineScale}%`, minWidth: `${1400 * timelineScale}px`, height: `${adaptiveHeight}px` }}>
          <div className="w-full h-full flex flex-col justify-center px-28 relative z-10">
            <div className="relative w-full mb-0 flex flex-col justify-end" style={{ height: `${skylineHeight}px` }}>
              {logMarkers.map((marker) => {
                const isHoveredGroup = marker.logList.some((l: WorkLog) => l.id === hoveredLogId);
                const isSelectedGroup = marker.logList.some((l: WorkLog) => selectedLogIds.has(l.id));
                const isDraggingGroup = marker.logList.some((l: WorkLog) => draggingLog?.id === l.id);
                const wrapperZIndex = isDraggingGroup ? 100 : (isHoveredGroup ? 60 : (isSelectedGroup ? 50 : 10));

                return (
                <div key={marker.dateStr} className="absolute bottom-0 flex flex-col items-center pointer-events-none" style={{ left: `${marker.pos}%`, transform: 'translateX(-50%)', zIndex: wrapperZIndex }}>
                  <div className="flex flex-col-reverse items-center pointer-events-auto">
                    {marker.logList.map((log: WorkLog, logIdx: number) => {
                      const isSelected = selectedLogIds.has(log.id);
                      const isPast = marker.isPast;
                      const isLocked = !!log.isLocked || lockedLevels[log.level];
                      const isDraggingThis = draggingLog?.id === log.id;
                      
                      // COLLABORATOR VISUALIZATION LOGIC
                      // Filter guests out based on 'Guest' username substring
                      const logCollaborators = collaborators?.filter(c => 
                        c.targetId === log.id && 
                        (c.action === 'Editing' || c.action === 'Viewing') && 
                        !c.username.includes('Guest')
                      ) || [];
                      
                      const editors = logCollaborators.filter(c => c.action === 'Editing');
                      const isBeingEdited = editors.length > 0;
                      const isCollapsed = collapsedLogIds.has(log.id);
                      const cardDateLabel = parseSafeDate(marker.dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

                      return (
                        <div key={log.id} data-log-id={log.id} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => handleLogMouseDown(e, log, marker.dateStr)} onMouseEnter={() => setHoveredLogId(log.id)} onMouseLeave={() => setHoveredLogId(null)} onDoubleClick={(e) => { e.stopPropagation(); onSelectDate(marker.dateStr, log.id); }} title={isCollapsed ? `${log.author} · ${cardDateLabel}${log.summary ? ` · ${log.summary}` : ''}` : undefined} style={{ marginBottom: logIdx === 0 ? '8px' : '-24px', zIndex: isDraggingThis || isBeingEdited ? 2000 : (100 - logIdx), transform: isDraggingThis ? 'scale(1.03) translateY(-4px)' : isSelected ? 'scale(1.03) translateY(-4px)' : 'none' }} className={`border rounded-xl shadow-sm transition-all relative overflow-visible group select-none ${isLocked || readOnly ? (readOnly ? 'cursor-pointer' : 'grayscale-[0.6] cursor-not-allowed') : draggingLog?.isCloning ? 'cursor-copy' : 'cursor-grab active:cursor-grabbing'} ${isPast && !isSelected ? 'grayscale-[0.5] opacity-75' : 'opacity-100 grayscale-0'} ${isCollapsed ? 'w-16 p-1.5' : `p-2.5 ${log.level === 1 ? 'w-52' : log.level === 2 ? 'w-48' : 'w-44'}`} ${isSelected ? 'ring-2 ring-indigo-500/50 border-indigo-600 bg-indigo-50' : log.level === 1 ? 'bg-slate-900 border-slate-900 text-white' : log.level === 2 ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-200'} ${isBeingEdited ? 'ring-4 ring-offset-2 ring-amber-400 border-amber-400' : ''}`}>
                          
                          {/* EDITING LABEL */}
                          {isBeingEdited && (
                            <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-amber-500 text-white text-[8px] font-black px-2 py-0.5 rounded-full shadow-lg z-[70] whitespace-nowrap flex items-center gap-1 animate-pulse border border-white">
                                <i className="fas fa-pencil-alt text-[7px]"></i>
                                {editors.length === 1 ? `${editors[0].username} ${t('Editing')}` : `${editors.length} ${t('Editing')}`}
                            </div>
                          )}

                          {/* Collaborator Avatars */}
                          {logCollaborators.length > 0 && (
                            <div className="absolute -top-3 -right-2 flex -space-x-1 z-[60] animate-in zoom-in duration-200">
                              {logCollaborators.map(c => (
                                <div 
                                  key={c.clientId} 
                                  className={`w-6 h-6 rounded-full border-2 border-white flex items-center justify-center text-[9px] font-black text-white shadow-md relative group/collab ${c.action === 'Editing' ? 'ring-2 ring-amber-300' : ''}`}
                                  style={{ backgroundColor: c.color }}
                                >
                                  {c.username.charAt(0).toUpperCase()}
                                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[8px] font-bold px-1.5 py-0.5 rounded opacity-0 group-hover/collab:opacity-100 whitespace-nowrap pointer-events-none transition-opacity">
                                    {c.username} · {t(c.action)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* COLLAPSE TOGGLE — bottom-right corner so it never
                              collides with the lock button (top-right) or the
                              collaborator avatars / editing badge above the card. */}
                          <button onMouseDown={e => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggleCollapsedLogs([log.id]); }} className={`absolute -bottom-2 -right-2 w-5 h-5 flex items-center justify-center rounded-full transition-all z-50 border border-white shadow-md ${isCollapsed ? 'opacity-100 bg-indigo-500 text-white' : 'opacity-0 group-hover:opacity-100 bg-white text-slate-400 hover:text-indigo-500'}`} title={isCollapsed ? t('Expand card') : t('Collapse card')} aria-label={isCollapsed ? t('Expand card') : t('Collapse card')} aria-pressed={isCollapsed}><i className={`fas ${isCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'} text-[8px]`}></i></button>

                          {!isCollapsed && !readOnly && onToggleLock && (<button onMouseDown={e => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onToggleLock?.(log.id, marker.dateStr); }} className={`absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-full transition-all z-50 ${!!log.isLocked ? 'text-slate-400 bg-slate-100 opacity-100' : 'opacity-0 group-hover:opacity-100 text-slate-300 hover:text-indigo-500 hover:bg-white'}`} title={!!log.isLocked ? t('Unlock Log') : t('Lock Log')}><i className={`fas ${!!log.isLocked ? 'fa-lock' : 'fa-lock-open'} text-[9px]`}></i></button>)}

                          {isCollapsed ? (
                            /* Compact state: one level-coloured initial. Stays
                               draggable and selectable, and the title attribute
                               carries the author / date / summary for hover. */
                            <div className={`w-6 h-6 mx-auto rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0 ${isSelected ? 'bg-indigo-600 text-white' : log.level === 1 ? 'bg-amber-400 text-slate-900' : log.level === 2 ? 'bg-indigo-500 text-white' : 'bg-slate-300 text-slate-700'}`}>{log.author.trim().charAt(0).toUpperCase() || '?'}</div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2 mb-1 overflow-hidden"><div className={`w-2 h-2 rounded-full flex-shrink-0 ${log.level === 1 ? 'bg-amber-400' : log.level === 2 ? 'bg-indigo-500' : 'bg-slate-300'}`}></div><span className={`text-sm font-bold leading-snug line-clamp-2 tracking-tight mt-[1px] ${isSelected ? 'text-indigo-900' : log.level === 1 ? 'text-amber-100' : log.level === 2 ? 'text-indigo-900' : 'text-slate-800'}`}>{log.author}</span></div>
                              <div className={`text-xs font-medium opacity-70 mb-1.5 flex items-center gap-1 ${log.level === 1 && !isSelected ? 'text-amber-200' : 'text-slate-500'}`}><i className="far fa-calendar text-[7px]"></i>{cardDateLabel}</div>
                              <p className={`text-xs line-clamp-2 leading-relaxed ${isSelected ? 'text-indigo-800' : log.level === 1 ? 'text-slate-300' : 'text-slate-500'}`}>{log.summary || t('Pending update...')}</p>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className={`w-0.5 bg-gradient-to-t transition-all duration-700 ${marker.isPast ? 'opacity-30' : 'opacity-100'}`} style={{ height: `${marker.baseStemHeight}px`, background: `linear-gradient(to top, #f1f5f9, ${marker.logList[0]?.level === 1 ? '#fbbf24' : marker.logList[0]?.level === 2 ? '#6366f1' : '#94a3b8'})` }}></div>
                </div>
              );})}
            </div>

            <div className="relative w-full pt-4">
              {/* Dynamic Scale Markers */}
              <div className="absolute -top-12 left-0 w-full flex justify-between pointer-events-none">
                {timeScaleMarkers.map((m, idx) => (
                   <div key={`${m.type}-${idx}`} className="absolute flex flex-col items-center" style={{ left: `${m.pos}%`, transform: 'translateX(-50%)' }}>
                      <div className={`w-px ${m.type === 'month' ? 'h-8 bg-slate-300' : m.type === 'week' ? 'h-5 bg-slate-200' : 'h-3 bg-slate-100'} mb-2`}></div>
                      <span className={`${m.type === 'month' ? 'text-[11px] text-slate-600' : 'text-[9px] text-slate-400'} font-black uppercase tracking-widest whitespace-nowrap px-1`}>
                        {m.label}
                      </span>
                      {m.subLabel && <span className="text-[7px] text-slate-300 font-bold uppercase tracking-wide">{m.subLabel}</span>}
                   </div>
                ))}
              </div>

              {/* Timeline axis */}
              <div 
                ref={lineRef}
                onClick={handleAxisClick}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (readOnly || suspended || !lineRef.current) return;
                  const rect = lineRef.current.getBoundingClientRect();
                  const date = timelineDateAtPosition((event.clientX - rect.left) / rect.width, project.startDate, project.endDate);
                  onSelectDate(date, undefined, 3);
                }}
                onMouseMove={handleAxisMouseMove} 
                onMouseLeave={handleAxisMouseLeave} 
                className={`relative h-8 w-full my-4 select-none ${readOnly ? '' : 'cursor-crosshair'}`}
              >
                
                {/* 1. Base Solid Line (The main timeline) */}
                <div 
                  className="absolute top-1/2 left-0 right-0 h-[5px] -translate-y-1/2 rounded-full"
                  style={{ background: `linear-gradient(to right, #e2e8f0 0%, #e2e8f0 ${todayPos}%, #94a3b8 ${todayPos}%, #94a3b8 100%)` }}
                ></div>

                {/* Ghost & Real-time Feedback */}
                {dragGhostPos !== null && dragCurrentDate && (
                  <div className="absolute top-1/2 -translate-y-1/2 z-[50] pointer-events-none" style={{ left: `${dragGhostPos}%` }}>
                    <div className={`w-6 h-6 rounded-full border-[3px] ${draggingLog?.isCloning ? 'border-emerald-400 bg-emerald-500/50' : 'border-indigo-200 bg-indigo-500/50'} transform -translate-x-1/2`}></div>
                    {selectedLogIds.size > 1 && (<div className={`absolute top-4 left-4 ${draggingLog?.isCloning ? 'bg-emerald-600' : 'bg-indigo-600'} text-white text-[9px] font-black px-2 py-0.5 rounded-full whitespace-nowrap shadow-md`}>{draggingLog?.isCloning ? t('Copy') : ''} +{selectedLogIds.size - 1}</div>)}
                    {selectedLogIds.size === 1 && draggingLog?.isCloning && (<div className="absolute top-4 left-4 bg-emerald-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full whitespace-nowrap shadow-md">{t('Copy')}</div>)}
                    <div className="absolute -top-14 -translate-x-1/2 flex flex-col items-center animate-in fade-in zoom-in-95 duration-75"><div className={`px-3 py-1.5 ${draggingLog?.isCloning ? 'bg-emerald-600' : 'bg-indigo-600'} text-white text-[10px] font-black rounded-lg shadow-xl whitespace-nowrap mb-1`}>{dragCurrentDate}</div><div className={`w-0.5 h-3 ${draggingLog?.isCloning ? 'bg-emerald-600' : 'bg-indigo-600'}`}></div></div>
                  </div>
                )}

                {!readOnly && !draggingLog && !selectionBox && (
                  <div ref={tooltipRef} className="absolute -top-12 -translate-x-1/2 z-[70] flex flex-col items-center pointer-events-none opacity-0 transition-opacity duration-75" style={{ left: `0%` }}>
                    <div ref={tooltipTextRef} className="px-3 py-1.5 bg-slate-900 text-white text-[10px] font-black rounded-lg shadow-xl whitespace-nowrap mb-1"></div>
                    <div className="w-0.5 h-3 bg-slate-900"></div>
                  </div>
                )}

                {todayIsWithinRange && (<div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-[60] flex flex-col items-center pointer-events-none" style={{ left: `${todayPos}%` }}><div className="w-[2px] h-6 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"></div><div className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-red-500 text-white text-[8px] font-black rounded shadow whitespace-nowrap animate-pulse">{t('TODAY')}</div></div>)}
                {logMarkers.map(m => (<div key={m.dateStr} className={`absolute top-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-lg z-20 transition-all ${m.isPast ? 'opacity-60 grayscale-[0.3]' : 'opacity-100'} ${m.logList[0]?.level === 1 ? 'w-7 h-7 bg-amber-500' : m.logList[0]?.level === 2 ? 'w-6 h-6 bg-indigo-500' : 'w-5 h-5 bg-slate-400'}`} style={{ left: `${m.pos}%`, transform: 'translate(-50%, -50%)' }} />))}
                {!readOnly && selectedPercentage !== null && (
                  <div className="absolute top-1/2 -translate-y-1/2 z-40" style={{ left: `${selectedPercentage}%` }} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                    <button onClick={() => setShowLevelMenu(true)} className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-xl transform -translate-x-1/2 -translate-y-16 border-2 border-white"><i className="fas fa-plus"></i></button>
                    {showLevelMenu && (<div className="absolute -translate-x-1/2 -translate-y-[260px] bg-white border border-slate-100 shadow-2xl rounded-2xl p-2 flex flex-col gap-1 min-w-[160px]">{levelOptions.map(opt => (<button key={opt.level} onClick={() => onSelectDate(selectedDate!, undefined, opt.level)} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50"><div className={`w-3 h-3 rounded-full ${opt.color}`}></div><span className="text-[10px] font-black text-slate-800 uppercase">{opt.label}</span></button>))}</div>)}
                  </div>
                )}
              </div>
              <div className="mt-10 flex justify-between text-[11px] font-black text-slate-400 uppercase tracking-widest px-2"><span>{projectStart.toLocaleDateString()}</span><span>{projectEnd.toLocaleDateString()}</span></div>
            </div>
          </div>
        </div>
      </div>

      {!autoScale && (
      <footer className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 z-10" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
        <p className="text-xs text-slate-500">{t(readOnly ? 'Double-click to view · Space to pan' : logMarkers.length === 0 ? 'Double-click the timeline to add your first card' : 'Drag to move · Double-click to edit · Space to pan')}</p>
        <div className="flex items-center gap-4">
          <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-1.5" title={t('Collapse / expand cards')}><kbd className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 border border-slate-200">E</kbd> {t('Collapse / expand cards')}</span>
          <button onClick={() => setShowExportModal(true)} disabled={isExporting} className="text-[9px] font-black text-emerald-600 uppercase tracking-widest border border-slate-200 px-4 py-2 rounded-full bg-white shadow-sm flex items-center gap-2 hover:bg-emerald-50 transition-colors disabled:opacity-50"><i className={`fas ${isExporting ? 'fa-spinner fa-spin' : 'fa-camera'}`}></i> { isExporting ? t('Processing...') : t('Snapshot') }</button>
          {!readOnly && onUpdateProject && (<button onClick={(e) => { e.stopPropagation(); setShowProjectSettings(true); }} className="text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-200 px-4 py-2 rounded-full bg-white shadow-sm flex items-center gap-2 hover:bg-slate-50 transition-colors"><i className="fas fa-sliders-h"></i> {t('Settings')}</button>)}
          <div className="flex items-center bg-white rounded-full border border-slate-200 shadow-sm mx-2">
            <button onClick={handleZoomOut} disabled={timelineScale <= 1} className="w-10 h-10 flex items-center justify-center rounded-l-full hover:bg-slate-50 text-slate-500 transition-colors disabled:opacity-30" title={t('Shrink Timeline')} aria-label={t('Shrink Timeline')}><i className="fas fa-minus text-[10px]"></i></button>
            <div className="w-px h-4 bg-slate-100"></div>
            <button onClick={handleZoomIn} disabled={timelineScale >= 30} className="w-10 h-10 flex items-center justify-center rounded-r-full hover:bg-slate-50 text-slate-500 transition-colors disabled:opacity-30" title={t('Stretch Timeline')} aria-label={t('Stretch Timeline')}><i className="fas fa-plus text-[10px]"></i></button>
          </div>
          <button onClick={fitToView} className="text-[9px] font-black text-slate-400 uppercase tracking-widest border border-slate-200 px-4 py-2 rounded-full bg-white transition-all hover:bg-slate-50 active:translate-y-0.5">{t('Reset View (H)')}</button>
        </div>
      </footer>
      )}
    </div>
  );
};

export default Timeline;
