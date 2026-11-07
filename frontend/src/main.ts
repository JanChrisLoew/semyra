import './styles.css';
import { EditorState } from '@codemirror/state';
import {
  backend,
  DocStats,
  DraftEntry,
  FilePayload,
  HeadingItem,
  onBackendEvent,
  UiSessionPrefs,
} from './api';
import { FormatAction, MarkdownEditorController } from './editor';
import { copyRichPreviewToClipboard, preparePreviewHtmlForExport } from './export-utils';
import { bindRovingHorizontalKeyNav, syncRovingTabindex } from './navigation-a11y';
import { CommandPaletteController } from './palette';
import { buildPaletteCommandItems, buildPaletteFileItems } from './palette-items';
import {
  baseNameOfPath,
  getFileExtension,
  isMarkdownPath,
  parentDirOfPath,
  resolveRelativeMarkdownPath,
} from './path-utils';
import { installProgressiveEnhancements } from './polyfills';
import { safeSetMarkdownHTML } from './sanitizer';
import { SidebarExplorerController } from './sidebar-explorer';
import { SyncScrollController } from './sync-scroll';
import { bindThemeSystem } from './theme';
import { estimateTokens } from './token-utils';
import { WELCOME_MARKDOWN } from './welcome';
import { WorkspaceSearchController } from './workspace-search';

installProgressiveEnhancements();

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
  hasExternalConflict?: boolean;
}

class MarkLiveApp {
  private tabs: OpenTab[] = [];
  private activeTabId = '';
  private untitledCounter = 1;
  private closedTabsHistory: Array<{
    name: string;
    path: string | null;
    content: string;
    lineEnding: 'LF' | 'CRLF';
  }> = [];
  private lastSelection = { chars: 0, words: 0 };

  private editor!: MarkdownEditorController;
  private syncScroll!: SyncScrollController;
  private palette!: CommandPaletteController;
  private explorer!: SidebarExplorerController;
  private workspaceSearch!: WorkspaceSearchController;

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
  private toastTimer: number | undefined;
  private renderSeq = 0;
  private externalChangedPath: string | null = null;

  // DOM References
  private appEl = document.getElementById('app')!;
  private sidebarEl = document.getElementById('sidebar')!;
  private tabBarEl = document.getElementById('tab-bar')!;
  private previewPaneEl = document.getElementById('preview-pane')!;
  private previewContentEl = document.getElementById('preview-content')!;
  private outlineEl = document.getElementById('outline-container')!;
  private statusPathBtn = document.getElementById('status-filepath') as HTMLButtonElement;
  private statusSaveBadge = document.getElementById('status-save-badge')!;
  private statusCursorEl = document.getElementById('status-cursor')!;
  private statusWordsEl = document.getElementById('status-words')!;
  private statusTokensEl = document.getElementById('status-tokens')!;
  private statusReadtimeEl = document.getElementById('status-readtime')!;
  private statusZoomBtn = document.getElementById('status-zoom') as HTMLButtonElement;
  private statusEolBtn = document.getElementById('status-eol') as HTMLButtonElement;
  private statusEncodingEl = document.getElementById('status-encoding')!;
  private statusToastEl = document.getElementById('status-toast')!;
  private btnCopyMarkdown = document.getElementById('btn-copy-markdown') as HTMLButtonElement | null;
  private dropOverlayEl = document.getElementById('drop-overlay')!;
  private externalBannerEl = document.getElementById('external-banner')!;
  private tabContextMenuEl = document.getElementById('tab-context-menu') as HTMLElement & {
    showPopover?: () => void;
    hidePopover?: () => void;
  };
  private tabContextTargetId: string | null = null;

  public async init(): Promise<void> {
    const cmHost = document.getElementById('codemirror-host')!;
    this.editor = new MarkdownEditorController(cmHost, '', {
      onDocChanged: (content) => this.handleEditorContentChange(content),
      onCursorChanged: (line, col, selChars, selWords) => {
        this.statusCursorEl.textContent = `Zeile ${line}, Spalte ${col}`;
        this.lastSelection = { chars: selChars, words: selWords };
        this.updateWordCountDisplay();
      },
      onEditorScrolled: () => this.syncScroll.syncEditorToPreview(),
      onFormatCommand: (cmd) => this.editor.applyFormat(cmd),
      onPasteImage: (mimeType, dataUrl) => {
        void this.handlePasteImage(mimeType, dataUrl);
      },
      onCopyRichText: () => {
        void this.copyCurrentTabRichText();
      },
      onCopyMarkdown: () => {
        void this.copyCurrentTabMarkdown();
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

    this.explorer = new SidebarExplorerController({
      fileTreeEl: document.getElementById('file-tree-container')!,
      workspaceTitleEl: document.getElementById('workspace-title')!,
      contextPopoverEl: document.getElementById('tree-context-menu') as HTMLElement,
      getActiveFilePath: () => this.activeTab?.path ?? null,
      onOpenFilePath: (filePath) => this.openFileByPath(filePath),
      onOpenCreatedFile: (payload) => this.openTabFromPayload(payload),
      onTriggerOpenFolderDialog: () => this.triggerOpenFolderDialog(),
      onWorkspaceFolderLoaded: (folderPath, persistPrefs) => {
        this.pushRecentFolder(folderPath);
        if (persistPrefs) {
          this.schedulePrefsSave();
        }
      },
      onEntryRenamed: (oldPath, newPath, newName) => {
        this.handleExplorerEntryRenamed(oldPath, newPath, newName);
      },
      onEntryDeleted: (deletedPath) => {
        this.handleExplorerEntryDeleted(deletedPath);
      },
    });

    this.workspaceSearch = new WorkspaceSearchController({
      searchInputEl: document.getElementById('workspace-search-input') as HTMLInputElement,
      caseToggleBtn: document.getElementById('btn-search-case')!,
      resultsContainerEl: document.getElementById('search-results-container')!,
      getWorkspaceRootPath: () => this.explorer.rootPath,
      onOpenMatch: async (filePath, line) => {
        await this.openFileByPath(filePath);
        requestAnimationFrame(() => {
          this.editor.jumpToLine(line);
        });
      },
    });

    this.palette = new CommandPaletteController(
      document.getElementById('palette-dialog') as HTMLDialogElement,
      document.getElementById('palette-input') as HTMLInputElement,
      document.getElementById('palette-results')!,
      {
        getFileItems: () =>
          buildPaletteFileItems({
            tabs: this.tabs,
            activeTabId: this.activeTabId,
            workspaceRootPath: this.explorer.rootPath,
            getWorkspaceFiles: () => this.explorer.getWorkspaceFiles(),
            recentFiles: this.recentFiles,
            recentFolders: this.recentFolders,
            onActivateTab: (tabId) => this.activateTab(tabId),
            onOpenFile: (filePath) => this.openFileByPath(filePath),
            onOpenFolder: async (folderPath) => {
              await this.explorer.loadFolder(folderPath, true);
              this.switchSidebarPanel('files');
            },
          }),
        getCommandItems: () =>
          buildPaletteCommandItems({
            wordWrapActive: this.editor.isWordWrapEnabled(),
            spellcheckActive: this.editor.isSpellcheckEnabled(),
            syncScrollActive: this.syncScroll.isEnabled(),
            autoSaveActive: this.autoSaveEnabled,
            currentLineEnding: this.activeTab?.lineEnding ?? 'CRLF',
            onNewTab: () => this.createNewTab(),
            onOpenFileDialog: () => this.triggerOpenFilesDialog(),
            onOpenFolderDialog: () => this.triggerOpenFolderDialog(),
            onSave: () => {
              if (this.activeTab) void this.saveTab(this.activeTab, false);
            },
            onSaveAs: () => {
              if (this.activeTab) void this.saveTab(this.activeTab, true);
            },
            onCopyRichText: () => {
              void this.copyCurrentTabRichText();
            },
            onCopyMarkdown: () => {
              void this.copyCurrentTabMarkdown();
            },
            onCopyAiContext: () => {
              void this.copyCurrentTabAiContext();
            },
            onExportHtml: () => {
              void this.exportCurrentTabHtml();
            },
            onExportPdf: () => {
              void this.exportCurrentTabPdf();
            },
            onPrint: () => {
              void this.printCurrentTab();
            },
            onAlignTable: () => this.alignActiveMarkdownTables(),
            onSetViewMode: (mode) => this.setViewMode(mode),
            onToggleWordWrap: () => this.toggleWordWrap(),
            onToggleSpellcheck: () => {
              this.editor.setSpellcheck(!this.editor.isSpellcheckEnabled());
              this.schedulePrefsSave();
            },
            onToggleSyncScroll: () => this.toggleSyncScroll(),
            onToggleAutoSave: () => this.toggleAutoSave(),
            onToggleLineEnding: () => this.toggleActiveTabLineEnding(),
            onZoomDelta: (delta) => this.setZoomPercent(this.zoomPercent + delta),
            onZoomReset: () => this.setZoomPercent(100),
            onOpenEditorSearch: () => this.openEditorSearchPanel(),
            onOpenEditorReplace: () => this.openEditorReplacePanel(),
            onOpenSearchPanel: () => this.switchSidebarPanel('search'),
            onOpenOutlinePanel: () => this.switchSidebarPanel('outline'),
            onToggleZen: () => this.appEl.classList.toggle('is-zen'),
            onToggleTheme: () => document.getElementById('btn-theme-toggle')?.click(),
            onRevealInExplorer: () => {
              const p = this.activeTab?.path ?? this.explorer.rootPath;
              if (p) void backend.revealInExplorer(p);
            },
            onShowShortcuts: () => {
              (document.getElementById('shortcuts-dialog') as HTMLDialogElement).showModal();
            },
            onReopenTab: () => {
              void this.reopenLastClosedTab();
            },
            onNextTab: () => this.cycleActiveTab(1),
            onPrevTab: () => this.cycleActiveTab(-1),
            onToggleTask: () => this.editor.toggleCurrentTask(),
          }),
      },
    );

    this.bindCompositeKeyboardNav();
    this.bindUIEvents();
    bindThemeSystem(() => {
      if (this.activeTab) {
        void this.renderPreviewImmediate(
          this.activeTab.currentContent,
          this.activeTab.parentDir ?? this.explorer.rootPath,
        );
      }
    });
    this.bindBackendEvents();

    // Restore startup payload (UI prefs, CLI files, last workspace, session tabs, crash drafts)
    try {
      const startup = await backend.getStartup();
      this.applyRestoredUiPrefs(startup.uiPrefs);

      if (startup.initialFolder) {
        await this.explorer.loadFolder(startup.initialFolder, false);
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

    if (!this.explorer.hasWorkspace) {
      this.explorer.renderEmptyStateWithRecents(this.recentFolders, this.recentFiles);
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
    document
      .getElementById('split-resizer')
      ?.setAttribute('aria-valuenow', String(Math.round(clamped)));
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
    if (!this.explorer.hasWorkspace) {
      this.explorer.renderEmptyStateWithRecents(this.recentFolders, this.recentFiles);
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
  // Crash-Recovery Draft Persistence & Image Insertion
  // ==========================================================================

  private restoreRecoveredDrafts(drafts: DraftEntry[]): void {
    let restoredCount = 0;
    for (const draft of drafts) {
      restoredCount++;
      if (draft.path) {
        const normLower = draft.path.toLowerCase();
        const existing = this.tabs.find((t) => t.path?.toLowerCase() === normLower);
        if (existing) {
          existing.currentContent = draft.content;
          existing.isDirty = draft.content !== existing.savedContent;
          existing.editorState = this.editor.createState(draft.content);
          if (existing.id === this.activeTabId) {
            this.editor.swapState(existing.editorState, 0);
            void this.renderPreviewImmediate(
              existing.currentContent,
              existing.parentDir ?? this.explorer.rootPath,
            );
          }
          continue;
        }
      }

      const id = crypto.randomUUID();
      const tab: OpenTab = {
        id,
        name: draft.name || `Unbenannt-${this.untitledCounter++}.md`,
        path: draft.path,
        parentDir: draft.parentDir ?? this.explorer.rootPath,
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
      if (restoredCount > 0) {
        this.showToast(
          restoredCount === 1
            ? '1 ungespeicherter Entwurf nach Systemstart wiederhergestellt'
            : `${restoredCount} ungespeicherte Entwürfe nach Systemstart wiederhergestellt`,
        );
      }
    }
  }

  private flushDraftSync(): void {
    window.clearTimeout(this.draftSyncTimer);
    this.draftSyncTimer = undefined;
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
    const targetBaseDir = tab.parentDir ?? this.explorer.rootPath;
    try {
      const res = await backend.savePastedImage(targetBaseDir, mimeType, dataUrl);
      this.editor.insertSnippet(res.markdownSnippet);
      if (this.explorer.hasWorkspace) {
        this.explorer.scheduleRefresh();
      }
    } catch (err) {
      console.error('Bild aus Zwischenablage konnte nicht gespeichert werden:', err);
    }
  }

  private async handleDroppedImages(imagePaths: string[]): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;
    const targetBaseDir = tab.parentDir ?? this.explorer.rootPath;
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
      if (this.explorer.hasWorkspace) {
        this.explorer.scheduleRefresh();
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
      parentDir: this.explorer.rootPath,
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
    if (target.hasExternalConflict && target.path) {
      this.externalChangedPath = target.path;
      this.externalBannerEl.hidden = false;
    } else {
      this.externalBannerEl.hidden = true;
    }
    this.editor.swapState(target.editorState, target.editorScrollTop);
    void this.editor.setLanguageForFile(target.name);

    this.renderTabBar();
    this.explorer.highlightActiveFile();
    this.updateStatusBar();
    this.syncWindowMetadata();
    this.schedulePrefsSave();

    void this.renderPreviewImmediate(
      target.currentContent,
      target.parentDir ?? this.explorer.rootPath,
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
      const fileName = baseNameOfPath(path);
      this.showToast(`Datei konnte nicht geöffnet werden: ${fileName}`);
      const prevLen = this.recentFiles.length;
      this.recentFiles = this.recentFiles.filter(
        (p) => p.toLowerCase() !== normLower,
      );
      if (this.recentFiles.length !== prevLen) {
        if (!this.explorer.hasWorkspace) {
          this.explorer.renderEmptyStateWithRecents(this.recentFolders, this.recentFiles);
        }
        this.schedulePrefsSave();
      }
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
        tab.parentDir ?? this.explorer.rootPath,
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
    tab.hasExternalConflict = false;
    this.pushRecentFile(tab.path);
    this.explorer.invalidateFilesCache();

    this.renderTabBar();
    this.updateStatusBar();
    this.syncWindowMetadata();
    this.scheduleDraftSync();
    this.schedulePrefsSave();

    if (this.explorer.hasWorkspace) {
      void this.explorer.refresh();
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

  private async requestCloseTab(tabId: string): Promise<boolean> {
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return true;
    const tab = this.tabs[idx];

    if (tab.isDirty) {
      const choice = await this.promptUnsavedChanges(
        `Möchtest du die Änderungen in „${tab.name}“ speichern?`,
      );
      if (choice === 'cancel') return false;
      if (choice === 'save') {
        const saved = await this.saveTab(tab);
        if (!saved) return false;
      }
    }

    this.closedTabsHistory.push({
      name: tab.name,
      path: tab.path,
      content: tab.currentContent,
      lineEnding: tab.lineEnding,
    });
    if (this.closedTabsHistory.length > 15) {
      this.closedTabsHistory.shift();
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
    this.flushDraftSync();
    this.schedulePrefsSave();
    return true;
  }

  private async reopenLastClosedTab(): Promise<void> {
    const last = this.closedTabsHistory.pop();
    if (!last) {
      this.showToast('Keine geschlossenen Tabs zum Wiederherstellen');
      return;
    }
    if (last.path) {
      await this.openFileByPath(last.path);
      this.showToast(`Tab wiederhergestellt: ${last.name}`);
    } else {
      this.createNewTab(last.name, last.content, false);
      this.showToast(`Entwurf wiederhergestellt: ${last.name}`);
    }
  }

  private cycleActiveTab(direction: 1 | -1): void {
    if (this.tabs.length <= 1) return;
    const curIdx = this.tabs.findIndex((t) => t.id === this.activeTabId);
    if (curIdx === -1) return;
    const nextIdx = (curIdx + direction + this.tabs.length) % this.tabs.length;
    this.activateTab(this.tabs[nextIdx].id);
  }

  private async closeOtherTabs(keepTabId: string): Promise<void> {
    const toClose = this.tabs.filter((t) => t.id !== keepTabId);
    for (const t of toClose) {
      const ok = await this.requestCloseTab(t.id);
      if (!ok) break;
    }
  }

  private async closeTabsToRight(fromTabId: string): Promise<void> {
    const idx = this.tabs.findIndex((t) => t.id === fromTabId);
    if (idx === -1) return;
    const toClose = this.tabs.slice(idx + 1);
    for (const t of toClose) {
      const ok = await this.requestCloseTab(t.id);
      if (!ok) break;
    }
  }

  private handleExplorerEntryRenamed(
    oldPath: string,
    newPath: string,
    newName: string,
  ): void {
    const oldLower = oldPath.toLowerCase();
    const oldPrefix = `${oldLower}\\`;
    for (const t of this.tabs) {
      if (!t.path) continue;
      const tabLower = t.path.toLowerCase();
      if (tabLower === oldLower) {
        t.path = newPath;
        t.name = newName;
        t.parentDir = parentDirOfPath(newPath);
      } else if (tabLower.startsWith(oldPrefix)) {
        const suffix = t.path.slice(oldPath.length);
        t.path = `${newPath}${suffix}`;
        t.parentDir = parentDirOfPath(t.path);
      }
    }

    const remapPath = (p: string) => {
      const pLower = p.toLowerCase();
      if (pLower === oldLower) return newPath;
      if (pLower.startsWith(oldPrefix)) {
        return `${newPath}${p.slice(oldPath.length)}`;
      }
      return p;
    };
    this.recentFiles = this.recentFiles.map(remapPath);
    this.recentFolders = this.recentFolders.map(remapPath);
    if (!this.explorer.hasWorkspace) {
      this.explorer.renderEmptyStateWithRecents(this.recentFolders, this.recentFiles);
    }

    this.renderTabBar();
    this.updateStatusBar();
    this.syncWindowMetadata();
    this.scheduleDraftSync();
    this.schedulePrefsSave();
  }

  private handleExplorerEntryDeleted(deletedPath: string): void {
    const lowerTarget = deletedPath.toLowerCase();
    const prefix = `${lowerTarget}\\`;

    const isDeleted = (p: string) => {
      const pLower = p.toLowerCase();
      return pLower === lowerTarget || pLower.startsWith(prefix);
    };
    this.recentFiles = this.recentFiles.filter((p) => !isDeleted(p));
    this.recentFolders = this.recentFolders.filter((p) => !isDeleted(p));
    if (!this.explorer.hasWorkspace) {
      this.explorer.renderEmptyStateWithRecents(this.recentFolders, this.recentFiles);
    }

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

    this.scheduleDraftSync();
    this.schedulePrefsSave();
  }

  // ==========================================================================
  // Live Markdown Rendering & Document Outline
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
        tab.parentDir ?? this.explorer.rootPath,
      );
    }, 35);

    if (this.autoSaveEnabled && tab.path && tab.isDirty && !tab.hasExternalConflict) {
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
    forceLightTheme = false,
  ): Promise<void> {
    const seq = ++this.renderSeq;
    try {
      let markdownToRender = markdown;
      const tab = this.activeTab;
      if (tab && !isMarkdownPath(tab.name)) {
        const ext = getFileExtension(tab.name);
        const langMap: Record<string, string> = {
          json: 'json',
          yaml: 'yaml',
          yml: 'yaml',
          toml: 'toml',
          ini: 'ini',
          txt: 'text',
          csv: 'text',
          log: 'text',
          env: 'properties',
          xml: 'xml',
          js: 'javascript',
          ts: 'typescript',
          rs: 'rust',
          html: 'html',
          css: 'css',
        };
        const lang = langMap[ext] ?? (ext || 'text');
        let fence = '```';
        while (markdown.includes(fence)) {
          fence += '`';
        }
        markdownToRender = `${fence}${lang}\n${markdown}\n${fence}`;
      }

      const res = await backend.renderMarkdown(markdownToRender, baseDir);
      if (seq !== this.renderSeq) return;

      if (tab) {
        tab.outline = res.outline;
        tab.stats = res.stats;
      }

      await safeSetMarkdownHTML(this.previewContentEl, res.html, { forceLightTheme });
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
      this.workspaceSearch.focusAndRunIfPopulated();
    }
  }

  private renderOutline(outline: HeadingItem[]): void {
    this.outlineEl.replaceChildren();
    if (outline.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'muted-hint';
      hint.textContent = this.activeTab && !isMarkdownPath(this.activeTab.name)
        ? 'Keine Überschriften (Text-/Konfigurationsdatei).'
        : 'Keine Überschriften im Dokument.';
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
        this.syncScroll.lockScrollForNavigation('editor', 500);
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
  // Chrome, Accessible Sibling Tabs, Status Bar & Unsaved Prompt
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
      slot.addEventListener('contextmenu', (e) => {
        this.openTabContextMenu(e, tab.id);
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

  private openTabContextMenu(e: MouseEvent, tabId: string): void {
    e.preventDefault();
    this.tabContextTargetId = tabId;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const revealBtn = document.getElementById('tab-ctx-reveal') as HTMLButtonElement;
    const copyPathBtn = document.getElementById('tab-ctx-copy-path') as HTMLButtonElement;
    if (revealBtn) revealBtn.disabled = !tab.path;
    if (copyPathBtn) copyPathBtn.disabled = !tab.path;

    const closeOthersBtn = this.tabContextMenuEl.querySelector<HTMLButtonElement>(
      '[data-tab-ctx="close-others"]',
    );
    const closeRightBtn = this.tabContextMenuEl.querySelector<HTMLButtonElement>(
      '[data-tab-ctx="close-to-right"]',
    );
    const tabIdx = this.tabs.findIndex((t) => t.id === tabId);
    if (closeOthersBtn) closeOthersBtn.disabled = this.tabs.length <= 1;
    if (closeRightBtn) closeRightBtn.disabled = tabIdx === -1 || tabIdx >= this.tabs.length - 1;

    this.tabContextMenuEl.style.left = `${e.clientX}px`;
    this.tabContextMenuEl.style.top = `${e.clientY}px`;
    this.tabContextMenuEl.showPopover?.();

    requestAnimationFrame(() => {
      const rect = this.tabContextMenuEl.getBoundingClientRect();
      const clampedLeft = Math.max(6, Math.min(e.clientX, window.innerWidth - rect.width - 8));
      const clampedTop = Math.max(6, Math.min(e.clientY, window.innerHeight - rect.height - 8));
      this.tabContextMenuEl.style.left = `${clampedLeft}px`;
      this.tabContextMenuEl.style.top = `${clampedTop}px`;

      const firstItem = this.tabContextMenuEl.querySelector<HTMLButtonElement>(
        '[focusgroup~="menu"] > button:not(:disabled)',
      );
      firstItem?.focus();
    });
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
    this.updateWordCountDisplay();
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

  private updateWordCountDisplay(): void {
    const tab = this.activeTab;
    if (!tab) return;
    const { words } = tab.stats;
    const totalTokens = estimateTokens(tab.currentContent);
    if (this.lastSelection.chars > 0) {
      const selW = this.lastSelection.words;
      const selC = this.lastSelection.chars;
      const selTokens = Math.ceil(Math.max(selC / 3.7, selW * 1.25));
      this.statusWordsEl.textContent = `${selW} von ${words.toLocaleString('de-DE')} Wörtern markiert (${selC.toLocaleString('de-DE')} Z.)`;
      this.statusTokensEl.textContent = `~${selTokens.toLocaleString('de-DE')} Tokens (~${totalTokens.toLocaleString('de-DE')})`;
      this.statusTokensEl.title = `Auswahl: ~${selTokens.toLocaleString('de-DE')} Tokens · Gesamtdokument: ~${totalTokens.toLocaleString('de-DE')} Tokens`;
    } else {
      this.statusWordsEl.textContent = `${words.toLocaleString('de-DE')} ${words === 1 ? 'Wort' : 'Wörter'}`;
      this.statusTokensEl.textContent = `~${totalTokens.toLocaleString('de-DE')} Tokens`;
      this.statusTokensEl.title = 'Geschätzter LLM-Token-Verbrauch für Prompts (GPT / Claude / Gemini)';
    }
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

  private openMermaidLightbox(svgHtml: string): void {
    const dialog = document.getElementById('mermaid-dialog') as HTMLDialogElement | null;
    const body = document.getElementById('mermaid-dialog-body');
    if (!dialog || !body) return;
    body.innerHTML = svgHtml;
    dialog.showModal();
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
      this.explorer.setTree(res.tree);
      this.switchSidebarPanel('files');
    }
  }

  private showToast(message: string): void {
    // Never mutate the polite live region while a modal dialog makes outside DOM inert
    if (document.querySelector('dialog[open]')) return;
    window.clearTimeout(this.toastTimer);
    this.statusToastEl.textContent = message;
    this.statusToastEl.classList.add('is-visible');
    this.toastTimer = window.setTimeout(() => {
      this.statusToastEl.classList.remove('is-visible');
      this.statusToastEl.textContent = '';
    }, 2800);
  }

  private async flushActivePreviewRender(): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;
    if (this.renderDebounceTimer !== undefined) {
      window.clearTimeout(this.renderDebounceTimer);
      this.renderDebounceTimer = undefined;
      await this.renderPreviewImmediate(
        tab.currentContent,
        tab.parentDir ?? this.explorer.rootPath,
      );
    }
  }

  private alignActiveMarkdownTables(): void {
    const count = this.editor.alignMarkdownTables();
    if (count > 0) {
      this.showToast(
        count === 1 ? 'Markdown-Tabelle ausgerichtet' : `${count} Markdown-Tabellen ausgerichtet`,
      );
    } else {
      this.showToast('Keine Markdown-Tabelle im Dokument gefunden');
    }
  }

  private openEditorSearchPanel(): void {
    if (this.appEl.getAttribute('data-view') === 'preview') {
      this.setViewMode('split');
    }
    this.editor.openSearch(false);
  }

  private openEditorReplacePanel(): void {
    if (this.appEl.getAttribute('data-view') === 'preview') {
      this.setViewMode('split');
    }
    this.editor.openSearch(true);
  }

  private async withLightPaperPreview<T>(fn: () => Promise<T>): Promise<T> {
    const tab = this.activeTab;
    await this.flushActivePreviewRender();
    if (!tab) return fn();

    const baseDir = tab.parentDir ?? this.explorer.rootPath;
    const prevView = (this.appEl.getAttribute('data-view') ?? 'split') as
      | 'editor'
      | 'split'
      | 'preview';
    const hasMermaid = this.previewContentEl.querySelector('.mermaid-wrapper[data-mermaid]') !== null;
    const metaScheme = document
      .querySelector('meta[name="color-scheme"]')
      ?.getAttribute('content');
    const isDarkActive =
      metaScheme === 'dark' ||
      (metaScheme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    // Expose preview pane offscreen when in editor-only mode so images decode & Mermaid measures
    // without visibly resizing `.editor-pane` on screen.
    if (prevView === 'editor') {
      this.appEl.setAttribute('data-print-prep', 'true');
    }
    if (hasMermaid && isDarkActive) {
      await this.renderPreviewImmediate(tab.currentContent, baseDir, undefined, true);
    }

    const imgs = Array.from(this.previewContentEl.querySelectorAll<HTMLImageElement>('img'));
    await Promise.all(
      imgs.map(async (img) => {
        img.loading = 'eager';
        if (typeof img.decode === 'function') {
          await img.decode().catch(() => {});
        }
      }),
    );

    try {
      return await fn();
    } finally {
      this.appEl.removeAttribute('data-print-prep');
      if (hasMermaid && isDarkActive) {
        await this.renderPreviewImmediate(tab.currentContent, baseDir);
      }
    }
  }

  private async copyCurrentTabRichText(): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;
    try {
      await this.flushActivePreviewRender();
      await copyRichPreviewToClipboard(this.previewContentEl, tab.currentContent);
      this.showToast('Als formatierter Text in die Zwischenablage kopiert');
    } catch (err) {
      console.error('Formatierter Text konnte nicht kopiert werden:', err);
      this.showToast('Kopieren in die Zwischenablage fehlgeschlagen');
    }
  }

  private async copyCurrentTabMarkdown(): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;
    try {
      await navigator.clipboard.writeText(tab.currentContent);
      this.showToast(isMarkdownPath(tab.name) ? 'Markdown in Zwischenablage kopiert' : 'Quelltext in Zwischenablage kopiert');
    } catch (err) {
      console.error('Markdown konnte nicht kopiert werden:', err);
      this.showToast('Kopieren in die Zwischenablage fehlgeschlagen');
    }
  }

  private async copyCurrentTabAiContext(): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;
    try {
      let fence = '```';
      while (tab.currentContent.includes(fence)) {
        fence += '`';
      }
      const ext = getFileExtension(tab.name) || 'markdown';
      const body = tab.currentContent.endsWith('\n') ? tab.currentContent : `${tab.currentContent}\n`;
      const payload = `${fence}${ext}:${tab.name}\n${body}${fence}\n`;
      await navigator.clipboard.writeText(payload);
      this.showToast(`Als KI-Kontext (${tab.name}) kopiert`);
    } catch (err) {
      console.error('KI-Kontext konnte nicht kopiert werden:', err);
      this.showToast('Kopieren in die Zwischenablage fehlgeschlagen');
    }
  }

  private async exportCurrentTabHtml(): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;
    const baseDir = tab.parentDir ?? this.explorer.rootPath;
    try {
      await this.flushActivePreviewRender();
      const renderedHtml = await preparePreviewHtmlForExport(this.previewContentEl);
      const res = await backend.exportHtmlDialog(
        tab.name,
        tab.currentContent,
        baseDir,
        baseDir,
        renderedHtml,
      );
      if (res.exported && res.path) {
        this.showToast(`HTML exportiert: ${baseNameOfPath(res.path)}`);
      }
    } catch (err) {
      console.error('HTML-Export fehlgeschlagen:', err);
      this.showToast('HTML-Export fehlgeschlagen');
    }
  }

  private async exportCurrentTabPdf(): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;
    const baseDir = tab.parentDir ?? this.explorer.rootPath;
    try {
      const pick = await backend.pickPdfSavePath(tab.name, baseDir);
      if (!pick.chosen || pick.token === undefined) {
        return;
      }
      const token = pick.token;
      const res = await this.withLightPaperPreview(() => backend.executePdfExport(token));
      if (res.exported && res.path) {
        this.showToast(`PDF exportiert: ${baseNameOfPath(res.path)}`);
      }
    } catch (err) {
      console.error('PDF-Export fehlgeschlagen:', err);
      this.showToast('PDF-Export fehlgeschlagen');
    }
  }

  private async printCurrentTab(): Promise<void> {
    try {
      await this.withLightPaperPreview(async () => {
        window.print();
      });
    } catch (err) {
      console.error('Druckvorbereitung fehlgeschlagen:', err);
      window.print();
    }
  }

  private bindUIEvents(): void {
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

    document.getElementById('btn-save')!.addEventListener('click', () => {
      if (this.activeTab) void this.saveTab(this.activeTab, false);
    });

    document.getElementById('btn-save-as')!.addEventListener('click', () => {
      if (this.activeTab) void this.saveTab(this.activeTab, true);
    });

    document.getElementById('btn-copy-markdown')?.addEventListener('click', () => {
      void this.copyCurrentTabMarkdown();
    });

    document.getElementById('btn-copy-rich')!.addEventListener('click', () => {
      void this.copyCurrentTabRichText();
    });

    document.getElementById('btn-export-html')!.addEventListener('click', () => {
      void this.exportCurrentTabHtml();
    });

    document.getElementById('btn-export-pdf')!.addEventListener('click', () => {
      void this.exportCurrentTabPdf();
    });

    document.getElementById('btn-print')!.addEventListener('click', () => {
      void this.printCurrentTab();
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

    // Context menu actions for tab bar
    this.tabContextMenuEl.addEventListener('click', async (e) => {
      const actionBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tab-ctx]');
      if (!actionBtn) return;
      const action = actionBtn.dataset.tabCtx;
      const targetId = this.tabContextTargetId;
      this.tabContextMenuEl.hidePopover?.();
      if (!targetId) return;

      const tab = this.tabs.find((t) => t.id === targetId);
      if (!tab) return;

      switch (action) {
        case 'close':
          await this.requestCloseTab(tab.id);
          break;
        case 'close-others':
          await this.closeOtherTabs(tab.id);
          break;
        case 'close-to-right':
          await this.closeTabsToRight(tab.id);
          break;
        case 'reveal':
          if (tab.path) void backend.revealInExplorer(tab.path);
          break;
        case 'copy-path':
          if (tab.path) {
            await navigator.clipboard.writeText(tab.path).catch(() => {});
            this.showToast('Dateipfad in Zwischenablage kopiert');
          }
          break;
        case 'copy-markdown':
          await navigator.clipboard.writeText(tab.currentContent).catch(() => {});
          this.showToast(isMarkdownPath(tab.name) ? 'Markdown in Zwischenablage kopiert' : 'Quelltext in Zwischenablage kopiert');
          break;
        case 'copy-ai-context': {
          let fence = '```';
          while (tab.currentContent.includes(fence)) {
            fence += '`';
          }
          const ext = getFileExtension(tab.name) || 'markdown';
          const body = tab.currentContent.endsWith('\n') ? tab.currentContent : `${tab.currentContent}\n`;
          const payload = `${fence}${ext}:${tab.name}\n${body}${fence}\n`;
          await navigator.clipboard.writeText(payload).catch(() => {});
          this.showToast(`Als KI-Kontext (${tab.name}) kopiert`);
          break;
        }
      }
    });

    // Double click empty tab bar space to open a new tab
    const tabStripWrap = document.querySelector('.tab-strip-wrap');
    tabStripWrap?.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('.tab-slot, button')) return;
      this.createNewTab();
    });

    // Native Ctrl + MouseWheel document text zoom
    window.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey) {
          e.preventDefault();
          const delta = e.deltaY < 0 ? 5 : -5;
          this.setZoomPercent(this.zoomPercent + delta);
        }
      },
      { passive: false },
    );

    const formatBarEl = document.getElementById('format-bar')!;
    formatBarEl.addEventListener('pointerdown', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fmt]');
      if (btn) {
        // Prevent button from stealing focus and collapsing the active CodeMirror text selection
        e.preventDefault();
      }
    });

    formatBarEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fmt]');
      if (!btn) return;
      const fmt = btn.dataset.fmt as FormatAction;
      if (fmt === 'align-table') {
        this.alignActiveMarkdownTables();
      } else {
        this.editor.applyFormat(fmt);
      }
    });

    const tableDialog = document.getElementById('table-dialog') as HTMLDialogElement;
    tableDialog.addEventListener('close', () => {
      const action = tableDialog.returnValue;
      tableDialog.returnValue = '';
      if (action !== 'insert') return;

      const cols = Math.max(
        1,
        Math.min(
          12,
          Number((document.getElementById('table-cols') as HTMLInputElement).value) || 3,
        ),
      );
      const rows = Math.max(
        1,
        Math.min(
          50,
          Number((document.getElementById('table-rows') as HTMLInputElement).value) || 3,
        ),
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
            this.showToast('Codeblock in Zwischenablage kopiert');
            setTimeout(() => {
              copyBtn.textContent = 'Kopieren';
            }, 1400);
          });
        }
        return;
      }

      const copyMermaidBtn = target.closest<HTMLButtonElement>('.copy-mermaid-btn');
      if (copyMermaidBtn) {
        const wrapper = copyMermaidBtn.closest('.mermaid-wrapper');
        const svgEl = wrapper?.querySelector('svg');
        if (svgEl) {
          void navigator.clipboard.writeText(svgEl.outerHTML).then(() => {
            copyMermaidBtn.textContent = 'Kopiert ✓';
            this.showToast('Mermaid-SVG in Zwischenablage kopiert');
            setTimeout(() => {
              copyMermaidBtn.textContent = 'SVG kopieren';
            }, 1400);
          });
        }
        return;
      }

      const zoomMermaidBtn = target.closest<HTMLButtonElement>('.zoom-mermaid-btn');
      if (zoomMermaidBtn) {
        const wrapper = zoomMermaidBtn.closest('.mermaid-wrapper');
        const svgEl = wrapper?.querySelector('svg');
        if (svgEl) {
          this.openMermaidLightbox(svgEl.outerHTML);
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
        } else if (/\.md(?:#.*)?$/i.test(href) && this.activeTab?.parentDir) {
          e.preventDefault();
          const hashIdx = href.indexOf('#');
          const hashId = hashIdx >= 0 ? decodeURIComponent(href.slice(hashIdx + 1)) : '';
          const joined = resolveRelativeMarkdownPath(this.activeTab.parentDir, href);
          void this.openFileByPath(joined).then(() => {
            if (hashId) {
              requestAnimationFrame(() => {
                this.previewContentEl
                  .querySelector(`#${CSS.escape(hashId)}`)
                  ?.scrollIntoView({ behavior: 'smooth' });
              });
            }
          });
        }
      }
    });

    // Status bar interactive buttons
    this.statusPathBtn.addEventListener('click', () => {
      const p = this.activeTab?.path ?? this.explorer.rootPath;
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
      const targetPath = this.externalChangedPath;
      this.externalChangedPath = null;
      if (!targetPath) return;
      const tab = this.tabs.find(
        (t) => t.path?.toLowerCase() === targetPath.toLowerCase(),
      );
      if (tab && tab.path) {
        tab.hasExternalConflict = false;
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
      if (this.activeTab) {
        this.activeTab.hasExternalConflict = false;
      }
      if (this.externalChangedPath) {
        const tab = this.tabs.find(
          (t) => t.path?.toLowerCase() === this.externalChangedPath?.toLowerCase(),
        );
        if (tab) tab.hasExternalConflict = false;
        this.externalChangedPath = null;
      }
    });

    // Application-wide keyboard shortcuts in capture phase so CodeMirror's unshifted
    // keymap fallbacks (e.g. Mod-f / Mod-d / Mod-k) never intercept Mod+Shift app commands.
    // Explicitly guarded against DE-QWERTZ AltGr (`Ctrl+Alt` / `AltGraph`).
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.getModifierState?.('AltGraph') || (e.ctrlKey && e.altKey)) {
          return;
        }
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();
        const openDialogs = document.querySelectorAll('dialog[open]');
        if (openDialogs.length > 0) {
          const onlyPaletteOpen =
            openDialogs.length === 1 && openDialogs[0].id === 'palette-dialog';
          const isPaletteSwitch =
            mod && !e.altKey && ((key === 'e' && !e.shiftKey) || (key === 'p' && e.shiftKey));
          if (!onlyPaletteOpen || !isPaletteSwitch) {
            return;
          }
        }

        const consume = () => {
          e.preventDefault();
          e.stopPropagation();
        };

        if (e.key === 'Escape' && !mod && !e.altKey && !e.shiftKey) {
          const hasOpenPopover = !!document.querySelector(':popover-open');
          if (this.appEl.classList.contains('is-zen') && !hasOpenPopover) {
            consume();
            this.appEl.classList.remove('is-zen');
            return;
          }
        }

        if (mod && !e.altKey && !e.shiftKey && key === 'e') {
          consume();
          this.palette.open('files');
        } else if (mod && !e.altKey && e.shiftKey && key === 'p') {
          consume();
          this.palette.open('commands');
        } else if (mod && !e.altKey && !e.shiftKey && key === 'f') {
          consume();
          this.openEditorSearchPanel();
        } else if (mod && !e.altKey && !e.shiftKey && key === 'h') {
          consume();
          this.openEditorReplacePanel();
        } else if (mod && !e.altKey && !e.shiftKey && key === 'n') {
          consume();
          newTabFn();
        } else if (mod && !e.altKey && !e.shiftKey && key === 'o') {
          consume();
          void this.triggerOpenFilesDialog();
        } else if (mod && !e.altKey && e.shiftKey && key === 'o') {
          consume();
          void this.triggerOpenFolderDialog();
        } else if (mod && !e.altKey && e.shiftKey && key === 'f') {
          consume();
          this.switchSidebarPanel('search');
        } else if (mod && !e.altKey && !e.shiftKey && key === 's') {
          consume();
          if (this.activeTab) void this.saveTab(this.activeTab, false);
        } else if (mod && !e.altKey && e.shiftKey && key === 's') {
          consume();
          if (this.activeTab) void this.saveTab(this.activeTab, true);
        } else if (mod && !e.altKey && e.shiftKey && key === 'k') {
          consume();
          void this.copyCurrentTabRichText();
        } else if (mod && !e.altKey && e.shiftKey && key === 'c') {
          consume();
          void this.copyCurrentTabMarkdown();
        } else if (mod && !e.altKey && e.shiftKey && key === 'd') {
          consume();
          void this.exportCurrentTabPdf();
        } else if (mod && !e.altKey && !e.shiftKey && key === 'p') {
          consume();
          void this.printCurrentTab();
        } else if (mod && !e.altKey && !e.shiftKey && key === 'w') {
          consume();
          if (this.activeTab) void this.requestCloseTab(this.activeTab.id);
        } else if (mod && !e.altKey && e.shiftKey && key === 't') {
          consume();
          void this.reopenLastClosedTab();
        } else if (mod && !e.altKey && (key === 'tab' || key === 'pagedown' || key === 'next')) {
          if (key === 'tab') {
            consume();
            this.cycleActiveTab(e.shiftKey ? -1 : 1);
          } else if (!e.shiftKey) {
            consume();
            this.cycleActiveTab(1);
          }
        } else if (mod && !e.altKey && !e.shiftKey && (key === 'pageup' || key === 'prior')) {
          consume();
          this.cycleActiveTab(-1);
        } else if (mod && !e.altKey && !e.shiftKey && key === 'j') {
          consume();
          this.sidebarEl.classList.toggle('is-collapsed');
        } else if (mod && !e.altKey && (e.key === '+' || e.key === '=')) {
          consume();
          this.setZoomPercent(this.zoomPercent + 10);
        } else if (mod && !e.altKey && e.key === '-') {
          consume();
          this.setZoomPercent(this.zoomPercent - 10);
        } else if (mod && !e.altKey && e.key === '0') {
          consume();
          this.setZoomPercent(100);
        } else if (e.altKey && !mod && !e.shiftKey && key === 'z') {
          consume();
          this.toggleWordWrap();
        } else if (e.altKey && !mod && e.key === '1') {
          consume();
          this.setViewMode('editor');
        } else if (e.altKey && !mod && e.key === '2') {
          consume();
          this.setViewMode('split');
        } else if (e.altKey && !mod && e.key === '3') {
          consume();
          this.setViewMode('preview');
        } else if (e.key === 'F11') {
          consume();
          toggleZen();
        } else if (e.key === 'F1') {
          consume();
          shortcutsDialog.showModal();
        }
      },
      { capture: true },
    );
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
        await this.explorer.loadFolder(folder, true);
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
            tab.hasExternalConflict = false;
            if (tab.id === this.activeTabId) {
              this.externalBannerEl.hidden = true;
            }
            this.renderTabBar();
            this.scheduleDraftSync();
            continue;
          }
          if (!tab.isDirty) {
            tab.savedContent = disk.content;
            tab.currentContent = disk.content;
            tab.encoding = disk.encoding || 'UTF-8';
            tab.lineEnding = disk.lineEnding;
            tab.hasExternalConflict = false;
            if (tab.id === this.activeTabId) {
              this.externalBannerEl.hidden = true;
              this.editor.replaceAllContent(disk.content);
            } else {
              tab.editorState = this.editor.createState(disk.content);
            }
          } else {
            tab.hasExternalConflict = true;
            if (tab.id === this.activeTabId) {
              this.externalChangedPath = tab.path;
              this.externalBannerEl.hidden = false;
            }
          }
        } catch {
          // File may have been deleted or temporarily locked
        }
      }

      if (this.explorer.hasWorkspace) {
        this.explorer.scheduleRefresh();
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
