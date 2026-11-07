import { backend } from './api';

/**
 * Synchronizes `<meta name="color-scheme">`, `localStorage`, OS media queries,
 * and the native Win32 titlebar/Mica backdrop (`backend.setWindowState`).
 */
export function bindThemeSystem(onThemeChanged: () => void): void {
  const meta = document.querySelector('meta[name="color-scheme"]') as HTMLMetaElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const syncNativeWindowTheme = (rerenderDiagrams = false) => {
    const content = meta.content;
    const theme = content === 'dark' ? 'dark' : content === 'light' ? 'light' : 'system';
    void backend.setWindowState({ theme });
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
      meta.content = e.newValue ?? 'light dark';
      syncNativeWindowTheme(true);
    }
  });

  const toggleBtn = document.getElementById('btn-theme-toggle')!;
  toggleBtn.addEventListener('click', () => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('color-scheme');
    } catch {}

    const systemDark = media.matches;
    const currentlyDark =
      stored === 'dark' ? true : stored === 'light' ? false : systemDark;
    const target = currentlyDark ? 'light' : 'dark';
    const systemScheme = systemDark ? 'dark' : 'light';

    if (target === systemScheme) {
      try {
        localStorage.removeItem('color-scheme');
      } catch {}
      meta.content = 'light dark';
    } else {
      try {
        localStorage.setItem('color-scheme', target);
      } catch {}
      meta.content = target;
    }
    syncNativeWindowTheme(true);
  });

  toggleBtn.addEventListener('dblclick', () => {
    try {
      localStorage.removeItem('color-scheme');
    } catch {}
    meta.content = 'light dark';
    syncNativeWindowTheme(true);
  });
}
