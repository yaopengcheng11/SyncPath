import React, { useEffect, useId, useRef } from 'react';
import { useI18n } from '../i18n';

export type AppDialogTone = 'info' | 'warning' | 'danger' | 'success';

interface AppDialogProps {
  open: boolean;
  title: string;
  message?: string;
  error?: string;
  tone?: AppDialogTone;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  onConfirm?: () => void;
  onCancel: () => void;
}

const TONE_STYLES: Record<AppDialogTone, {
  icon: string;
  iconClass: string;
  confirmClass: string;
}> = {
  info: {
    icon: 'fa-info',
    iconClass: 'bg-indigo-50 text-indigo-600',
    confirmClass: 'bg-slate-900 hover:bg-slate-800'
  },
  warning: {
    icon: 'fa-exclamation',
    iconClass: 'bg-amber-50 text-amber-600',
    confirmClass: 'bg-slate-900 hover:bg-slate-800'
  },
  danger: {
    icon: 'fa-trash-alt',
    iconClass: 'bg-red-50 text-red-600',
    confirmClass: 'bg-red-600 hover:bg-red-700'
  },
  success: {
    icon: 'fa-check',
    iconClass: 'bg-emerald-50 text-emerald-600',
    confirmClass: 'bg-slate-900 hover:bg-slate-800'
  }
};

const AppDialog: React.FC<AppDialogProps> = ({
  open,
  title,
  message,
  error,
  tone = 'info',
  confirmLabel,
  cancelLabel,
  confirmDisabled = false,
  cancelDisabled = false,
  onConfirm,
  onCancel
}) => {
  const { t } = useI18n();
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const cancelDisabledRef = useRef(cancelDisabled);
  cancelDisabledRef.current = cancelDisabled;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!dialogRef.current?.contains(document.activeElement) || event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!cancelDisabledRef.current) onCancelRef.current();
      }
      if (event.key === 'Tab') {
        const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'));
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  useEffect(() => {
    if (open && confirmDisabled) dialogRef.current?.focus();
  }, [open, confirmDisabled]);

  if (!open) return null;
  const styles = TONE_STYLES[tone];
  const resolvedConfirmLabel = confirmLabel ?? t('Confirm');
  const resolvedCancelLabel = cancelLabel ?? t('Cancel');

  return (
    <div
      className="sp-modal-backdrop fixed inset-0 z-[4000] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget && !cancelDisabled) onCancel();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="sp-dialog w-full max-w-md rounded-[1.75rem] border border-white/70 bg-white p-7 shadow-2xl shadow-slate-950/20 animate-in zoom-in-95 duration-200"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        tabIndex={-1}
      >
        <div className="flex items-start gap-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${styles.iconClass}`}>
            <i className={`fas ${styles.icon} text-sm`}></i>
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-slate-900">
              {title}
            </h2>
            {message && <p id={messageId} className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-500">{message}</p>}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelDisabled}
            className="-mr-2 -mt-2 flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
            aria-label={t('Close dialog')}
          >
            <i className="fas fa-times text-xs"></i>
          </button>
        </div>
        {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">{error}</p>}
        <div className="mt-7 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelDisabled}
            className="sp-button-secondary rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
          >
            {resolvedCancelLabel}
          </button>
          {onConfirm && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={confirmDisabled}
              className={`${tone === 'danger' ? '' : 'sp-button-primary'} rounded-xl px-4 py-2.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles.confirmClass}`}
            >
              {resolvedConfirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AppDialog;
