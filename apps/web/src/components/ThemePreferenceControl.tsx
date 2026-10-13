import React from 'react';
import { useI18n } from '../i18n';
import { useThemePreference, type ThemePreference } from '../hooks/useThemePreference';

const options: { value: ThemePreference; label: string; icon: string }[] = [
  { value: 'light', label: 'Light', icon: 'fa-sun' },
  { value: 'dark', label: 'Dark', icon: 'fa-moon' },
  { value: 'system', label: 'System', icon: 'fa-desktop' }
];

const ThemePreferenceControl: React.FC = () => {
  const { t } = useI18n();
  const { preference, setPreference } = useThemePreference();
  return <fieldset className="min-w-0 border-0 p-0">
    <legend className="mb-2 text-xs font-semibold text-slate-500">{t('Theme')}</legend>
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
      {options.map((option) => <button key={option.value} type="button" aria-pressed={preference === option.value} onClick={() => setPreference(option.value)} className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${preference === option.value ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:bg-white/60 hover:text-slate-700'}`}>
        <i className={`fas ${option.icon} text-[10px]`} aria-hidden="true" />{t(option.label)}
      </button>)}
    </div>
  </fieldset>;
};

export default ThemePreferenceControl;
