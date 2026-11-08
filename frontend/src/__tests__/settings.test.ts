import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsController, SettingsState } from '../settings';

describe('SettingsController', () => {
  let state: SettingsState;

  beforeEach(() => {
    state = {
      wordWrap: true,
      spellcheck: false,
      autoSave: true,
      syncScroll: true,
      formatBarVisible: true,
      centeredEditor: false,
      lineEnding: 'CRLF',
      language: 'de',
    };

    document.body.innerHTML = `
      <div id="view-popover" popover="auto">
        <button id="menu-toggle-word-wrap" role="menuitemcheckbox" aria-checked="false"></button>
        <button id="menu-toggle-sync-scroll" role="menuitemcheckbox" aria-checked="false"></button>
        <button id="menu-toggle-autosave" role="menuitemcheckbox" aria-checked="false"></button>
        <button id="menu-toggle-format-bar" role="menuitemcheckbox" aria-checked="false"></button>
        <button id="menu-toggle-centered" role="menuitemcheckbox" aria-checked="false"></button>
        <button id="menu-toggle-orientation"></button>
        <button id="menu-toggle-zen"></button>
        <button id="menu-toggle-theme"></button>
      </div>

      <button id="btn-settings"></button>

      <dialog id="settings-dialog">
        <button data-lang-choice="de"></button>
        <button data-lang-choice="en"></button>

        <button data-theme-choice="system"></button>
        <button data-theme-choice="light"></button>
        <button data-theme-choice="dark"></button>

        <input type="checkbox" id="setting-word-wrap">
        <input type="checkbox" id="setting-spellcheck">
        <input type="checkbox" id="setting-autosave">
        <input type="checkbox" id="setting-sync-scroll">
        <input type="checkbox" id="setting-format-bar">
        <input type="checkbox" id="setting-centered-editor">

        <button data-crlf-choice="CRLF"></button>
        <button data-crlf-choice="LF"></button>

        <button id="btn-reset-split"></button>
        <button id="btn-settings-open-shortcuts"></button>
      </dialog>
    `;

    // Mock HTMLDialogElement methods in JSDOM if needed
    const dialog = document.getElementById('settings-dialog') as HTMLDialogElement;
    dialog.showModal = vi.fn(() => {
      dialog.setAttribute('open', '');
    });
    dialog.close = vi.fn(() => {
      dialog.removeAttribute('open');
    });
  });

  it('synchronizes view menu check states with current application state', () => {
    const callbacks = {
      onToggleWordWrap: vi.fn(),
      onToggleSpellcheck: vi.fn(),
      onToggleAutoSave: vi.fn(),
      onToggleSyncScroll: vi.fn(),
      onToggleFormatBar: vi.fn(),
      onToggleCenteredEditor: vi.fn(),
      onToggleOrientation: vi.fn(),
      onToggleZen: vi.fn(),
      onResetSplit: vi.fn(),
      onSetLineEnding: vi.fn(),
      onSetLanguage: vi.fn(),
      onOpenShortcuts: vi.fn(),
    };

    const ctrl = new SettingsController(() => state, callbacks);
    ctrl.syncViewMenu();

    expect(document.getElementById('menu-toggle-word-wrap')?.getAttribute('aria-checked')).toBe('true');
    expect(document.getElementById('menu-toggle-sync-scroll')?.getAttribute('aria-checked')).toBe('true');
    expect(document.getElementById('menu-toggle-autosave')?.getAttribute('aria-checked')).toBe('true');
    expect(document.getElementById('menu-toggle-format-bar')?.getAttribute('aria-checked')).toBe('true');
    expect(document.getElementById('menu-toggle-centered')?.getAttribute('aria-checked')).toBe('false');
  });

  it('synchronizes dialog form inputs with state on open', () => {
    const callbacks = {
      onToggleWordWrap: vi.fn(),
      onToggleSpellcheck: vi.fn(),
      onToggleAutoSave: vi.fn(),
      onToggleSyncScroll: vi.fn(),
      onToggleFormatBar: vi.fn(),
      onToggleCenteredEditor: vi.fn(),
      onToggleOrientation: vi.fn(),
      onToggleZen: vi.fn(),
      onResetSplit: vi.fn(),
      onSetLineEnding: vi.fn(),
      onSetLanguage: vi.fn(),
      onOpenShortcuts: vi.fn(),
    };

    const ctrl = new SettingsController(() => state, callbacks);
    ctrl.openSettings();

    const wrapInput = document.getElementById('setting-word-wrap') as HTMLInputElement;
    const spellInput = document.getElementById('setting-spellcheck') as HTMLInputElement;
    const crlfBtn = document.querySelector('[data-crlf-choice="CRLF"]');

    expect(wrapInput.checked).toBe(true);
    expect(spellInput.checked).toBe(false);
    expect(crlfBtn?.classList.contains('is-active')).toBe(true);
  });

  it('dispatches callbacks when dialog switches change', () => {
    const callbacks = {
      onToggleWordWrap: vi.fn(),
      onToggleSpellcheck: vi.fn(),
      onToggleAutoSave: vi.fn(),
      onToggleSyncScroll: vi.fn(),
      onToggleFormatBar: vi.fn(),
      onToggleCenteredEditor: vi.fn(),
      onToggleOrientation: vi.fn(),
      onToggleZen: vi.fn(),
      onResetSplit: vi.fn(),
      onSetLineEnding: vi.fn(),
      onSetLanguage: vi.fn(),
      onOpenShortcuts: vi.fn(),
    };

    new SettingsController(() => state, callbacks);

    const spellInput = document.getElementById('setting-spellcheck') as HTMLInputElement;
    spellInput.checked = true;
    spellInput.dispatchEvent(new Event('change'));

    expect(callbacks.onToggleSpellcheck).toHaveBeenCalledTimes(1);

    const resetSplitBtn = document.getElementById('btn-reset-split');
    resetSplitBtn?.click();
    expect(callbacks.onResetSplit).toHaveBeenCalledTimes(1);
  });

  it('synchronizes and triggers language choice buttons', () => {
    const callbacks = {
      onToggleWordWrap: vi.fn(),
      onToggleSpellcheck: vi.fn(),
      onToggleAutoSave: vi.fn(),
      onToggleSyncScroll: vi.fn(),
      onToggleFormatBar: vi.fn(),
      onToggleCenteredEditor: vi.fn(),
      onToggleOrientation: vi.fn(),
      onToggleZen: vi.fn(),
      onResetSplit: vi.fn(),
      onSetLineEnding: vi.fn(),
      onSetLanguage: vi.fn(),
      onOpenShortcuts: vi.fn(),
    };

    const ctrl = new SettingsController(() => state, callbacks);
    ctrl.openSettings();

    const deBtn = document.querySelector('[data-lang-choice="de"]');
    const enBtn = document.querySelector<HTMLButtonElement>('[data-lang-choice="en"]');

    expect(deBtn?.classList.contains('is-active')).toBe(true);
    expect(enBtn?.classList.contains('is-active')).toBe(false);

    enBtn?.click();
    expect(callbacks.onSetLanguage).toHaveBeenCalledWith('en');
  });
});
