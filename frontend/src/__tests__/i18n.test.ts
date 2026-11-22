import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLanguage,
  localizeShortcut,
  onLanguageChange,
  setLanguage,
  t,
  updateDomLanguage,
} from '../i18n';

describe('i18n module', () => {
  beforeEach(() => {
    setLanguage('de', false);
    document.body.innerHTML = '';
  });

  it('translates keys into German by default and supports English', () => {
    setLanguage('de', false);
    expect(t('nav.files')).toBe('Dateien');
    expect(t('settings.title')).toBe('Einstellungen');
    expect(t('settings.langDe')).toBe('Deutsch');
    expect(t('settings.langEn')).toBe('Englisch');

    setLanguage('en', false);
    expect(getLanguage()).toBe('en');
    expect(t('nav.files')).toBe('Files');
    expect(t('settings.title')).toBe('Settings');
    expect(t('settings.langDe')).toBe('German');
    expect(t('settings.langEn')).toBe('English');
  });

  it('interpolates parameters correctly in both languages', () => {
    setLanguage('de', false);
    expect(t('status.cursor', { line: 12, col: 5 })).toBe('Zeile 12, Spalte 5');

    setLanguage('en', false);
    expect(t('status.cursor', { line: 12, col: 5 })).toBe('Line 12, Column 5');
  });

  it('falls back to German or the raw key if a translation is missing', () => {
    setLanguage('en', false);
    expect(t('nonexistent.key.xyz')).toBe('nonexistent.key.xyz');
  });

  it('updates DOM nodes with data-i18n, title, aria, and placeholder attributes', () => {
    document.body.innerHTML = `
      <h1 data-i18n="settings.title">Original</h1>
      <button data-i18n-title="nav.saveTitle" data-i18n-aria="nav.saveTitle"></button>
      <input type="text" data-i18n-placeholder="palette.placeholder">
    `;

    setLanguage('de', false);
    updateDomLanguage();

    const h1 = document.querySelector('h1')!;
    const btn = document.querySelector('button')!;
    const input = document.querySelector('input')!;

    expect(h1.textContent).toBe('Einstellungen');
    expect(btn.title.toLowerCase()).toContain('speichern');
    expect(btn.getAttribute('aria-label')?.toLowerCase()).toContain('speichern');
    expect(input.placeholder).toContain('Befehle');

    setLanguage('en', false);
    updateDomLanguage();

    expect(h1.textContent).toBe('Settings');
    expect(btn.title).toContain('Save');
    expect(btn.getAttribute('aria-label')).toContain('Save');
    expect(input.placeholder.toLowerCase()).toContain('commands');
    expect(document.documentElement.lang).toBe('en');
  });

  it('notifies registered language listeners when language changes', () => {
    const listener = vi.fn();
    const unsubscribe = onLanguageChange(listener);

    setLanguage('en', false);
    expect(listener).toHaveBeenCalledWith('en');

    setLanguage('de', false);
    expect(listener).toHaveBeenCalledWith('de');

    unsubscribe();
    setLanguage('en', false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('localizes keyboard shortcuts between German and English', () => {
    expect(localizeShortcut('Alt+Umschalt+Y', 'en')).toBe('Alt+Shift+Y');
    expect(localizeShortcut('Alt+Umschalt+A', 'en')).toBe('Alt+Shift+A');
    expect(localizeShortcut('Strg+Umschalt+C', 'en')).toBe('Ctrl+Shift+C');
    expect(localizeShortcut('Entf', 'en')).toBe('Del');
    expect(localizeShortcut('Strg+BildAb', 'en')).toBe('Ctrl+PageDown');
    expect(localizeShortcut('Strg+BildAuf', 'en')).toBe('Ctrl+PageUp');
    expect(localizeShortcut('Alt+Z', 'en')).toBe('Alt+Z');
    expect(localizeShortcut('F11', 'en')).toBe('F11');

    expect(localizeShortcut('Alt+Shift+Y', 'de')).toBe('Alt+Umschalt+Y');
    expect(localizeShortcut('Ctrl+Shift+C', 'de')).toBe('Strg+Umschalt+C');
    expect(localizeShortcut('Del', 'de')).toBe('Entf');
    expect(localizeShortcut('Ctrl+PageDown', 'de')).toBe('Strg+BildAb');
    expect(localizeShortcut('Ctrl+PageUp', 'de')).toBe('Strg+BildAuf');
  });

  it('updates shortcuts dynamically in menus, context popovers and shortcuts dialog', () => {
    document.body.innerHTML = `
      <div id="view-popover">
        <kbd class="menu-item-shortcut">Alt+Umschalt+Y</kbd>
        <kbd class="menu-item-shortcut">Alt+Z</kbd>
      </div>
      <div id="tree-context-menu">
        <kbd class="ctx-shortcut">Entf</kbd>
      </div>
      <dialog id="shortcuts-dialog">
        <div class="shortcuts-grid">
          <div><kbd>Strg</kbd> + <kbd>Umschalt</kbd> + <kbd>P</kbd></div>
          <div><kbd>Strg</kbd> + <kbd>Tab</kbd> / <kbd>BildAb</kbd> / <kbd>BildAuf</kbd></div>
        </div>
      </dialog>
    `;

    setLanguage('en', false);
    const viewKbd = document.querySelector('#view-popover .menu-item-shortcut')!;
    const ctxKbd = document.querySelector('#tree-context-menu .ctx-shortcut')!;
    const dialogKbds = Array.from(document.querySelectorAll('#shortcuts-dialog kbd')).map((k) => k.textContent);

    expect(viewKbd.textContent).toBe('Alt+Shift+Y');
    expect(ctxKbd.textContent).toBe('Del');
    expect(dialogKbds).toEqual(['Ctrl', 'Shift', 'P', 'Ctrl', 'Tab', 'PageDown', 'PageUp']);

    setLanguage('de', false);
    expect(viewKbd.textContent).toBe('Alt+Umschalt+Y');
    expect(ctxKbd.textContent).toBe('Entf');
    const dialogKbdsDe = Array.from(document.querySelectorAll('#shortcuts-dialog kbd')).map((k) => k.textContent);
    expect(dialogKbdsDe).toEqual(['Strg', 'Umschalt', 'P', 'Strg', 'Tab', 'BildAb', 'BildAuf']);
  });

  it('has consistent keys in German and English dictionaries', () => {
    // Check that important UI keys exist in both languages
    const keysToCheck = [
      'nav.files',
      'nav.search',
      'nav.outline',
      'nav.view',
      'nav.share',
      'nav.settings',
      'settings.title',
      'settings.language',
      'settings.theme',
      'settings.themeSystem',
      'settings.themeLight',
      'settings.themeDark',
      'settings.wordWrap',
      'settings.spellcheck',
      'settings.autoSave',
      'settings.syncScroll',
      'settings.centered',
      'settings.formatBar',
      'settings.done',
      'view.editorLayout',
      'view.appearance',
      'share.clipboard',
      'share.exportPrint',
      'tableDialog.title',
      'shortcutsDialog.title',
      'docStats.title',
    ];

    setLanguage('de', false);
    for (const key of keysToCheck) {
      const val = t(key);
      expect(val).toBeTruthy();
      expect(val).not.toBe(key);
    }

    setLanguage('en', false);
    for (const key of keysToCheck) {
      const val = t(key);
      expect(val).toBeTruthy();
      expect(val).not.toBe(key);
    }
  });
});
