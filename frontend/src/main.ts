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
import { extractTemplateVariables, formatAiContextEntry, toWorkspaceRelativeLabel } from './ai-bundle';
import {
  openAiBundleDialogModal,
  openCompareDiffDialogModal,
  openExternalDiffDialogModal,
  openPromptVariablesDialogModal,
} from './ai-dialogs';
import { AiTemplateId, getAiTemplate } from './ai-templates';
import {
  CODEBLOCK_LANGUAGES,
  FormatAction,
  GITHUB_ALERT_TYPES,
  MarkdownEditorController,
} from './editor';
import { DocumentAutoSave } from './document-auto-save';
import { DocumentCloseController, type UnsavedChoice } from './document-close';
import { DocumentExportController, type DocumentSnapshot } from './document-export';
import { DocumentFileOperations } from './document-file-operations';
import {
  applyDiskDocumentVersion,
  applyDocumentEdit,
  restoreDocumentDraft,
  setDocumentLineEnding,
  setExternalDocumentConflict,
  type DiskDocumentVersion,
  type FileDocument,
} from './document-state';
import { renderDocument } from './export-utils';
import { formatMarkdownDocument } from './markdown-formatter';
import { lintMarkdownDocument, type LintIssue, type LintOptions } from './markdown-lint';
import { MermaidViewer } from './mermaid-viewer';
import { bindRovingHorizontalKeyNav, syncRovingTabindex } from './navigation-a11y';
import { CommandPaletteController } from './palette';
import { buildPaletteCommandItems, buildPaletteFileItems } from './palette-items';
import {
  baseNameOfPath,
  isMarkdownPath,
  isSameOrDescendantPath,
  parentDirOfPath,
  resolveRelativeMarkdownPath,
} from './path-utils';
import { installProgressiveEnhancements } from './polyfills';
import { safeSetMarkdownHTML } from './sanitizer';
import { SidebarExplorerController } from './sidebar-explorer';
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  clampSidebarWidth,
  clampSplitRatio,
  formatSidebarValueText,
  formatSplitValueText,
  parseSplitRatios,
  type SplitRatios,
  snapSplitRatio,
  splitRatioFromPointer,
} from './layout-utils';
import {
  calculateDetailedStats,
  computeHeadingTokenCounts,
  extractMarkdownSection,
} from './stats-utils';
import { SyncScrollController } from './sync-scroll';
import { findAdjacentTabId, reorderTabList, toggleTabPinned } from './tab-utils';
import { bindThemeSystem, toggleTheme } from './theme';
import { SettingsController } from './settings';
import { getLanguage, setLanguage, onLanguageChange, t, updateDomLanguage, Language } from './i18n';
import { estimateTokens } from './token-utils';
import { WELCOME_MARKDOWN, getWelcomeMarkdown } from './welcome';
import { WorkspaceSearchController } from './workspace-search';

installProgressiveEnhancements();

interface OpenTab extends FileDocument {
  id: string;
  editorState: EditorState;
  editorScrollTop: number;
  previewScrollTop: number;
  outline: HeadingItem[];
  stats: DocStats;
  isPinned?: boolean;
}

class SemyraApp {
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
  private splitOrientation: 'vertical' | 'horizontal' = 'vertical';
  /** Remembered split ratio per orientation so toggling restores each layout's own proportions. */
  private splitRatios: SplitRatios = parseSplitRatios(null);
  private editorCentered = false;
  private zoomPercent = 100;
  private recentFiles: string[] = [];
  private recentFolders: string[] = [];
  private activeHeadingSlug: string | null = null;

  private renderDebounceTimer: number | undefined;
  private readonly autoSave = new DocumentAutoSave<OpenTab>(
    (tab): boolean => this.documentClose.isClosing(tab),
    (tab) => this.documentFiles.save(tab, false, true),
  );
  private readonly documentFiles = new DocumentFileOperations<OpenTab>({
    isOpen: (tab) => this.tabs.includes(tab),
    getWorkspaceRoot: () => this.explorer.rootPath,
    beforeSave: (tab, automatic) => {
      if (automatic && !this.autoSave.canSave(tab)) return false;
      this.autoSave.cancel(tab);
      return true;
    },
    onSaved: (tab, previousPath, savedAs) => this.onTabSaved(tab, previousPath, savedAs),
    onSaveConflict: (tab) => {
      this.markExternalConflict(tab);
      this.showToast(t('toast.saveConflict'));
    },
    onSaveError: (err) => {
      console.error('Datei konnte nicht gespeichert werden:', err);
      this.showToast(err instanceof Error ? err.message : t('toast.saveFailed'));
    },
  });
  private readonly documentClose = new DocumentCloseController(this.documentFiles, this.autoSave, {
    getDocuments: () => this.tabs,
    promptTab: (tab) => this.promptUnsavedChanges(t('unsavedDialog.descWithName', { name: tab.name })),
    promptWindow: (tabs) => {
      const names = tabs.map((tab) => `„${tab.name}“`).join(', ');
      return this.promptUnsavedChanges(t('unsavedDialog.beforeQuitDesc', { names }));
    },
    removeTab: (tab) => this.removeClosedTab(tab),
    prepareWindowClose: async () => {
      window.clearTimeout(this.prefsSyncTimer);
      return await this.persistUiPrefs() || window.confirm(t('prefs.closeAfterSaveFailure'));
    },
    closeNativeWindow: () => {
      document.body.inert = true;
      return backend.forceCloseWindow(this.recoveryRestored);
    },
    onWindowCloseAborted: () => { document.body.inert = false; },
    onWindowCloseError: (err) => console.error('Fenster konnte nicht geschlossen werden:', err),
  });
  private draftSyncTimer: number | undefined;
  private draftDeadlineTimer: number | undefined;
  private draftRevision = 0;
  private recoveryRestored = false;
  private prefsSyncTimer: number | undefined;
  private prefsRevision = 0;
  private prefsSaveFailed = false;
  private toastTimer: number | undefined;
  private renderSeq = 0;
  private externalChangedPath: string | null = null;
  private sidebarSourceMode: 'workspace' | 'ai-library' = 'workspace';
  private lastWorkfolderPath: string | null = null;
  private aiLibraryRootPath: string | null = null;
  private currentLintIssues: LintIssue[] = [];
  private cachedWorkspaceRootForLint: string | null = null;
  private cachedWorkspaceRelPaths: string[] | null = null;
  private lintWorkspaceRefreshInFlight: string | null = null;
  private navHistory: Array<{ tabId: string; path: string | null }> = [];
  private navHistoryIndex = -1;
  private navigatingHistoryDepth = 0;
  private navHistorySeq = 0;
  private previewFindMatches: HTMLElement[] = [];
  private previewFindActiveIdx = -1;

  // DOM References
  private appEl = document.getElementById('app')!;
  private sidebarEl = document.getElementById('sidebar')!;
  private tabBarEl = document.getElementById('tab-bar')!;
  private previewPaneEl = document.getElementById('preview-pane')!;
  private previewContentEl = document.getElementById('preview-content')!;
  private previewFindBarEl = document.getElementById('preview-find-bar')!;
  private previewFindInputEl = document.getElementById('preview-find-input') as HTMLInputElement;
  private previewFindCountEl = document.getElementById('preview-find-count')!;
  private readonly mermaidViewer = new MermaidViewer();
  private documentExport = new DocumentExportController(
    () => this.snapshotActiveDocument(),
    this.previewPaneEl,
    (message) => this.showToast(message),
  );
  private outlineEl = document.getElementById('outline-container')!;
  private outlineCountBadgeEl = document.getElementById('outline-count-badge');
  private statusPathBtn = document.getElementById('status-filepath') as HTMLButtonElement;
  private statusSaveBadge = document.getElementById('status-save-badge')!;
  private statusCursorEl = document.getElementById('status-cursor')!;
  private statusDocSummaryBtn = document.getElementById('status-doc-summary') as HTMLButtonElement | null;
  private statusWordsEl = document.getElementById('status-words');
  private statusTokensEl = document.getElementById('status-tokens');
  private statusReadtimeEl = document.getElementById('status-readtime');
  private statusZoomBtn = document.getElementById('status-zoom') as HTMLButtonElement;
  private statusEolBtn = document.getElementById('status-eol') as HTMLButtonElement;
  private statusEncodingEl = document.getElementById('status-encoding')!;
  private statusLintBtn = document.getElementById('status-lint-badge') as HTMLButtonElement | null;
  private statusToastEl = document.getElementById('status-toast')!;
  private formatBarVisible = true;
  private btnCopyMarkdown = document.getElementById('btn-copy-markdown') as HTMLButtonElement | null;
  private dropOverlayEl = document.getElementById('drop-overlay')!;
  private externalBannerEl = document.getElementById('external-banner')!;
  private tabContextMenuEl = document.getElementById('tab-context-menu') as HTMLElement & {
    showPopover?: () => void;
    hidePopover?: () => void;
  };
  private tableContextMenuEl = document.getElementById('table-context-menu') as HTMLElement & {
    showPopover?: () => void;
    hidePopover?: () => void;
  };
  private tabContextTargetId: string | null = null;
  private gotoLineReturnFocusEl: HTMLElement | null = null;
  private tabDragState: {
    tabId: string;
    startX: number;
    startY: number;
    isDragging: boolean;
    targetTabId: string | null;
    isAfter: boolean;
  } | null = null;
  private suppressNextTabClick = false;
  private settingsCtrl!: SettingsController;

  public async init(): Promise<void> {
    const cmHost = document.getElementById('codemirror-host')!;
    this.editor = new MarkdownEditorController(cmHost, '', {
      onDocChanged: (content) => this.handleEditorContentChange(content),
      onCursorChanged: (line, col, selChars, selWords) => {
        this.statusCursorEl.textContent = t('status.cursor', { line, col });
        this.lastSelection = { chars: selChars, words: selWords };
        this.updateWordCountDisplay();
      },
      onEditorScrolled: () => this.syncScroll.syncEditorToPreview(),
      onFormatCommand: (cmd) => this.editor.applyFormat(cmd),
      onPasteImage: (mimeType, dataUrl) => {
        void this.handlePasteImage(mimeType, dataUrl);
      },
      onPickImage: () => this.pickImageFromDisk(),
      onCopyRichText: () => {
        void this.documentExport.copyRichText();
      },
      onCopyMarkdown: () => {
        void this.copyCurrentTabMarkdown();
      },
      onTableContextMenu: (clientX, clientY) => {
        this.openTableContextMenu(clientX, clientY);
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
      onOpenFilePath: async (filePath) => {
        await this.openFileByPath(filePath);
      },
      onOpenCreatedFile: (payload) => {
        this.invalidateLintWorkspaceCache();
        this.openTabFromPayload(payload);
      },
      onTriggerOpenFolderDialog: () => this.triggerOpenFolderDialog(),
      onWorkspaceFolderLoaded: (folderPath, persistPrefs) => {
        this.invalidateLintWorkspaceCache();
        void this.workspaceSearch.runSearch();
        if (this.sidebarSourceMode === 'workspace') {
          this.lastWorkfolderPath = folderPath;
          this.pushRecentFolder(folderPath);
          if (persistPrefs) {
            this.schedulePrefsSave();
          }
        }
      },
      onEntryRenamed: (oldPath, newPath, newName) => {
        this.handleExplorerEntryRenamed(oldPath, newPath, newName);
      },
      onEntryDeleted: (deletedPath) => {
        this.handleExplorerEntryDeleted(deletedPath);
      },
      onRemoveRecentFolder: (folderPath) => {
        this.recentFolders = this.recentFolders.filter((p) => p !== folderPath);
        this.schedulePrefsSave();
        this.explorer.renderEmptyStateWithRecents(this.recentFolders, this.recentFiles);
        this.showToast(t('toast.recentFolderRemoved'));
      },
      onRemoveRecentFile: (filePath) => {
        this.recentFiles = this.recentFiles.filter((p) => p !== filePath);
        this.schedulePrefsSave();
        this.explorer.renderEmptyStateWithRecents(this.recentFolders, this.recentFiles);
        this.showToast(t('toast.recentFileRemoved'));
      },
      onCopyAtPath: async (entryPath) => {
        await this.copyAtPathForTarget(entryPath, baseNameOfPath(entryPath));
      },
      onScaffoldAgents: async (targetDir) => {
        await this.scaffoldWorkspaceAgents(targetDir);
      },
      onScaffoldSkill: (targetDir) => {
        this.scaffoldWorkspaceSkill(targetDir);
      },
      onBundleWorkspace: (rootPath) => this.openAiBundleDialog(rootPath),
    });

    this.workspaceSearch = new WorkspaceSearchController({
      searchInputEl: document.getElementById('workspace-search-input') as HTMLInputElement,
      replaceInputEl: document.getElementById('workspace-replace-input') as HTMLInputElement | null,
      replaceAllBtn: document.getElementById('btn-workspace-replace-all') as HTMLButtonElement | null,
      clearBtn: document.getElementById('btn-search-clear') as HTMLButtonElement | null,
      statusBadgeEl: document.getElementById('search-status-badge'),
      caseToggleBtn: document.getElementById('btn-search-case')!,
      resultsContainerEl: document.getElementById('search-results-container')!,
      getWorkspaceRootPath: () => this.explorer.rootPath,
      onOpenMatch: async (filePath, line) => {
        await this.openFileByPath(filePath);
        requestAnimationFrame(() => {
          this.editor.jumpToLine(line);
        });
      },
      onFilesReplaced: async (res) => {
        const updatedSet = new Set(res.updatedPaths.map((p) => p.toLowerCase()));
        await Promise.all(this.tabs
          .filter((tab) => tab.path && updatedSet.has(tab.path.toLowerCase()))
          .map((tab) => this.syncTabFromDisk(tab)));
        const summary = { count: res.totalReplacements, files: res.filesUpdated };
        if (res.failures.length > 0) {
          console.error('Ordner-Ersetzen konnte einige Dateien nicht verarbeiten:', res.failures);
          this.showToast(t('toast.workspaceReplacePartial', {
            ...summary,
            failed: res.failures.length,
            file: res.failures[0].path,
          }) + (res.failures.some(f => f.error === 'encoding_conversion_required') ? ' ' + t('encoding.replaceSkipped') : ''), 7000);
        } else {
          this.showToast(res.totalReplacements > 0
            ? t('toast.workspaceReplaced', summary)
            : t('toast.workspaceReplaceNone'));
        }
      },
      onReplaceError: () => this.showToast(t('toast.workspaceReplaceFailed')),
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
            getWorkspaceFiles: async () => (await this.explorer.getWorkspaceFiles()) ?? [],
            recentFiles: this.recentFiles,
            recentFolders: this.recentFolders,
            onActivateTab: (tabId) => this.activateTab(tabId),
            onOpenFile: async (filePath) => {
              await this.openFileByPath(filePath);
            },
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
            autoSaveActive: this.autoSave.isEnabled,
            currentLineEnding: this.activeTab?.lineEnding ?? 'CRLF',
            onNewTab: () => this.createNewTab(),
            onOpenFileDialog: () => this.triggerOpenFilesDialog(),
            onOpenFolderDialog: () => this.triggerOpenFolderDialog(),
            onSave: () => {
              if (this.activeTab) void this.documentFiles.save(this.activeTab);
            },
            onSaveAs: () => {
              if (this.activeTab) void this.documentFiles.save(this.activeTab, true);
            },
            onCopyRichText: () => {
              void this.documentExport.copyRichText();
            },
            onCopyMarkdown: () => {
              void this.copyCurrentTabMarkdown();
            },
            onCopyAiContext: () => {
              void this.copyCurrentTabAiContext();
            },
            onCopyAtPath: () => {
              void this.copyAtPath();
            },
            onOpenAiBundle: () => {
              this.openAiBundleDialog();
            },
            onFillPromptVariables: () => {
              this.openPromptVariablesDialog();
            },
            onCreateFromTemplate: (templateId) => {
              this.createTabFromAiTemplate(templateId);
            },
            onScaffoldWorkspaceAgents: () => {
              void this.scaffoldWorkspaceAgents();
            },
            onScaffoldWorkspaceSkill: () => {
              this.scaffoldWorkspaceSkill();
            },
            onExportHtml: () => {
              void this.documentExport.exportHtml();
            },
            onExportHtmlLight: () => {
              void this.documentExport.exportHtml('light');
            },
            onExportHtmlDark: () => {
              void this.documentExport.exportHtml('dark');
            },
            onExportPdf: () => {
              void this.documentExport.exportPdf();
            },
            onDiffWithSaved: () => {
              void this.openDiffWithSavedDialog();
            },
            onCompareOpenTabs: () => {
              this.openCompareOpenTabsDialog();
            },
            onPrint: () => {
              void this.documentExport.print();
            },
            onAlignTable: () => this.alignActiveMarkdownTables(),
            onInsertTableRowAbove: () => {
              if (this.editor.modifyTable({ type: 'insert-row', direction: 'above' })) {
                this.showToast(t('toast.tableRowAbove'));
              }
            },
            onInsertTableRowBelow: () => {
              if (this.editor.modifyTable({ type: 'insert-row', direction: 'below' })) {
                this.showToast(t('toast.tableRowBelow'));
              }
            },
            onDeleteTableRow: () => {
              if (this.editor.modifyTable({ type: 'delete-row' })) {
                this.showToast(t('toast.tableRowDeleted'));
              }
            },
            onInsertTableColumnLeft: () => {
              if (this.editor.modifyTable({ type: 'insert-col', direction: 'left' })) {
                this.showToast(t('toast.tableColLeft'));
              }
            },
            onInsertTableColumnRight: () => {
              if (this.editor.modifyTable({ type: 'insert-col', direction: 'right' })) {
                this.showToast(t('toast.tableColRight'));
              }
            },
            onDeleteTableColumn: () => {
              if (this.editor.modifyTable({ type: 'delete-col' })) {
                this.showToast(t('toast.tableColDeleted'));
              }
            },
            onSetViewMode: (mode) => this.setViewMode(mode),
            splitOrientation: this.splitOrientation,
            onToggleSplitOrientation: () => this.toggleSplitOrientation(),
            centeredEditorActive: this.editorCentered,
            onToggleCenteredEditor: () => this.toggleEditorCentered(),
            onShowDocStats: () => this.openDocStatsPopover(),
            formatBarVisible: this.formatBarVisible,
            onToggleFormatBar: () => this.toggleFormatBar(),
            onScrollPreviewTop: () => this.previewPaneEl.scrollTo({ top: 0, behavior: 'smooth' }),
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
            onOpenEditorSearch: () => {
              if (this.appEl.getAttribute('data-view') === 'preview') {
                this.openPreviewFind();
              } else {
                this.openEditorSearchPanel();
              }
            },
            onOpenEditorReplace: () => this.openEditorReplacePanel(),
            onOpenSearchPanel: () => this.switchSidebarPanel('search'),
            onOpenOutlinePanel: () => this.switchSidebarPanel('outline'),
            onToggleZen: () => void this.toggleZen(),
            onToggleTheme: () => toggleTheme(),
            onOpenSettings: () => this.settingsCtrl.openSettings(),
            onFormatDocument: this.activeTab && isMarkdownPath(this.activeTab.name)
              ? () => this.formatCurrentTabDocument()
              : undefined,
            onShowLint: () => this.openLintDialog(),
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
        getHeadings: () =>
          (this.activeTab?.outline ?? []).map((h) => ({
            level: h.level,
            text: h.text,
            line: h.line,
          })),
        onJumpToLine: (line) => {
          this.syncScroll.lockScrollForNavigation('editor', 500);
          this.editor.jumpToLine(line);
          if (this.appEl.getAttribute('data-view') === 'preview') {
            const targetEl = this.previewContentEl.querySelector<HTMLElement>(
              `[data-line="${line}"]`,
            );
            targetEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        },
      },
    );

    this.bindCompositeKeyboardNav();
    this.bindUIEvents();

    this.settingsCtrl = new SettingsController(
      () => ({
        wordWrap: this.editor.isWordWrapEnabled(),
        spellcheck: this.editor.isSpellcheckEnabled(),
        autoSave: this.autoSave.isEnabled,
        syncScroll: this.syncScroll.isEnabled(),
        formatBarVisible: this.formatBarVisible,
        centeredEditor: this.editorCentered,
        lineEnding: this.activeTab?.lineEnding ?? 'CRLF',
        language: getLanguage(),
      }),
      {
        onToggleWordWrap: () => this.toggleWordWrap(),
        onToggleSpellcheck: () => this.toggleSpellcheck(),
        onToggleAutoSave: () => this.toggleAutoSave(),
        onToggleSyncScroll: () => this.toggleSyncScroll(),
        onToggleFormatBar: () => this.toggleFormatBar(),
        onToggleCenteredEditor: () => this.toggleEditorCentered(),
        onToggleOrientation: () => this.toggleSplitOrientation(),
        onToggleZen: () => void this.toggleZen(),
        onResetSplit: () => this.setSplitRatio(50),
        onSetLineEnding: (eol) => this.setActiveTabLineEnding(eol),
        onSetLanguage: (lang) => {
          setLanguage(lang);
          this.schedulePrefsSave();
        },
        onOpenShortcuts: () => {
          (document.getElementById('shortcuts-dialog') as HTMLDialogElement)?.showModal();
        },
      },
    );
    bindThemeSystem(() => {
      if (this.activeTab) {
        void this.renderPreviewImmediate(
          this.activeTab.currentContent,
          this.activeTab.parentDir ?? this.explorer.rootPath,
        );
      }
    });

    onLanguageChange((lang) => {
      this.editor.setAppLanguage(lang);
      this.settingsCtrl?.syncAll();
      this.updateStatusBar();
      this.renderTabBar();
      if (!this.explorer.hasWorkspace) {
        this.explorer.renderEmptyStateWithRecents(this.recentFolders, this.recentFiles);
      } else {
        void this.explorer.refresh();
      }
      if (this.activeTab) {
        this.renderOutline(this.activeTab.outline);
        void this.renderPreviewImmediate(
          this.activeTab.currentContent,
          this.activeTab.parentDir ?? this.explorer.rootPath,
        );
      }
      this.syncWindowMetadata();
      this.showToast(t('toast.langChanged'));
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
        const pinnedSet = new Set(
          (startup.uiPrefs.pinnedSessionFiles ?? []).map((p) => p.toLowerCase()),
        );
        if (pinnedSet.size > 0) {
          for (const tab of this.tabs) {
            if (tab.path && pinnedSet.has(tab.path.toLowerCase())) {
              tab.isPinned = true;
            }
          }
          this.tabs = [
            ...this.tabs.filter((t) => t.isPinned),
            ...this.tabs.filter((t) => !t.isPinned),
          ];
          this.renderTabBar();
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
      this.recoveryRestored = true;
      if (startup.recoveredDrafts.length > 0) this.flushDraftSync();
    } catch {
      // Fallback to welcome tab
    }

    if (!this.explorer.hasWorkspace) {
      this.explorer.renderEmptyStateWithRecents(this.recentFolders, this.recentFiles);
    }

    if (this.tabs.length === 0) {
      const isEn = getLanguage() === 'en';
      this.createNewTab(
        isEn ? 'Welcome.md' : 'Willkommen.md',
        getWelcomeMarkdown(getLanguage()),
        false,
      );
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
    this.setSplitOrientation(prefs.splitOrientation ?? 'vertical', false);
    this.setSplitRatio(prefs.splitRatio || 50, false);
    this.setZoomPercent(prefs.zoomPercent || 100, false);

    this.syncScroll.setEnabled(prefs.syncScroll);
    const syncBtn = document.getElementById('btn-sync-scroll');
    if (syncBtn) {
      syncBtn.classList.toggle('is-active', prefs.syncScroll);
      syncBtn.setAttribute('aria-pressed', String(prefs.syncScroll));
    }

    this.autoSave.setEnabled(prefs.autoSave);
    const autoBtn = document.getElementById('btn-autosave');
    if (autoBtn) {
      autoBtn.classList.toggle('is-active', prefs.autoSave);
      autoBtn.setAttribute('aria-pressed', String(prefs.autoSave));
    }

    this.editor.setWordWrap(prefs.wordWrap);
    const wrapBtn = document.getElementById('btn-word-wrap');
    if (wrapBtn) {
      wrapBtn.classList.toggle('is-active', prefs.wordWrap);
      wrapBtn.setAttribute('aria-pressed', String(prefs.wordWrap));
    }

    this.editor.setSpellcheck(prefs.spellcheck);

    if (typeof prefs.formatBarVisible === 'boolean') {
      this.formatBarVisible = prefs.formatBarVisible;
    }
    this.applyFormatBarVisibility();

    if (prefs.language === 'de' || prefs.language === 'en') {
      setLanguage(prefs.language, false);
      this.editor.setAppLanguage(prefs.language);
    }

    this.recentFiles = prefs.recentFiles ?? [];
    this.recentFolders = prefs.recentFolders ?? [];
    this.settingsCtrl?.syncAll();
  }

  public toggleSpellcheck(): void {
    const next = !this.editor.isSpellcheckEnabled();
    this.editor.setSpellcheck(next);
    this.settingsCtrl?.syncAll();
    this.schedulePrefsSave();
    this.showToast(next ? t('toast.spellcheckOn') : t('toast.spellcheckOff'));
  }

  public toggleFormatBar(): void {
    this.formatBarVisible = !this.formatBarVisible;
    this.applyFormatBarVisibility();
    this.settingsCtrl?.syncAll();
    this.schedulePrefsSave();
    this.showToast(
      this.formatBarVisible
        ? t('toast.formatBarOn')
        : t('toast.formatBarOff'),
    );
  }

  private applyFormatBarVisibility(): void {
    const bar = document.getElementById('format-bar');
    const expandBtn = document.getElementById('btn-expand-format-bar');
    if (bar) {
      bar.classList.toggle('is-collapsed', !this.formatBarVisible);
    }
    if (expandBtn) {
      expandBtn.hidden = this.formatBarVisible;
    }
  }

  private setSidebarWidth(px: number, persist = true): void {
    const clamped = clampSidebarWidth(px, window.innerWidth);
    document.documentElement.style.setProperty('--sidebar-width', `${clamped}px`);
    const resizer = document.getElementById('sidebar-resizer');
    resizer?.setAttribute('aria-valuenow', String(clamped));
    resizer?.setAttribute('aria-valuetext', formatSidebarValueText(clamped));
    if (persist) {
      try {
        localStorage.setItem('semyra.sidebarWidth', String(clamped));
      } catch {
        // Storage unavailable: width simply is not persisted.
      }
    }
  }

  private initLayoutPreferences(): void {
    try {
      this.splitRatios = parseSplitRatios(localStorage.getItem('semyra.splitRatios'));
      this.editorCentered = localStorage.getItem('semyra.editorCentered') === '1';
    } catch {
      // ignore
    }
    this.splitRatios[this.splitOrientation] = this.splitRatio;
    this.applyEditorCentered();

    // Auto-collapse sidebar on narrow screens during startup to grant primary space to editor
    if (window.innerWidth < 800 && !this.sidebarEl.classList.contains('is-collapsed')) {
      this.sidebarEl.classList.add('is-collapsed');
    }
  }

  private applyEditorCentered(): void {
    this.appEl.dataset.editorWidth = this.editorCentered ? 'centered' : 'full';
  }

  private toggleEditorCentered(): void {
    this.editorCentered = !this.editorCentered;
    this.applyEditorCentered();
    this.settingsCtrl?.syncAll();
    try {
      localStorage.setItem('semyra.editorCentered', this.editorCentered ? '1' : '0');
    } catch {
      // ignore
    }
    this.showToast(
      this.editorCentered ? t('toast.centeredOn') : t('toast.centeredOff'),
    );
  }

  private bindSidebarResizer(): void {
    const handle = document.getElementById('sidebar-resizer');
    if (!handle) return;

    let stored = SIDEBAR_WIDTH_DEFAULT;
    try {
      const raw = Number(localStorage.getItem('semyra.sidebarWidth'));
      if (raw > 0) stored = raw;
    } catch {
      // ignore
    }
    this.setSidebarWidth(stored, false);

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('is-dragging');
      const left = this.sidebarEl.getBoundingClientRect().left;

      const onMove = (ev: PointerEvent) => this.setSidebarWidth(ev.clientX - left, false);
      const onUp = (ev: PointerEvent) => {
        handle.releasePointerCapture(ev.pointerId);
        handle.classList.remove('is-dragging');
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        this.setSidebarWidth(this.sidebarEl.getBoundingClientRect().width);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });

    handle.addEventListener('dblclick', () => this.setSidebarWidth(SIDEBAR_WIDTH_DEFAULT));

    handle.addEventListener('keydown', (e) => {
      const current = this.sidebarEl.getBoundingClientRect().width;
      const step = e.shiftKey ? 32 : 16;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.setSidebarWidth(current - step);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.setSidebarWidth(current + step);
      } else if (e.key === 'Home') {
        e.preventDefault();
        this.setSidebarWidth(SIDEBAR_WIDTH_DEFAULT);
      } else if (e.key === 'End') {
        e.preventDefault();
        this.setSidebarWidth(SIDEBAR_WIDTH_MAX);
      }
    });

    window.addEventListener('resize', () => {
      const w = this.sidebarEl.getBoundingClientRect().width;
      if (w > 0) this.setSidebarWidth(w, false);
    });
  }

  private setSplitRatio(pct: number, persist = true): void {
    const clamped = clampSplitRatio(pct);
    this.splitRatio = clamped;
    this.splitRatios[this.splitOrientation] = clamped;
    document.documentElement.style.setProperty('--split-ratio', `${clamped.toFixed(2)}%`);
    const splitResizer = document.getElementById('split-resizer');
    splitResizer?.setAttribute('aria-valuenow', String(Math.round(clamped)));
    splitResizer?.setAttribute(
      'aria-valuetext',
      formatSplitValueText(this.splitOrientation, clamped),
    );
    if (persist) {
      this.saveSplitRatios();
      this.schedulePrefsSave();
    }
  }

  private saveSplitRatios(): void {
    try {
      localStorage.setItem('semyra.splitRatios', JSON.stringify(this.splitRatios));
    } catch {
      // Storage unavailable: ratios are only kept for this session.
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
    this.settingsCtrl?.syncAll();
  }

  private setSplitOrientation(orientation: 'vertical' | 'horizontal', persist = true): void {
    this.splitOrientation = orientation;
    const splitContainer = document.getElementById('split-container');
    if (splitContainer) {
      splitContainer.dataset.orientation = orientation;
    }
    const resizer = document.getElementById('split-resizer');
    resizer?.setAttribute('aria-orientation', orientation);

    if (persist) {
      this.schedulePrefsSave();
    }
    this.settingsCtrl?.syncAll();
  }

  private toggleSplitOrientation(): void {
    const next = this.splitOrientation === 'horizontal' ? 'vertical' : 'horizontal';
    this.splitRatios[this.splitOrientation] = this.splitRatio;
    this.setSplitOrientation(next);
    this.setSplitRatio(this.splitRatios[next]);
    this.showToast(
      next === 'horizontal'
        ? t('toast.splitOrientationH')
        : t('toast.splitOrientationV'),
    );
  }

  private openDocStatsPopover(): void {
    const popover = document.getElementById('doc-stats-popover') as HTMLElement & {
      showPopover?: () => void;
      hidePopover?: () => void;
    };
    if (!popover) return;

    const content = this.activeTab?.currentContent ?? '';
    const stats = calculateDetailedStats(content, this.lastSelection);
    const isEn = getLanguage() === 'en';
    const locale = isEn ? 'en-US' : 'de-DE';

    document.getElementById('stat-words')!.textContent = stats.wordsTotal.toLocaleString(locale);
    document.getElementById('stat-words-sub')!.textContent =
      stats.wordsSelected > 0
        ? t('docStats.wordsSelected', { count: stats.wordsSelected.toLocaleString(locale) })
        : t('docStats.inDoc');

    document.getElementById('stat-chars')!.textContent = stats.charsTotal.toLocaleString(locale);
    document.getElementById('stat-chars-no-space')!.textContent =
      stats.charsSelected > 0
        ? t('docStats.charsNoSpaceSelected', {
            count: stats.charsNoSpaces.toLocaleString(locale),
            selected: stats.charsSelected.toLocaleString(locale),
          })
        : t('docStats.charsNoSpace', { count: stats.charsNoSpaces.toLocaleString(locale) });

    document.getElementById('stat-paragraphs')!.textContent = stats.paragraphsTotal.toLocaleString(locale);
    document.getElementById('stat-lines')!.textContent = t('docStats.linesCount', {
      count: stats.linesTotal.toLocaleString(locale),
    });

    document.getElementById('stat-read-time')!.textContent = stats.readingTimeString;
    document.getElementById('stat-speak-time')!.textContent = t('docStats.speakTimeVal', {
      time: stats.speakingTimeString,
    });

    document.getElementById('stat-flesch-score')!.textContent = `${stats.fleschScore} / 100`;
    document.getElementById('stat-flesch-grade')!.textContent = stats.fleschGrade;

    document.getElementById('stat-tokens')!.textContent = `~${stats.tokensEstimate.toLocaleString(locale)} Tokens`;

    if (typeof popover.showPopover === 'function') {
      try {
        popover.showPopover();
      } catch {
        popover.style.display = 'block';
      }
    } else {
      popover.style.display = 'block';
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
    const pinnedSessionFiles = this.tabs
      .filter((t) => t.isPinned && t.path)
      .map((t) => t.path as string);
    return {
      splitRatio: this.splitRatio,
      splitOrientation: this.splitOrientation,
      zoomPercent: this.zoomPercent,
      syncScroll: this.syncScroll.isEnabled(),
      autoSave: this.autoSave.isEnabled,
      wordWrap: this.editor.isWordWrapEnabled(),
      spellcheck: this.editor.isSpellcheckEnabled(),
      formatBarVisible: this.formatBarVisible,
      language: getLanguage(),
      recentFiles: this.recentFiles,
      recentFolders: this.recentFolders,
      sessionFiles,
      pinnedSessionFiles,
      activeSessionFile: this.activeTab?.path ?? null,
    };
  }

  private schedulePrefsSave(): void {
    window.clearTimeout(this.prefsSyncTimer);
    this.prefsSyncTimer = window.setTimeout(() => {
      void this.persistUiPrefs();
    }, 350);
  }

  private async persistUiPrefs(): Promise<boolean> {
    const revision = ++this.prefsRevision;
    try {
      await backend.saveUiPrefs(revision, this.buildCurrentUiPrefs());
      if (revision === this.prefsRevision) this.prefsSaveFailed = false;
      return true;
    } catch (err) {
      console.error('Einstellungen konnten nicht gespeichert werden:', err);
      if (revision === this.prefsRevision && !this.prefsSaveFailed) {
        this.prefsSaveFailed = true;
        this.showToast(t('toast.prefsSaveFailed'));
      }
      return false;
    }
  }

  // ==========================================================================
  // Crash-Recovery Draft Persistence & Image Insertion
  // ==========================================================================

  private restoreRecoveredDrafts(drafts: DraftEntry[]): void {
    let restoredCount = 0;
    const restoredPaths = new Set<string>();
    for (const draft of drafts) {
      restoredCount++;
      const normLower = draft.path?.toLowerCase();
      const duplicate = normLower !== undefined && restoredPaths.has(normLower);
      if (normLower && !duplicate) {
        restoredPaths.add(normLower);
        const existing = this.tabs.find((t) => t.path?.toLowerCase() === normLower);
        if (existing) {
          restoreDocumentDraft(existing, draft);
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
        name: draft.name || t('tab.untitledName', { num: this.untitledCounter++ }),
        path: duplicate ? null : draft.path,
        parentDir: draft.parentDir ?? this.explorer.rootPath,
        savedContent: draft.savedContent,
        savedLineEnding: draft.savedLineEnding,
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
      this.statusSaveBadge.textContent = t('status.restored');
      if (restoredCount > 0) {
        this.showToast(
          restoredCount === 1
            ? t('toast.draftRestored')
            : t('toast.draftsRestored', { count: restoredCount }),
        );
      }
    }
  }

  private flushDraftSync(): void {
    window.clearTimeout(this.draftSyncTimer);
    window.clearTimeout(this.draftDeadlineTimer);
    this.draftSyncTimer = undefined;
    this.draftDeadlineTimer = undefined;
    const dirtyEntries: DraftEntry[] = this.tabs
      .filter((t) => t.isDirty)
      .map((t) => ({
        name: t.name,
        path: t.path,
        parentDir: t.parentDir,
        content: t.currentContent,
        savedContent: t.savedContent,
        savedLineEnding: t.savedLineEnding,
        lineEnding: t.lineEnding,
      }));
    void backend.saveDrafts(++this.draftRevision, dirtyEntries, this.recoveryRestored).catch((err) => {
      console.error('Entwurfswiederherstellung konnte nicht aktualisiert werden:', err);
      this.showToast(t('toast.draftSaveFailed'));
    });
  }

  private scheduleDraftSync(): void {
    // Keep the first edit's deadline while later edits reset the idle timer.
    this.draftDeadlineTimer ??= window.setTimeout(() => this.flushDraftSync(), 5000);
    window.clearTimeout(this.draftSyncTimer);
    this.draftSyncTimer = window.setTimeout(() => {
      this.flushDraftSync();
    }, 1100);
  }

  private pickImageFromDisk(): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml,image/*';
      input.className = 'visually-hidden';
      let settled = false;

      const finish = (result: string | null) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('focus', onWindowFocus);
        input.remove();
        resolve(result);
      };

      const onWindowFocus = () => {
        window.setTimeout(() => {
          if (!settled && (!input.files || input.files.length === 0)) {
            finish(null);
          }
        }, 300);
      };

      input.addEventListener('cancel', () => finish(null), { once: true });
      input.addEventListener(
        'change',
        () => {
          const file = input.files?.[0];
          if (!file) {
            finish(null);
            return;
          }
          const reader = new FileReader();
          reader.onload = async () => {
            if (typeof reader.result !== 'string') {
              finish(null);
              return;
            }
            const tab = this.activeTab;
            const targetBaseDir = tab?.parentDir ?? this.explorer.rootPath;
            try {
              const res = await backend.savePastedImage(
                targetBaseDir,
                file.type || 'image/png',
                reader.result,
              );
              if (this.explorer.hasWorkspace) {
                this.explorer.scheduleRefresh();
              }
              const match = /\(([^)]+)\)$/.exec(res.markdownSnippet.trim());
              finish(match ? match[1] : null);
            } catch (err) {
              console.error('Bild konnte nicht gespeichert werden:', err);
              finish(null);
            }
          };
          reader.onerror = () => finish(null);
          reader.readAsDataURL(file);
        },
        { once: true },
      );

      document.body.append(input);
      window.addEventListener('focus', onWindowFocus, { once: true });
      input.click();
    });
  }

  private async handlePasteImage(mimeType: string, dataUrl: string): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;
    const targetBaseDir = tab.parentDir ?? this.explorer.rootPath;
    try {
      const res = await backend.savePastedImage(targetBaseDir, mimeType, dataUrl);
      this.editor.insertSnippet(res.markdownSnippet);
      if (this.explorer.hasWorkspace) {
        this.invalidateLintWorkspaceCache();
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
        this.invalidateLintWorkspaceCache();
        this.explorer.scheduleRefresh();
      }
    }
  }

  // ==========================================================================
  // Tab & File Lifecycle
  // ==========================================================================

  private createNewTab(name?: string, initialContent = '', markDirty = false): void {
    this.persistActiveTabScrollAndState();

    const tabName = name ?? t('tab.untitledName', { num: this.untitledCounter++ });
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

    window.clearTimeout(this.renderDebounceTimer);
    this.renderDebounceTimer = undefined;
    this.activeTabId = tabId;
    if (this.navigatingHistoryDepth === 0) {
      this.recordNavigationHistory(target.id, target.path);
    }
    if (target.hasExternalConflict && target.path) {
      this.externalChangedPath = target.path;
      this.externalBannerEl.hidden = false;
    } else {
      this.externalChangedPath = null;
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

  private async openFileByPath(path: string, persistPrefs = true): Promise<boolean> {
    const normLower = path.toLowerCase();
    const existing = this.tabs.find((t) => t.path?.toLowerCase() === normLower);
    if (existing) {
      this.activateTab(existing.id);
      return true;
    }

    try {
      const payload = await backend.readFile(path);
      this.openTabFromPayload(payload, persistPrefs);
      return true;
    } catch (err) {
      console.error('Datei konnte nicht geöffnet werden:', err);
      const fileName = baseNameOfPath(path);
      this.showToast(t('toast.openFileFailed', { name: fileName }));
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
      return false;
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
      savedLineEnding: payload.lineEnding,
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

  private onTabSaved(tab: OpenTab, previousPath: string | null, savedAs: boolean): void {
    this.clearExternalConflict(tab);
    if (tab.path) {
      this.pushRecentFile(tab.path);
    }
    this.explorer.invalidateFilesCache();
    this.invalidateLintWorkspaceCache();

    if (savedAs && tab.path) {
      const prevLower = previousPath?.toLowerCase() ?? null;
      for (const entry of this.navHistory) {
        if (entry.tabId === tab.id || (prevLower && entry.path?.toLowerCase() === prevLower)) {
          entry.path = tab.path;
        }
      }
    }

    if (savedAs) {
      this.renderTabBar(false);
    } else {
      this.updateTabDirtyState(tab.id, tab.isDirty);
    }
    this.updateStatusBar();
    this.syncWindowMetadata();
    if (tab.isDirty) {
      this.flushDraftSync();
      this.autoSave.schedule(tab);
    } else {
      this.scheduleDraftSync();
    }
    this.schedulePrefsSave();

    if (this.explorer.hasWorkspace) {
      void this.explorer.refresh();
    }
  }

  private setActiveTabLineEnding(eol: 'CRLF' | 'LF'): void {
    const tab = this.activeTab;
    if (!tab || tab.lineEnding === eol) return;
    setDocumentLineEnding(tab, eol);
    if (tab.path) {
      this.updateTabDirtyState(tab.id, tab.isDirty);
      this.syncWindowMetadata();
      this.scheduleDraftSync();
      this.autoSave.schedule(tab);
    }
    this.updateStatusBar();
    this.settingsCtrl?.syncAll();
  }

  private toggleActiveTabLineEnding(): void {
    const tab = this.activeTab;
    if (!tab) return;
    this.setActiveTabLineEnding(tab.lineEnding === 'CRLF' ? 'LF' : 'CRLF');
  }

  private removeClosedTab(tab: OpenTab): void {
    const idx = this.tabs.indexOf(tab);
    if (idx === -1) return;

    this.closedTabsHistory.push({
      name: tab.name,
      path: tab.path,
      content: tab.currentContent,
      lineEnding: tab.lineEnding,
    });
    if (this.closedTabsHistory.length > 15) {
      this.closedTabsHistory.shift();
    }

    this.autoSave.cancel(tab);
    this.tabs.splice(idx, 1);
    if (this.tabs.length === 0) {
      this.createNewTab();
    } else if (this.activeTabId === tab.id) {
      const nextTab = this.tabs[Math.min(idx, this.tabs.length - 1)];
      this.activateTab(nextTab.id);
    } else {
      this.renderTabBar();
    }
    this.syncWindowMetadata();
    this.flushDraftSync();
    this.schedulePrefsSave();
  }

  private async reopenLastClosedTab(): Promise<void> {
    const last = this.closedTabsHistory.pop();
    if (!last) {
      this.showToast(t('toast.noClosedTabs'));
      return;
    }
    if (last.path) {
      await this.openFileByPath(last.path);
      this.showToast(t('toast.tabReopened', { name: last.name }));
    } else {
      this.createNewTab(last.name, last.content, false);
      this.showToast(t('toast.draftReopened', { name: last.name }));
    }
  }

  private cycleActiveTab(direction: 1 | -1): void {
    if (!this.activeTabId) return;
    const nextId = findAdjacentTabId(this.tabs, this.activeTabId, direction);
    if (nextId) {
      this.activateTab(nextId);
    }
  }

  private async closeOtherTabs(keepTabId: string): Promise<void> {
    const toClose = this.tabs.filter((t) => t.id !== keepTabId && !t.isPinned);
    for (const t of toClose) {
      const ok = await this.documentClose.closeTab(t.id);
      if (!ok) break;
    }
  }

  private async closeTabsToRight(fromTabId: string): Promise<void> {
    const idx = this.tabs.findIndex((t) => t.id === fromTabId);
    if (idx === -1) return;
    const toClose = this.tabs.slice(idx + 1).filter((t) => !t.isPinned);
    for (const t of toClose) {
      const ok = await this.documentClose.closeTab(t.id);
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
    for (const entry of this.navHistory) {
      if (entry.path) {
        entry.path = remapPath(entry.path);
      }
    }
    this.invalidateLintWorkspaceCache();
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
    this.invalidateLintWorkspaceCache();
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

    if (applyDocumentEdit(tab, content)) {
      this.updateTabDirtyState(tab.id, tab.isDirty);
      this.syncWindowMetadata();
    }
    this.updateStatusBar();
    this.scheduleDraftSync();

    window.clearTimeout(this.renderDebounceTimer);
    ++this.renderSeq;
    this.renderDebounceTimer = window.setTimeout(() => {
      this.renderDebounceTimer = undefined;
      void this.renderPreviewImmediate(
        content,
        tab.parentDir ?? this.explorer.rootPath,
      );
    }, 35);

    this.autoSave.schedule(tab);
  }

  private async renderPreviewImmediate(
    markdown: string,
    baseDir: string | null,
    restoreScrollTop?: number,
  ): Promise<void> {
    const seq = ++this.renderSeq;
    const isCurrent = () => seq === this.renderSeq;
    try {
      const tab = this.activeTab;
      const res = await renderDocument(tab?.name ?? 'Untitled.md', markdown, baseDir, 'live');
      if (seq !== this.renderSeq || res.superseded) return;

      const applied = await safeSetMarkdownHTML(this.previewContentEl, res.html, { isCurrent });
      if (!applied || !isCurrent()) return;
      if (tab) {
        tab.outline = res.outline;
        tab.stats = res.stats;
      }
      this.renderOutline(res.outline);
      this.updateStatusBar();

      if (typeof restoreScrollTop === 'number') {
        this.previewPaneEl.scrollTop = restoreScrollTop;
      }
      this.syncScroll.updateActiveHeadingFromViewport();
      if (!this.previewFindBarEl.hidden && this.previewFindInputEl.value) {
        this.updatePreviewFindMatches(false);
      }
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

    if (this.outlineCountBadgeEl) {
      if (outline.length === 0) {
        this.outlineCountBadgeEl.textContent = '';
      } else {
        this.outlineCountBadgeEl.textContent = String(outline.length);
        this.outlineCountBadgeEl.title =
          outline.length === 1
            ? t('outline.oneSection')
            : t('outline.sectionsCount', { count: outline.length });
      }
    }

    if (outline.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'muted-hint';
      hint.textContent = this.activeTab && !isMarkdownPath(this.activeTab.name)
        ? t('sidebar.emptyOutlineTextFile')
        : t('sidebar.emptyOutline');
      this.outlineEl.appendChild(hint);
      return;
    }

    const tokenByLine = new Map<number, number>();
    if (this.activeTab) {
      for (const tc of computeHeadingTokenCounts(this.activeTab.currentContent)) {
        tokenByLine.set(tc.line, tc.tokens);
      }
    }

    for (const item of outline) {
      const row = document.createElement('div');
      row.className = 'outline-row';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `outline-item outline-lvl-${item.level}`;
      btn.dataset.headingSlug = item.slug;
      const headingLabel = item.text || t('outline.untitledHeading');
      const tok = tokenByLine.get(item.line);
      btn.title = tok && tok > 0
        ? `${t('outline.lineTooltip', { line: item.line, text: item.text })} (${t('outline.tokensTooltip', { tokens: tok })})`
        : t('outline.lineTooltip', { line: item.line, text: item.text });

      const textSpan = document.createElement('span');
      textSpan.className = 'outline-item-text';
      textSpan.textContent = headingLabel;
      btn.appendChild(textSpan);

      if (tok && tok > 0) {
        const tokSpan = document.createElement('span');
        tokSpan.className = 'outline-item-tokens';
        tokSpan.textContent = `~${tok} tok`;
        btn.appendChild(tokSpan);
      }

      btn.addEventListener('click', () => {
        this.syncScroll.lockScrollForNavigation('editor', 500);
        this.editor.jumpToLine(item.line);
        const headingEl = this.previewContentEl.querySelector<HTMLElement>(
          `#${CSS.escape(item.slug)}`,
        );
        headingEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'mini-icon-btn outline-copy-btn';
      copyBtn.title = t('outline.copySection');
      copyBtn.setAttribute('aria-label', t('outline.copySection'));
      copyBtn.innerHTML =
        '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="4" width="7" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4 11H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.copyOutlineSectionAiContext(item.line, item.slug);
      });

      row.appendChild(btn);
      row.appendChild(copyBtn);
      this.outlineEl.appendChild(row);
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
      if (isCurrent) {
        btn.setAttribute('aria-current', 'location');
      } else {
        btn.removeAttribute('aria-current');
      }
    }
  }

  // ==========================================================================
  // Chrome, Accessible Sibling Tabs, Status Bar & Unsaved Prompt
  // ==========================================================================

  private renderTabBar(scrollActiveIntoView = false): void {
    this.tabBarEl.replaceChildren();
    let activeTabBtn: HTMLButtonElement | null = null;

    for (const tab of this.tabs) {
      const isSelected = tab.id === this.activeTabId;

      const slot = document.createElement('div');
      slot.className = `tab-slot ${isSelected ? 'is-active' : ''} ${tab.isPinned ? 'is-pinned' : ''}`.trim();
      slot.setAttribute('role', 'presentation');
      slot.dataset.tabId = tab.id;

      slot.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          void this.documentClose.closeTab(tab.id);
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
      selectBtn.title = tab.path ?? `${tab.name} (${t('tab.unsavedTitle')})`;
      selectBtn.addEventListener('click', (e) => {
        if (this.suppressNextTabClick) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        this.activateTab(tab.id);
      });

      const titleSpan = document.createElement('span');
      titleSpan.className = 'tab-title';
      titleSpan.textContent = tab.name;

      if (tab.isPinned) {
        const pinEl = document.createElement('span');
        pinEl.className = 'tab-pin-indicator';
        pinEl.textContent = '📌';
        pinEl.title = t('tab.pinnedTitle');
        pinEl.setAttribute('aria-hidden', 'true');
        selectBtn.append(pinEl, titleSpan);
      } else {
        selectBtn.appendChild(titleSpan);
      }

      if (tab.isDirty) {
        const dot = document.createElement('span');
        dot.className = 'tab-dirty-dot';
        dot.title = t('tab.unsavedTitle');
        dot.setAttribute('aria-label', t('tab.unsavedTitle'));
        selectBtn.appendChild(dot);
      }

      if (isSelected) {
        activeTabBtn = selectBtn;
      }

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'tab-close-btn';
      closeBtn.setAttribute('aria-label', t('tab.closeTitle', { name: tab.name }));
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => {
        void this.documentClose.closeTab(tab.id);
      });

      slot.append(selectBtn, closeBtn);
      this.tabBarEl.appendChild(slot);
    }

    syncRovingTabindex(this.tabBarEl, 'button[role="tab"]', activeTabBtn);
    if (scrollActiveIntoView) {
      activeTabBtn?.closest('.tab-slot')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }

  private updateTabDirtyState(tabId: string, isDirty: boolean): void {
    const slot = this.tabBarEl.querySelector<HTMLElement>(`.tab-slot[data-tab-id="${tabId}"]`);
    if (!slot) return;
    const selectBtn = slot.querySelector<HTMLButtonElement>('.tab-select-btn');
    if (!selectBtn) return;
    const existingDot = selectBtn.querySelector('.tab-dirty-dot');
    if (isDirty) {
      if (!existingDot) {
        const dot = document.createElement('span');
        dot.className = 'tab-dirty-dot';
        dot.title = t('tab.unsavedTitle');
        dot.setAttribute('aria-label', t('tab.unsavedTitle'));
        selectBtn.appendChild(dot);
      }
    } else {
      existingDot?.remove();
    }
  }

  private openTabContextMenu(e: MouseEvent, tabId: string): void {
    e.preventDefault();
    this.tabContextTargetId = tabId;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const revealBtn = document.getElementById('tab-ctx-reveal') as HTMLButtonElement;
    const copyPathBtn = document.getElementById('tab-ctx-copy-path') as HTMLButtonElement;
    const copyAtPathBtn = document.getElementById('tab-ctx-copy-at-path') as HTMLButtonElement | null;
    const diffSavedBtn = document.getElementById('tab-ctx-diff-saved') as HTMLButtonElement | null;
    const compareTabsBtn = document.getElementById('tab-ctx-compare-tabs') as HTMLButtonElement | null;
    if (revealBtn) revealBtn.disabled = !tab.path;
    if (copyPathBtn) copyPathBtn.disabled = !tab.path;
    if (copyAtPathBtn) copyAtPathBtn.disabled = !tab.path;
    if (diffSavedBtn) diffSavedBtn.disabled = !tab.path;
    if (compareTabsBtn) compareTabsBtn.disabled = this.tabs.length < 2;

    const closeOthersBtn = this.tabContextMenuEl.querySelector<HTMLButtonElement>(
      '[data-tab-ctx="close-others"]',
    );
    const closeRightBtn = this.tabContextMenuEl.querySelector<HTMLButtonElement>(
      '[data-tab-ctx="close-to-right"]',
    );
    const tabIdx = this.tabs.findIndex((t) => t.id === tabId);
    if (closeOthersBtn) closeOthersBtn.disabled = this.tabs.length <= 1;
    if (closeRightBtn) closeRightBtn.disabled = tabIdx === -1 || tabIdx >= this.tabs.length - 1;

    const pinLabel = document.getElementById('tab-ctx-pin-label');
    if (pinLabel) {
      pinLabel.textContent = tab.isPinned ? t('tabCtx.unpin') : t('tabCtx.pin');
    }

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

  private openTableContextMenu(clientX: number, clientY: number): void {
    this.tableContextMenuEl.style.left = `${clientX}px`;
    this.tableContextMenuEl.style.top = `${clientY}px`;
    this.tableContextMenuEl.showPopover?.();

    requestAnimationFrame(() => {
      const rect = this.tableContextMenuEl.getBoundingClientRect();
      const clampedLeft = Math.max(6, Math.min(clientX, window.innerWidth - rect.width - 8));
      const clampedTop = Math.max(6, Math.min(clientY, window.innerHeight - rect.height - 8));
      this.tableContextMenuEl.style.left = `${clampedLeft}px`;
      this.tableContextMenuEl.style.top = `${clampedTop}px`;

      const firstItem = this.tableContextMenuEl.querySelector<HTMLButtonElement>(
        '[focusgroup~="menu"] > button:not(:disabled)',
      );
      firstItem?.focus();
    });
  }

  private updateStatusBar(): void {
    const tab = this.activeTab;
    if (!tab) return;

    const isEn = getLanguage() === 'en';
    this.statusPathBtn.textContent = tab.path ?? tab.name;
    this.statusSaveBadge.textContent = tab.isDirty
      ? t('status.unsaved')
      : tab.path
        ? t('status.saved')
        : t('status.draft');
    this.statusSaveBadge.classList.toggle('is-dirty', tab.isDirty);

    const { words, readingTimeSec } = tab.stats;
    this.updateWordCountDisplay();
    if (this.statusReadtimeEl) {
      if (readingTimeSec < 60) {
        this.statusReadtimeEl.textContent = isEn ? `${readingTimeSec}s read time` : `${readingTimeSec} Sek. Lesezeit`;
      } else {
        const mins = Math.ceil(readingTimeSec / 60);
        this.statusReadtimeEl.textContent = isEn ? `~${mins} min read time` : `~${mins} Min. Lesezeit`;
      }
    }
    this.statusZoomBtn.textContent = `${this.zoomPercent}%`;
    this.statusEolBtn.textContent = tab.lineEnding;
    this.statusEncodingEl.textContent = tab.encoding;
  }

  private updateWordCountDisplay(): void {
    const tab = this.activeTab;
    if (!tab) return;
    const { words, readingTimeSec } = tab.stats;
    const totalTokens = estimateTokens(tab.currentContent);
    const isEn = getLanguage() === 'en';
    const locale = isEn ? 'en-US' : 'de-DE';
    const wordLabel = isEn ? (words === 1 ? 'word' : 'words') : (words === 1 ? 'Wort' : 'Wörter');
    const readingTimeStr = readingTimeSec < 60
      ? (isEn ? `${readingTimeSec}s read time` : `${readingTimeSec} Sek. Lesezeit`)
      : (isEn ? `~${Math.ceil(readingTimeSec / 60)} min read time` : `~${Math.ceil(readingTimeSec / 60)} Min. Lesezeit`);

    if (this.statusDocSummaryBtn) {
      if (this.lastSelection.chars > 0) {
        const selW = this.lastSelection.words;
        const selC = this.lastSelection.chars;
        const selTokens = estimateTokens(this.editor?.getSelectedText() ?? '');
        this.statusDocSummaryBtn.textContent = isEn
          ? `${selW} of ${words.toLocaleString(locale)} words · ~${selTokens.toLocaleString(locale)} tokens`
          : `${selW} von ${words.toLocaleString(locale)} Wörtern · ~${selTokens.toLocaleString(locale)} Tokens`;
        this.statusDocSummaryBtn.title = isEn
          ? `Selection: ${selW.toLocaleString(locale)} words (${selC.toLocaleString(locale)} ch.), ~${selTokens.toLocaleString(locale)} tokens · Document: ${words.toLocaleString(locale)} words (~${totalTokens.toLocaleString(locale)} tokens, ${readingTimeStr}) · Click for details`
          : `Auswahl: ${selW.toLocaleString(locale)} Wörter (${selC.toLocaleString(locale)} Z.), ~${selTokens.toLocaleString(locale)} Tokens · Dokument: ${words.toLocaleString(locale)} Wörter (~${totalTokens.toLocaleString(locale)} Tokens, ${readingTimeStr}) · Klicken für Details`;
      } else {
        const tokenLabel = isEn ? 'tokens' : 'Tokens';
        this.statusDocSummaryBtn.textContent = `${words.toLocaleString(locale)} ${wordLabel} · ~${totalTokens.toLocaleString(locale)} ${tokenLabel}`;
        this.statusDocSummaryBtn.title = isEn
          ? `Document statistics: ${words.toLocaleString(locale)} words · ~${totalTokens.toLocaleString(locale)} tokens · ${readingTimeStr} · Click for details`
          : `Dokument-Statistiken: ${words.toLocaleString(locale)} Wörter · ~${totalTokens.toLocaleString(locale)} Tokens · ${readingTimeStr} · Klicken für Details`;
      }
    }

    if (this.statusWordsEl) {
      if (this.lastSelection.chars > 0) {
        const selW = this.lastSelection.words;
        const selC = this.lastSelection.chars;
        this.statusWordsEl.textContent = isEn
          ? `${selW} of ${words.toLocaleString(locale)} words selected (${selC.toLocaleString(locale)} ch.)`
          : `${selW} von ${words.toLocaleString(locale)} Wörtern markiert (${selC.toLocaleString(locale)} Z.)`;
      } else {
        this.statusWordsEl.textContent = `${words.toLocaleString(locale)} ${wordLabel}`;
      }
    }
    if (this.statusTokensEl) {
      if (this.lastSelection.chars > 0) {
        const selW = this.lastSelection.words;
        const selC = this.lastSelection.chars;
        const selTokens = estimateTokens(this.editor?.getSelectedText() ?? '');
        this.statusTokensEl.textContent = `~${selTokens.toLocaleString(locale)} Tokens (~${totalTokens.toLocaleString(locale)})`;
      } else {
        this.statusTokensEl.textContent = `~${totalTokens.toLocaleString(locale)} Tokens`;
      }
    }

    if (this.activeTab) {
      this.updateLintStatus(this.activeTab.currentContent, this.activeTab.path);
    }
  }

  private syncWindowMetadata(): void {
    const tab = this.activeTab;
    const dirtyPrefix = tab?.isDirty ? '● ' : '';
    const title = tab ? `${dirtyPrefix}${tab.name} — Semyra` : 'Semyra';
    void backend.setWindowState({ title });
  }

  private promptUnsavedChanges(
    message: string,
  ): Promise<UnsavedChoice> {
    const dialog = document.getElementById('unsaved-dialog') as HTMLDialogElement;
    if (dialog.open) return Promise.resolve('cancel');
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
  // View, Toolbar & Global Shortcuts Wiring
  // ==========================================================================

  private setViewMode(mode: 'editor' | 'split' | 'preview'): void {
    if (mode !== 'preview' && !this.previewFindBarEl.hidden) {
      this.closePreviewFind(false);
    }
    this.appEl.setAttribute('data-view', mode);
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-set-view]')) {
      b.classList.toggle('is-active', b.dataset.setView === mode);
    }
    this.syncScroll.updateActiveHeadingFromViewport();
  }

  private toggleWordWrap(): void {
    const next = !this.editor.isWordWrapEnabled();
    this.editor.setWordWrap(next);
    const btn = document.getElementById('btn-word-wrap');
    if (btn) {
      btn.classList.toggle('is-active', next);
      btn.setAttribute('aria-pressed', String(next));
    }
    this.settingsCtrl?.syncAll();
    this.schedulePrefsSave();
  }

  private toggleSyncScroll(): void {
    const next = !this.syncScroll.isEnabled();
    this.syncScroll.setEnabled(next);
    const btn = document.getElementById('btn-sync-scroll');
    if (btn) {
      btn.classList.toggle('is-active', next);
      btn.setAttribute('aria-pressed', String(next));
    }
    this.settingsCtrl?.syncAll();
    this.schedulePrefsSave();
  }

  private toggleAutoSave(): void {
    const enabled = !this.autoSave.isEnabled;
    this.autoSave.setEnabled(enabled);
    const btn = document.getElementById('btn-autosave');
    if (btn) {
      btn.classList.toggle('is-active', enabled);
      btn.setAttribute('aria-pressed', String(enabled));
    }
    this.settingsCtrl?.syncAll();
    this.schedulePrefsSave();
  }

  private async toggleZen(force?: boolean): Promise<void> {
    const isCurrentlyZen = this.appEl.classList.contains('is-zen');
    const next = typeof force === 'boolean' ? force : !isCurrentlyZen;
    if (next === isCurrentlyZen) return;

    if (next) {
      this.appEl.classList.add('is-zen');

      // Clear focus from top-bar elements so it slides away smoothly
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      this.editor.focus();

      // Activate native Windows OS borderless fullscreen
      void backend.setWindowState({ fullscreen: true });

      // Inform user of Zen mode shortcuts
      this.showToast(t('toast.zenOn'), 2800);
    } else {
      this.appEl.classList.remove('is-zen');
      this.editor.focus();

      // Exit native Windows OS borderless fullscreen
      void backend.setWindowState({ fullscreen: false });

      // Inform user
      this.showToast(t('toast.zenOff'), 1800);
    }
    this.settingsCtrl?.syncAll();
  }

  private async triggerOpenFilesDialog(): Promise<void> {
    const res = await backend.openFilesDialog(getLanguage());
    for (const f of res.files) {
      this.openTabFromPayload(f);
    }
  }

  private async triggerOpenFolderDialog(): Promise<void> {
    const res = await backend.openFolderDialog(getLanguage());
    if (res.tree) {
      this.setSidebarSourceMode('workspace', false);
      this.explorer.setTree(res.tree);
      this.switchSidebarPanel('files');
    }
  }

  private async setSidebarSourceMode(
    mode: 'workspace' | 'ai-library',
    loadTree = true,
  ): Promise<void> {
    if (this.sidebarSourceMode === 'workspace' && this.explorer.rootPath) {
      this.lastWorkfolderPath = this.explorer.rootPath;
    }
    this.sidebarSourceMode = mode;
    this.invalidateLintWorkspaceCache();

    const wsBtn = document.getElementById('btn-source-workspace');
    const libBtn = document.getElementById('btn-source-ai-library');

    this.explorer.setAiLibraryMode(mode === 'ai-library');
    wsBtn?.classList.toggle('is-active', mode === 'workspace');
    wsBtn?.setAttribute('aria-pressed', mode === 'workspace' ? 'true' : 'false');
    libBtn?.classList.toggle('is-active', mode === 'ai-library');
    libBtn?.setAttribute('aria-pressed', mode === 'ai-library' ? 'true' : 'false');

    if (!loadTree) return;

    if (mode === 'ai-library') {
      try {
        const res = await backend.initAiLibrary();
        this.aiLibraryRootPath = res.root;
        this.explorer.setTree(res.tree, false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast(t('aiLib.initFailed', { err: msg }));
      }
    } else if (this.lastWorkfolderPath) {
      await this.explorer.loadFolder(this.lastWorkfolderPath, false);
    } else {
      this.explorer.clearWorkspace(this.recentFolders, this.recentFiles);
      void this.workspaceSearch.runSearch();
    }
  }

  private invalidateLintWorkspaceCache(): void {
    this.cachedWorkspaceRootForLint = null;
    this.cachedWorkspaceRelPaths = null;
  }

  private async refreshLintWorkspaceFiles(workspaceRoot: string): Promise<void> {
    if (this.sidebarSourceMode !== 'workspace' || this.explorer.rootPath !== workspaceRoot) return;
    if (this.lintWorkspaceRefreshInFlight === workspaceRoot) return;
    this.lintWorkspaceRefreshInFlight = workspaceRoot;
    try {
      const files = await this.explorer.getWorkspaceFiles();
      if (!files || this.sidebarSourceMode !== 'workspace' || this.explorer.rootPath !== workspaceRoot) return;
      this.cachedWorkspaceRootForLint = workspaceRoot;
      this.cachedWorkspaceRelPaths = files.map((f) => f.relPath);
      if (this.activeTab) {
        this.updateLintStatus(this.activeTab.currentContent, this.activeTab.path);
        const dialog = document.getElementById('lint-dialog') as HTMLDialogElement | null;
        if (dialog?.open) {
          this.renderLintDialogList();
        }
      }
    } finally {
      if (this.lintWorkspaceRefreshInFlight === workspaceRoot) {
        this.lintWorkspaceRefreshInFlight = null;
      }
    }
  }

  private updateLintStatus(content: string, filePath: string | null): void {
    const workspaceRoot = this.sidebarSourceMode === 'workspace' ? this.explorer.rootPath : null;
    let lintOptions: LintOptions | undefined;

    if (workspaceRoot) {
      if (this.cachedWorkspaceRootForLint !== workspaceRoot || this.cachedWorkspaceRelPaths === null) {
        void this.refreshLintWorkspaceFiles(workspaceRoot);
      } else if (filePath) {
        const rel = toWorkspaceRelativeLabel(filePath, workspaceRoot, '');
        const isInsideWorkspace =
          rel.length > 0 && !/^[A-Za-z]:[\\/]/.test(rel) && !rel.startsWith('/');
        if (isInsideWorkspace) {
          lintOptions = {
            knownWorkspaceFiles: this.cachedWorkspaceRelPaths,
            currentFileRelPath: rel,
          };
        }
      }
    }

    const result = lintMarkdownDocument(content, filePath, lintOptions);
    this.currentLintIssues = result.issues;
    const btn = this.statusLintBtn;
    if (!btn) return;

    const errors = result.issues.filter((i) => i.severity === 'error').length;
    const warnings = result.issues.length - errors;
    btn.classList.remove('is-ok', 'is-warning', 'is-error');

    if (errors > 0) {
      btn.classList.add('is-error');
      btn.textContent = t('lint.badgeErrors', { count: errors });
    } else if (warnings > 0) {
      btn.classList.add('is-warning');
      btn.textContent = t('lint.badgeWarnings', { count: warnings });
    } else {
      btn.classList.add('is-ok');
      btn.textContent = result.isSkillFile ? t('lint.badgeSkillOk') : t('lint.badgeOk');
    }
  }

  private renderLintDialogList(): void {
    const listEl = document.getElementById('lint-dialog-list');
    const dialog = document.getElementById('lint-dialog') as HTMLDialogElement | null;
    if (!listEl) return;

    if (this.activeTab) {
      this.updateLintStatus(this.activeTab.currentContent, this.activeTab.path);
    }

    listEl.replaceChildren();
    if (this.currentLintIssues.length === 0) {
      const p = document.createElement('p');
      p.className = 'lint-empty-state';
      p.textContent = t('lint.noIssues');
      listEl.appendChild(p);
      return;
    }

    for (const issue of this.currentLintIssues) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `lint-issue-row is-${issue.severity}`;

      const sev = document.createElement('span');
      sev.className = 'lint-issue-severity';
      sev.textContent =
        issue.severity === 'error' ? t('lint.severityError') : t('lint.severityWarning');

      const lineSpan = document.createElement('span');
      lineSpan.className = 'lint-issue-line';
      lineSpan.textContent = t('lint.lineLabel', { line: issue.line });

      const msgSpan = document.createElement('span');
      msgSpan.className = 'lint-issue-msg';
      msgSpan.textContent = issue.message;

      row.append(sev, lineSpan, msgSpan);
      row.addEventListener('click', () => {
        dialog?.close();
        this.editor.jumpToLine(issue.line);
        this.editor.focus();
      });
      listEl.appendChild(row);
    }
  }

  private openLintDialog(): void {
    this.renderLintDialogList();
    const dialog = document.getElementById('lint-dialog') as HTMLDialogElement | null;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }

  private formatCurrentTabDocument(): void {
    const tab = this.activeTab;
    if (!tab || !isMarkdownPath(tab.name)) return;
    const formatted = formatMarkdownDocument(tab.currentContent);
    if (formatted === tab.currentContent) {
      this.showToast(t('toast.docAlreadyFormatted'));
      return;
    }
    this.editor.replaceAllContent(formatted);
    this.showToast(t('toast.docFormatted'));
  }

  private showToast(message: string, durationMs = 2800): void {
    // Never mutate the polite live region while a modal dialog makes outside DOM inert
    if (document.querySelector('dialog[open]')) return;
    window.clearTimeout(this.toastTimer);
    this.statusToastEl.textContent = message;
    this.statusToastEl.classList.add('is-visible');
    this.toastTimer = window.setTimeout(() => {
      this.statusToastEl.classList.remove('is-visible');
      this.statusToastEl.textContent = '';
    }, durationMs);
  }

  private snapshotActiveDocument(): DocumentSnapshot | undefined {
    const tab = this.activeTab;
    if (!tab) return;
    return { name: tab.name, content: tab.currentContent, baseDir: tab.parentDir ?? this.explorer.rootPath };
  }

  private alignActiveMarkdownTables(): void {
    const count = this.editor.alignMarkdownTables();
    if (count > 0) {
      this.showToast(
        count === 1 ? t('toast.tableFormatted') : t('toast.tablesFormatted', { count }),
      );
    } else {
      this.showToast(t('toast.noTableFound'));
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

  private async copyCurrentTabMarkdown(): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;
    try {
      await navigator.clipboard.writeText(tab.currentContent);
      this.showToast(isMarkdownPath(tab.name) ? t('toast.copyMarkdown') : t('toast.copySource'));
    } catch (err) {
      console.error('Markdown konnte nicht kopiert werden:', err);
      this.showToast(t('toast.copyFailed'));
    }
  }

  private clearExternalConflict(tab: OpenTab): void {
    setExternalDocumentConflict(tab, false);
    if (tab.id === this.activeTabId) {
      this.externalChangedPath = null;
      this.externalBannerEl.hidden = true;
    }
  }

  private markExternalConflict(tab: OpenTab): void {
    this.autoSave.cancel(tab);
    setExternalDocumentConflict(tab, true);
    if (tab.id === this.activeTabId) {
      this.externalChangedPath = tab.path;
      this.externalBannerEl.hidden = false;
    }
  }

  private syncTabFromDisk(tab: OpenTab, discardLocal = false): Promise<void> {
    return this.documentFiles.syncFromDisk(tab, discardLocal, {
      onConflict: () => this.markExternalConflict(tab),
      onReload: (version) => this.applyDiskContent(tab, version),
      onError: (err) => {
        if (discardLocal) {
          console.error('Datei konnte nicht neu geladen werden:', err);
          this.showToast(t('toast.reloadFailed'));
        }
      },
    });
  }

  private applyDiskContent(tab: OpenTab, payload: DiskDocumentVersion): void {
    this.autoSave.cancel(tab);
    this.clearExternalConflict(tab);
    const contentChanged = applyDiskDocumentVersion(tab, payload);
    if (contentChanged) {
      if (tab.id === this.activeTabId) {
        this.editor.replaceAllContent(payload.content);
      } else {
        tab.editorState = this.editor.createState(payload.content);
      }
    }
    this.renderTabBar();
    this.updateStatusBar();
    this.syncWindowMetadata();
    this.scheduleDraftSync();
  }

  private dismissExternalConflictBanner(): void {
    this.externalBannerEl.hidden = true;
  }

  private async openExternalDiffDialog(): Promise<void> {
    const targetPath = this.externalChangedPath ?? this.activeTab?.path;
    if (!targetPath) return;
    const tab = this.tabs.find(
      (t) => t.path?.toLowerCase() === targetPath.toLowerCase(),
    );
    if (!tab || !tab.path) return;

    await openExternalDiffDialogModal({
      path: tab.path,
      localContent: tab.currentContent,
      onKeepLocal: (payload) => {
        if (tab.path !== targetPath) return;
        tab.overwriteExpected = payload;
        if (tab.id === this.activeTabId) this.dismissExternalConflictBanner();
      },
      onReloadDisk: () => this.syncTabFromDisk(tab, true),
    });
  }

  private async openDiffWithSavedDialog(tab: OpenTab | undefined = this.activeTab): Promise<void> {
    if (!tab || !tab.path) {
      this.showToast(t('toast.diffNoSavedFile'));
      return;
    }
    try {
      const payload = await backend.readFile(tab.path);
      openCompareDiffDialogModal({
        title: t('diff.withSavedTitle'),
        subtitle: t('diff.withSavedSubtitle'),
        leftLabel: t('diff.savedLabel', { name: tab.name }),
        rightLabel: t('diff.editorLabel', { name: tab.name }),
        leftContent: payload.content,
        rightContent: tab.currentContent,
        readOnly: true,
      });
    } catch (err) {
      console.error('Gespeicherter Stand konnte nicht gelesen werden:', err);
      this.showToast(t('toast.diffReadFailed'));
    }
  }

  private openCompareOpenTabsDialog(baseTab: OpenTab | undefined = this.activeTab): void {
    if (this.tabs.length < 2) {
      this.showToast(t('toast.diffNeedTwoTabs'));
      return;
    }
    const rightTab = baseTab ?? this.activeTab ?? this.tabs[0];
    const otherTabs = this.tabs.filter((tab) => tab.id !== rightTab.id);
    if (otherTabs.length === 0) {
      this.showToast(t('toast.diffNeedTwoTabs'));
      return;
    }

    const openDiff = (leftTab: OpenTab) => {
      openCompareDiffDialogModal({
        title: t('diff.compareTabsTitle'),
        subtitle: t('diff.compareTabsSubtitle', { left: leftTab.name, right: rightTab.name }),
        leftLabel: leftTab.name,
        rightLabel: rightTab.name,
        leftContent: leftTab.currentContent,
        rightContent: rightTab.currentContent,
        readOnly: true,
      });
    };

    if (otherTabs.length === 1) {
      openDiff(otherTabs[0]);
      return;
    }

    const isEn = getLanguage() === 'en';
    const existing = document.getElementById('compare-tab-picker-dialog') as HTMLDialogElement | null;
    existing?.remove();

    const dialog = document.createElement('dialog');
    dialog.id = 'compare-tab-picker-dialog';
    dialog.className = 'modal-dialog lint-dialog';
    dialog.setAttribute('closedby', 'any');
    dialog.setAttribute('aria-labelledby', 'compare-tab-picker-title');

    const card = document.createElement('div');
    card.className = 'modal-card lint-card';

    const header = document.createElement('div');
    header.className = 'settings-header';

    const titleWrap = document.createElement('div');
    const titleEl = document.createElement('h3');
    titleEl.id = 'compare-tab-picker-title';
    titleEl.textContent = t('diff.compareTabsTitle');
    const subEl = document.createElement('p');
    subEl.className = 'lint-dialog-sub';
    subEl.textContent = isEn
      ? `Select a tab to compare with "${rightTab.name}":`
      : `Tab zum Vergleichen mit „${rightTab.name}“ auswählen:`;
    titleWrap.append(titleEl, subEl);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mini-icon-btn';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', isEn ? 'Close' : 'Schließen');
    closeBtn.addEventListener('click', () => dialog.close());
    header.append(titleWrap, closeBtn);

    const list = document.createElement('div');
    list.className = 'lint-issues-list scroller';
    let firstBtn: HTMLButtonElement | null = null;
    for (const candidate of otherTabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lint-issue-row';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'lint-issue-msg';
      nameSpan.textContent = candidate.name;
      const pathSpan = document.createElement('span');
      pathSpan.className = 'lint-issue-line';
      pathSpan.textContent = toWorkspaceRelativeLabel(
        candidate.path,
        this.explorer.rootPath,
        isEn ? 'Unsaved' : 'Ungespeichert',
      );
      btn.append(nameSpan, pathSpan);
      btn.addEventListener('click', () => {
        dialog.returnValue = 'picked';
        dialog.close();
        openDiff(candidate);
      });
      if (!firstBtn) firstBtn = btn;
      list.append(btn);
    }

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn';
    cancelBtn.textContent = isEn ? 'Cancel' : 'Abbrechen';
    cancelBtn.addEventListener('click', () => dialog.close());
    actions.append(cancelBtn);

    card.append(header, list, actions);
    dialog.append(card);
    dialog.addEventListener('close', () => {
      dialog.returnValue = '';
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
    firstBtn?.focus();
  }

  private async copyCurrentTabAiContext(): Promise<void> {
    if (!this.activeTab) return;
    await this.copyTabAiContext(this.activeTab);
  }

  private async copyTabAiContext(tab: OpenTab): Promise<void> {
    try {
      const label = toWorkspaceRelativeLabel(tab.path, this.explorer.rootPath, tab.name);
      const payload = formatAiContextEntry(label, tab.currentContent);
      await navigator.clipboard.writeText(payload);
      this.showToast(t('toast.copyAiWithName', { name: label }));
    } catch (err) {
      console.error('KI-Kontext konnte nicht kopiert werden:', err);
      this.showToast(t('toast.copyFailed'));
    }
  }

  private async copyOutlineSectionAiContext(headingLine: number, slug: string): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;
    const section = extractMarkdownSection(tab.currentContent, headingLine);
    if (!section) return;
    const relLabel = toWorkspaceRelativeLabel(tab.path, this.explorer.rootPath, tab.name);
    const payload = formatAiContextEntry(`${relLabel}#${slug}`, section.content);
    try {
      await navigator.clipboard.writeText(payload);
      this.showToast(t('toast.copySectionAi', { heading: section.heading }));
    } catch (err) {
      console.error('Abschnitt konnte nicht kopiert werden:', err);
      this.showToast(t('toast.copyFailed'));
    }
  }

  private async copyAtPathForTarget(targetPath: string | null, fallbackName: string): Promise<void> {
    const relPath = toWorkspaceRelativeLabel(targetPath, this.explorer.rootPath, fallbackName);
    const atPath = `@${relPath}`;
    try {
      await navigator.clipboard.writeText(atPath);
      this.showToast(t('toast.copyAtPath', { path: atPath }));
    } catch (err) {
      console.error('@-Pfad konnte nicht kopiert werden:', err);
      this.showToast(t('toast.copyFailed'));
    }
  }

  private async copyAtPath(tab: OpenTab | undefined = this.activeTab): Promise<void> {
    if (!tab) return;
    await this.copyAtPathForTarget(tab.path, tab.name);
  }

  private createTabFromAiTemplate(templateId: AiTemplateId): void {
    const tpl = getAiTemplate(templateId);
    this.createNewTab(tpl.suggestedName, tpl.content, true);
  }

  private getActiveWorkspaceRoot(): string | null {
    return this.sidebarSourceMode === 'workspace'
      ? this.explorer.rootPath
      : this.lastWorkfolderPath;
  }

  private async scaffoldWorkspaceAgents(targetDir?: string): Promise<void> {
    const rootPath = targetDir ?? this.getActiveWorkspaceRoot();
    if (!rootPath) {
      this.showToast(t('toast.noWorkspaceOpen'));
      return;
    }

    const sep = rootPath.includes('\\') ? '\\' : '/';
    const cleanRoot = rootPath.replace(/[\\/]+$/, '');
    const agentsPath = `${cleanRoot}${sep}AGENTS.md`;

    try {
      const existing = await backend.readFile(agentsPath);
      this.openTabFromPayload(existing);
      this.showToast(t('toast.workspaceAgentsExists'));
      return;
    } catch {
      // AGENTS.md does not exist yet — create it below.
    }

    try {
      const tpl = getAiTemplate('agents', getLanguage());
      const created = await backend.createFile(cleanRoot, 'AGENTS.md');
      await backend.writeFile(
        created.path,
        tpl.content,
        created.lineEnding,
        created.content,
        created.lineEnding,
      );
      if (this.sidebarSourceMode === 'workspace') {
        await this.explorer.refresh();
      }
      this.openTabFromPayload({ ...created, content: tpl.content });
      this.showToast(t('toast.workspaceAgentsCreated'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.showToast(t('toast.workspaceAgentsFailed', { err: msg }));
    }
  }

  private scaffoldWorkspaceSkill(targetDir?: string): void {
    const rootPath = targetDir ?? this.getActiveWorkspaceRoot();
    if (!rootPath) {
      this.showToast(t('toast.noWorkspaceOpen'));
      return;
    }

    const sep = rootPath.includes('\\') ? '\\' : '/';
    const cleanRoot = rootPath.replace(/[\\/]+$/, '');
    this.explorer.openNewSkillDialog(`${cleanRoot}${sep}.agents${sep}skills`);
  }

  private openAiBundleDialog(workspaceOnlyRoot?: string): void {
    const workspaceRootPath = workspaceOnlyRoot ?? this.explorer.rootPath;
    openAiBundleDialogModal({
      tabs: workspaceOnlyRoot
        ? this.tabs.filter((tab) => tab.path && isSameOrDescendantPath(tab.path, workspaceOnlyRoot))
        : this.tabs,
      workspaceRootPath,
      onShowToast: (msg) => this.showToast(msg),
      onSaveBundle: async (bundleText) => {
        const res = await backend.saveFileDialog(
          bundleText,
          'ai-context.md',
          workspaceRootPath,
          this.activeTab?.lineEnding ?? 'LF',
          getLanguage(),
        );
        return res.saved && res.path
          ? t('toast.aiBundleSaved', { name: res.name ?? baseNameOfPath(res.path) })
          : null;
      },
    });
  }

  private openPromptVariablesDialog(): void {
    const tab = this.activeTab;
    if (!tab) return;
    const vars = extractTemplateVariables(tab.currentContent);
    if (vars.length === 0) {
      this.showToast(t('toast.noTemplateVars'));
      return;
    }
    void openPromptVariablesDialogModal({
      title: tab.name,
      content: tab.currentContent,
      onCopy: async (rendered) => {
        try {
          await navigator.clipboard.writeText(rendered);
          this.showToast(t('toast.copyAiWithName', { name: tab.name }));
        } catch {
          this.showToast(t('toast.copyFailed'));
        }
      },
    });
  }

  private bindUIEvents(): void {
    document.getElementById('unsaved-dialog')!.addEventListener('cancel', (e) => {
      e.preventDefault();
    });

    document.getElementById('btn-toggle-sidebar')!.addEventListener('click', () => {
      this.sidebarEl.classList.toggle('is-collapsed');
    });

    document.getElementById('btn-source-workspace')?.addEventListener('click', () => {
      void this.setSidebarSourceMode('workspace');
    });
    document.getElementById('btn-source-ai-library')?.addEventListener('click', () => {
      void this.setSidebarSourceMode('ai-library');
    });
    this.statusLintBtn?.addEventListener('click', () => {
      this.renderLintDialogList();
    });
    document.getElementById('lint-dialog')?.addEventListener('close', (e) => {
      (e.currentTarget as HTMLDialogElement).returnValue = '';
    });

    const newTabFn = () => this.createNewTab();
    document.getElementById('btn-new-tab')?.addEventListener('click', newTabFn);
    document.getElementById('btn-tab-add')?.addEventListener('click', newTabFn);

    document.getElementById('btn-open-file')?.addEventListener('click', () => {
      void this.triggerOpenFilesDialog();
    });

    document.getElementById('btn-open-folder')?.addEventListener('click', () => {
      void this.triggerOpenFolderDialog();
    });

    document.getElementById('btn-save')?.addEventListener('click', () => {
      if (this.activeTab) void this.documentFiles.save(this.activeTab);
    });

    document.getElementById('btn-save-as')?.addEventListener('click', () => {
      if (this.activeTab) void this.documentFiles.save(this.activeTab, true);
    });

    document.getElementById('btn-copy-markdown')?.addEventListener('click', () => {
      void this.copyCurrentTabMarkdown();
    });

    document.getElementById('btn-copy-rich')?.addEventListener('click', () => {
      void this.documentExport.copyRichText();
    });

    document.getElementById('btn-export-html')?.addEventListener('click', () => {
      void this.documentExport.exportHtml();
    });

    document.getElementById('btn-export-pdf')?.addEventListener('click', () => {
      void this.documentExport.exportPdf();
    });

    document.getElementById('btn-print')?.addEventListener('click', () => {
      void this.documentExport.print();
    });

    // Share & Export Popover Actions
    const sharePopover = document.getElementById('share-popover') as (HTMLElement & {
      hidePopover?: () => void;
    }) | null;
    const closeShareMenu = () => {
      try {
        sharePopover?.hidePopover?.();
      } catch {}
    };

    document.getElementById('btn-share-copy-markdown')?.addEventListener('click', () => {
      closeShareMenu();
      void this.copyCurrentTabMarkdown();
    });

    document.getElementById('btn-share-copy-ai')?.addEventListener('click', () => {
      closeShareMenu();
      void this.copyCurrentTabAiContext();
    });

    document.getElementById('btn-share-bundle-ai')?.addEventListener('click', () => {
      closeShareMenu();
      this.openAiBundleDialog();
    });

    document.getElementById('btn-share-copy-rich')?.addEventListener('click', () => {
      closeShareMenu();
      void this.documentExport.copyRichText();
    });

    document.getElementById('btn-share-export-html')?.addEventListener('click', () => {
      closeShareMenu();
      void this.documentExport.exportHtml();
    });

    document.getElementById('btn-share-html-light')?.addEventListener('click', () => {
      closeShareMenu();
      void this.documentExport.exportHtml('light');
    });

    document.getElementById('btn-share-html-dark')?.addEventListener('click', () => {
      closeShareMenu();
      void this.documentExport.exportHtml('dark');
    });

    document.getElementById('btn-share-fill-prompt-vars')?.addEventListener('click', () => {
      closeShareMenu();
      this.openPromptVariablesDialog();
    });

    document.getElementById('btn-share-export-pdf')?.addEventListener('click', () => {
      closeShareMenu();
      void this.documentExport.exportPdf();
    });

    document.getElementById('btn-share-print')?.addEventListener('click', () => {
      closeShareMenu();
      void this.documentExport.print();
    });

    document.getElementById('btn-share-save-as')?.addEventListener('click', () => {
      closeShareMenu();
      if (this.activeTab) void this.documentFiles.save(this.activeTab, true);
    });

    // Contextual Format Ribbon Toggle Buttons
    document.getElementById('btn-collapse-format-bar')?.addEventListener('click', () => {
      this.toggleFormatBar();
    });
    document.getElementById('btn-expand-format-bar')?.addEventListener('click', () => {
      this.toggleFormatBar();
    });

    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-set-view]')) {
      btn.addEventListener('click', () => {
        this.setViewMode(btn.dataset.setView as 'editor' | 'split' | 'preview');
      });
    }

    document.getElementById('btn-word-wrap')?.addEventListener('click', () => {
      this.toggleWordWrap();
    });
    document.getElementById('btn-sync-scroll')?.addEventListener('click', () => {
      this.toggleSyncScroll();
    });
    document.getElementById('btn-autosave')?.addEventListener('click', () => {
      this.toggleAutoSave();
    });

    document.getElementById('btn-exit-zen')?.addEventListener('click', () => {
      void this.toggleZen(false);
    });

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
          await this.documentClose.closeTab(tab.id);
          break;
        case 'close-others':
          await this.closeOtherTabs(tab.id);
          break;
        case 'close-to-right':
          await this.closeTabsToRight(tab.id);
          break;
        case 'toggle-pin':
          this.tabs = toggleTabPinned(this.tabs, tab.id);
          this.renderTabBar(true);
          this.schedulePrefsSave();
          break;
        case 'reveal':
          if (tab.path) void backend.revealInExplorer(tab.path);
          break;
        case 'copy-path':
          if (tab.path) {
            await navigator.clipboard.writeText(tab.path).catch(() => {});
            this.showToast(t('toast.copyPath'));
          }
          break;
        case 'copy-at-path':
          await this.copyAtPath(tab);
          break;
        case 'copy-markdown':
          await navigator.clipboard.writeText(tab.currentContent).catch(() => {});
          this.showToast(isMarkdownPath(tab.name) ? t('toast.copyMarkdown') : t('toast.copySource'));
          break;
        case 'copy-ai-context':
          await this.copyTabAiContext(tab);
          break;
        case 'diff-saved':
          await this.openDiffWithSavedDialog(tab);
          break;
        case 'compare-tabs':
          this.openCompareOpenTabsDialog(tab);
          break;
      }
    });

    // Context menu actions for Markdown tables
    this.tableContextMenuEl.addEventListener('click', (e) => {
      const actionBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-table-action]');
      if (!actionBtn) return;
      const action = actionBtn.dataset.tableAction;
      this.tableContextMenuEl.hidePopover?.();
      switch (action) {
        case 'row-above':
          if (this.editor.modifyTable({ type: 'insert-row', direction: 'above' })) {
            this.showToast(t('toast.tableRowAbove'));
          }
          break;
        case 'row-below':
          if (this.editor.modifyTable({ type: 'insert-row', direction: 'below' })) {
            this.showToast(t('toast.tableRowBelow'));
          }
          break;
        case 'delete-row':
          if (this.editor.modifyTable({ type: 'delete-row' })) {
            this.showToast(t('toast.tableRowDeleted'));
          }
          break;
        case 'col-left':
          if (this.editor.modifyTable({ type: 'insert-col', direction: 'left' })) {
            this.showToast(t('toast.tableColLeft'));
          }
          break;
        case 'col-right':
          if (this.editor.modifyTable({ type: 'insert-col', direction: 'right' })) {
            this.showToast(t('toast.tableColRight'));
          }
          break;
        case 'delete-col':
          if (this.editor.modifyTable({ type: 'delete-col' })) {
            this.showToast(t('toast.tableColDeleted'));
          }
          break;
        case 'align':
          this.alignActiveMarkdownTables();
          break;
      }
    });

    // Tab drag-and-drop reordering via Pointer Events (immune to button click suppression)
    this.tabBarEl.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('.tab-close-btn')) return;

      const slot = (e.target as HTMLElement).closest<HTMLElement>('.tab-slot');
      if (!slot || !slot.dataset.tabId) return;

      this.tabDragState = {
        tabId: slot.dataset.tabId,
        startX: e.clientX,
        startY: e.clientY,
        isDragging: false,
        targetTabId: null,
        isAfter: false,
      };
    });

    window.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.tabDragState) return;

      if (!this.tabDragState.isDragging) {
        const dist = Math.hypot(e.clientX - this.tabDragState.startX, e.clientY - this.tabDragState.startY);
        if (dist < 6) return;
        this.tabDragState.isDragging = true;
        this.suppressNextTabClick = true;
        document.body.classList.add('is-tab-dragging');

        const activeSlot = this.tabBarEl.querySelector<HTMLElement>(
          `.tab-slot[data-tab-id="${this.tabDragState.tabId}"]`,
        );
        activeSlot?.classList.add('is-dragging');
      }

      for (const el of this.tabBarEl.querySelectorAll('.tab-slot')) {
        el.classList.remove('drop-before', 'drop-after');
      }

      let targetSlot =
        (document.elementFromPoint(e.clientX, e.clientY)?.closest('.tab-slot') as HTMLElement | null) ?? null;
      const slots = Array.from(this.tabBarEl.querySelectorAll<HTMLElement>('.tab-slot'));
      if (!targetSlot && slots.length > 0) {
        for (const slot of slots) {
          const rect = slot.getBoundingClientRect();
          if (e.clientX >= rect.left && e.clientX <= rect.right) {
            targetSlot = slot;
            break;
          }
        }
        if (!targetSlot) {
          const firstRect = slots[0].getBoundingClientRect();
          const lastRect = slots[slots.length - 1].getBoundingClientRect();
          if (e.clientX < firstRect.left) {
            targetSlot = slots[0];
          } else if (e.clientX > lastRect.right) {
            targetSlot = slots[slots.length - 1];
          }
        }
      }

      if (targetSlot && targetSlot.dataset.tabId && targetSlot.dataset.tabId !== this.tabDragState.tabId) {
        const rect = targetSlot.getBoundingClientRect();
        const isAfter = e.clientX > rect.left + rect.width / 2;
        targetSlot.classList.toggle('drop-after', isAfter);
        targetSlot.classList.toggle('drop-before', !isAfter);
        this.tabDragState.targetTabId = targetSlot.dataset.tabId;
        this.tabDragState.isAfter = isAfter;
      } else {
        this.tabDragState.targetTabId = null;
      }
    });

    const finishTabDrag = () => {
      if (!this.tabDragState) return;
      const state = this.tabDragState;
      this.tabDragState = null;

      document.body.classList.remove('is-tab-dragging');
      for (const el of this.tabBarEl.querySelectorAll('.tab-slot')) {
        el.classList.remove('drop-before', 'drop-after', 'is-dragging');
      }

      if (state.isDragging) {
        setTimeout(() => {
          this.suppressNextTabClick = false;
        }, 80);

        if (state.targetTabId && state.targetTabId !== state.tabId) {
          this.tabs = reorderTabList(this.tabs, state.tabId, state.targetTabId, state.isAfter);
          this.renderTabBar();
          this.schedulePrefsSave();
        }
      }
    };

    window.addEventListener('pointerup', finishTabDrag);
    window.addEventListener('pointercancel', finishTabDrag);

    // Double click empty tab bar space to open a new tab
    const tabStripWrap = document.querySelector('.tab-strip-wrap');
    tabStripWrap?.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('.tab-slot, button')) return;
      this.createNewTab();
    });

    // Horizontal mouse wheel scrolling on tab bar
    this.tabBarEl.addEventListener(
      'wheel',
      (e) => {
        if (e.deltaY && !e.deltaX) {
          e.preventDefault();
          this.tabBarEl.scrollLeft += e.deltaY;
        }
      },
      { passive: false },
    );

    // Horizontal mouse wheel scrolling on format ribbon
    const formatScroll = document.querySelector('.format-buttons-scroll');
    formatScroll?.addEventListener(
      'wheel',
      (e) => {
        const wheelEvt = e as WheelEvent;
        if (wheelEvt.deltaY && !wheelEvt.deltaX) {
          wheelEvt.preventDefault();
          formatScroll.scrollLeft += wheelEvt.deltaY;
        }
      },
      { passive: false },
    );

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
      } else if (fmt === 'codeblock' || fmt === 'alert') {
        this.openFormatOptionPopover(btn, fmt);
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

      const headers = Array.from({ length: cols }, (_, i) => t('table.columnHeader', { num: i + 1 }));
      const seps = Array.from({ length: cols }, () => sepCell);
      const lines = [
        `| ${headers.join(' | ')} |`,
        `| ${seps.join(' | ')} |`,
      ];
      for (let r = 0; r < rows; r++) {
        const cells = Array.from({ length: cols }, () => t('table.cellContent'));
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
        const pct = splitRatioFromPointer(
          this.splitOrientation,
          { x: ev.clientX, y: ev.clientY },
          rect,
        );
        this.setSplitRatio(snapSplitRatio(pct), false);
      };

      const onUp = (ev: PointerEvent) => {
        resizer.releasePointerCapture(ev.pointerId);
        resizer.classList.remove('is-dragging');
        resizer.removeEventListener('pointermove', onMove);
        resizer.removeEventListener('pointerup', onUp);
        this.saveSplitRatios();
        this.schedulePrefsSave();
      };

      resizer.addEventListener('pointermove', onMove);
      resizer.addEventListener('pointerup', onUp);
    });

    resizer.addEventListener('dblclick', () => {
      this.setSplitRatio(50);
    });

    this.bindSidebarResizer();
    this.initLayoutPreferences();

    resizer.addEventListener('keydown', (e) => {
      const isHoriz = this.splitOrientation === 'horizontal';
      const step = e.shiftKey ? 10 : 3;
      if ((!isHoriz && e.key === 'ArrowLeft') || (isHoriz && e.key === 'ArrowUp')) {
        e.preventDefault();
        this.setSplitRatio(this.splitRatio - step);
      } else if ((!isHoriz && e.key === 'ArrowRight') || (isHoriz && e.key === 'ArrowDown')) {
        e.preventDefault();
        this.setSplitRatio(this.splitRatio + step);
      } else if (e.key === 'Home') {
        e.preventDefault();
        this.setSplitRatio(50);
      } else if (e.key === 'End') {
        e.preventDefault();
        this.setSplitRatio(80);
      }
    });

    const openStats = () => this.openDocStatsPopover();
    this.statusDocSummaryBtn?.addEventListener('click', openStats);
    document.getElementById('status-words')?.addEventListener('click', openStats);
    document.getElementById('status-tokens')?.addEventListener('click', openStats);
    document.getElementById('status-readtime')?.addEventListener('click', openStats);

    this.previewPaneEl.addEventListener(
      'scroll',
      () => {
        this.syncScroll.syncPreviewToEditor();
        const isScrolled = this.previewPaneEl.scrollTop > 220;
        this.previewPaneEl.classList.toggle('is-scrolled', isScrolled);
      },
      {
        passive: true,
      },
    );

    document.getElementById('btn-scroll-top')?.addEventListener('click', () => {
      this.previewPaneEl.scrollTo({ top: 0, behavior: 'smooth' });
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
            copyBtn.textContent = t('preview.copied');
            this.showToast(t('toast.copyCode'));
            setTimeout(() => {
              copyBtn.textContent = t('preview.copy');
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
            copyMermaidBtn.textContent = t('preview.copied');
            this.showToast(t('toast.copyDiagram'));
            setTimeout(() => {
              copyMermaidBtn.textContent = t('preview.copySvg');
            }, 1400);
          });
        }
        return;
      }

      const zoomMermaidBtn = target.closest<HTMLButtonElement>('.zoom-mermaid-btn');
      const diagram = zoomMermaidBtn
        ? zoomMermaidBtn.closest('.mermaid-wrapper')?.querySelector<SVGSVGElement>(':scope > svg')
        : target.closest<SVGSVGElement>('.mermaid-wrapper > svg');
      if (diagram && !target.closest('a[href], a[*|href]')) {
        this.mermaidViewer.open(diagram);
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
          if (anchor.classList.contains('heading-anchor')) {
            void navigator.clipboard?.writeText(href);
            this.showToast(t('toast.sectionLinkCopied'));
          }
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

    // Split-Preview double-click to source line
    this.previewContentEl.addEventListener('dblclick', (e) => {
      if (this.appEl.getAttribute('data-view') !== 'split') return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('button, a[href], input, .mermaid-wrapper')) return;
      const lineEl = target.closest<HTMLElement>('[data-line]');
      if (!lineEl) return;
      const lineNum = Number.parseInt(lineEl.dataset.line ?? '', 10);
      if (!Number.isFinite(lineNum) || lineNum < 1) return;
      this.syncScroll.lockScrollForNavigation('editor', 500);
      this.editor.jumpToLine(lineNum);
    });

    // Status bar interactive buttons
    this.statusPathBtn.addEventListener('click', () => {
      const p = this.activeTab?.path ?? this.explorer.rootPath;
      if (p) void backend.revealInExplorer(p);
    });

    this.statusCursorEl.addEventListener('click', () => {
      this.openGoToLineDialog();
    });

    // Go-to-Line native <dialog>
    const gotoDialog = document.getElementById('goto-line-dialog') as HTMLDialogElement | null;
    const gotoForm = document.getElementById('goto-line-form') as HTMLFormElement | null;
    const gotoInput = document.getElementById('goto-line-input') as HTMLInputElement | null;
    if (gotoDialog && gotoForm && gotoInput) {
      gotoInput.addEventListener('input', () => {
        gotoInput.setCustomValidity('');
      });
      gotoDialog.addEventListener('close', () => {
        const val = gotoDialog.returnValue;
        gotoDialog.returnValue = '';
        if (val !== 'confirm') {
          const returnEl = this.gotoLineReturnFocusEl;
          this.gotoLineReturnFocusEl = null;
          if (returnEl && returnEl.isConnected) {
            returnEl.focus();
          } else if (this.appEl.getAttribute('data-view') === 'preview') {
            if (!this.previewContentEl.hasAttribute('tabindex')) {
              this.previewContentEl.tabIndex = -1;
            }
            this.previewContentEl.focus({ preventScroll: true });
          } else {
            this.editor.view.focus();
          }
          return;
        }
        this.gotoLineReturnFocusEl = null;
        const match = /^\s*(\d+)(?::(\d+))?\s*$/.exec(gotoInput.value);
        if (!match) return;
        const requestedLine = Number.parseInt(match[1], 10);
        const requestedCol = match[2] ? Number.parseInt(match[2], 10) : 1;
        if (this.appEl.getAttribute('data-view') === 'preview') {
          this.setViewMode('split');
        }
        const totalLines = this.editor.view.state.doc.lines;
        const clampedLine = Math.max(1, Math.min(totalLines, requestedLine));
        this.syncScroll.lockScrollForNavigation('editor', 500);
        this.editor.jumpToLine(clampedLine);
        if (requestedCol > 1) {
          const lineObj = this.editor.view.state.doc.line(clampedLine);
          const offset = Math.min(requestedCol - 1, lineObj.length);
          this.editor.view.dispatch({
            selection: { anchor: lineObj.from + offset },
            scrollIntoView: true,
          });
        }
        this.editor.view.focus();
      });
      gotoForm.addEventListener('submit', (e) => {
        const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
        if (submitter?.value === 'cancel') return;
        if (!/^\s*(\d+)(?::(\d+))?\s*$/.test(gotoInput.value)) {
          e.preventDefault();
          gotoInput.setCustomValidity(t('gotoLine.invalid'));
          gotoInput.reportValidity();
        }
      });
    }

    // Inline Preview Find-in-Page bar
    this.previewFindInputEl.addEventListener('input', () => {
      this.updatePreviewFindMatches(true);
    });
    this.previewFindInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.stepPreviewFind(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closePreviewFind();
      }
    });
    document.getElementById('preview-find-prev')?.addEventListener('click', () => {
      this.stepPreviewFind(-1);
    });
    document.getElementById('preview-find-next')?.addEventListener('click', () => {
      this.stepPreviewFind(1);
    });
    document.getElementById('preview-find-close')?.addEventListener('click', () => {
      this.closePreviewFind();
    });

    this.statusZoomBtn.addEventListener('click', () => {
      this.setZoomPercent(100);
    });

    this.statusEolBtn.addEventListener('click', () => {
      this.toggleActiveTabLineEnding();
    });

    // External modification reload banner & diff modal
    document.getElementById('btn-compare-external')?.addEventListener('click', () => {
      void this.openExternalDiffDialog();
    });

    document.getElementById('btn-reload-external')!.addEventListener('click', async () => {
      const tab = this.activeTab;
      if (tab) await this.syncTabFromDisk(tab, true);
    });

    document.getElementById('btn-dismiss-banner')!.addEventListener('click', () => {
      this.dismissExternalConflictBanner();
    });

    // Application-wide keyboard shortcuts in capture phase so CodeMirror's unshifted
    // keymap fallbacks (e.g. Mod-f / Mod-d / Mod-k) never intercept Mod+Shift app commands.
    // Explicitly guarded against DE-QWERTZ AltGr (`Ctrl+Alt` / `AltGraph`).
    window.addEventListener(
      'keydown',
      (e) => {
        if (document.body.inert) return;
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
          if (!this.previewFindBarEl.hidden) {
            consume();
            this.closePreviewFind();
            return;
          }
          const hasOpenPopover = !!document.querySelector(':popover-open');
          const hasOpenCmSearch = !!document.querySelector('.cm-search');
          if (this.appEl.classList.contains('is-zen') && !hasOpenPopover && !hasOpenCmSearch) {
            consume();
            void this.toggleZen(false);
            return;
          }
        }

        if (mod && !e.altKey && !e.shiftKey && (key === ',' || e.key === ',')) {
          consume();
          this.settingsCtrl.openSettings();
        } else if (mod && !e.altKey && !e.shiftKey && key === 'e') {
          consume();
          this.palette.open('files');
        } else if (mod && !e.altKey && e.shiftKey && key === 'p') {
          consume();
          this.palette.open('commands');
        } else if (mod && !e.altKey && !e.shiftKey && key === 'g') {
          consume();
          this.openGoToLineDialog();
        } else if (mod && !e.altKey && !e.shiftKey && key === 'f') {
          consume();
          if (this.appEl.getAttribute('data-view') === 'preview') {
            this.openPreviewFind();
          } else {
            this.openEditorSearchPanel();
          }
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
          if (this.activeTab) void this.documentFiles.save(this.activeTab);
        } else if (mod && !e.altKey && e.shiftKey && key === 's') {
          consume();
          if (this.activeTab) void this.documentFiles.save(this.activeTab, true);
        } else if (mod && !e.altKey && e.shiftKey && key === 'k') {
          consume();
          void this.documentExport.copyRichText();
        } else if (mod && !e.altKey && e.shiftKey && key === 'c') {
          consume();
          void this.copyCurrentTabMarkdown();
        } else if (mod && !e.altKey && e.shiftKey && key === 'a') {
          consume();
          void this.copyCurrentTabAiContext();
        } else if (mod && !e.altKey && e.shiftKey && key === 'h') {
          consume();
          void this.documentExport.exportHtml();
        } else if (mod && !e.altKey && e.shiftKey && key === 'd') {
          consume();
          void this.documentExport.exportPdf();
        } else if (mod && !e.altKey && !e.shiftKey && key === 'p') {
          consume();
          void this.documentExport.print();
        } else if (mod && !e.altKey && !e.shiftKey && key === 'w') {
          consume();
          if (this.activeTab) void this.documentClose.closeTab(this.activeTab.id);
        } else if (mod && !e.altKey && e.shiftKey && key === 't') {
          consume();
          void this.reopenLastClosedTab();
        } else if (mod && !e.altKey && e.shiftKey && key === 'l') {
          consume();
          this.formatCurrentTabDocument();
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
        } else if (e.altKey && !mod && !e.shiftKey && e.key === 'ArrowLeft') {
          consume();
          void this.navigateHistory(-1);
        } else if (e.altKey && !mod && !e.shiftKey && e.key === 'ArrowRight') {
          consume();
          void this.navigateHistory(1);
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
        } else if (e.altKey && !mod && e.shiftKey && key === 's') {
          consume();
          this.toggleSplitOrientation();
        } else if (e.altKey && !mod && e.shiftKey && key === 'b') {
          consume();
          this.toggleEditorCentered();
        } else if (e.altKey && !mod && e.shiftKey && key === 'r') {
          consume();
          this.toggleFormatBar();
        } else if (e.altKey && !mod && e.shiftKey && key === 'y') {
          consume();
          this.toggleSyncScroll();
        } else if (e.altKey && !mod && e.shiftKey && key === 'a') {
          consume();
          this.toggleAutoSave();
        } else if (e.altKey && !mod && e.shiftKey && key === 't') {
          consume();
          toggleTheme();
        } else if (e.key === 'F11') {
          consume();
          void this.toggleZen();
        } else if (e.key === 'F1') {
          consume();
          shortcutsDialog.showModal();
        }
      },
      { capture: true },
    );
  }

  private recordNavigationHistory(tabId: string, path: string | null): void {
    const current = this.navHistory[this.navHistoryIndex];
    if (current && current.tabId === tabId && current.path === path) return;
    if (this.navHistoryIndex < this.navHistory.length - 1) {
      this.navHistory = this.navHistory.slice(0, this.navHistoryIndex + 1);
    }
    this.navHistory.push({ tabId, path });
    if (this.navHistory.length > 100) {
      this.navHistory.shift();
    }
    this.navHistoryIndex = this.navHistory.length - 1;
  }

  private async navigateHistory(delta: -1 | 1): Promise<void> {
    const navSeq = ++this.navHistorySeq;
    let idx = this.navHistoryIndex + delta;
    while (idx >= 0 && idx < this.navHistory.length) {
      if (navSeq !== this.navHistorySeq) return;
      const entry = this.navHistory[idx];
      const existing = this.tabs.find((t) => t.id === entry.tabId);
      if (existing) {
        this.navHistoryIndex = idx;
        this.navigatingHistoryDepth++;
        try {
          this.activateTab(existing.id);
        } finally {
          this.navigatingHistoryDepth--;
        }
        return;
      }
      if (entry.path) {
        this.navigatingHistoryDepth++;
        let opened = false;
        try {
          opened = await this.openFileByPath(entry.path);
        } finally {
          this.navigatingHistoryDepth--;
        }
        if (navSeq !== this.navHistorySeq) return;
        if (opened) {
          this.navHistoryIndex = idx;
          if (this.activeTab) {
            entry.tabId = this.activeTab.id;
          }
          return;
        }
      }
      idx += delta;
    }
  }

  private openFormatOptionPopover(
    anchorBtn: HTMLButtonElement,
    fmt: 'codeblock' | 'alert',
  ): void {
    const syncExpandedFalse = () => {
      for (const btn of document.querySelectorAll<HTMLButtonElement>(
        '[data-fmt="alert"], [data-fmt="codeblock"]',
      )) {
        btn.setAttribute('aria-expanded', 'false');
      }
    };

    const existing = document.getElementById('format-option-popover');
    if (existing) {
      const wasSameTrigger = existing.dataset.triggerFmt === fmt && existing.matches(':popover-open');
      try {
        existing.hidePopover?.();
      } catch {
        /* ignore */
      }
      existing.remove();
      syncExpandedFalse();
      if (wasSameTrigger) {
        return;
      }
    }

    const popover = document.createElement('div');
    popover.id = 'format-option-popover';
    popover.className = 'context-popover';
    popover.setAttribute('popover', 'auto');
    popover.setAttribute('role', 'menu');
    popover.setAttribute('focusgroup', 'menu');
    popover.dataset.triggerFmt = fmt;
    popover.setAttribute(
      'aria-label',
      fmt === 'codeblock' ? t('format.codeblockPicker') : t('format.alertPicker'),
    );

    const titleEl = document.createElement('div');
    titleEl.className = 'context-popover-title';
    titleEl.textContent =
      fmt === 'codeblock' ? t('format.codeblockPicker') : t('format.alertPicker');
    popover.append(titleEl);

    const options = fmt === 'codeblock' ? CODEBLOCK_LANGUAGES : GITHUB_ALERT_TYPES;
    const buttons: HTMLButtonElement[] = [];

    const closePopover = (restoreAnchorFocus = false) => {
      try {
        popover.hidePopover?.();
      } catch {
        /* ignore */
      }
      popover.remove();
      anchorBtn.setAttribute('aria-expanded', 'false');
      if (restoreAnchorFocus) anchorBtn.focus();
    };

    for (const opt of options) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'menu-item';
      item.setAttribute('role', 'menuitem');
      item.tabIndex = buttons.length === 0 ? 0 : -1;

      const labelSpan = document.createElement('span');
      labelSpan.className = 'menu-item-text';
      labelSpan.textContent = fmt === 'alert' ? `[!${opt}]` : opt;
      item.append(labelSpan);

      item.addEventListener('click', () => {
        closePopover(false);
        this.editor.applyFormat(fmt, opt);
      });

      buttons.push(item);
      popover.append(item);
    }

    popover.addEventListener('keydown', (e) => {
      const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = buttons[(idx + 1) % buttons.length];
        buttons.forEach((b) => (b.tabIndex = -1));
        next.tabIndex = 0;
        next.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = buttons[(idx - 1 + buttons.length) % buttons.length];
        buttons.forEach((b) => (b.tabIndex = -1));
        prev.tabIndex = 0;
        prev.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        buttons.forEach((b) => (b.tabIndex = -1));
        buttons[0].tabIndex = 0;
        buttons[0].focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        buttons.forEach((b) => (b.tabIndex = -1));
        buttons[buttons.length - 1].tabIndex = 0;
        buttons[buttons.length - 1].focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closePopover(true);
      }
    });

    popover.addEventListener('toggle', (e) => {
      if ((e as ToggleEvent).newState === 'closed') {
        anchorBtn.setAttribute('aria-expanded', 'false');
        popover.remove();
      }
    });

    document.body.append(popover);
    const anchorRect = anchorBtn.getBoundingClientRect();
    popover.style.left = `${anchorRect.left}px`;
    popover.style.top = `${anchorRect.bottom + 4}px`;
    anchorBtn.setAttribute('aria-expanded', 'true');

    try {
      popover.showPopover?.();
    } catch {
      popover.style.display = 'block';
    }

    const popRect = popover.getBoundingClientRect();
    const clampedLeft = Math.max(8, Math.min(anchorRect.left, window.innerWidth - popRect.width - 8));
    let clampedTop = anchorRect.bottom + 4;
    if (clampedTop + popRect.height > window.innerHeight - 8) {
      const aboveTop = anchorRect.top - popRect.height - 4;
      clampedTop = aboveTop >= 8 ? aboveTop : Math.max(8, window.innerHeight - popRect.height - 8);
    }
    popover.style.left = `${clampedLeft}px`;
    popover.style.top = `${clampedTop}px`;
    buttons[0]?.focus();
  }

  private openGoToLineDialog(): void {
    const dialog = document.getElementById('goto-line-dialog') as HTMLDialogElement | null;
    const input = document.getElementById('goto-line-input') as HTMLInputElement | null;
    if (!dialog || !input || dialog.open) return;
    this.gotoLineReturnFocusEl =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const head = this.editor.view.state.selection.main.head;
    const lineNum = this.editor.view.state.doc.lineAt(head).number;
    input.setCustomValidity('');
    input.value = String(lineNum);
    dialog.showModal();
    input.focus();
    input.select();
  }

  private openPreviewFind(): void {
    this.previewFindBarEl.hidden = false;
    this.previewFindInputEl.focus();
    this.previewFindInputEl.select();
    if (this.previewFindInputEl.value) {
      this.updatePreviewFindMatches(false);
    } else {
      this.previewFindCountEl.textContent = '0/0';
    }
  }

  private closePreviewFind(restoreFocus = true): void {
    const wasOpen = !this.previewFindBarEl.hidden;
    this.previewFindBarEl.hidden = true;
    this.clearPreviewFindHighlights();
    this.previewFindCountEl.textContent = '0/0';
    if (!restoreFocus || !wasOpen) return;
    if (this.appEl.getAttribute('data-view') === 'preview') {
      if (!this.previewContentEl.hasAttribute('tabindex')) {
        this.previewContentEl.tabIndex = -1;
      }
      this.previewContentEl.focus({ preventScroll: true });
    } else {
      this.editor.view.focus();
    }
  }

  private clearPreviewFindHighlights(): void {
    const marks = this.previewContentEl.querySelectorAll<HTMLElement>('mark.preview-find-match');
    const parents = new Set<Node>();
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parents.add(parent);
      const text = document.createTextNode(mark.textContent ?? '');
      parent.replaceChild(text, mark);
    }
    for (const parent of parents) {
      parent.normalize();
    }
    this.previewFindMatches = [];
    this.previewFindActiveIdx = -1;
  }

  private updatePreviewFindMatches(scrollToFirst: boolean): void {
    this.clearPreviewFindHighlights();
    const query = this.previewFindInputEl.value;
    if (!query) {
      this.previewFindCountEl.textContent = '0/0';
      return;
    }
    const lowerQuery = query.toLowerCase();
    const walker = document.createTreeWalker(this.previewContentEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('script, style, .katex-mathml, .mermaid, svg')) return NodeFilter.FILTER_REJECT;
        return node.nodeValue && node.nodeValue.length > 0
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      },
    });
    const textNodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      textNodes.push(current as Text);
      current = walker.nextNode();
    }

    const matches: HTMLElement[] = [];
    for (const textNode of textNodes) {
      const text = textNode.nodeValue ?? '';
      const lowerText = text.toLowerCase();
      let startIdx = 0;
      let idx = lowerText.indexOf(lowerQuery, startIdx);
      if (idx === -1) continue;

      const frag = document.createDocumentFragment();
      while (idx !== -1) {
        if (idx > startIdx) {
          frag.appendChild(document.createTextNode(text.slice(startIdx, idx)));
        }
        const mark = document.createElement('mark');
        mark.className = 'preview-find-match';
        mark.textContent = text.slice(idx, idx + query.length);
        frag.appendChild(mark);
        matches.push(mark);
        startIdx = idx + query.length;
        idx = lowerText.indexOf(lowerQuery, startIdx);
      }
      if (startIdx < text.length) {
        frag.appendChild(document.createTextNode(text.slice(startIdx)));
      }
      textNode.parentNode?.replaceChild(frag, textNode);
    }

    this.previewFindMatches = matches;
    if (matches.length === 0) {
      this.previewFindActiveIdx = -1;
      this.previewFindCountEl.textContent = '0/0';
      return;
    }
    this.previewFindActiveIdx = 0;
    this.activatePreviewFindMatch(0, scrollToFirst);
  }

  private stepPreviewFind(delta: -1 | 1): void {
    const count = this.previewFindMatches.length;
    if (count === 0) return;
    const nextIdx = (this.previewFindActiveIdx + delta + count) % count;
    this.activatePreviewFindMatch(nextIdx, true);
  }

  private activatePreviewFindMatch(index: number, scrollIntoView: boolean): void {
    for (const m of this.previewFindMatches) {
      m.classList.remove('is-current');
    }
    const target = this.previewFindMatches[index];
    if (!target) return;
    this.previewFindActiveIdx = index;
    target.classList.add('is-current');
    this.previewFindCountEl.textContent = `${index + 1}/${this.previewFindMatches.length}`;
    if (scrollIntoView) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  private bindBackendEvents(): void {
    onBackendEvent('drag-enter', () => {
      this.dropOverlayEl.hidden = false;
    });

    onBackendEvent('drag-leave', () => {
      this.dropOverlayEl.hidden = true;
    });

    onBackendEvent('files-dropped', async ({ files, images, folder }) => {
      if (document.body.inert) return;
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
      const root = this.explorer.rootPath;
      const workspaceChanged = root !== null && paths.some((path) => isSameOrDescendantPath(path, root));
      if (workspaceChanged) {
        this.workspaceSearch.refreshAfterFileChanges(paths);
        this.explorer.invalidateFilesCache();
        this.invalidateLintWorkspaceCache();
        this.explorer.scheduleRefresh();
      }
      const changedLower = new Set(paths.map((p) => p.toLowerCase()));
      await Promise.all(this.tabs
        .filter((tab) => tab.path && changedLower.has(tab.path.toLowerCase()))
        .map((tab) => this.syncTabFromDisk(tab)));
    });

    onBackendEvent('close-requested', () => this.documentClose.closeWindow());
  }
}

const app = new SemyraApp();
void app.init();
