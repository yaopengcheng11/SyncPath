import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { LogLevel, Project, WorkLog } from '../types';
import { useI18n } from '../i18n';
import { buildGanttTimeline, ganttFilename } from '../utils/ganttTimeline';

interface TimelineExportDialogProps {
  open: boolean;
  project: Pick<Project, 'name' | 'startDate' | 'endDate'>;
  logs: Record<string, WorkLog[]>;
  visibleLevels?: Partial<Record<LogLevel, boolean>>;
  background: 'white' | 'transparent';
  onBackgroundChange: (background: 'white' | 'transparent') => void;
  exporting: boolean;
  error?: string;
  onExportPng: () => Promise<void>;
  onClose: () => void;
}

const TimelineExportDialog: React.FC<TimelineExportDialogProps> = ({
  open, project, logs, visibleLevels, background, onBackgroundChange, exporting, error, onExportPng, onClose
}) => {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<'image' | 'gantt'>('image');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busy = exporting || actionBusy;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const titleId = useId();
  const scopeId = useId();
  const imageTabId = useId();
  const ganttTabId = useId();
  const imagePanelId = useId();
  const ganttPanelId = useId();
  const output = useMemo(() => buildGanttTimeline(project, logs, { locale, visibleLevels }), [project, logs, locale, visibleLevels]);
  const empty = output.cardCount === 0;

  useEffect(() => {
    if (!open) return;
    setTab('image');
    setActionError(null);
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const keydown = (event: KeyboardEvent): void => {
      const dialog = dialogRef.current;
      if (!dialog?.contains(document.activeElement) || event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current && !pendingRef.current) closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled])')];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  useEffect(() => {
    if (open && busy) dialogRef.current?.focus();
  }, [open, busy]);

  const close = (): void => {
    if (!busyRef.current && !pendingRef.current) onClose();
  };

  const exportPng = async (): Promise<void> => {
    if (empty || busyRef.current || pendingRef.current) return;
    pendingRef.current = true;
    setActionBusy(true);
    setActionError(null);
    try {
      await onExportPng();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('Failed to generate export. Please try again.'));
    } finally {
      pendingRef.current = false;
      setActionBusy(false);
    }
  };

  const downloadChart = (): void => {
    if (empty || busyRef.current || pendingRef.current) return;
    setActionError(null);
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([output.html], { type: 'text/html;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = ganttFilename(project.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('Unable to download the chart. Please try again.'));
    } finally {
      if (url) {
        const revoke = URL.revokeObjectURL.bind(URL);
        window.setTimeout(() => revoke(url!), 0);
      }
    }
  };

  if (!open) return null;

  return (
    <div role="presentation" className="sp-modal-backdrop fixed inset-0 z-[4000] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-md"
      onMouseDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) close(); }}
      onClick={(event) => event.stopPropagation()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={scopeId} tabIndex={-1}
        className="sp-dialog flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[2rem] border border-white/70 bg-white/95 shadow-2xl backdrop-blur-xl outline-none"
        onMouseDown={(event) => event.stopPropagation()}>
        <header className="sp-dialog-header flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-6 py-5 sm:px-8">
          <div className="min-w-0">
            <h2 id={titleId} className="text-xl font-semibold tracking-tight text-slate-800">{t('Export timeline')}</h2>
            <p className="mt-1 truncate text-sm font-semibold text-slate-600">{project.name}</p>
            <p id={scopeId} className="mt-2 text-xs leading-5 text-slate-500">{t('{{count}} visible cards · {{start}} — {{end}}', { count: output.cardCount, start: project.startDate, end: project.endDate })}<br />{t('Exports the shown levels within the task dates.')}</p>
          </div>
          <button type="button" onClick={close} disabled={busy} aria-label={t('Close export dialog')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 disabled:opacity-40"><i className="fas fa-times" aria-hidden="true" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-8">
          <div role="tablist" aria-label={t('Export format')} className="mb-5 flex w-fit gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
            <button id={imageTabId} type="button" role="tab" aria-selected={tab === 'image'} aria-controls={imagePanelId} disabled={busy} onClick={() => setTab('image')} className={`rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-40 ${tab === 'image' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{t('Image')}</button>
            <button id={ganttTabId} type="button" role="tab" aria-selected={tab === 'gantt'} aria-controls={ganttPanelId} disabled={busy} onClick={() => setTab('gantt')} className={`rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-40 ${tab === 'gantt' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{t('Gantt')}</button>
          </div>
          {empty && <p className="mb-5 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">{t('No visible cards in the current view.')}</p>}
          {tab === 'image' ? (
            <section id={imagePanelId} role="tabpanel" aria-labelledby={imageTabId} className="py-3">
              <p className="mb-6 text-sm leading-6 text-slate-500">{t('Download the current timeline as a PNG image.')}</p>
              <p className="mb-3 text-xs font-semibold text-slate-600">{t('Background')}</p>
              <div className="mb-8 flex flex-wrap gap-3">
                <button type="button" disabled={busy} aria-pressed={background === 'white'} onClick={() => onBackgroundChange('white')} className={`rounded-xl border px-5 py-3 text-sm font-semibold disabled:opacity-40 ${background === 'white' ? 'border-slate-800 bg-slate-50 text-slate-800' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{t('White')}</button>
                <button type="button" disabled={busy} aria-pressed={background === 'transparent'} onClick={() => onBackgroundChange('transparent')} className={`rounded-xl border px-5 py-3 text-sm font-semibold disabled:opacity-40 ${background === 'transparent' ? 'border-slate-800 bg-slate-50 text-slate-800' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{t('Transparent')}</button>
              </div>
              <button type="button" disabled={busy || empty} onClick={() => void exportPng()} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40">{busy ? t('Processing...') : t('Download PNG')}</button>
            </section>
          ) : (
            <section id={ganttPanelId} role="tabpanel" aria-labelledby={ganttTabId}>
              <p className="mb-4 text-sm leading-6 text-slate-500">{t('Download the chart as a standalone HTML file that opens in any browser.')}</p>
              {!empty && (
                <div className="mb-5 max-h-[28rem] overflow-auto rounded-xl border border-slate-200 bg-slate-100 p-3">
                  <div role="img" aria-label={t('Timeline chart preview')} dangerouslySetInnerHTML={{ __html: output.svg }} />
                </div>
              )}
            </section>
          )}
        </div>
        <footer className="shrink-0 border-t border-slate-100 px-6 py-4 sm:px-8">
          {(error || actionError) && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error || actionError}</p>}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              {tab === 'gantt' && (
                <button type="button" disabled={busy || empty} onClick={downloadChart} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40">{t('Download .html')}</button>
              )}
            </div>
            <button type="button" disabled={busy} onClick={close} className="shrink-0 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">{t('Close')}</button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default TimelineExportDialog;
