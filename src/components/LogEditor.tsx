import React, { useState, useMemo } from 'react';
import { WorkLog, Goal, LogLevel, Project } from '../types';
import { getDisplayWeekRange, parseSafeDate, getHolidaysInRange } from '../utils/dateUtils';
import { summarizeWork } from '../services/geminiService';

interface LogEditorProps {
  dateStr: string;
  initialLog?: WorkLog;
  initialLevel?: LogLevel;
  onSave: (log: WorkLog) => void;
  onBack: () => void;
  readOnly?: boolean;
  project?: Project;
}

const LogEditor: React.FC<LogEditorProps> = ({ dateStr, initialLog, initialLevel = 3, onSave, onBack, readOnly = false, project }) => {
  const [author, setAuthor] = useState(initialLog?.author || '');
  const [level, setLevel] = useState<LogLevel>(initialLog?.level || initialLevel);
  const [goals] = useState<Goal[]>(initialLog?.goals || []);
  const [summary, setSummary] = useState(initialLog?.summary || '');
  const [notes, setNotes] = useState(initialLog?.notes || '');
  const [isCompleted, setIsCompleted] = useState(initialLog?.status === 'completed');
  const [isSummarizing, setIsSummarizing] = useState(false);

  const handleSave = () => {
    if (readOnly) return;
    if (!author.trim()) {
      alert("Please enter key objectives.");
      return;
    }
    onSave({
      id: initialLog?.id || Math.random().toString(36).substr(2, 9),
      author: author.trim(),
      level,
      weekStartDate: dateStr,
      goals,
      summary,
      notes,
      createdAt: initialLog?.createdAt || Date.now(),
      updatedAt: Date.now(),
      status: isCompleted ? 'completed' : 'pending'
    });
  };

  const handleAISummarize = async () => {
    if (readOnly) return;
    setIsSummarizing(true);
    const result = await summarizeWork([], notes);
    setSummary(result);
    setIsSummarizing(false);
  };

  // Weekend and Holiday Detection
  const statusHint = useMemo(() => {
    const date = parseSafeDate(dateStr);
    const day = date.getDay();
    const isWeekend = day === 0 || day === 6; 
    
    let holidayName = null;
    let isHoliday = false;

    if (project) {
        if (project.holidayRegion === 'CN') {
            const holidays = getHolidaysInRange(dateStr, dateStr, 'CN');
            if (holidays.length > 0) { isHoliday = true; holidayName = holidays[0].name; }
        } else {
            const stored = project.storedHolidays?.find(h => h.date === dateStr);
            if (stored) {
                isHoliday = true; 
                holidayName = stored.localName || stored.name;
            } else if (project.holidayRegion && project.holidayRegion !== 'NONE') {
                const holidays = getHolidaysInRange(dateStr, dateStr, project.holidayRegion);
                if (holidays.length > 0) { isHoliday = true; holidayName = holidays[0].name; }
            }
        }
    }

    if (isHoliday) return { type: 'holiday', text: `Public Holiday: ${holidayName || 'Holiday'}` };
    if (isWeekend) return { type: 'weekend', text: 'Scheduled for Weekend' };
    return null;
  }, [dateStr, project]);

  const levelInfo: Record<LogLevel, { label: string, color: string, text: string }> = {
    1: { label: 'Primary Log', color: 'bg-amber-500', text: 'Significant milestone or delivery' },
    2: { label: 'Secondary Log', color: 'bg-indigo-500', text: 'Important update or sync' },
    3: { label: 'Minor Log', color: 'bg-slate-400', text: 'Regular routine check-in' },
  };

  return (
    <div className="fixed inset-0 bg-white dark:bg-slate-950 z-50 flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-300 overflow-hidden">
      {/* Header */}
      <header className={`px-8 py-6 border-b transition-colors duration-500 flex items-center justify-between ${level === 1 ? 'bg-slate-900 border-slate-800' : 'bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800'}`}>
        <div className="flex items-center gap-6">
          <button 
            onClick={onBack}
            className={`w-10 h-10 border flex items-center justify-center rounded-full transition-colors ${level === 1 ? 'border-slate-800 hover:bg-slate-800' : 'border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900'}`}
          >
            <i className={`fas fa-chevron-left text-sm ${level === 1 ? 'text-slate-500' : 'text-slate-400 dark:text-slate-500'}`}></i>
          </button>
          <div>
            <h2 className={`text-xl font-black tracking-tight ${level === 1 ? 'text-white' : 'text-slate-800 dark:text-white'}`}>
              {levelInfo[level].label}
            </h2>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${level === 1 ? 'text-amber-400' : 'text-slate-400 dark:text-slate-500'}`}>
              {getDisplayWeekRange(dateStr)}
            </p>
          </div>
        </div>
        <div className="flex gap-4 items-center">
          {/* Status Toggle */}
          {!readOnly && (
             <div onClick={() => setIsCompleted(!isCompleted)} className={`cursor-pointer flex items-center gap-3 px-4 py-2 rounded-full border transition-all select-none ${isCompleted ? 'bg-emerald-50 border-emerald-100 text-emerald-600 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400' : 'bg-slate-50 border-slate-100 text-slate-400 dark:bg-slate-900 dark:border-slate-800'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${isCompleted ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400 dark:bg-slate-700'}`}>
                   <i className="fas fa-check text-[10px]"></i>
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest">{isCompleted ? 'Completed' : 'Pending'}</span>
             </div>
          )}

          {!readOnly && (
            <button 
              onClick={handleSave}
              className={`px-8 py-3 rounded-full text-xs font-black uppercase tracking-widest transition-all shadow-xl ${level === 1 ? 'bg-amber-500 text-slate-900 hover:bg-amber-400 shadow-amber-900/20' : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 shadow-slate-200 dark:shadow-none'}`}
            >
              Publish Entry
            </button>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-8 bg-white dark:bg-slate-950">
        <div className="max-w-5xl mx-auto space-y-8">
          
          {/* Non-working Day Banner */}
          {statusHint && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-200 dark:border-amber-800/50 p-4 rounded-3xl flex items-center gap-4 animate-in slide-in-from-top-2 duration-300">
              <div className="w-10 h-10 rounded-full bg-amber-200 dark:bg-amber-800 flex items-center justify-center text-amber-700 dark:text-amber-300 text-xl shadow-sm">
                <i className={`fas ${statusHint.type === 'holiday' ? 'fa-gift' : 'fa-mug-hot'}`}></i>
              </div>
              <div>
                <h4 className="text-sm font-black text-amber-800 dark:text-amber-300 uppercase tracking-widest">{statusHint.text}</h4>
                <p className="text-xs text-amber-600 dark:text-amber-400 font-bold opacity-80">This entry falls on a non-working day.</p>
              </div>
            </div>
          )}

          {/* Entry Level & Key Objectives Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <section className="bg-slate-50 dark:bg-slate-900 p-6 rounded-2xl border border-slate-100 dark:border-slate-800">
              <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">Entry Type</label>
              <div className="flex gap-2">
                {([1, 2, 3] as const).map(lv => (
                  <button
                    key={lv}
                    onClick={() => !readOnly && setLevel(lv)}
                    disabled={readOnly}
                    className={`flex-1 py-3 rounded-xl border-2 transition-all flex flex-col items-center gap-1
                      ${level === lv ? 'border-indigo-600 bg-white dark:bg-slate-800 shadow-lg scale-[1.02]' : 'border-transparent hover:bg-white dark:hover:bg-slate-800'}
                      ${readOnly ? 'cursor-default opacity-80' : ''}
                    `}
                  >
                    <div className={`w-2 h-2 rounded-full ${levelInfo[lv].color}`}></div>
                    <span className="text-[10px] font-black uppercase text-slate-700 dark:text-slate-300">{levelInfo[lv].label}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="bg-slate-50 dark:bg-slate-900 p-6 rounded-2xl border border-slate-100 dark:border-slate-800">
              <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">Key Objectives</label>
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black transition-colors ${level === 1 ? 'bg-amber-400 text-slate-900' : 'bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300'}`}>
                  {author ? author.charAt(0).toUpperCase() : '?'}
                </div>
                <input 
                  type="text" 
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="Objective (e.g. Launch MVP)"
                  readOnly={readOnly}
                  className="flex-1 bg-transparent border-none p-0 text-xl font-bold text-slate-800 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 focus:ring-0"
                />
              </div>
            </section>
          </div>

          {/* Overview & Details */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 pb-12">
            <section>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-black text-slate-800 dark:text-slate-200 uppercase tracking-widest flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${level === 1 ? 'bg-amber-400' : 'bg-indigo-500'}`}></span>
                  Overview
                </h3>
                {!readOnly && (
                  <button 
                    onClick={handleAISummarize}
                    disabled={isSummarizing || !notes}
                    className="text-[9px] font-black uppercase text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 disabled:opacity-30 flex items-center gap-1"
                    title="Generate summary from details"
                  >
                    {isSummarizing ? <i className="fas fa-circle-notch fa-spin"></i> : <i className="fas fa-magic"></i>}
                    Draft Summary
                  </button>
                )}
              </div>
              <textarea 
                value={summary}
                readOnly={readOnly}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Key updates for stakeholders (displayed on timeline card)..."
                className="w-full p-6 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl min-h-[300px] focus:bg-white dark:focus:bg-slate-800 focus:ring-4 focus:ring-indigo-50 dark:focus:ring-indigo-900/30 outline-none transition-all text-sm leading-relaxed text-slate-800 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-600 shadow-inner"
              />
            </section>

            <section>
              <h3 className="text-sm font-black text-slate-800 dark:text-slate-200 uppercase tracking-widest flex items-center gap-2 mb-4">
                <span className={`w-1.5 h-1.5 rounded-full ${level === 1 ? 'bg-amber-400' : 'bg-indigo-500'}`}></span>
                Details
              </h3>
              <textarea 
                value={notes}
                readOnly={readOnly}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Specific technical details, blockers, or execution notes..."
                className="w-full p-6 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl min-h-[300px] focus:bg-white dark:focus:bg-slate-800 focus:ring-4 focus:ring-indigo-50 dark:focus:ring-indigo-900/30 outline-none transition-all text-sm leading-relaxed text-slate-800 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-600 shadow-inner"
              />
            </section>
          </div>
        </div>
      </main>
    </div>
  );
};

export default LogEditor;