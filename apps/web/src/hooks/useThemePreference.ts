import { useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'syncpath_theme';
const listeners = new Set<() => void>();
const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function readPreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch { return 'system'; }
}

let preference: ThemePreference = typeof window === 'undefined' ? 'system' : readPreference();

function applyTheme(): void {
  if (typeof document === 'undefined') return;
  const resolved = preference === 'system' ? media?.matches ? 'dark' : 'light' : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
}

function changed(): void {
  applyTheme();
  for (const listener of listeners) listener();
}

function storageChanged(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  preference = readPreference();
  changed();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    media?.addEventListener('change', changed);
    window.addEventListener('storage', storageChanged);
    // The setting may change in another tab while no header is mounted.
    preference = readPreference();
    applyTheme();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      media?.removeEventListener('change', changed);
      window.removeEventListener('storage', storageChanged);
    }
  };
}

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* Keep the current page usable when browser storage is unavailable. */ }
  changed();
}

// Apply before the first header render so saved preferences also style sign-in and shared pages.
applyTheme();

export function useThemePreference(): { preference: ThemePreference; setPreference: typeof setThemePreference } {
  return { preference: useSyncExternalStore(subscribe, () => preference, () => 'system'), setPreference: setThemePreference };
}
