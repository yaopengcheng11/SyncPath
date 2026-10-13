import React, { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { calendarGrid, calendarMonth, clampCalendarDate, isCalendarDateAllowed, parseCalendarDate, shiftCalendarDate, shiftCalendarMonth, todayCalendarDate } from '../utils/calendarDate';

export interface DatePickerProps {
  label: string;
  value: string;
  onChange: (date: string) => void;
  name?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
}

/** An in-form calendar keeps the parent dialog's focus trap and avoids clipped popovers. */
const DatePicker: React.FC<DatePickerProps> = ({ label, value, onChange, name, min, max, disabled = false }) => {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => calendarMonth(parseCalendarDate(value) ? value : todayCalendarDate()));
  const [focusedDate, setFocusedDate] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const dialogId = useId();
  const minDate = min || '0001-01-01';
  const maxDate = max || '9999-12-31';
  const today = todayCalendarDate();
  const dateLocale = locale === 'zh' ? 'zh-CN' : 'en-US';
  const formatter = new Intl.DateTimeFormat(dateLocale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const selectedDate = parseCalendarDate(value);
  const visibleMonth = parseCalendarDate(month)!;
  const monthLabel = new Intl.DateTimeFormat(dateLocale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(visibleMonth);
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(dateLocale, { weekday: 'narrow', timeZone: 'UTC' }).format(parseCalendarDate(shiftCalendarDate('2026-10-05', index))!));
  const dates = calendarGrid(month);

  const close = (restoreFocus = false): void => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const show = (): void => {
    const first = clampCalendarDate(parseCalendarDate(value) ? value : today, minDate, maxDate);
    setMonth(calendarMonth(first));
    setFocusedDate(first);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    calendarRef.current?.querySelector<HTMLButtonElement>(`button[data-date="${focusedDate}"]`)?.focus();
  }, [open, focusedDate, month]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const select = (date: string): void => {
    if (!disabled && isCalendarDateAllowed(date, minDate, maxDate)) {
      onChange(date);
      close(true);
    }
  };

  const navigateMonth = (amount: number): void => {
    const next = shiftCalendarMonth(month, amount);
    const nextFocus = clampCalendarDate(next, minDate, maxDate);
    setMonth(calendarMonth(nextFocus));
    setFocusedDate(nextFocus);
  };

  const dayKey = (event: React.KeyboardEvent<HTMLButtonElement>, date: string): void => {
    let next: string | null = null;
    const weekday = (parseCalendarDate(date)!.getUTCDay() + 6) % 7;
    if (event.key === 'ArrowRight') next = shiftCalendarDate(date, 1);
    if (event.key === 'ArrowLeft') next = shiftCalendarDate(date, -1);
    if (event.key === 'ArrowDown') next = shiftCalendarDate(date, 7);
    if (event.key === 'ArrowUp') next = shiftCalendarDate(date, -7);
    if (event.key === 'Home') next = shiftCalendarDate(date, -weekday);
    if (event.key === 'End') next = shiftCalendarDate(date, 6 - weekday);
    if (event.key === 'PageUp') next = shiftCalendarMonth(date, -1);
    if (event.key === 'PageDown') next = shiftCalendarMonth(date, 1);
    if (next) {
      event.preventDefault();
      event.stopPropagation();
      next = clampCalendarDate(next, minDate, maxDate);
      setFocusedDate(next);
      setMonth(calendarMonth(next));
    }
  };

  return <div ref={rootRef} className="min-w-0" onKeyDown={(event) => {
    if (open && event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.preventDefault(); event.stopPropagation(); close(true);
    }
  }} onBlur={(event) => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close();
  }}>
    <span id={labelId} className="mb-2 block text-xs font-semibold text-slate-600">{label}</span>
    {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
    <button ref={triggerRef} type="button" disabled={disabled} aria-labelledby={labelId} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined} onClick={() => open ? close(true) : show()} className={`flex w-full items-center justify-between gap-2 rounded-xl border bg-white px-3.5 py-3 text-left text-sm font-medium text-slate-800 outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-60 ${open ? 'border-indigo-400 shadow-sm' : 'border-slate-200 hover:border-indigo-300'}`}>
      <span className="truncate">{selectedDate ? formatter.format(selectedDate) : t('Choose date')}</span>
      <i className="far fa-calendar-alt shrink-0 text-indigo-500" aria-hidden="true" />
    </button>
    {open && <div ref={calendarRef} id={dialogId} role="dialog" aria-label={t('Choose {{label}}', { label })} className="mt-2 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-lg shadow-slate-900/10">
      <div className="mb-2 flex items-center justify-between gap-1">
        <button type="button" aria-label={t('Previous month')} disabled={month <= calendarMonth(minDate)} onClick={() => navigateMonth(-1)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-30"><i className="fas fa-chevron-left text-[10px]" aria-hidden="true" /></button>
        <span aria-live="polite" className="truncate text-xs font-semibold text-slate-800">{monthLabel}</span>
        <button type="button" aria-label={t('Next month')} disabled={month >= calendarMonth(maxDate)} onClick={() => navigateMonth(1)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-30"><i className="fas fa-chevron-right text-[10px]" aria-hidden="true" /></button>
      </div>
      <div className="grid grid-cols-7 text-center">
        {weekdays.map((day, index) => <span key={index} aria-hidden="true" className="pb-1 text-[10px] font-medium text-slate-400">{day}</span>)}
        {dates.map((date) => {
          const allowed = isCalendarDateAllowed(date, minDate, maxDate);
          const dateObject = parseCalendarDate(date);
          return <button key={date} type="button" data-date={date} disabled={!allowed} tabIndex={date === focusedDate ? 0 : -1} aria-label={dateObject ? formatter.format(dateObject) : date} aria-pressed={value === date} aria-current={date === today ? 'date' : undefined} onKeyDown={(event) => dayKey(event, date)} onClick={() => select(date)} className={`my-0.5 flex h-7 min-w-0 items-center justify-center rounded-lg text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-25 ${date === value ? 'bg-indigo-600 font-bold text-white' : calendarMonth(date) !== month ? 'text-slate-400 hover:bg-slate-100' : 'text-slate-700 hover:bg-indigo-50 hover:text-indigo-700'} ${date === today && date !== value ? 'font-bold ring-1 ring-inset ring-indigo-200' : ''}`}>
            {Number(date.slice(-2))}
          </button>;
        })}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
        <button type="button" disabled={!isCalendarDateAllowed(today, minDate, maxDate)} onClick={() => select(today)} className="rounded-lg px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 disabled:opacity-30">{t('Today')}</button>
        <button type="button" onClick={() => close(true)} className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">{t('Close')}</button>
      </div>
    </div>}
  </div>;
};

export default DatePicker;
