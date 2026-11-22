import { getThemeChoice, setThemeChoice, toggleTheme, ThemeChoice } from './theme';
import { Language } from './i18n';

export interface SettingsState {
  wordWrap: boolean;
  spellcheck: boolean;
  autoSave: boolean;
  syncScroll: boolean;
  formatBarVisible: boolean;
  centeredEditor: boolean;
  lineEnding: 'CRLF' | 'LF';
  language: Language;
}

export interface SettingsCallbacks {
  onToggleWordWrap: () => void;
  onToggleSpellcheck: () => void;
  onToggleAutoSave: () => void;
  onToggleSyncScroll: () => void;
  onToggleFormatBar: () => void;
  onToggleCenteredEditor: () => void;
  onToggleOrientation: () => void;
  onToggleZen: () => void;
  onResetSplit: () => void;
  onSetLineEnding: (eol: 'CRLF' | 'LF') => void;
  onSetLanguage: (lang: Language) => void;
  onOpenShortcuts: () => void;
}

export class SettingsController {
  private dialog: HTMLDialogElement | null = null;
  private viewPopover: HTMLElement | null = null;
  private callbacks: SettingsCallbacks;
  private getState: () => SettingsState;

  constructor(getState: () => SettingsState, callbacks: SettingsCallbacks) {
    this.getState = getState;
    this.callbacks = callbacks;
    this.init();
  }

  private init(): void {
    this.dialog = document.getElementById('settings-dialog') as HTMLDialogElement | null;
    this.viewPopover = document.getElementById('view-popover');

    this.bindViewMenu();
    this.bindSettingsDialog();
  }

  public openSettings(): void {
    if (!this.dialog) return;
    this.syncDialogValues();
    try {
      this.dialog.showModal();
    } catch {
      // dialog may already be open
    }
  }

  public closeSettings(): void {
    this.dialog?.close();
  }

  public syncAll(): void {
    this.syncViewMenu();
    if (this.dialog && this.dialog.open) {
      this.syncDialogValues();
    }
  }

  public syncViewMenu(): void {
    const state = this.getState();
    const setChecked = (id: string, checked: boolean) => {
      const el = document.getElementById(id);
      if (el) {
        el.setAttribute('aria-checked', String(checked));
      }
    };

    setChecked('menu-toggle-word-wrap', state.wordWrap);
    setChecked('menu-toggle-sync-scroll', state.syncScroll);
    setChecked('menu-toggle-autosave', state.autoSave);
    setChecked('menu-toggle-format-bar', state.formatBarVisible);
    setChecked('menu-toggle-centered', state.centeredEditor);
  }

  public syncDialogValues(): void {
    if (!this.dialog) return;
    const state = this.getState();

    // Theme segmented buttons
    const currentTheme = getThemeChoice();
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach((btn) => {
      const isSelected = btn.dataset.themeChoice === currentTheme;
      btn.classList.toggle('is-active', isSelected);
      btn.setAttribute('aria-pressed', String(isSelected));
    });

    // Language segmented buttons
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-lang-choice]').forEach((btn) => {
      const isSelected = btn.dataset.langChoice === state.language;
      btn.classList.toggle('is-active', isSelected);
      btn.setAttribute('aria-pressed', String(isSelected));
    });

    // Switches
    const setSwitch = (id: string, val: boolean) => {
      const input = document.getElementById(id) as HTMLInputElement | null;
      if (input) input.checked = val;
    };

    setSwitch('setting-word-wrap', state.wordWrap);
    setSwitch('setting-spellcheck', state.spellcheck);
    setSwitch('setting-autosave', state.autoSave);
    setSwitch('setting-sync-scroll', state.syncScroll);
    setSwitch('setting-format-bar', state.formatBarVisible);
    setSwitch('setting-centered-editor', state.centeredEditor);

    // Line ending segmented buttons
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-crlf-choice]').forEach((btn) => {
      const isSelected = btn.dataset.crlfChoice === state.lineEnding;
      btn.classList.toggle('is-active', isSelected);
      btn.setAttribute('aria-pressed', String(isSelected));
    });
  }

  private bindViewMenu(): void {
    if (!this.viewPopover) return;

    const closePopover = () => {
      try {
        this.viewPopover?.hidePopover();
      } catch {}
    };

    const bindItem = (id: string, action: () => void) => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', () => {
          action();
          this.syncAll();
          closePopover();
        });
      }
    };

    bindItem('menu-toggle-word-wrap', () => this.callbacks.onToggleWordWrap());
    bindItem('menu-toggle-sync-scroll', () => this.callbacks.onToggleSyncScroll());
    bindItem('menu-toggle-autosave', () => this.callbacks.onToggleAutoSave());
    bindItem('menu-toggle-format-bar', () => this.callbacks.onToggleFormatBar());
    bindItem('menu-toggle-centered', () => this.callbacks.onToggleCenteredEditor());
    bindItem('menu-toggle-orientation', () => this.callbacks.onToggleOrientation());
    bindItem('menu-toggle-zen', () => this.callbacks.onToggleZen());
    bindItem('menu-toggle-theme', () => toggleTheme());

    // Sync state whenever view popover opens
    this.viewPopover.addEventListener('toggle', (e: Event) => {
      const toggleEvt = e as ToggleEvent;
      if (toggleEvt.newState === 'open') {
        this.syncViewMenu();
      }
    });
  }

  private bindSettingsDialog(): void {
    if (!this.dialog) return;

    this.dialog.addEventListener('close', () => {
      if (this.dialog) {
        this.dialog.returnValue = '';
      }
    });

    // Direct open button in toolbar
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      this.openSettings();
    });

    // Theme segmented buttons
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const choice = btn.dataset.themeChoice as ThemeChoice;
        if (choice) {
          setThemeChoice(choice);
          this.syncDialogValues();
        }
      });
    });

    // Language segmented buttons
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-lang-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const choice = btn.dataset.langChoice as Language;
        if (choice && choice !== this.getState().language) {
          this.callbacks.onSetLanguage(choice);
          this.syncDialogValues();
        }
      });
    });

    // Switches inside dialog
    const bindSwitch = (id: string, onChange: () => void) => {
      const input = document.getElementById(id) as HTMLInputElement | null;
      if (input) {
        input.addEventListener('change', () => {
          onChange();
          this.syncAll();
        });
      }
    };

    bindSwitch('setting-word-wrap', () => this.callbacks.onToggleWordWrap());
    bindSwitch('setting-spellcheck', () => this.callbacks.onToggleSpellcheck());
    bindSwitch('setting-autosave', () => this.callbacks.onToggleAutoSave());
    bindSwitch('setting-sync-scroll', () => this.callbacks.onToggleSyncScroll());
    bindSwitch('setting-format-bar', () => this.callbacks.onToggleFormatBar());
    bindSwitch('setting-centered-editor', () => this.callbacks.onToggleCenteredEditor());

    // Line ending buttons
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-crlf-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const choice = btn.dataset.crlfChoice as 'CRLF' | 'LF';
        if (choice) {
          this.callbacks.onSetLineEnding(choice);
          this.syncDialogValues();
        }
      });
    });

    // Reset split button
    document.getElementById('btn-reset-split')?.addEventListener('click', () => {
      this.callbacks.onResetSplit();
    });

    // Open shortcuts from dialog
    document.getElementById('btn-settings-open-shortcuts')?.addEventListener('click', () => {
      this.closeSettings();
      this.callbacks.onOpenShortcuts();
    });
  }
}
