import React, { useState, useEffect } from 'react';
import { WorkLog, Goal, LogLevel } from '../types';
import { getDisplayWeekRange } from '../utils/dateUtils';
import { summarizeWork, suggestGoals } from '../services/geminiService';

interface LogEditorProps {
  dateStr: string;
  initialLog?: WorkLog;
  initialLevel?: LogLevel;
  onSave: (log: WorkLog) => void;
  onBack: () => void;
  readOnly?: boolean;
}

const LogEditor: React.FC<LogEditorProps> = ({ dateStr, initialLog, initialLevel = 3, onSave, onBack, readOnly = false }) => {
  const [author, setAuthor] = useState(initialLog?.author || '');
  const [level, setLevel] = useState<LogLevel>(initialLog?.level || initialLevel);
  const [goals, setGoals] = useState<Goal[]>(initialLog?.goals || []);
  const [summary, setSummary] = useState(initialLog?.summary || '');
  const [notes, setNotes] = useState(initialLog?.notes || '');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);

  const handleAddGoal = () => {
    if (readOnly) return;
    const newGoal: Goal = {
      id: Math.random().toString(36).substr(2, 9),
      title: '',
      description: '',
      status: 'pending'
    };
    setGoals([...goals, newGoal]);
  };

  const updateGoal = (id: string, updates: Partial<Goal>) => {
    if (readOnly) return;
    setGoals(goals.map(g => g.id === id ? { ...g, ...updates } : g));
  };

  const removeGoal = (id: string) => {
    if (readOnly) return;
    setGoals(goals.filter(g => g.id !== id));
  };

  const handleSave = () => {
    if (readOnly) return;
    if (!author.trim()) {
      alert("Please enter a collaborator name.");
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
      updatedAt: Date.now() // Always update timestamp on save
    });
  };

  const handleAISummarize = async () => {
    if (readOnly) return;
    setIsSummarizing(true);
    const result = await summarizeWork(goals, notes);
    setSummary(result);
    setIsSummarizing(false);
  };

  const handleAISuggest = async () => {
    if (readOnly) return;
    setIsSuggesting(true);
    const suggestions = await suggestGoals(notes || "general team work");
    const newGoals: Goal[] = suggestions.map(s => ({
      id: Math.random().toString(36).substr(2, 9),
      title: s.title || 'New Goal',
      description: s.description || '',
      status: 'pending'
    }));
    setGoals([...goals, ...newGoals]);
    setIsSuggesting(false);
  };

  const levelInfo = {
    1: { label: 'Primary Log', color: 'bg-amber-500', text: 'Significant milestone or delivery' },
    2: { label: 'Secondary Log', color: 'bg-indigo-500', text: 'Important update or sync' },
    3: { label: 'Minor Log', color: 'bg-slate-400', text: 'Regular routine check-in' },
  };

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-300 overflow-hidden">
      {/* Header */}
      <header className={`px-8 py-6 border-b transition-colors duration-500 flex items-center justify-between ${level === 1 ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'}`}>
        <div className="flex items-center gap-6">
          <button 
            onClick={onBack}
            className={`w-10 h-10 border flex items-center justify-center rounded-full transition-colors ${level === 1 ? 'border-slate-800 hover:bg-slate-800' : 'border-slate-100 hover:bg-slate-50'}`}
          >
            <i className={`fas fa-chevron-left text-sm ${level === 1 ? 'text-slate-500' : 'text-slate-400'}`}></i>
          </button>
          <div>
            <h2 className={`text-xl font-black tracking-tight ${level === 1 ? 'text-white' : 'text-slate-800'}`}>
              {levelInfo[level].label}
            </h2>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${level === 1 ? 'text-amber-400' : 'text-slate-400'}`}>
              {getDisplayWeekRange(dateStr)}
            </p>
          </div>
        </div>
        <div className="flex gap-4">
          {!readOnly && (
            <button 
              onClick={handleSave}
              className={`px-8 py-3 rounded-full text-xs font-black uppercase tracking-widest transition-all shadow-xl ${level === 1 ? 'bg-amber-500 text-slate-900 hover:bg-amber-400 shadow-amber-900/20' : 'bg-slate-900 text-white hover:bg-slate-800 shadow-slate-200'}`}
            >
              Publish Entry
            </button>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-8 bg-white">
        <div className="max-w-5xl mx-auto space-y-12">
          {/* Entry Level & Author Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <section className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Entry Type</label>
              <div className="flex gap-2">
                {(Object.keys(levelInfo) as unknown as LogLevel[]).map(lv => (
                  <button
                    key={lv}
                    onClick={() => !readOnly && setLevel(Number(lv) as LogLevel)}
                    disabled={readOnly}
                    className={`flex-1 py-3 rounded-xl border-2 transition-all flex flex-col items-center gap-1
                      ${level === Number(lv) ? 'border-indigo-600 bg-white shadow-lg' : 'border-transparent hover:bg-white'}
                      ${readOnly ? 'cursor-default opacity-80' : ''}
                    `}
                  >
                    <div className={`w-2 h-2 rounded-full ${levelInfo[lv].color}`}></div>
                    <span className="text-[10px] font-black uppercase">{levelInfo[lv].label}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Collaborator Identity</label>
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black transition-colors ${level === 1 ? 'bg-amber-400 text-slate-900' : level === 2 ? 'bg-indigo-100 text-indigo-600' : 'bg-indigo-100 text-indigo-600'}`}>
                  {author ? author.charAt(0).toUpperCase() : '?'}
                </div>
                <input 
                  type="text" 
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="Name (e.g. Sarah J.)"
                  readOnly={readOnly}
                  className="flex-1 bg-transparent border-none p-0 text-xl font-bold text-slate-800 placeholder:text-slate-300 focus:ring-0"
                />
              </div>
            </section>
          </div>

          {/* Goals Section */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${level === 1 ? 'bg-amber-400' : 'bg-indigo-500'}`}></span>
                Key Objectives
              </h3>
              {!readOnly && (
                <div className="flex gap-2">
                   <button 
                    onClick={handleAISuggest}
                    disabled={isSuggesting}
                    className="text-[9px] font-black uppercase text-indigo-600 px-3 py-1.5 rounded hover:bg-indigo-50 disabled:opacity-50"
                  >
                    {isSuggesting ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-magic mr-1"></i>}
                    AI Assist
                  </button>
                  <button 
                    onClick={handleAddGoal}
                    className="text-[9px] font-black uppercase text-slate-600 px-3 py-1.5 rounded hover:bg-slate-100"
                  >
                    <i className="fas fa-plus mr-1"></i> New Objective
                  </button>
                </div>
              )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {goals.map((goal) => (
                <div key={goal.id} className="p-6 border border-slate-200 rounded-2xl bg-white hover:border-indigo-400 hover:shadow-xl transition-all group shadow-sm flex flex-col gap-5">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${goal.status === 'completed' ? 'bg-emerald-500' : goal.status === 'in-progress' ? 'bg-amber-500' : 'bg-slate-300'}`}></div>
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Status Tracking</span>
                    </div>
                    {!readOnly && (
                      <button 
                        onClick={() => removeGoal(goal.id)}
                        className="text-slate-300 hover:text-red-500 transition-all"
                      >
                        <i className="fas fa-trash-alt text-xs"></i>
                      </button>
                    )}
                  </div>
                  
                  <div className="space-y-4">
                    <select 
                      value={goal.status}
                      disabled={readOnly}
                      onChange={(e) => updateGoal(goal.id, { status: e.target.value as any })}
                      className={`
                        w-full px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all bg-white
                        ${readOnly ? 'cursor-default appearance-none opacity-80' : 'cursor-pointer'}
                        ${goal.status === 'completed' ? 'text-emerald-700 border-emerald-100 bg-emerald-50/50' : 
                          goal.status === 'in-progress' ? 'text-amber-700 border-amber-100 bg-amber-50/50' : 'text-slate-600 border-slate-200'}
                      `}
                    >
                      <option value="pending">Pending</option>
                      <option value="in-progress">Doing</option>
                      <option value="completed">Done</option>
                    </select>

                    <div className="relative">
                      <input 
                        type="text"
                        value={goal.title}
                        placeholder="Define your objective clearly..."
                        readOnly={readOnly}
                        onChange={(e) => updateGoal(goal.id, { title: e.target.value })}
                        className="w-full font-bold text-slate-900 bg-white border border-slate-200 rounded-xl px-4 py-3 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 outline-none placeholder:text-slate-300 transition-all text-sm"
                      />
                    </div>
                  </div>
                </div>
              ))}
              {goals.length === 0 && (
                <div className="md:col-span-2 py-12 border-2 border-dashed border-slate-100 rounded-3xl flex flex-col items-center justify-center text-slate-300">
                  <i className="fas fa-bullseye text-3xl mb-3"></i>
                  <p className="text-[10px] font-black uppercase tracking-widest">No objectives added for this entry</p>
                </div>
              )}
            </div>
          </section>

          {/* Summary & Notes */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 pb-12">
            <section>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${level === 1 ? 'bg-amber-400' : 'bg-indigo-500'}`}></span>
                  Overview
                </h3>
                {!readOnly && (
                  <button 
                    onClick={handleAISummarize}
                    disabled={isSummarizing || goals.length === 0}
                    className="text-[9px] font-black uppercase text-indigo-500 hover:text-indigo-700 disabled:opacity-30"
                  >
                    Draft Summary
                  </button>
                )}
              </div>
              <textarea 
                value={summary}
                readOnly={readOnly}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Key updates for stakeholders..."
                className="w-full p-6 bg-slate-50 border border-slate-200 rounded-3xl min-h-[180px] focus:bg-white focus:ring-4 focus:ring-indigo-50 outline-none transition-all text-sm leading-relaxed text-slate-800"
              />
            </section>

            <section>
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2 mb-4">
                <span className={`w-1.5 h-1.5 rounded-full ${level === 1 ? 'bg-amber-400' : 'bg-indigo-500'}`}></span>
                Details
              </h3>
              <textarea 
                value={notes}
                readOnly={readOnly}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Specific technical details or roadblocks..."
                className="w-full p-6 bg-slate-50 border border-slate-200 rounded-3xl min-h-[180px] focus:bg-white focus:ring-4 focus:ring-indigo-50 outline-none transition-all text-sm leading-relaxed text-slate-800"
              />
            </section>
          </div>
        </div>
      </main>
    </div>
  );
};

export default LogEditor;