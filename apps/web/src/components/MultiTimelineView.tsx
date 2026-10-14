import React, { useMemo, useState } from 'react';
import type { Project, WorkLog } from '../types';
import Timeline from './Timeline';
import { useI18n } from '../i18n';
import {
  countCards,
  filterLogs,
  groupTasksByWorkspace,
  localDateStr,
  toggleGroup,
  toggleTask,
  type MultiTimelineFilter,
  type PickerTask
} from './multiTimelineState';

interface MultiTimelineViewProps {
  projects: Project[];
  logs: Record<string, Record<string, WorkLog[]>>;
  onBack: () => void;
  /** Every task the user may pick, grouped in the picker by `workspaceId`. */
  pickerTasks?: PickerTask[];
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Drives the "@mentions of me" filter. */
  currentUserId?: string;
}

const FILTERS: MultiTimelineFilter[] = ['all', 'today', 'mentions'];

const FILTER_LABEL: Record<MultiTimelineFilter, string> = {
  all: 'All',
  today: 'Today',
  mentions: 'Mentions of me'
};

const MultiTimelineView: React.FC<MultiTimelineViewProps> = ({
  projects,
  logs,
  onBack,
  pickerTasks,
  selectedIds,
  onSelectionChange,
  currentUserId = ''
}) => {
  const { t } = useI18n();
  const [filter, setFilter] = useState<MultiTimelineFilter>('all');
  const [pickerOpen, setPickerOpen] = useState(false);

  const today = localDateStr(new Date());
  // Falls back to the tasks already on screen when the picker is not wired up.
  const selected = selectedIds ?? projects.map((p) => p.id);
  const toggleable = Boolean(pickerTasks && onSelectionChange);
  const groups = useMemo(() => groupTasksByWorkspace(pickerTasks ?? []), [pickerTasks]);

  // Filtering narrows the CARDS only. The timeline keeps each task's own date
  // range, so filtering never shifts or zooms the view out from under you.
  const rows = useMemo(
    () => projects.map((project) => {
      const visible = filterLogs(logs[project.id] ?? {}, filter, today, currentUserId);
      return { project, visible, count: countCards(visible) };
    }),
    [projects, logs, filter, today, currentUserId]
  );
  // With a filter active, tasks that match nothing are noise — drop them.
  const shown = filter === 'all' ? rows : rows.filter((row) => row.count > 0);

  return (
    <div className="sp-app-shell flex flex-col h-screen bg-slate-50 overflow-hidden">
      <header className="sp-topbar px-4 py-3 sm:px-6 border-b border-slate-200 bg-white z-20 flex flex-wrap items-center gap-3 shrink-0">
        <button onClick={onBack} aria-label={t('Back to tasks')} className="sp-icon-button shrink-0 border border-slate-200 bg-white flex items-center justify-center text-slate-500 transition-colors">
          <i className="fas fa-arrow-left"></i>
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="sp-heading text-base font-semibold text-slate-800">{t('Multi-View')}</h2>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">{t('Interactive Mode: Space + Wheel to Zoom • Space + Drag to Pan')}</p>
        </div>

        {/* Filter: all cards, or only the ones dated today. */}
        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1" role="group" aria-label={t('Card filter')}>
          {FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              aria-pressed={filter === option}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                filter === option
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {option === 'today' ? t('Today') : option === 'mentions' ? t('Mentions of me') : t('All')}
            </button>
          ))}
        </div>

        {toggleable && (
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            aria-expanded={pickerOpen}
            className="sp-button-secondary inline-flex shrink-0 items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors"
          >
            <i className="fas fa-list-check text-[11px]" aria-hidden="true"></i>
            {t('Choose tasks')}
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] tabular-nums">{selected.length}</span>
          </button>
        )}

        <div className="shrink-0 px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium">
          {projects.length} {t('Tasks')}
        </div>
      </header>

      {toggleable && pickerOpen && (
        <div className="shrink-0 border-b border-slate-200 bg-white max-h-[38vh] overflow-y-auto">
          <div className="px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2">
            <p className="sp-metadata text-xs">{t('Pick the tasks to stack on this page.')}</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSelectionChange?.(groups.flatMap((g) => g.tasks.map((task) => task.id)))}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50"
              >
                {t('Select all')}
              </button>
              <button
                type="button"
                onClick={() => onSelectionChange?.([])}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100"
              >
                {t('Clear all')}
              </button>
            </div>
          </div>
          <div className="px-4 sm:px-6 pb-4 space-y-4">
            {groups.map((group) => {
              const ids = group.tasks.map((task) => task.id);
              const allOn = ids.every((id) => selected.includes(id));
              return (
                <section key={group.workspaceId}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="sp-heading text-xs font-semibold uppercase tracking-wider text-slate-500">{group.workspaceName}</h3>
                    <button
                      type="button"
                      onClick={() => onSelectionChange?.(toggleGroup(selected, ids))}
                      className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                    >
                      {allOn ? t('Clear all') : t('Select all')}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {group.tasks.map((task) => {
                      const on = selected.includes(task.id);
                      return (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => onSelectionChange?.(toggleTask(selected, task.id))}
                          aria-pressed={on}
                          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors ${
                            on
                              ? 'border-indigo-300 bg-indigo-50 text-indigo-900'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              on ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300'
                            }`}
                            aria-hidden="true"
                          >
                            {on && <i className="fas fa-check text-[8px] text-white"></i>}
                          </span>
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: task.color }}></span>
                          <span className="min-w-0 truncate">{task.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-6 bg-slate-100/50">
        {shown.map(({ project, visible, count }) => (
          <div key={project.id} className="sp-task-card bg-white rounded-[18px] border border-slate-200/60 overflow-hidden flex flex-col h-[600px]">
            <div className="sp-topbar flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-white/50 backdrop-blur shrink-0">
              <div className="w-2 h-2 shrink-0 rounded-full" style={{ backgroundColor: project.color }}></div>
              <span className="sp-heading break-words font-semibold text-slate-800 text-sm">{project.name}</span>
              <span className="ml-auto shrink-0 sp-metadata text-xs tabular-nums">
                {count} {filter === 'mentions' ? t('cards mentioning me') : t('cards')}
              </span>
            </div>

            <div className="flex-1 relative overflow-hidden">
              <Timeline
                project={project}
                logs={visible}
                onSelectDate={() => {}}
                readOnly={true}
                autoScale={true}
                className="h-full w-full"
              />
            </div>
          </div>
        ))}

        {shown.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <i className={`fas ${projects.length === 0 ? 'fa-layer-group' : filter === 'mentions' ? 'fa-at' : 'fa-calendar-day'} text-2xl mb-4 opacity-40`}></i>
            <p className="text-sm font-medium text-slate-500">
              {projects.length === 0
                ? t('No tasks selected')
                : filter === 'mentions'
                  ? t('No cards mention you in these tasks')
                  : t('No cards today in these tasks')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MultiTimelineView;
