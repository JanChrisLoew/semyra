import { backend } from './api';

export type ThemeChoice = 'system' | 'light' | 'dark';

let currentThemeListener: (() => void) | null = null;

export function hasStoredThemeChoice(): boolean {
  try {
    const stored = localStorage.getItem('color-scheme');
    return stored === 'light' || stored === 'dark';
  } catch {
    return false;
  }
}

export function getThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem('color-scheme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  return 'system';
}

export function setThemeChoice(choice: ThemeChoice, notify = true): void {
  const meta = document.querySelector('meta[name="color-scheme"]') as HTMLMetaElement | null;
  try {
    if (choice === 'system') {
      localStorage.removeItem('color-scheme');
      if (meta) meta.content = 'light dark';
    } else {
      localStorage.setItem('color-scheme', choice);
      if (meta) meta.content = choice;
    }
  } catch {}

  void backend.setWindowState({ theme: choice });
  if (notify) {
    currentThemeListener?.();
  }
}

export function toggleTheme(): void {
  const current = getThemeChoice();
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark = current === 'dark' ? true : current === 'light' ? false : media.matches;
  setThemeChoice(isDark ? 'light' : 'dark');
}

/**
 * Synchronizes `<meta name="color-scheme">`, `localStorage`, OS media queries,
 * and the native Win32 titlebar/Mica backdrop (`backend.setWindowState`).
 */
export function bindThemeSystem(onThemeChanged: () => void): void {
  currentThemeListener = onThemeChanged;
  const meta = document.querySelector('meta[name="color-scheme"]') as HTMLMetaElement | null;
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const syncNativeWindowTheme = (rerenderDiagrams = false) => {
    const choice = getThemeChoice();
    void backend.setWindowState({ theme: choice });
    if (rerenderDiagrams) {
      onThemeChanged();
    }
  };

  syncNativeWindowTheme(false);

  media.addEventListener('change', () => {
    syncNativeWindowTheme(true);
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'color-scheme') {
      if (meta) meta.content = e.newValue ?? 'light dark';
      syncNativeWindowTheme(true);
    }
  });

  const toggleBtn = document.getElementById('btn-theme-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      toggleTheme();
    });

    toggleBtn.addEventListener('dblclick', () => {
      setThemeChoice('system');
    });
  }
}
