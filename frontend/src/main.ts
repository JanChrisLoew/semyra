import './styles.css';
import { EditorState } from '@codemirror/state';
import {
  backend,
  DocStats,
  DraftEntry,
  FilePayload,
  FileTreeNode,
  HeadingItem,
  onBackendEvent,
  SearchFileResult,
  UiSessionPrefs,
  WorkspaceFileEntry,
} from './api';
import { FormatAction, MarkdownEditorController } from './editor';
import { bindRovingHorizontalKeyNav, syncRovingTabindex } from './navigation-a11y';
import { CommandPaletteController, PaletteItem } from './palette';
import { safeSetMarkdownHTML } from './sanitizer';
import { SyncScrollController } from './sync-scroll';
import { WELCOME_MARKDOWN } from './welcome';

// Progressive enhancement for Popover API (modern-web-guidance menu)
if (!('popover' in HTMLElement.prototype)) {
  import('@oddbird/popover-polyfill');
}

// Progressive enhancement for declarative Invoker Commands (<button command="show-modal" commandfor="...">)
if (!('commandForElement' in HTMLButtonElement.prototype)) {
  import('invokers-polyfill');
}

// Progressive enhancement fallback for focusgroup="menu nomemory" (modern-web-guidance menu)
if (!('focusGroup' in HTMLElement.prototype)) {
  for (const fg of document.querySelectorAll<HTMLElement>('[focusgroup~="menu"]')) {
    fg.setAttribute('role', 'menu');
    for (const btn of fg.querySelectorAll<HTMLButtonElement>('button')) {
      if (!btn.hasAttribute('role')) {
        btn.setAttribute('role', 'menuitem');
      }
    }
    fg.addEventListener('keydown', (e) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const items = Array.from(fg.querySelectorAll<HTMLButtonElement>('button')).filter(
        (b) => !b.disabled && !b.hidden && b.offsetParent !== null,
      );
      if (items.length === 0) return;
      e.preventDefault();
      const activeIdx = items.indexOf(document.activeElement as HTMLButtonElement);
      let nextIdx = 0;
      if (e.key === 'Home') {
        nextIdx = 0;
      } else if (e.key === 'End') {
        nextIdx = items.length - 1;
      } else if (e.key === 'ArrowDown') {
        nextIdx = activeIdx < 0 ? 0 : (activeIdx + 1) % items.length;
      } else if (e.key === 'ArrowUp') {
        nextIdx = activeIdx <= 0 ? items.length - 1 : activeIdx - 1;
      }
      items[nextIdx]?.focus();
    });
  }
}

// Fallback for <dialog closedby="any"> light-dismiss where native closedBy is absent
if (!('closedBy' in HTMLDialogElement.prototype)) {
  const outside = (e: PointerEvent, dialog: HTMLDialogElement) => {
    const r = dialog.getBoundingClientRect();
    return (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    );
  };
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[closedby="any"]')) {
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (e) => {
      pressedOutside = outside(e, dialog);
    });
    dialog.addEventListener('pointerup', (e) => {
      if (pressedOutside && outside(e, dialog)) dialog.close();
    });
  }
}

interface OpenTab {
  id: string;
  name: string;
  path: string | null;
  parentDir: string | null;
  savedContent: string;
  currentContent: string;
  lineEnding: 'CRLF' | 'LF';
  encoding: string;
  isDirty: boolean;
  editorState: EditorState;
  editorScrollTop: number;
  previewScrollTop: number;
  outline: HeadingItem[];
  stats: DocStats;
}

type EntryDialogMode = 'new-file' | 'new-folder' | 'rename';

interface ContextMenuTarget {
  path: string;
  parentDir: string;
  name: string;
  isDir: boolean;
  isWorkspaceRoot: boolean;
}

function parentDirOfPath(filePath: string): string | null {
  const idx = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
  return idx > 0 ? filePath.slice(0, idx) : null;
}

function baseNameOfPath(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
  return idx >= 0 ? filePath.slice(idx + 1) : filePath;
}

class MarkLiveApp {
  private tabs: OpenTab[] = [];
  private activeTabId = '';
  private untitledCounter = 1;
  private workspaceTree: FileTreeNode | null = null;
  private workspaceFilesCache: WorkspaceFileEntry[] | null = null;

  private editor!: MarkdownEditorController;
  private syncScroll!: SyncScrollController;
  private palette!: CommandPaletteController;

  private splitRatio = 50;
  private zoomPercent = 100;
  private autoSaveEnabled = false;
  private recentFiles: string[] = [];
  private recentFolders: string[] = [];
  private activeHeadingSlug: string | null = null;

  private renderDebounceTimer: number | undefined;
  private autoSaveTimer: number | undefined;
  private draftSyncTimer: number | undefined;
  private prefsSyncTimer: number | undefined;
  private searchDebounceTimer: number | undefined;
  private renderSeq = 0;
  private searchSeq = 0;
  private searchCaseSensitive = false;
  private externalChangedPath: string | null = null;

  private contextTarget: ContextMenuTarget | null = null;
  private entryDialogState: { mode: EntryDialogMode; targetPath: string } = {
    mode: 'new-file',
    targetPath: '',
  };

  // DOM References
  private appEl = document.getElementById('app')!;
  private sidebarEl = document.getElementById('sidebar')!;
  private tabBarEl = document.getElementById('tab-bar')!;
  private previewPaneEl = document.getElementById('preview-pane')!;
  private previewContentEl = document.getElementById('preview-content')!;
  private fileTreeEl = document.getElementById('file-tree-container')!;
  private searchInputEl = document.getElementById('workspace-search-input') as HTMLInputElement;
  private searchResultsEl = document.getElementById('search-results-container')!;
  private outlineEl = document.getElementById('outline-container')!;
  private workspaceTitleEl = document.getElementById('workspace-title')!;
  private statusPathBtn = document.getElementById('status-filepath') as HTMLButtonElement;
  private statusSaveBadge = document.getElementById('status-save-badge')!;
  private statusCursorEl = document.getElementById('status-cursor')!;
  private statusWordsEl = document.getElementById('status-words')!;
  private statusReadtimeEl = document.getElementById('status-readtime')!;
  private statusZoomBtn = document.getElementById('status-zoom') as HTMLButtonElement;
  private statusEolBtn = document.getElementById('status-eol') as HTMLButtonElement;
  private statusEncodingEl = document.getElementById('status-encoding')!;
  private dropOverlayEl = document.getElementById('drop-overlay')!;
  private externalBannerEl = document.getElementById('external-banner')!;
  private contextPopoverEl = document.getElementById('tree-context-menu') as HTMLElement & {
    showPopover?: () => void;
    hidePopover?: () => void;
  };

  public async init(): Promise<void> {
    const cmHost = document.getElementById('codemirror-host')!;
    this.editor = new MarkdownEditorController(cmHost, '', {
      onDocChanged: (content) => this.handleEditorContentChange(content),
      onCursorChanged: (line, col) => {
        this.statusCursorEl.textContent = `Zeile ${line}, Spalte ${col}`;
      },
      onEditorScrolled: () => this.syncScroll.syncEditorToPreview(),
      onFormatCommand: (cmd) => this.editor.applyFormat(cmd),
      onPasteImage: (mimeType, dataUrl) => {
        void this.handlePasteImage(mimeType, dataUrl);
      },
    });

    this.syncScroll = new SyncScrollController({
      appEl: this.appEl,
      previewPaneEl: this.previewPaneEl,
      previewContentEl: this.previewContentEl,
      getEditor: () => this.editor,
      getOutline: () => this.activeTab?.outline ?? [],
      onActiveHeadingChange: (slug) => {
        this.activeHeadingSlug = slug;
        this.highlightCurrentHeadingInOutline();
      },
    });

    this.palette = new CommandPaletteController(
      document.getElementById('palette-dialog') as HTMLDialogElement,
      document.getElementById('palette-input') as HTMLInputElement,
      document.getElementById('palette-results')!,
      {
        getFileItems: () => this.buildPaletteFileItems(),
        getCommandItems: () => this.buildPaletteCommandItems(),
      },
    );

    this.bindCompositeKeyboardNav();
    this.bindUIEvents();
    this.bindThemeSystem();
    this.bindBackendEvents();

    // Restore startup payload (UI prefs, CLI files, last workspace, session tabs, crash drafts)
    try {
      const startup = await backend.getStartup();
      this.applyRestoredUiPrefs(startup.uiPrefs);

      if (startup.initialFolder) {
        await this.loadWorkspaceFolder(startup.initialFolder, false);
      }

      if (startup.initialFiles.length > 0) {
        for (const filePath of startup.initialFiles) {
          await this.openFileByPath(filePath, false);
        }
      } else if (startup.uiPrefs.sessionFiles.length > 0) {
        for (const sessionPath of startup.uiPrefs.sessionFiles) {
          await this.openFileByPath(sessionPath, false);
        }
        if (startup.uiPrefs.activeSessionFile) {
          const lower = startup.uiPrefs.activeSessionFile.toLowerCase();
          const match = this.tabs.find((t) => t.path?.toLowerCase() === lower);
          if (match) {
            this.activateTab(match.id);
          }
        }
      }

      if (startup.recoveredDrafts.length > 0) {
        this.restoreRecoveredDrafts(startup.recoveredDrafts);
      }
    } catch {
      // Fallback to welcome tab
    }

    if (!this.workspaceTree) {
      this.renderEmptySidebarWithRecents();
    }

    if (this.tabs.length === 0) {
      this.createNewTab('Willkommen.md', WELCOME_MARKDOWN, false);
    }
  }

  private get activeTab(): OpenTab | undefined {
    return this.tabs.find((t) => t.id === this.activeTabId);
  }

  private bindCompositeKeyboardNav(): void {
    bindRovingHorizontalKeyNav(this.tabBarEl, {
      itemSelector: 'button[role="tab"]',
      activateOnFocus: false,
    });
    bindRovingHorizontalKeyNav(document.getElementById('sidebar-tabs')!, {
      itemSelector: 'button[role="tab"]',
      activateOnFocus: true,
    });
    bindRovingHorizontalKeyNav(document.getElementById('format-bar')!, {
      itemSelector: 'button.fmt-btn',
      activateOnFocus: false,
    });
  }

  // ==========================================================================
  // Preferences, Recent History & Zoom Management
  // ==========================================================================

  private applyRestoredUiPrefs(prefs: UiSessionPrefs): void {
    this.setSplitRatio(prefs.splitRatio || 50, false);
    this.setZoomPercent(prefs.zoomPercent || 100, false);

    this.syncScroll.setEnabled(prefs.syncScroll);
    const syncBtn = document.getElementById('btn-sync-scroll')!;
    syncBtn.classList.toggle('is-active', prefs.syncScroll);
    syncBtn.setAttribute('aria-pressed', String(prefs.syncScroll));

    this.autoSaveEnabled = prefs.autoSave;
    const autoBtn = document.getElementById('btn-autosave')!;
    autoBtn.classList.toggle('is-active', prefs.autoSave);
    autoBtn.setAttribute('aria-pressed', String(prefs.autoSave));

    this.editor.setWordWrap(prefs.wordWrap);
    const wrapBtn = document.getElementById('btn-word-wrap')!;
    wrapBtn.classList.toggle('is-active', prefs.wordWrap);
    wrapBtn.setAttribute('aria-pressed', String(prefs.wordWrap));

    this.editor.setSpellcheck(prefs.spellcheck);

    this.recentFiles = prefs.recentFiles ?? [];
    this.recentFolders = prefs.recentFolders ?? [];
  }

  private setSplitRatio(pct: number, persist = true): void {
    const clamped = Math.max(20, Math.min(80, pct));
    this.splitRatio = clamped;
    document.documentElement.style.setProperty('--split-ratio', `${clamped.toFixed(2)}%`);
    document.getElementById('split-resizer')?.setAttribute('aria-valuenow', String(Math.round(clamped)));
    if (persist) {
      this.schedulePrefsSave();
    }
  }

  private setZoomPercent(pct: number, persist = true): void {
    const clamped = Math.max(75, Math.min(175, Math.round(pct / 5) * 5));
    this.zoomPercent = clamped;
    document.documentElement.style.setProperty('--doc-zoom', String(clamped / 100));
    this.statusZoomBtn.textContent = `${clamped}%`;
    if (persist) {
      this.schedulePrefsSave();
    }
  }

  private pushRecentFile(filePath: string): void {
    const lower = filePath.toLowerCase();
    this.recentFiles = [
      filePath,
      ...this.recentFiles.filter((p) => p.toLowerCase() !== lower),
    ].slice(0, 12);
    if (!this.workspaceTree) {
      this.renderEmptySidebarWithRecents();
    }
  }

  private pushRecentFolder(folderPath: string): void {
    const lower = folderPath.toLowerCase();
    this.recentFolders = [
      folderPath,
      ...this.recentFolders.filter((p) => p.toLowerCase() !== lower),
    ].slice(0, 8);
  }

  private buildCurrentUiPrefs(): UiSessionPrefs {
    const sessionFiles = this.tabs
      .map((t) => t.path)
      .filter((p): p is string => Boolean(p));
    return {
      splitRatio: this.splitRatio,
      zoomPercent: this.zoomPercent,
      syncScroll: this.syncScroll.isEnabled(),
      autoSave: this.autoSaveEnabled,
      wordWrap: this.editor.isWordWrapEnabled(),
      spellcheck: this.editor.isSpellcheckEnabled(),
      recentFiles: this.recentFiles,
      recentFolders: this.recentFolders,
      sessionFiles,
      activeSessionFile: this.activeTab?.path ?? null,
    };
  }

  private schedulePrefsSave(): void {
    window.clearTimeout(this.prefsSyncTimer);
    this.prefsSyncTimer = window.setTimeout(() => {
      void backend.saveUiPrefs(this.buildCurrentUiPrefs()).catch(() => {});
    }, 350);
  }

  // ==========================================================================
  // Quick-Open & Command Palette Items
  // ==========================================================================

  private async buildPaletteFileItems(): Promise<PaletteItem[]> {
    const items: PaletteItem[] = [];
    const seenPaths = new Set<string>();

    for (const tab of this.tabs) {
      if (tab.path) {
        seenPaths.add(tab.path.toLowerCase());
      }
      items.push({
        id: `tab:${tab.id}`,
        kind: 'tab',
        label: tab.name,
        subtitle: tab.path ?? 'Ungespeicherter Tab',
        badge: tab.id === this.activeTabId ? 'Aktiv' : 'Geöffnet',
        run: () => this.activateTab(tab.id),
      });
    }

    if (this.workspaceTree) {
      if (!this.workspaceFilesCache) {
        try {
          const res = await backend.listWorkspaceFiles(this.workspaceTree.path);
          this.workspaceFilesCache = res.files;
        } catch {
          this.workspaceFilesCache = [];
        }
      }
      for (const f of this.workspaceFilesCache) {
        const lower = f.path.toLowerCase();
        if (seenPaths.has(lower)) continue;
        seenPaths.add(lower);
        items.push({
          id: `ws:${f.path}`,
          kind: 'file',
          label: f.name,
          subtitle: f.relPath,
          badge: 'Arbeitsordner',
          run: () => this.openFileByPath(f.path),
        });
      }
    }

    for (const recentPath of this.recentFiles) {
      const lower = recentPath.toLowerCase();
      if (seenPaths.has(lower)) continue;
      seenPaths.add(lower);
      items.push({
        id: `recent:${recentPath}`,
        kind: 'recent',
        label: baseNameOfPath(recentPath),
        subtitle: recentPath,
        badge: 'Zuletzt geöffnet',
        run: () => this.openFileByPath(recentPath),
      });
    }

    for (const folderPath of this.recentFolders) {
      if (this.workspaceTree?.path.toLowerCase() === folderPath.toLowerCase()) continue;
      items.push({
        id: `folder:${folderPath}`,
        kind: 'folder',
        label: baseNameOfPath(folderPath),
        subtitle: folderPath,
        badge: 'Ordnerverlauf',
        run: async () => {
          await this.loadWorkspaceFolder(folderPath);
          this.switchSidebarPanel('files');
        },
      });
    }

    return items;
  }

  private buildPaletteCommandItems(): PaletteItem[] {
    const wrapActive = this.editor.isWordWrapEnabled();
    const spellActive = this.editor.isSpellcheckEnabled();
    const syncActive = this.syncScroll.isEnabled();
    const autoActive = this.autoSaveEnabled;
    const currentEol = this.activeTab?.lineEnding ?? 'CRLF';

    return [
      {
        id: 'cmd:new-tab',
        kind: 'command',
        label: 'Datei: Neues Markdown-Dokument',
        shortcut: 'Strg+N',
        run: () => this.createNewTab(),
      },
      {
        id: 'cmd:open-file',
        kind: 'command',
        label: 'Datei: Markdown-Datei öffnen…',
        shortcut: 'Strg+O',
        run: () => this.triggerOpenFilesDialog(),
      },
      {
        id: 'cmd:open-folder',
        kind: 'command',
        label: 'Arbeitsbereich: Ordner öffnen…',
        shortcut: 'Strg+Umschalt+O',
        run: () => this.triggerOpenFolderDialog(),
      },
      {
        id: 'cmd:save',
        kind: 'command',
        label: 'Datei: Speichern',
        shortcut: 'Strg+S',
        run: () => {
          if (this.activeTab) void this.saveTab(this.activeTab, false);
        },
      },
      {
        id: 'cmd:save-as',
        kind: 'command',
        label: 'Datei: Speichern unter…',
        shortcut: 'Strg+Umschalt+S',
        run: () => {
          if (this.activeTab) void this.saveTab(this.activeTab, true);
        },
      },
      {
        id: 'cmd:export-html',
        kind: 'command',
        label: 'Export: Als eigenständige HTML-Datei exportieren…',
        run: () => this.exportCurrentTabHtml(),
      },
      {
        id: 'cmd:print',
        kind: 'command',
        label: 'Export: Drucken / Als PDF speichern…',
        shortcut: 'Strg+P',
        run: () => window.print(),
      },
      {
        id: 'cmd:view-split',
        kind: 'command',
        label: 'Ansicht: Split-Vorschau (Editor & Live-Vorschau)',
        shortcut: 'Alt+2',
        run: () => this.setViewMode('split'),
      },
      {
        id: 'cmd:view-editor',
        kind: 'command',
        label: 'Ansicht: Nur Editor',
        shortcut: 'Alt+1',
        run: () => this.setViewMode('editor'),
      },
      {
        id: 'cmd:view-preview',
        kind: 'command',
        label: 'Ansicht: Nur Lese-Vorschau',
        shortcut: 'Alt+3',
        run: () => this.setViewMode('preview'),
      },
      {
        id: 'cmd:toggle-wrap',
        kind: 'command',
        label: `Editor: Zeilenumbruch ${wrapActive ? 'deaktivieren' : 'aktivieren'}`,
        badge: wrapActive ? 'Aktiv' : 'Aus',
        shortcut: 'Alt+Z',
        run: () => this.toggleWordWrap(),
      },
      {
        id: 'cmd:toggle-spellcheck',
        kind: 'command',
        label: `Editor: Rechtschreibprüfung ${spellActive ? 'deaktivieren' : 'aktivieren'}`,
        badge: spellActive ? 'Aktiv' : 'Aus',
        run: () => {
          this.editor.setSpellcheck(!spellActive);
          this.schedulePrefsSave();
        },
      },
      {
        id: 'cmd:toggle-sync-scroll',
        kind: 'command',
        label: `Vorschau: Synchronisiertes Scrollen ${syncActive ? 'ausschalten' : 'einschalten'}`,
        badge: syncActive ? 'Aktiv' : 'Aus',
        run: () => this.toggleSyncScroll(),
      },
      {
        id: 'cmd:toggle-autosave',
        kind: 'command',
        label: `Datei: Auto-Save ${autoActive ? 'ausschalten' : 'einschalten'}`,
        badge: autoActive ? 'Aktiv' : 'Aus',
        run: () => this.toggleAutoSave(),
      },
      {
        id: 'cmd:toggle-eol',
        kind: 'command',
        label: `Dokument: Zeilenenden auf ${currentEol === 'CRLF' ? 'LF (Unix)' : 'CRLF (Windows)'} umstellen`,
        badge: currentEol,
        run: () => this.toggleActiveTabLineEnding(),
      },
      {
        id: 'cmd:zoom-in',
        kind: 'command',
        label: 'Ansicht: Dokument vergrößern (Zoom +)',
        shortcut: 'Strg++',
        run: () => this.setZoomPercent(this.zoomPercent + 10),
      },
      {
        id: 'cmd:zoom-out',
        kind: 'command',
        label: 'Ansicht: Dokument verkleinern (Zoom -)',
        shortcut: 'Strg+-',
        run: () => this.setZoomPercent(this.zoomPercent - 10),
      },
      {
        id: 'cmd:zoom-reset',
        kind: 'command',
        label: 'Ansicht: Dokument-Zoom auf 100 % zurücksetzen',
        shortcut: 'Strg+0',
        run: () => this.setZoomPercent(100),
      },
      {
        id: 'cmd:search-workspace',
        kind: 'command',
        label: 'Suche: Volltextsuche im Arbeitsordner öffnen',
        shortcut: 'Strg+Umschalt+F',
        run: () => this.switchSidebarPanel('search'),
      },
      {
        id: 'cmd:outline',
        kind: 'command',
        label: 'Navigation: Dokument-Gliederung (Inhaltsverzeichnis) anzeigen',
        run: () => this.switchSidebarPanel('outline'),
      },
      {
        id: 'cmd:zen',
        kind: 'command',
        label: 'Ansicht: Zen-Fokusmodus umschalten',
        shortcut: 'F11',
        run: () => this.appEl.classList.toggle('is-zen'),
      },
      {
        id: 'cmd:theme',
        kind: 'command',
        label: 'Darstellung: Hell-/Dunkel-Design umschalten',
        run: () => document.getElementById('btn-theme-toggle')?.click(),
      },
      {
        id: 'cmd:reveal',
        kind: 'command',
        label: 'Windows: Aktuelle Datei im Explorer anzeigen',
        run: () => {
          const p = this.activeTab?.path ?? this.workspaceTree?.path;
          if (p) void backend.revealInExplorer(p);
        },
      },
      {
        id: 'cmd:shortcuts',
        kind: 'command',
        label: 'Hilfe: Tastenkürzel-Übersicht anzeigen',
        shortcut: 'F1',
        run: () => (document.getElementById('shortcuts-dialog') as HTMLDialogElement).showModal(),
      },
    ];
  }

  // ==========================================================================
  // Crash-Recovery Draft Persistence & Image Insertion
  // ==========================================================================

  private restoreRecoveredDrafts(drafts: DraftEntry[]): void {
    for (const draft of drafts) {
      if (draft.path) {
        const normLower = draft.path.toLowerCase();
        const existing = this.tabs.find((t) => t.path?.toLowerCase() === normLower);
        if (existing) {
          existing.currentContent = draft.content;
          existing.isDirty = draft.content !== existing.savedContent;
          existing.editorState = this.editor.createState(draft.content);
          if (existing.id === this.activeTabId) {
            this.editor.swapState(existing.editorState, 0);
          }
          continue;
        }
      }

      const id = crypto.randomUUID();
      const tab: OpenTab = {
        id,
        name: draft.name || `Unbenannt-${this.untitledCounter++}.md`,
        path: draft.path,
        parentDir: draft.parentDir ?? this.workspaceTree?.path ?? null,
        savedContent: draft.savedContent,
        currentContent: draft.content,
        lineEnding: draft.lineEnding === 'LF' ? 'LF' : 'CRLF',
        encoding: 'UTF-8',
        isDirty: true,
        editorState: this.editor.createState(draft.content),
        editorScrollTop: 0,
        previewScrollTop: 0,
        outline: [],
        stats: { words: 0, chars: 0, lines: 1, readingTimeSec: 0 },
      };
      this.tabs.push(tab);
    }

    if (this.tabs.length > 0) {
      this.activateTab(this.tabs[this.tabs.length - 1].id);
      this.statusSaveBadge.textContent = 'Entwurf wiederhergestellt';
    }
  }

  private scheduleDraftSync(): void {
    window.clearTimeout(this.draftSyncTimer);
    this.draftSyncTimer = window.setTimeout(() => {
      const dirtyEntries: DraftEntry[] = this.tabs
        .filter((t) => t.isDirty)
        .map((t) => ({
          name: t.name,
          path: t.path,
          parentDir: t.parentDir,
          content: t.currentContent,
          savedContent: t.savedContent,
          lineEnding: t.lineEnding,
        }));
      void backend.saveDrafts(dirtyEntries).catch(() => {});
    }, 1100);
  }

  private async handlePasteImage(mimeType: string, dataUrl: string): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;
    const targetBaseDir = tab.parentDir ?? this.workspaceTree?.path ?? null;
    try {
      const res = await backend.savePastedImage(targetBaseDir, mimeType, dataUrl);
      this.editor.insertSnippet(res.markdownSnippet);
      if (this.workspaceTree) {
        void this.refreshWorkspaceTree();
      }
    } catch (err) {
      console.error('Bild aus Zwischenablage konnte nicht gespeichert werden:', err);
    }
  }

  private async handleDroppedImages(imagePaths: string[]): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;
    const targetBaseDir = tab.parentDir ?? this.workspaceTree?.path ?? null;
    const snippets: string[] = [];

    for (const imgPath of imagePaths) {
      try {
        const res = await backend.importDroppedImage(targetBaseDir, imgPath);
        snippets.push(res.markdownSnippet);
      } catch (err) {
        console.error('Bild konnte nicht importiert werden:', err);
      }
    }

    if (snippets.length > 0) {
      this.editor.insertSnippet(snippets.join('\n'));
      if (this.workspaceTree) {
        void this.refreshWorkspaceTree();
      }
    }
  }

  // ==========================================================================
  // Tab & File Lifecycle
  // ==========================================================================

  private createNewTab(name?: string, initialContent = '', markDirty = false): void {
    this.persistActiveTabScrollAndState();

    const tabName = name ?? `Unbenannt-${this.untitledCounter++}.md`;
    const id = crypto.randomUUID();
    const state = this.editor.createState(initialContent);

    const newTab: OpenTab = {
      id,
      name: tabName,
      path: null,
      parentDir: this.workspaceTree?.path ?? null,
      savedContent: markDirty ? '' : initialContent,
      currentContent: initialContent,
      lineEnding: 'CRLF',
      encoding: 'UTF-8',
      isDirty: markDirty,
      editorState: state,
      editorScrollTop: 0,
      previewScrollTop: 0,
      outline: [],
      stats: { words: 0, chars: 0, lines: 1, readingTimeSec: 0 },
    };

    this.tabs.push(newTab);
    this.activateTab(id);
    if (markDirty) {
      this.scheduleDraftSync();
    }
  }

  private persistActiveTabScrollAndState(): void {
    const current = this.activeTab;
    if (!current) return;
    current.editorState = this.editor.view.state;
    current.editorScrollTop = this.editor.view.scrollDOM.scrollTop;
    current.previewScrollTop = this.previewPaneEl.scrollTop;
  }

  private activateTab(tabId: string): void {
    if (this.activeTabId && this.activeTabId !== tabId) {
      this.persistActiveTabScrollAndState();
    }
    const target = this.tabs.find((t) => t.id === tabId);
    if (!target) return;

    this.activeTabId = tabId;
    this.externalBannerEl.hidden = true;
    this.editor.swapState(target.editorState, target.editorScrollTop);

    this.renderTabBar();
    this.highlightActiveFileInTree();
    this.updateStatusBar();
    this.syncWindowMetadata();
    this.schedulePrefsSave();

    void this.renderPreviewImmediate(
      target.currentContent,
      target.parentDir ?? this.workspaceTree?.path ?? null,
      target.previewScrollTop,
    );
  }

  private async openFileByPath(path: string, persistPrefs = true): Promise<void> {
    const normLower = path.toLowerCase();
    const existing = this.tabs.find((t) => t.path?.toLowerCase() === normLower);
    if (existing) {
      this.activateTab(existing.id);
      return;
    }

    try {
      const payload = await backend.readFile(path);
      this.openTabFromPayload(payload, persistPrefs);
    } catch (err) {
      console.error('Datei konnte nicht geöffnet werden:', err);
    }
  }

  private openTabFromPayload(payload: FilePayload, persistPrefs = true): void {
    const normLower = payload.path.toLowerCase();
    const existing = this.tabs.find((t) => t.path?.toLowerCase() === normLower);
    if (existing) {
      this.activateTab(existing.id);
      return;
    }

    // Replace untouched single welcome/empty untitled tab cleanly
    if (
      this.tabs.length === 1 &&
      this.tabs[0].path === null &&
      !this.tabs[0].isDirty
    ) {
      this.tabs = [];
      this.activeTabId = '';
    } else {
      this.persistActiveTabScrollAndState();
    }

    this.pushRecentFile(payload.path);

    const id = crypto.randomUUID();
    const tab: OpenTab = {
      id,
      name: payload.name,
      path: payload.path,
      parentDir: payload.parentDir,
      savedContent: payload.content,
      currentContent: payload.content,
      lineEnding: payload.lineEnding,
      encoding: payload.encoding || 'UTF-8',
      isDirty: false,
      editorState: this.editor.createState(payload.content),
      editorScrollTop: 0,
      previewScrollTop: 0,
      outline: [],
      stats: { words: 0, chars: 0, lines: 1, readingTimeSec: 0 },
    };

    this.tabs.push(tab);
    this.activateTab(id);
    if (persistPrefs) {
      this.schedulePrefsSave();
    }
  }

  private async saveTab(tab: OpenTab, forceSaveAs = false): Promise<boolean> {
    if (!tab.path || forceSaveAs) {
      const res = await backend.saveFileDialog(
        tab.currentContent,
        tab.name,
        tab.parentDir ?? this.workspaceTree?.path ?? null,
        tab.lineEnding,
      );
      if (!res.saved || !res.path) return false;
      tab.path = res.path;
      tab.name = res.name ?? tab.name;
      tab.parentDir = res.parentDir ?? tab.parentDir;
    } else {
      await backend.writeFile(tab.path, tab.currentContent, tab.lineEnding);
    }

    tab.savedContent = tab.currentContent;
    tab.encoding = 'UTF-8';
    tab.isDirty = false;
    this.pushRecentFile(tab.path);
    this.workspaceFilesCache = null;

    this.renderTabBar();
    this.updateStatusBar();
    this.syncWindowMetadata();
    this.scheduleDraftSync();
    this.schedulePrefsSave();

    if (this.workspaceTree) {
      void this.refreshWorkspaceTree();
    }
    return true;
  }

  private toggleActiveTabLineEnding(): void {
    const tab = this.activeTab;
    if (!tab) return;
    tab.lineEnding = tab.lineEnding === 'CRLF' ? 'LF' : 'CRLF';
    if (tab.path) {
      tab.isDirty = true;
      this.renderTabBar();
      this.syncWindowMetadata();
      this.scheduleDraftSync();
    }
    this.updateStatusBar();
  }

  private async requestCloseTab(tabId: string): Promise<void> {
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const tab = this.tabs[idx];

    if (tab.isDirty) {
      const choice = await this.promptUnsavedChanges(
        `Möchtest du die Änderungen in „${tab.name}“ speichern?`,
      );
      if (choice === 'cancel') return;
      if (choice === 'save') {
        const saved = await this.saveTab(tab);
        if (!saved) return;
      }
    }

    this.tabs.splice(idx, 1);
    if (this.tabs.length === 0) {
      this.createNewTab();
    } else if (this.activeTabId === tabId) {
      const nextTab = this.tabs[Math.min(idx, this.tabs.length - 1)];
      this.activateTab(nextTab.id);
    } else {
      this.renderTabBar();
    }
    this.syncWindowMetadata();
    this.scheduleDraftSync();
    this.schedulePrefsSave();
  }

  // ==========================================================================
  // Live Markdown Rendering
  // ==========================================================================

  private handleEditorContentChange(content: string): void {
    const tab = this.activeTab;
    if (!tab) return;

    tab.currentContent = content;
    const nextDirty = content !== tab.savedContent;
    if (tab.isDirty !== nextDirty) {
      tab.isDirty = nextDirty;
      this.renderTabBar();
      this.syncWindowMetadata();
    }
    this.updateStatusBar();
    this.scheduleDraftSync();

    window.clearTimeout(this.renderDebounceTimer);
    this.renderDebounceTimer = window.setTimeout(() => {
      void this.renderPreviewImmediate(
        content,
        tab.parentDir ?? this.workspaceTree?.path ?? null,
      );
    }, 35);

    if (this.autoSaveEnabled && tab.path && tab.isDirty) {
      window.clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = window.setTimeout(() => {
        void this.saveTab(tab);
      }, 900);
    }
  }

  private async renderPreviewImmediate(
    markdown: string,
    baseDir: string | null,
    restoreScrollTop?: number,
  ): Promise<void> {
    const seq = ++this.renderSeq;
    try {
      const res = await backend.renderMarkdown(markdown, baseDir);
      if (seq !== this.renderSeq) return;

      const tab = this.activeTab;
      if (tab) {
        tab.outline = res.outline;
        tab.stats = res.stats;
      }

      await safeSetMarkdownHTML(this.previewContentEl, res.html);
      this.renderOutline(res.outline);
      this.updateStatusBar();

      if (typeof restoreScrollTop === 'number') {
        this.previewPaneEl.scrollTop = restoreScrollTop;
      }
      this.syncScroll.updateActiveHeadingFromViewport();
    } catch (err) {
      console.error('Markdown-Rendering fehlgeschlagen:', err);
    }
  }

  // ==========================================================================
  // Workspace Explorer, Recent History, Search & Outline
  // ==========================================================================

  private switchSidebarPanel(panel: 'files' | 'search' | 'outline'): void {
    this.sidebarEl.classList.remove('is-collapsed');
    const sidebarTabs = document.getElementById('sidebar-tabs')!;
    let activeBtn: HTMLButtonElement | null = null;
    for (const b of sidebarTabs.querySelectorAll<HTMLButtonElement>('[data-sidebar-panel]')) {
      const active = b.dataset.sidebarPanel === panel;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', String(active));
      if (active) activeBtn = b;
    }
    syncRovingTabindex(sidebarTabs, 'button[role="tab"]', activeBtn);

    document.getElementById('panel-files')!.hidden = panel !== 'files';
    document.getElementById('panel-search')!.hidden = panel !== 'search';
    document.getElementById('panel-outline')!.hidden = panel !== 'outline';

    if (panel === 'search') {
      this.searchInputEl.focus();
      this.searchInputEl.select();
      if (this.searchInputEl.value.trim()) {
        void this.runWorkspaceSearch();
      }
    }
  }

  private renderEmptySidebarWithRecents(): void {
    if (this.workspaceTree) return;
    this.fileTreeEl.replaceChildren();

    const wrap = document.createElement('div');
    wrap.className = 'empty-sidebar-state';

    const p = document.createElement('p');
    p.textContent = 'Öffne einen Ordner oder ziehe Dateien per Drag & Drop in das Fenster.';

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'secondary-action-btn';
    openBtn.textContent = 'Ordner auswählen…';
    openBtn.addEventListener('click', () => {
      void this.triggerOpenFolderDialog();
    });

    wrap.append(p, openBtn);

    if (this.recentFolders.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'recent-section';
      const h = document.createElement('h3');
      h.className = 'recent-heading';
      h.textContent = 'Zuletzt geöffnete Ordner';
      sec.appendChild(h);

      for (const folderPath of this.recentFolders.slice(0, 5)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'recent-entry-btn';
        btn.title = folderPath;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'recent-entry-name';
        nameSpan.textContent = `📁 ${baseNameOfPath(folderPath)}`;

        const pathSpan = document.createElement('span');
        pathSpan.className = 'recent-entry-path';
        pathSpan.textContent = folderPath;

        btn.append(nameSpan, pathSpan);
        btn.addEventListener('click', () => {
          void this.loadWorkspaceFolder(folderPath);
        });
        sec.appendChild(btn);
      }
      wrap.appendChild(sec);
    }

    if (this.recentFiles.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'recent-section';
      const h = document.createElement('h3');
      h.className = 'recent-heading';
      h.textContent = 'Zuletzt geöffnete Dateien';
      sec.appendChild(h);

      for (const filePath of this.recentFiles.slice(0, 6)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'recent-entry-btn';
        btn.title = filePath;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'recent-entry-name';
        nameSpan.textContent = `📝 ${baseNameOfPath(filePath)}`;

        const pathSpan = document.createElement('span');
        pathSpan.className = 'recent-entry-path';
        pathSpan.textContent = parentDirOfPath(filePath) ?? filePath;

        btn.append(nameSpan, pathSpan);
        btn.addEventListener('click', () => {
          void this.openFileByPath(filePath);
        });
        sec.appendChild(btn);
      }
      wrap.appendChild(sec);
    }

    this.fileTreeEl.appendChild(wrap);
  }

  private async runWorkspaceSearch(): Promise<void> {
    const query = this.searchInputEl.value.trim();
    if (!this.workspaceTree) {
      this.searchResultsEl.replaceChildren();
      const hint = document.createElement('p');
      hint.className = 'muted-hint';
      hint.textContent = 'Bitte öffne zuerst einen Arbeitsordner (Strg+Umschalt+O).';
      this.searchResultsEl.appendChild(hint);
      return;
    }

    if (!query) {
      this.searchResultsEl.replaceChildren();
      const hint = document.createElement('p');
      hint.className = 'muted-hint';
      hint.textContent =
        'Suchbegriff eingeben, um alle Markdown-Dateien im Ordner zu durchsuchen.';
      this.searchResultsEl.appendChild(hint);
      return;
    }

    const seq = ++this.searchSeq;
    try {
      const { results } = await backend.searchWorkspace(
        this.workspaceTree.path,
        query,
        this.searchCaseSensitive,
      );
      if (seq !== this.searchSeq) return;
      this.renderSearchResults(results);
    } catch (err) {
      console.error('Ordnersuche fehlgeschlagen:', err);
    }
  }

  private renderSearchResults(results: SearchFileResult[]): void {
    this.searchResultsEl.replaceChildren();
    if (results.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'muted-hint';
      hint.textContent = 'Keine Treffer gefunden.';
      this.searchResultsEl.appendChild(hint);
      return;
    }

    const totalHits = results.reduce((acc, f) => acc + f.matches.length, 0);
    const summary = document.createElement('div');
    summary.className = 'search-summary';
    summary.textContent = `${totalHits} Treffer in ${results.length} ${results.length === 1 ? 'Datei' : 'Dateien'}`;
    this.searchResultsEl.appendChild(summary);

    for (const fileRes of results) {
      const group = document.createElement('div');
      group.className = 'search-file-group';

      const header = document.createElement('div');
      header.className = 'search-file-header';
      header.title = fileRes.path;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'search-file-name';
      nameSpan.textContent = fileRes.relPath || fileRes.name;

      const countSpan = document.createElement('span');
      countSpan.className = 'search-hit-count';
      countSpan.textContent = String(fileRes.matches.length);

      header.append(nameSpan, countSpan);
      group.appendChild(header);

      for (const match of fileRes.matches) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'search-match-btn';
        btn.title = `Zeile ${match.line}, Spalte ${match.column}`;

        const lineBadge = document.createElement('span');
        lineBadge.className = 'search-line-badge';
        lineBadge.textContent = `${match.line}:`;

        const previewSpan = document.createElement('span');
        previewSpan.className = 'search-match-preview';
        previewSpan.textContent = match.preview;

        btn.append(lineBadge, previewSpan);
        btn.addEventListener('click', async () => {
          await this.openFileByPath(fileRes.path);
          requestAnimationFrame(() => {
            this.editor.jumpToLine(match.line);
          });
        });
        group.appendChild(btn);
      }

      this.searchResultsEl.appendChild(group);
    }
  }

  private async loadWorkspaceFolder(path: string, persistPrefs = true): Promise<void> {
    try {
      const tree = await backend.listTree(path);
      this.setWorkspaceTree(tree, persistPrefs);
    } catch (err) {
      console.error('Ordnerbaum konnte nicht geladen werden:', err);
    }
  }

  private async refreshWorkspaceTree(): Promise<void> {
    if (!this.workspaceTree) return;
    await this.loadWorkspaceFolder(this.workspaceTree.path, false);
  }

  private setWorkspaceTree(tree: FileTreeNode, persistPrefs = true): void {
    this.workspaceTree = tree;
    this.workspaceFilesCache = null;
    this.pushRecentFolder(tree.path);
    if (persistPrefs) {
      this.schedulePrefsSave();
    }

    this.workspaceTitleEl.textContent = tree.name;
    this.workspaceTitleEl.title = tree.path;
    document.getElementById('btn-new-folder-file')!.hidden = false;
    document.getElementById('btn-new-subfolder')!.hidden = false;
    document.getElementById('btn-refresh-tree')!.hidden = false;

    this.fileTreeEl.replaceChildren();
    const children = tree.children ?? [];
    if (children.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted-hint';
      p.textContent = 'Keine Markdown-Dateien in diesem Ordner.';
      this.fileTreeEl.appendChild(p);
      return;
    }

    for (const node of children) {
      this.fileTreeEl.appendChild(this.renderTreeNode(node, 0));
    }
    this.highlightActiveFileInTree();
  }

  private renderTreeNode(node: FileTreeNode, depth: number): HTMLElement {
    if (node.isDir) {
      const details = document.createElement('details');
      details.className = 'tree-dir-details';
      if (depth < 1) details.open = true;

      const summary = document.createElement('summary');
      summary.className = 'tree-row';
      summary.dataset.dirpath = node.path;
      summary.dataset.entryname = node.name;
      summary.title = node.path;
      summary.innerHTML = `<span class="tree-chevron">▶</span><span aria-hidden="true">📁</span><span></span>`;
      summary.lastElementChild!.textContent = node.name;
      details.appendChild(summary);

      const childrenBox = document.createElement('div');
      childrenBox.className = 'tree-children';
      for (const child of node.children ?? []) {
        childrenBox.appendChild(this.renderTreeNode(child, depth + 1));
      }
      details.appendChild(childrenBox);
      return details;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tree-row ${node.isMarkdown ? '' : 'is-non-md'}`;
    btn.dataset.filepath = node.path;
    btn.dataset.entryname = node.name;
    btn.title = node.path;
    const icon = node.isMarkdown ? '📝' : '📄';
    btn.innerHTML = `<span aria-hidden="true">${icon}</span><span></span>`;
    btn.lastElementChild!.textContent = node.name;
    btn.addEventListener('click', () => {
      if (node.isMarkdown) {
        void this.openFileByPath(node.path);
      } else {
        void backend.revealInExplorer(node.path);
      }
    });
    return btn;
  }

  private highlightActiveFileInTree(): void {
    const activePath = this.activeTab?.path?.toLowerCase() ?? '';
    const rows = this.fileTreeEl.querySelectorAll<HTMLElement>('.tree-row[data-filepath]');
    for (const row of rows) {
      const p = (row.dataset.filepath ?? '').toLowerCase();
      row.classList.toggle('is-active', Boolean(activePath && p === activePath));
    }
  }

  private renderOutline(outline: HeadingItem[]): void {
    this.outlineEl.replaceChildren();
    if (outline.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'muted-hint';
      hint.textContent = 'Keine Überschriften im Dokument.';
      this.outlineEl.appendChild(hint);
      return;
    }

    for (const item of outline) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `outline-item outline-lvl-${item.level}`;
      btn.dataset.headingSlug = item.slug;
      btn.textContent = item.text || 'Überschrift';
      btn.title = `Zeile ${item.line}: ${item.text}`;
      btn.addEventListener('click', () => {
        this.editor.jumpToLine(item.line);
        const headingEl = this.previewContentEl.querySelector<HTMLElement>(
          `#${CSS.escape(item.slug)}`,
        );
        headingEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      this.outlineEl.appendChild(btn);
    }
    this.highlightCurrentHeadingInOutline();
  }

  private highlightCurrentHeadingInOutline(): void {
    const items = this.outlineEl.querySelectorAll<HTMLButtonElement>('.outline-item');
    for (const btn of items) {
      const isCurrent = Boolean(
        this.activeHeadingSlug && btn.dataset.headingSlug === this.activeHeadingSlug,
      );
      btn.classList.toggle('is-current', isCurrent);
    }
  }

  // ==========================================================================
  // Explorer Context Menu & File/Folder Entry Dialogs
  // ==========================================================================

  private openTreeContextMenu(e: MouseEvent): void {
    if (!this.workspaceTree) return;
    e.preventDefault();

    const row = (e.target as HTMLElement).closest<HTMLElement>('.tree-row');
    if (row?.dataset.filepath) {
      const path = row.dataset.filepath;
      this.contextTarget = {
        path,
        parentDir: parentDirOfPath(path) ?? this.workspaceTree.path,
        name: row.dataset.entryname ?? 'Datei.md',
        isDir: false,
        isWorkspaceRoot: false,
      };
    } else if (row?.dataset.dirpath) {
      const path = row.dataset.dirpath;
      this.contextTarget = {
        path,
        parentDir: path,
        name: row.dataset.entryname ?? 'Ordner',
        isDir: true,
        isWorkspaceRoot: false,
      };
    } else {
      this.contextTarget = {
        path: this.workspaceTree.path,
        parentDir: this.workspaceTree.path,
        name: this.workspaceTree.name,
        isDir: true,
        isWorkspaceRoot: true,
      };
    }

    const renameBtn = document.getElementById('ctx-btn-rename') as HTMLButtonElement;
    const deleteBtn = document.getElementById('ctx-btn-delete') as HTMLButtonElement;
    renameBtn.disabled = this.contextTarget.isWorkspaceRoot;
    deleteBtn.disabled = this.contextTarget.isWorkspaceRoot;

    this.contextPopoverEl.style.left = `${e.clientX}px`;
    this.contextPopoverEl.style.top = `${e.clientY}px`;
    this.contextPopoverEl.showPopover?.();

    requestAnimationFrame(() => {
      const rect = this.contextPopoverEl.getBoundingClientRect();
      const clampedLeft = Math.max(6, Math.min(e.clientX, window.innerWidth - rect.width - 8));
      const clampedTop = Math.max(6, Math.min(e.clientY, window.innerHeight - rect.height - 8));
      this.contextPopoverEl.style.left = `${clampedLeft}px`;
      this.contextPopoverEl.style.top = `${clampedTop}px`;

      const firstItem = this.contextPopoverEl.querySelector<HTMLButtonElement>(
        '[focusgroup~="menu"] > button:not(:disabled)',
      );
      firstItem?.focus();
    });
  }

  private openEntryDialog(
    mode: EntryDialogMode,
    targetPath: string,
    initialValue = '',
  ): void {
    this.entryDialogState = { mode, targetPath };

    const dialog = document.getElementById('new-file-dialog') as HTMLDialogElement;
    const titleEl = document.getElementById('new-file-dialog-title')!;
    const labelEl = document.getElementById('new-file-label')!;
    const inputEl = document.getElementById('new-file-name') as HTMLInputElement;
    const submitBtn = document.getElementById('new-file-submit-btn') as HTMLButtonElement;
    const errorEl = document.getElementById('new-file-error')!;

    errorEl.textContent = '';
    errorEl.classList.remove('is-visible');

    if (mode === 'new-file') {
      titleEl.textContent = 'Neue Markdown-Datei erstellen';
      labelEl.textContent = 'Dateiname';
      inputEl.placeholder = 'z. B. Notizen.md';
      submitBtn.textContent = 'Erstellen';
    } else if (mode === 'new-folder') {
      titleEl.textContent = 'Neuen Unterordner erstellen';
      labelEl.textContent = 'Ordnername';
      inputEl.placeholder = 'z. B. Kapitel-1';
      submitBtn.textContent = 'Erstellen';
    } else {
      titleEl.textContent = 'Element umbenennen';
      labelEl.textContent = 'Neuer Name';
      inputEl.placeholder = '';
      submitBtn.textContent = 'Umbenennen';
    }

    inputEl.value = initialValue;
    dialog.showModal();

    requestAnimationFrame(() => {
      inputEl.focus();
      const dotIdx = initialValue.lastIndexOf('.');
      if (mode === 'rename' && dotIdx > 0) {
        inputEl.setSelectionRange(0, dotIdx);
      } else {
        inputEl.select();
      }
    });
  }

  private async confirmMoveToRecycleBin(target: ContextMenuTarget): Promise<void> {
    const dialog = document.getElementById('delete-dialog') as HTMLDialogElement;
    const desc = document.getElementById('delete-dialog-desc')!;
    desc.textContent = `Möchtest du „${target.name}“ wirklich in den Windows-Papierkorb verschieben?`;

    const confirmed = await new Promise<boolean>((resolve) => {
      const onClose = () => {
        dialog.removeEventListener('close', onClose);
        const val = dialog.returnValue;
        dialog.returnValue = '';
        resolve(val === 'delete');
      };
      dialog.addEventListener('close', onClose);
      dialog.showModal();
    });

    if (!confirmed) return;

    try {
      await backend.deletePath(target.path);
      const lowerTarget = target.path.toLowerCase();
      const prefix = `${lowerTarget}\\`;

      for (let i = this.tabs.length - 1; i >= 0; i--) {
        const t = this.tabs[i];
        if (!t.path) continue;
        const lowerTab = t.path.toLowerCase();
        if (lowerTab === lowerTarget || lowerTab.startsWith(prefix)) {
          if (!t.isDirty) {
            this.tabs.splice(i, 1);
          } else {
            t.path = null;
          }
        }
      }

      if (this.tabs.length === 0) {
        this.createNewTab();
      } else if (!this.tabs.some((t) => t.id === this.activeTabId)) {
        this.activateTab(this.tabs[0].id);
      } else {
        this.renderTabBar();
        this.updateStatusBar();
      }

      await this.refreshWorkspaceTree();
      this.scheduleDraftSync();
      this.schedulePrefsSave();
    } catch (err) {
      console.error('Löschen in Papierkorb fehlgeschlagen:', err);
    }
  }

  // ==========================================================================
  // Chrome, Accessible Sibling Tabs, Status Bar & Dialogs
  // ==========================================================================

  private renderTabBar(): void {
    this.tabBarEl.replaceChildren();
    let activeTabBtn: HTMLButtonElement | null = null;

    for (const tab of this.tabs) {
      const isSelected = tab.id === this.activeTabId;

      const slot = document.createElement('div');
      slot.className = `tab-slot ${isSelected ? 'is-active' : ''}`;
      slot.setAttribute('role', 'presentation');
      slot.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          void this.requestCloseTab(tab.id);
        }
      });

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'tab-select-btn';
      selectBtn.setAttribute('role', 'tab');
      selectBtn.setAttribute('aria-selected', String(isSelected));
      selectBtn.tabIndex = isSelected ? 0 : -1;
      selectBtn.title = tab.path ?? `${tab.name} (Ungespeichert)`;
      selectBtn.addEventListener('click', () => this.activateTab(tab.id));

      const titleSpan = document.createElement('span');
      titleSpan.className = 'tab-title';
      titleSpan.textContent = tab.name;
      selectBtn.appendChild(titleSpan);

      if (tab.isDirty) {
        const dot = document.createElement('span');
        dot.className = 'tab-dirty-dot';
        dot.title = 'Ungespeicherte Änderungen';
        selectBtn.appendChild(dot);
      }

      if (isSelected) {
        activeTabBtn = selectBtn;
      }

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'tab-close-btn';
      closeBtn.setAttribute('aria-label', `${tab.name} schließen`);
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => {
        void this.requestCloseTab(tab.id);
      });

      slot.append(selectBtn, closeBtn);
      this.tabBarEl.appendChild(slot);
    }

    syncRovingTabindex(this.tabBarEl, 'button[role="tab"]', activeTabBtn);
  }

  private updateStatusBar(): void {
    const tab = this.activeTab;
    if (!tab) return;

    this.statusPathBtn.textContent = tab.path ?? tab.name;
    this.statusSaveBadge.textContent = tab.isDirty
      ? 'Ungespeichert'
      : tab.path
        ? 'Gespeichert'
        : 'Entwurf';
    this.statusSaveBadge.classList.toggle('is-dirty', tab.isDirty);

    const { words, readingTimeSec } = tab.stats;
    this.statusWordsEl.textContent = `${words.toLocaleString('de-DE')} ${words === 1 ? 'Wort' : 'Wörter'}`;
    if (readingTimeSec < 60) {
      this.statusReadtimeEl.textContent = `${readingTimeSec} Sek. Lesezeit`;
    } else {
      const mins = Math.ceil(readingTimeSec / 60);
      this.statusReadtimeEl.textContent = `~${mins} Min. Lesezeit`;
    }
    this.statusZoomBtn.textContent = `${this.zoomPercent}%`;
    this.statusEolBtn.textContent = tab.lineEnding;
    this.statusEncodingEl.textContent = tab.encoding;
  }

  private syncWindowMetadata(): void {
    const tab = this.activeTab;
    const anyDirty = this.tabs.some((t) => t.isDirty);
    const dirtyPrefix = tab?.isDirty ? '● ' : '';
    const title = tab ? `${dirtyPrefix}${tab.name} — MarkLive` : 'MarkLive';
    void backend.setWindowState({
      title,
      hasUnsavedChanges: anyDirty,
    });
  }

  private promptUnsavedChanges(
    message: string,
  ): Promise<'save' | 'discard' | 'cancel'> {
    const dialog = document.getElementById('unsaved-dialog') as HTMLDialogElement;
    const desc = document.getElementById('unsaved-dialog-desc')!;
    desc.textContent = message;

    return new Promise((resolve) => {
      const onClose = () => {
        dialog.removeEventListener('close', onClose);
        const val = dialog.returnValue;
        dialog.returnValue = '';
        if (val === 'save' || val === 'discard') {
          resolve(val);
        } else {
          resolve('cancel');
        }
      };
      dialog.addEventListener('close', onClose);
      dialog.showModal();
    });
  }

  // ==========================================================================
  // Dark Mode Toggle (modern-web-guidance dark-mode & dark-mode-toggle)
  // ==========================================================================

  private bindThemeSystem(): void {
    const meta = document.querySelector('meta[name="color-scheme"]') as HTMLMetaElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const syncNativeWindowTheme = (rerenderDiagrams = false) => {
      const content = meta.content;
      const theme =
        content === 'dark' ? 'dark' : content === 'light' ? 'light' : 'system';
      void backend.setWindowState({ theme });
      if (rerenderDiagrams && this.activeTab) {
        void this.renderPreviewImmediate(
          this.activeTab.currentContent,
          this.activeTab.parentDir ?? this.workspaceTree?.path ?? null,
        );
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

  // ==========================================================================
  // View, Toolbar & Global Shortcuts Wiring
  // ==========================================================================

  private setViewMode(mode: 'editor' | 'split' | 'preview'): void {
    this.appEl.setAttribute('data-view', mode);
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-set-view]')) {
      b.classList.toggle('is-active', b.dataset.setView === mode);
    }
    this.syncScroll.updateActiveHeadingFromViewport();
  }

  private toggleWordWrap(): void {
    const next = !this.editor.isWordWrapEnabled();
    this.editor.setWordWrap(next);
    const btn = document.getElementById('btn-word-wrap')!;
    btn.classList.toggle('is-active', next);
    btn.setAttribute('aria-pressed', String(next));
    this.schedulePrefsSave();
  }

  private toggleSyncScroll(): void {
    const next = !this.syncScroll.isEnabled();
    this.syncScroll.setEnabled(next);
    const btn = document.getElementById('btn-sync-scroll')!;
    btn.classList.toggle('is-active', next);
    btn.setAttribute('aria-pressed', String(next));
    this.schedulePrefsSave();
  }

  private toggleAutoSave(): void {
    this.autoSaveEnabled = !this.autoSaveEnabled;
    const btn = document.getElementById('btn-autosave')!;
    btn.classList.toggle('is-active', this.autoSaveEnabled);
    btn.setAttribute('aria-pressed', String(this.autoSaveEnabled));
    this.schedulePrefsSave();
  }

  private async triggerOpenFilesDialog(): Promise<void> {
    const res = await backend.openFilesDialog();
    for (const f of res.files) {
      this.openTabFromPayload(f);
    }
  }

  private async triggerOpenFolderDialog(): Promise<void> {
    const res = await backend.openFolderDialog();
    if (res.tree) {
      this.setWorkspaceTree(res.tree);
      this.switchSidebarPanel('files');
    }
  }

  private exportCurrentTabHtml(): void {
    const tab = this.activeTab;
    if (!tab) return;
    void backend.exportHtmlDialog(
      tab.name,
      tab.currentContent,
      tab.parentDir ?? this.workspaceTree?.path ?? null,
      tab.parentDir ?? this.workspaceTree?.path ?? null,
    );
  }

  private bindUIEvents(): void {
    // Keep unsaved-changes Escape guard in a cancel listener alongside closedby="none"
    document.getElementById('unsaved-dialog')!.addEventListener('cancel', (e) => {
      e.preventDefault();
    });

    document.getElementById('btn-toggle-sidebar')!.addEventListener('click', () => {
      this.sidebarEl.classList.toggle('is-collapsed');
    });

    const newTabFn = () => this.createNewTab();
    document.getElementById('btn-new-tab')!.addEventListener('click', newTabFn);
    document.getElementById('btn-tab-add')!.addEventListener('click', newTabFn);

    document.getElementById('btn-open-file')!.addEventListener('click', () => {
      void this.triggerOpenFilesDialog();
    });

    document.getElementById('btn-open-folder')!.addEventListener('click', () => {
      void this.triggerOpenFolderDialog();
    });
    document.getElementById('btn-sidebar-open-folder')?.addEventListener('click', () => {
      void this.triggerOpenFolderDialog();
    });

    document.getElementById('btn-refresh-tree')!.addEventListener('click', () => {
      void this.refreshWorkspaceTree();
    });

    document.getElementById('btn-new-folder-file')!.addEventListener('click', () => {
      if (!this.workspaceTree) return;
      this.openEntryDialog('new-file', this.workspaceTree.path);
    });

    document.getElementById('btn-new-subfolder')!.addEventListener('click', () => {
      if (!this.workspaceTree) return;
      this.openEntryDialog('new-folder', this.workspaceTree.path);
    });

    this.fileTreeEl.addEventListener('contextmenu', (e) => {
      this.openTreeContextMenu(e);
    });

    this.contextPopoverEl.addEventListener('click', (e) => {
      const actionBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-ctx-action]');
      if (!actionBtn || actionBtn.disabled || !this.contextTarget) return;

      const target = this.contextTarget;
      const action = actionBtn.dataset.ctxAction;
      this.contextPopoverEl.hidePopover?.();

      if (action === 'new-file') {
        this.openEntryDialog('new-file', target.parentDir);
      } else if (action === 'new-folder') {
        this.openEntryDialog('new-folder', target.parentDir);
      } else if (action === 'rename' && !target.isWorkspaceRoot) {
        this.openEntryDialog('rename', target.path, target.name);
      } else if (action === 'reveal') {
        void backend.revealInExplorer(target.path);
      } else if (action === 'delete' && !target.isWorkspaceRoot) {
        void this.confirmMoveToRecycleBin(target);
      }
    });

    // Unified entry form submit (New File / New Subfolder / Rename)
    const entryDialog = document.getElementById('new-file-dialog') as HTMLDialogElement;
    const entryInput = document.getElementById('new-file-name') as HTMLInputElement;
    const entryError = document.getElementById('new-file-error')!;

    entryDialog.addEventListener('close', () => {
      entryDialog.returnValue = '';
    });

    document.getElementById('new-file-form')!.addEventListener('submit', async (e) => {
      const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
      if (submitter?.value !== 'create') return;
      e.preventDefault();

      const { mode, targetPath } = this.entryDialogState;
      const rawName = entryInput.value;

      try {
        if (mode === 'new-file') {
          const created = await backend.createFile(targetPath, rawName);
          entryDialog.close();
          await this.refreshWorkspaceTree();
          this.openTabFromPayload(created);
        } else if (mode === 'new-folder') {
          await backend.createFolder(targetPath, rawName);
          entryDialog.close();
          await this.refreshWorkspaceTree();
        } else if (mode === 'rename') {
          const renamed = await backend.renamePath(targetPath, rawName);
          entryDialog.close();

          const oldLower = targetPath.toLowerCase();
          const oldPrefix = `${oldLower}\\`;
          for (const t of this.tabs) {
            if (!t.path) continue;
            const tabLower = t.path.toLowerCase();
            if (tabLower === oldLower) {
              t.path = renamed.path;
              t.name = renamed.name;
              t.parentDir = parentDirOfPath(renamed.path);
            } else if (tabLower.startsWith(oldPrefix)) {
              const suffix = t.path.slice(targetPath.length);
              t.path = `${renamed.path}${suffix}`;
              t.parentDir = parentDirOfPath(t.path);
            }
          }

          await this.refreshWorkspaceTree();
          this.renderTabBar();
          this.updateStatusBar();
          this.syncWindowMetadata();
          this.scheduleDraftSync();
          this.schedulePrefsSave();
        }
      } catch (err) {
        entryError.textContent =
          err instanceof Error ? err.message : 'Aktion fehlgeschlagen.';
        entryError.classList.add('is-visible');
      }
    });

    // Workspace full-text search wiring
    this.searchInputEl.addEventListener('input', () => {
      window.clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = window.setTimeout(() => {
        void this.runWorkspaceSearch();
      }, 180);
    });

    this.searchInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.clearTimeout(this.searchDebounceTimer);
        void this.runWorkspaceSearch();
      }
    });

    const caseBtn = document.getElementById('btn-search-case')!;
    caseBtn.addEventListener('click', () => {
      this.searchCaseSensitive = !this.searchCaseSensitive;
      caseBtn.classList.toggle('is-active', this.searchCaseSensitive);
      caseBtn.setAttribute('aria-pressed', String(this.searchCaseSensitive));
      if (this.searchInputEl.value.trim()) {
        void this.runWorkspaceSearch();
      }
    });

    document.getElementById('btn-save')!.addEventListener('click', () => {
      if (this.activeTab) void this.saveTab(this.activeTab, false);
    });

    document.getElementById('btn-save-as')!.addEventListener('click', () => {
      if (this.activeTab) void this.saveTab(this.activeTab, true);
    });

    document.getElementById('btn-export-html')!.addEventListener('click', () => {
      this.exportCurrentTabHtml();
    });

    document.getElementById('btn-print')!.addEventListener('click', () => {
      window.print();
    });

    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-set-view]')) {
      btn.addEventListener('click', () => {
        this.setViewMode(btn.dataset.setView as 'editor' | 'split' | 'preview');
      });
    }

    document.getElementById('btn-word-wrap')!.addEventListener('click', () => {
      this.toggleWordWrap();
    });
    document.getElementById('btn-sync-scroll')!.addEventListener('click', () => {
      this.toggleSyncScroll();
    });
    document.getElementById('btn-autosave')!.addEventListener('click', () => {
      this.toggleAutoSave();
    });

    const toggleZen = () => this.appEl.classList.toggle('is-zen');
    document.getElementById('btn-zen')!.addEventListener('click', toggleZen);

    document.getElementById('format-bar')!.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fmt]');
      if (!btn) return;
      this.editor.applyFormat(btn.dataset.fmt as FormatAction);
    });

    const tableDialog = document.getElementById('table-dialog') as HTMLDialogElement;
    tableDialog.addEventListener('close', () => {
      const action = tableDialog.returnValue;
      tableDialog.returnValue = '';
      if (action !== 'insert') return;

      const cols = Math.max(
        1,
        Math.min(12, Number((document.getElementById('table-cols') as HTMLInputElement).value) || 3),
      );
      const rows = Math.max(
        1,
        Math.min(50, Number((document.getElementById('table-rows') as HTMLInputElement).value) || 3),
      );
      const align = (document.getElementById('table-align') as HTMLSelectElement).value;
      const sepCell =
        align === 'center' ? ':---:' : align === 'right' ? '---:' : ':---';

      const headers = Array.from({ length: cols }, (_, i) => `Spalte ${i + 1}`);
      const seps = Array.from({ length: cols }, () => sepCell);
      const lines = [
        `| ${headers.join(' | ')} |`,
        `| ${seps.join(' | ')} |`,
      ];
      for (let r = 0; r < rows; r++) {
        const cells = Array.from({ length: cols }, () => 'Inhalt');
        lines.push(`| ${cells.join(' | ')} |`);
      }
      this.editor.insertSnippet(`\n${lines.join('\n')}\n`);
    });

    const shortcutsDialog = document.getElementById('shortcuts-dialog') as HTMLDialogElement;
    shortcutsDialog.addEventListener('close', () => {
      shortcutsDialog.returnValue = '';
    });

    for (const tabBtn of document.querySelectorAll<HTMLButtonElement>('[data-sidebar-panel]')) {
      tabBtn.addEventListener('click', () => {
        const target = tabBtn.dataset.sidebarPanel as 'files' | 'search' | 'outline';
        this.switchSidebarPanel(target);
      });
    }

    // Draggable & Keyboard-Accessible Split-View Resizer
    const resizer = document.getElementById('split-resizer')!;
    const splitContainer = document.getElementById('split-container')!;
    resizer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      resizer.setPointerCapture(e.pointerId);
      resizer.classList.add('is-dragging');

      const onMove = (ev: PointerEvent) => {
        const rect = splitContainer.getBoundingClientRect();
        const pct = ((ev.clientX - rect.left) / rect.width) * 100;
        this.setSplitRatio(pct, false);
      };

      const onUp = (ev: PointerEvent) => {
        resizer.releasePointerCapture(ev.pointerId);
        resizer.classList.remove('is-dragging');
        resizer.removeEventListener('pointermove', onMove);
        resizer.removeEventListener('pointerup', onUp);
        this.schedulePrefsSave();
      };

      resizer.addEventListener('pointermove', onMove);
      resizer.addEventListener('pointerup', onUp);
    });

    resizer.addEventListener('dblclick', () => {
      this.setSplitRatio(50);
    });

    resizer.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.setSplitRatio(this.splitRatio - 3);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.setSplitRatio(this.splitRatio + 3);
      } else if (e.key === 'Home') {
        e.preventDefault();
        this.setSplitRatio(50);
      }
    });

    this.previewPaneEl.addEventListener('scroll', () => this.syncScroll.syncPreviewToEditor(), {
      passive: true,
    });

    this.previewContentEl.addEventListener('change', (e) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement && target.classList.contains('task-checkbox')) {
        const line = Number(target.getAttribute('data-task-line'));
        if (Number.isFinite(line)) {
          this.editor.toggleTaskOnLine(line, target.checked);
        }
      }
    });

    this.previewContentEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      const copyBtn = target.closest<HTMLButtonElement>('.copy-code-btn');
      if (copyBtn) {
        const codeEl = copyBtn.closest('.code-block-wrapper')?.querySelector('pre code');
        if (codeEl) {
          void navigator.clipboard.writeText(codeEl.textContent ?? '').then(() => {
            copyBtn.textContent = 'Kopiert ✓';
            setTimeout(() => {
              copyBtn.textContent = 'Kopieren';
            }, 1400);
          });
        }
        return;
      }

      const anchor = target.closest<HTMLAnchorElement>('a[href]');
      if (anchor) {
        const href = anchor.getAttribute('href') ?? '';
        if (href.startsWith('#')) {
          e.preventDefault();
          const id = decodeURIComponent(href.slice(1));
          this.previewContentEl.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({
            behavior: 'smooth',
          });
        } else if (
          href.startsWith('https://') ||
          href.startsWith('http://') ||
          href.startsWith('mailto:')
        ) {
          e.preventDefault();
          void backend.openExternalUrl(href);
        } else if (href.endsWith('.md') && this.activeTab?.parentDir) {
          e.preventDefault();
          const joined = `${this.activeTab.parentDir}\\${href.replace(/\//g, '\\')}`;
          void this.openFileByPath(joined);
        }
      }
    });

    // Status bar interactive buttons
    this.statusPathBtn.addEventListener('click', () => {
      const p = this.activeTab?.path ?? this.workspaceTree?.path;
      if (p) void backend.revealInExplorer(p);
    });

    this.statusZoomBtn.addEventListener('click', () => {
      this.setZoomPercent(100);
    });

    this.statusEolBtn.addEventListener('click', () => {
      this.toggleActiveTabLineEnding();
    });

    // External modification reload banner
    document.getElementById('btn-reload-external')!.addEventListener('click', async () => {
      this.externalBannerEl.hidden = true;
      if (!this.externalChangedPath) return;
      const tab = this.tabs.find(
        (t) => t.path?.toLowerCase() === this.externalChangedPath?.toLowerCase(),
      );
      if (tab && tab.path) {
        const payload = await backend.readFile(tab.path);
        tab.savedContent = payload.content;
        tab.currentContent = payload.content;
        tab.encoding = payload.encoding || 'UTF-8';
        tab.lineEnding = payload.lineEnding;
        tab.isDirty = false;
        if (tab.id === this.activeTabId) {
          this.editor.replaceAllContent(payload.content);
        } else {
          tab.editorState = this.editor.createState(payload.content);
        }
        this.renderTabBar();
        this.updateStatusBar();
        this.scheduleDraftSync();
      }
    });

    document.getElementById('btn-dismiss-banner')!.addEventListener('click', () => {
      this.externalBannerEl.hidden = true;
    });

    // Application-wide keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && !e.shiftKey && key === 'e') {
        e.preventDefault();
        this.palette.open('files');
      } else if (mod && e.shiftKey && key === 'p') {
        e.preventDefault();
        this.palette.open('commands');
      } else if (mod && !e.shiftKey && key === 'n') {
        e.preventDefault();
        newTabFn();
      } else if (mod && !e.shiftKey && key === 'o') {
        e.preventDefault();
        void this.triggerOpenFilesDialog();
      } else if (mod && e.shiftKey && key === 'o') {
        e.preventDefault();
        void this.triggerOpenFolderDialog();
      } else if (mod && e.shiftKey && key === 'f') {
        e.preventDefault();
        this.switchSidebarPanel('search');
      } else if (mod && !e.shiftKey && key === 's') {
        e.preventDefault();
        if (this.activeTab) void this.saveTab(this.activeTab, false);
      } else if (mod && e.shiftKey && key === 's') {
        e.preventDefault();
        if (this.activeTab) void this.saveTab(this.activeTab, true);
      } else if (mod && !e.shiftKey && key === 'p') {
        e.preventDefault();
        window.print();
      } else if (mod && key === 'w') {
        e.preventDefault();
        if (this.activeTab) void this.requestCloseTab(this.activeTab.id);
      } else if (mod && e.key === '\\') {
        e.preventDefault();
        this.sidebarEl.classList.toggle('is-collapsed');
      } else if (mod && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        this.setZoomPercent(this.zoomPercent + 10);
      } else if (mod && e.key === '-') {
        e.preventDefault();
        this.setZoomPercent(this.zoomPercent - 10);
      } else if (mod && e.key === '0') {
        e.preventDefault();
        this.setZoomPercent(100);
      } else if (e.altKey && !mod && key === 'z') {
        e.preventDefault();
        this.toggleWordWrap();
      } else if (e.altKey && e.key === '1') {
        e.preventDefault();
        this.setViewMode('editor');
      } else if (e.altKey && e.key === '2') {
        e.preventDefault();
        this.setViewMode('split');
      } else if (e.altKey && e.key === '3') {
        e.preventDefault();
        this.setViewMode('preview');
      } else if (e.key === 'F11') {
        e.preventDefault();
        toggleZen();
      } else if (e.key === 'F1') {
        e.preventDefault();
        shortcutsDialog.showModal();
      }
    });
  }

  private bindBackendEvents(): void {
    onBackendEvent('drag-enter', () => {
      this.dropOverlayEl.hidden = false;
    });

    onBackendEvent('drag-leave', () => {
      this.dropOverlayEl.hidden = true;
    });

    onBackendEvent('files-dropped', async ({ files, images, folder }) => {
      this.dropOverlayEl.hidden = true;
      if (folder) {
        await this.loadWorkspaceFolder(folder);
        this.sidebarEl.classList.remove('is-collapsed');
      }
      for (const f of files) {
        await this.openFileByPath(f);
      }
      if (images && images.length > 0) {
        await this.handleDroppedImages(images);
      }
    });

    onBackendEvent('fs-changed', async ({ paths }) => {
      const changedLower = new Set(paths.map((p) => p.toLowerCase()));
      for (const tab of this.tabs) {
        if (!tab.path || !changedLower.has(tab.path.toLowerCase())) continue;
        try {
          const disk = await backend.readFile(tab.path);
          if (disk.content === tab.currentContent) {
            tab.savedContent = disk.content;
            tab.isDirty = false;
            this.renderTabBar();
            this.scheduleDraftSync();
            continue;
          }
          if (!tab.isDirty) {
            tab.savedContent = disk.content;
            tab.currentContent = disk.content;
            tab.encoding = disk.encoding || 'UTF-8';
            tab.lineEnding = disk.lineEnding;
            if (tab.id === this.activeTabId) {
              this.editor.replaceAllContent(disk.content);
            } else {
              tab.editorState = this.editor.createState(disk.content);
            }
          } else if (tab.id === this.activeTabId) {
            this.externalChangedPath = tab.path;
            this.externalBannerEl.hidden = false;
          }
        } catch {
          // File may have been deleted or temporarily locked
        }
      }

      if (this.workspaceTree) {
        void this.refreshWorkspaceTree();
      }
    });

    onBackendEvent('close-requested', async () => {
      const dirtyTabs = this.tabs.filter((t) => t.isDirty);
      if (dirtyTabs.length === 0) {
        await backend.saveUiPrefs(this.buildCurrentUiPrefs()).catch(() => {});
        await backend.clearDrafts().catch(() => {});
        await backend.forceCloseWindow();
        return;
      }

      const names = dirtyTabs.map((t) => `„${t.name}“`).join(', ');
      const choice = await this.promptUnsavedChanges(
        `Ungespeicherte Änderungen in ${names}. Vor dem Beenden speichern?`,
      );
      if (choice === 'cancel') return;

      if (choice === 'save') {
        for (const tab of dirtyTabs) {
          const ok = await this.saveTab(tab, false);
          if (!ok) return;
        }
      }
      await backend.saveUiPrefs(this.buildCurrentUiPrefs()).catch(() => {});
      await backend.clearDrafts().catch(() => {});
      await backend.forceCloseWindow();
    });
  }
}

const app = new MarkLiveApp();
void app.init();
