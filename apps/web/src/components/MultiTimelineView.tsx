import React from 'react';
import { Project, WorkLog } from '../types';
import Timeline from './Timeline';
import { useI18n } from '../i18n';

interface MultiTimelineViewProps {
  projects: Project[];
  logs: Record<string, Record<string, WorkLog[]>>;
  onBack: () => void;
}

const MultiTimelineView: React.FC<MultiTimelineViewProps> = ({ projects, logs, onBack }) => {
  const { t } = useI18n();
  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden">
      <header className="px-12 py-6 border-b border-slate-200 bg-white z-20 shadow-sm flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onBack} aria-label={t('Back to tasks')} className="w-10 h-10 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center justify-center text-slate-500 transition-all">
            <i className="fas fa-arrow-left"></i>
          </button>
          <div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">{t('Multi-View')}</h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('Interactive Mode: Space + Wheel to Zoom • Space + Drag to Pan')}</p>
          </div>
          <div className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-black uppercase tracking-widest">
            {projects.length} {t('Tasks')}
          </div>
        </div>
      </header>
      
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-8 space-y-8 bg-slate-100/50">
        {projects.map((project, index) => (
          <div key={project.id} className="bg-white rounded-[2.5rem] shadow-sm border border-slate-200/60 overflow-hidden flex flex-col h-[600px] transition-shadow hover:shadow-md">
            {/* Header moved to static flow to prevent overlap */}
            <div className="flex items-center gap-3 px-8 py-5 border-b border-slate-100 bg-white/50 backdrop-blur shrink-0">
               <div className="w-3 h-3 rounded-full" style={{ backgroundColor: project.color }}></div>
               <span className="font-black text-slate-800 text-sm">{project.name}</span>
            </div>
            
            <div className="flex-1 relative overflow-hidden">
              <Timeline 
                project={project}
                logs={logs[project.id] || {}}
                onSelectDate={() => {}} 
                readOnly={true} 
                autoScale={true}
                className="h-full w-full"
              />
            </div>
          </div>
        ))}
        
        {projects.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <i className="fas fa-layer-group text-4xl mb-4 opacity-20"></i>
                <p className="text-sm font-bold uppercase tracking-widest opacity-40">{t('No tasks selected')}</p>
            </div>
        )}
      </div>
    </div>
  );
};

export default MultiTimelineView;
