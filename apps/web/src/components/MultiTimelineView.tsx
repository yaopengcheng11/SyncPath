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
    <div className="sp-app-shell flex flex-col h-screen bg-slate-50 overflow-hidden">
      <header className="sp-topbar px-4 py-3 sm:px-6 border-b border-slate-200 bg-white z-20 flex items-center justify-between shrink-0">
        <div className="flex min-w-0 w-full items-center gap-3">
          <button onClick={onBack} aria-label={t('Back to tasks')} className="sp-icon-button shrink-0 border border-slate-200 bg-white flex items-center justify-center text-slate-500 transition-colors">
            <i className="fas fa-arrow-left"></i>
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="sp-heading text-base font-semibold text-slate-800">{t('Multi-View')}</h2>
            <p className="mt-0.5 text-xs leading-5 text-slate-500">{t('Interactive Mode: Space + Wheel to Zoom • Space + Drag to Pan')}</p>
          </div>
          <div className="shrink-0 px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium">
            {projects.length} {t('Tasks')}
          </div>
        </div>
      </header>
      
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-6 bg-slate-100/50">
        {projects.map((project, index) => (
          <div key={project.id} className="sp-task-card bg-white rounded-[18px] border border-slate-200/60 overflow-hidden flex flex-col h-[600px]">
            {/* Header moved to static flow to prevent overlap */}
            <div className="sp-topbar flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-white/50 backdrop-blur shrink-0">
               <div className="w-2 h-2 shrink-0 rounded-full" style={{ backgroundColor: project.color }}></div>
               <span className="sp-heading break-words font-semibold text-slate-800 text-sm">{project.name}</span>
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
                <i className="fas fa-layer-group text-2xl mb-4 opacity-40"></i>
                <p className="text-sm font-medium text-slate-500">{t('No tasks selected')}</p>
            </div>
        )}
      </div>
    </div>
  );
};

export default MultiTimelineView;
