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
} from './api';
import { FormatAction, MarkdownEditorController } from './editor';
import { safeSetMarkdownHTML } from './sanitizer';

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

const WELCOME_MARKDOWN = `# Willkommen bei MarkLive 👋

**MarkLive** ist dein nativer **Windows 11 x64 Markdown-Editor** auf Basis von **Rust** (\`pulldown-cmark\` + \`syntect\`) mit sofortiger Live-Vorschau.

> [!TIP]
> Öffne eine Datei über **Strg + O**, wähle links einen **Arbeitsordner** aus, füge Screenshots direkt per **Strg + V** ein oder ziehe Dateien aus dem Windows Explorer per **Drag & Drop** hierher!

## Highlights

- [x] **Echtzeit Split-View** mit inkrementellem DOM-Morphing & Sync-Scroll
- [x] **Multi-Tab Workflow**, **Volltextsuche** (\`Strg + Umschalt + F\`) & **Crash-Recovery**
- [x] **GitHub-Flavored Markdown (GFM)**: Tabellen, interaktive Checklisten, Hinweise & YAML-Frontmatter
- [ ] Klicke direkt in der Vorschau auf diese Checkbox, um sie im Markdown abzuhaken!

## Syntax-Highlighting (Rust \`syntect\`)

\`\`\`rust
fn gruss_aus_windows_11(name: &str) -> String {
    format!("Hallo {name}, viel Spaß beim Schreiben in MarkLive!")
}
\`\`\`

## Tabellen & Mathematik

| Funktion | Tastenkürzel | Beschreibung |
| :--- | :---: | :--- |
| Datei speichern | \`Strg + S\` | Speichert Änderungen direkt auf der Festplatte |
| Volltextsuche | \`Strg + Umschalt + F\` | Durchsucht alle Markdown-Dateien im Arbeitsordner |
| Screenshot einfügen | \`Strg + V\` | Speichert Zwischenablage-Bilder automatisch unter \`assets/\` |
| Ansichtsmodus | \`Alt + 1 / 2 / 3\` | Wechselt zwischen Editor, Split & Lesemodus |

Auch mathematische Formeln mit KaTeX wie $E = mc^2$ oder abgesetzte Gleichungen funktionieren sofort:

$$
f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} \\exp\\left(-\\frac{(x - \\mu)^2}{2\\sigma^2}\\right)
$$

## Mermaid-Diagramme

\`\`\`mermaid
flowchart LR
  Editor["CodeMirror 6 Editor"] --> Rust["Rust Markdown-Engine"]
  Rust --> Preview["Windows 11 Live-Vorschau"]
\`\`\`
`;

interface OpenTab {
  id: string;
  name: string;
  path: string | null;
  parentDir: string | null;
  savedContent: string;
  currentContent: string;
  lineEnding: 'CRLF' | 'LF';
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

class MarkLiveApp {
  private tabs: OpenTab[] = [];
  private activeTabId = '';
  private untitledCounter = 1;
  private workspaceTree: FileTreeNode | null = null;
  private editor!: MarkdownEditorController;

  private syncScrollEnabled = true;
  private autoSaveEnabled = false;
  private scrollSyncLock: 'editor' | 'preview' | null = null;
  private scrollUnlockTimer: number | undefined;
  private renderDebounceTimer: number | undefined;
  private autoSaveTimer: number | undefined;
  private draftSyncTimer: number | undefined;
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
  private statusEolEl = document.getElementById('status-eol')!;
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
      onEditorScrolled: () => this.syncEditorToPreview(),
      onFormatCommand: (cmd) => this.editor.applyFormat(cmd),
      onPasteImage: (mimeType, dataUrl) => {
        void this.handlePasteImage(mimeType, dataUrl);
      },
    });

    this.bindUIEvents();
    this.bindThemeSystem();
    this.bindBackendEvents();

    // Check startup payload (CLI args + last workspace + crash-recovered drafts)
    try {
      const startup = await backend.getStartup();
      if (startup.initialFolder) {
        await this.loadWorkspaceFolder(startup.initialFolder);
      }
      if (startup.initialFiles.length > 0) {
        for (const filePath of startup.initialFiles) {
          await this.openFileByPath(filePath);
        }
      }
      if (startup.recoveredDrafts.length > 0) {
        this.restoreRecoveredDrafts(startup.recoveredDrafts);
      }
    } catch {
      // Fallback to welcome tab
    }

    if (this.tabs.length === 0) {
      this.createNewTab('Willkommen.md', WELCOME_MARKDOWN, false);
    }
  }

  private get activeTab(): OpenTab | undefined {
    return this.tabs.find((t) => t.id === this.activeTabId);
  }

  // ==========================================================================
  // Crash-Recovery Draft Persistence & Clipboard Image Paste
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
    void this.renderPreviewImmediate(
      target.currentContent,
      target.parentDir ?? this.workspaceTree?.path ?? null,
      target.previewScrollTop,
    );
  }

  private async openFileByPath(path: string): Promise<void> {
    const normLower = path.toLowerCase();
    const existing = this.tabs.find((t) => t.path?.toLowerCase() === normLower);
    if (existing) {
      this.activateTab(existing.id);
      return;
    }

    try {
      const payload = await backend.readFile(path);
      this.openTabFromPayload(payload);
    } catch (err) {
      console.error('Datei konnte nicht geöffnet werden:', err);
    }
  }

  private openTabFromPayload(payload: FilePayload): void {
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

    const id = crypto.randomUUID();
    const tab: OpenTab = {
      id,
      name: payload.name,
      path: payload.path,
      parentDir: payload.parentDir,
      savedContent: payload.content,
      currentContent: payload.content,
      lineEnding: payload.lineEnding,
      isDirty: false,
      editorState: this.editor.createState(payload.content),
      editorScrollTop: 0,
      previewScrollTop: 0,
      outline: [],
      stats: { words: 0, chars: 0, lines: 1, readingTimeSec: 0 },
    };

    this.tabs.push(tab);
    this.activateTab(id);
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
    tab.isDirty = false;
    this.renderTabBar();
    this.updateStatusBar();
    this.syncWindowMetadata();
    this.scheduleDraftSync();

    if (this.workspaceTree) {
      void this.refreshWorkspaceTree();
    }
    return true;
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
  }

  // ==========================================================================
  // Live Markdown Rendering & Bidirectional Sync-Scroll
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
    } catch (err) {
      console.error('Markdown-Rendering fehlgeschlagen:', err);
    }
  }

  private getPreviewLineAnchors(): Array<{ line: number; top: number }> {
    const paneRect = this.previewPaneEl.getBoundingClientRect();
    const scrollTop = this.previewPaneEl.scrollTop;
    const nodes = this.previewContentEl.querySelectorAll<HTMLElement>('[data-line]');
    const anchors: Array<{ line: number; top: number }> = [];

    for (const el of nodes) {
      const line = Number(el.getAttribute('data-line'));
      if (!Number.isFinite(line)) continue;
      const top = el.getBoundingClientRect().top - paneRect.top + scrollTop;
      if (anchors.length === 0 || anchors[anchors.length - 1].line !== line) {
        anchors.push({ line, top });
      }
    }
    anchors.sort((a, b) => a.line - b.line);
    return anchors;
  }

  private syncEditorToPreview(): void {
    if (!this.syncScrollEnabled || this.scrollSyncLock === 'preview') return;
    if (this.appEl.getAttribute('data-view') !== 'split') return;

    const edScroller = this.editor.view.scrollDOM;
    const edMax = edScroller.scrollHeight - edScroller.clientHeight;
    const pvMax = this.previewPaneEl.scrollHeight - this.previewPaneEl.clientHeight;
    if (edMax <= 0 || pvMax <= 0) return;

    this.lockScrollSource('editor');

    if (edScroller.scrollTop <= 2) {
      this.previewPaneEl.scrollTop = 0;
      return;
    }
    if (edScroller.scrollTop >= edMax - 2) {
      this.previewPaneEl.scrollTop = pvMax;
      return;
    }

    const topLine = this.editor.getTopViewportLine();
    const anchors = this.getPreviewLineAnchors();
    if (anchors.length === 0) {
      this.previewPaneEl.scrollTop = (edScroller.scrollTop / edMax) * pvMax;
      return;
    }

    let prev = { line: 1, top: 0 };
    let next = { line: this.editor.view.state.doc.lines + 1, top: pvMax };

    for (const a of anchors) {
      if (a.line <= topLine) {
        prev = a;
      } else {
        next = a;
        break;
      }
    }

    const span = Math.max(1, next.line - prev.line);
    const ratio = Math.max(0, Math.min(1, (topLine - prev.line) / span));
    this.previewPaneEl.scrollTop = prev.top + (next.top - prev.top) * ratio;
  }

  private syncPreviewToEditor(): void {
    if (!this.syncScrollEnabled || this.scrollSyncLock === 'editor') return;
    if (this.appEl.getAttribute('data-view') !== 'split') return;

    const pvTop = this.previewPaneEl.scrollTop;
    const pvMax = this.previewPaneEl.scrollHeight - this.previewPaneEl.clientHeight;
    const edMax =
      this.editor.view.scrollDOM.scrollHeight - this.editor.view.scrollDOM.clientHeight;
    if (pvMax <= 0 || edMax <= 0) return;

    this.lockScrollSource('preview');

    if (pvTop <= 2) {
      this.editor.view.scrollDOM.scrollTop = 0;
      return;
    }
    if (pvTop >= pvMax - 2) {
      this.editor.view.scrollDOM.scrollTop = edMax;
      return;
    }

    const anchors = this.getPreviewLineAnchors();
    if (anchors.length === 0) {
      this.editor.view.scrollDOM.scrollTop = (pvTop / pvMax) * edMax;
      return;
    }

    let prev = { line: 1, top: 0 };
    let next = { line: this.editor.view.state.doc.lines, top: pvMax };

    for (const a of anchors) {
      if (a.top <= pvTop + 8) {
        prev = a;
      } else {
        next = a;
        break;
      }
    }

    const pxSpan = Math.max(1, next.top - prev.top);
    const ratio = Math.max(0, Math.min(1, (pvTop - prev.top) / pxSpan));
    const targetLine = prev.line + (next.line - prev.line) * ratio;
    this.editor.scrollToSourceLine(targetLine);
  }

  private lockScrollSource(source: 'editor' | 'preview'): void {
    this.scrollSyncLock = source;
    window.clearTimeout(this.scrollUnlockTimer);
    this.scrollUnlockTimer = window.setTimeout(() => {
      this.scrollSyncLock = null;
    }, 90);
  }

  // ==========================================================================
  // Workspace Explorer, Full-Text Search & Document Outline
  // ==========================================================================

  private switchSidebarPanel(panel: 'files' | 'search' | 'outline'): void {
    this.sidebarEl.classList.remove('is-collapsed');
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-sidebar-panel]')) {
      const active = b.dataset.sidebarPanel === panel;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', String(active));
    }
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
    summary.textContent = `${totalHits} ${totalHits === 1 ? 'Treffer' : 'Treffer'} in ${results.length} ${results.length === 1 ? 'Datei' : 'Dateien'}`;
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

  private async loadWorkspaceFolder(path: string): Promise<void> {
    try {
      const tree = await backend.listTree(path);
      this.setWorkspaceTree(tree);
    } catch (err) {
      console.error('Ordnerbaum konnte nicht geladen werden:', err);
    }
  }

  private async refreshWorkspaceTree(): Promise<void> {
    if (!this.workspaceTree) return;
    await this.loadWorkspaceFolder(this.workspaceTree.path);
  }

  private setWorkspaceTree(tree: FileTreeNode): void {
    this.workspaceTree = tree;
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
      summary.innerHTML = `<span class="tree-chevron">▶</span><span>📁</span><span></span>`;
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
    btn.innerHTML = `<span>${icon}</span><span></span>`;
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
    } catch (err) {
      console.error('Löschen in Papierkorb fehlgeschlagen:', err);
    }
  }

  // ==========================================================================
  // Chrome, Tabs, Status Bar & Dialogs
  // ==========================================================================

  private renderTabBar(): void {
    this.tabBarEl.replaceChildren();
    for (const tab of this.tabs) {
      const item = document.createElement('div');
      item.className = `tab-item ${tab.id === this.activeTabId ? 'is-active' : ''}`;
      item.setAttribute('role', 'tab');
      item.setAttribute('aria-selected', String(tab.id === this.activeTabId));
      item.title = tab.path ?? `${tab.name} (Ungespeichert)`;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'tab-title';
      titleSpan.textContent = tab.name;
      item.appendChild(titleSpan);

      if (tab.isDirty) {
        const dot = document.createElement('span');
        dot.className = 'tab-dirty-dot';
        dot.title = 'Ungespeicherte Änderungen';
        item.appendChild(dot);
      }

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'tab-close-btn';
      closeBtn.setAttribute('aria-label', `${tab.name} schließen`);
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.requestCloseTab(tab.id);
      });
      item.appendChild(closeBtn);

      item.addEventListener('click', () => this.activateTab(tab.id));
      item.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          void this.requestCloseTab(tab.id);
        }
      });

      this.tabBarEl.appendChild(item);
    }
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
    this.statusEolEl.textContent = tab.lineEnding;
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

    // Listen to OS preference changes without deleting stored user override
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
  // UI & Global Shortcuts Wiring
  // ==========================================================================

  private bindUIEvents(): void {
    // Primary toolbar actions
    document.getElementById('btn-toggle-sidebar')!.addEventListener('click', () => {
      this.sidebarEl.classList.toggle('is-collapsed');
    });

    const newTabFn = () => this.createNewTab();
    document.getElementById('btn-new-tab')!.addEventListener('click', newTabFn);
    document.getElementById('btn-tab-add')!.addEventListener('click', newTabFn);

    const openFilesFn = async () => {
      const res = await backend.openFilesDialog();
      for (const f of res.files) {
        this.openTabFromPayload(f);
      }
    };
    document.getElementById('btn-open-file')!.addEventListener('click', openFilesFn);

    const openFolderFn = async () => {
      const res = await backend.openFolderDialog();
      if (res.tree) {
        this.setWorkspaceTree(res.tree);
        this.switchSidebarPanel('files');
      }
    };
    document.getElementById('btn-open-folder')!.addEventListener('click', openFolderFn);
    document
      .getElementById('btn-sidebar-open-folder')!
      .addEventListener('click', openFolderFn);

    document.getElementById('btn-refresh-tree')!.addEventListener('click', () => {
      void this.refreshWorkspaceTree();
    });

    // Sidebar header quick actions: New File & New Subfolder
    document.getElementById('btn-new-folder-file')!.addEventListener('click', () => {
      if (!this.workspaceTree) return;
      this.openEntryDialog('new-file', this.workspaceTree.path);
    });

    document.getElementById('btn-new-subfolder')!.addEventListener('click', () => {
      if (!this.workspaceTree) return;
      this.openEntryDialog('new-folder', this.workspaceTree.path);
    });

    // Explorer right-click context menu & action dispatch
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

          // Update any open tabs referencing the renamed file or directory
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
      const tab = this.activeTab;
      if (!tab) return;
      void backend.exportHtmlDialog(
        tab.name,
        tab.currentContent,
        tab.parentDir ?? this.workspaceTree?.path ?? null,
        tab.parentDir ?? this.workspaceTree?.path ?? null,
      );
    });

    document.getElementById('btn-print')!.addEventListener('click', () => {
      window.print();
    });

    // View mode switcher
    const setViewMode = (mode: 'editor' | 'split' | 'preview') => {
      this.appEl.setAttribute('data-view', mode);
      for (const b of document.querySelectorAll<HTMLButtonElement>('[data-set-view]')) {
        b.classList.toggle('is-active', b.dataset.setView === mode);
      }
    };
    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-set-view]')) {
      btn.addEventListener('click', () => {
        setViewMode(btn.dataset.setView as 'editor' | 'split' | 'preview');
      });
    }

    // Sync-Scroll & Auto-Save toggles
    const syncBtn = document.getElementById('btn-sync-scroll')!;
    syncBtn.addEventListener('click', () => {
      this.syncScrollEnabled = !this.syncScrollEnabled;
      syncBtn.classList.toggle('is-active', this.syncScrollEnabled);
      syncBtn.setAttribute('aria-pressed', String(this.syncScrollEnabled));
    });

    const autoSaveBtn = document.getElementById('btn-autosave')!;
    autoSaveBtn.addEventListener('click', () => {
      this.autoSaveEnabled = !this.autoSaveEnabled;
      autoSaveBtn.classList.toggle('is-active', this.autoSaveEnabled);
      autoSaveBtn.setAttribute('aria-pressed', String(this.autoSaveEnabled));
    });

    const toggleZen = () => this.appEl.classList.toggle('is-zen');
    document.getElementById('btn-zen')!.addEventListener('click', toggleZen);

    // Formatting toolbar buttons
    document.getElementById('format-bar')!.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fmt]');
      if (!btn) return;
      this.editor.applyFormat(btn.dataset.fmt as FormatAction);
    });

    // Table generator dialog close handler (reset returnValue per modern-web-guidance dialog)
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

    // Sidebar tab switcher (Dateien | Suche | Gliederung)
    for (const tabBtn of document.querySelectorAll<HTMLButtonElement>('[data-sidebar-panel]')) {
      tabBtn.addEventListener('click', () => {
        const target = tabBtn.dataset.sidebarPanel as 'files' | 'search' | 'outline';
        this.switchSidebarPanel(target);
      });
    }

    // Draggable Split-View Resizer
    const resizer = document.getElementById('split-resizer')!;
    const splitContainer = document.getElementById('split-container')!;
    resizer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      resizer.setPointerCapture(e.pointerId);
      resizer.classList.add('is-dragging');

      const onMove = (ev: PointerEvent) => {
        const rect = splitContainer.getBoundingClientRect();
        const pct = Math.max(20, Math.min(80, ((ev.clientX - rect.left) / rect.width) * 100));
        document.documentElement.style.setProperty('--split-ratio', `${pct.toFixed(2)}%`);
      };

      const onUp = (ev: PointerEvent) => {
        resizer.releasePointerCapture(ev.pointerId);
        resizer.classList.remove('is-dragging');
        resizer.removeEventListener('pointermove', onMove);
        resizer.removeEventListener('pointerup', onUp);
      };

      resizer.addEventListener('pointermove', onMove);
      resizer.addEventListener('pointerup', onUp);
    });

    resizer.addEventListener('dblclick', () => {
      document.documentElement.style.setProperty('--split-ratio', '50%');
    });

    // Preview Pane interactions: Sync-scroll, Interactive Checkboxes, Copy-Code, External Links
    this.previewPaneEl.addEventListener('scroll', () => this.syncPreviewToEditor(), {
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

      // Copy Code Block button
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

      // Links in Markdown Preview
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

    // Status bar file path -> Reveal in Windows Explorer
    this.statusPathBtn.addEventListener('click', () => {
      const p = this.activeTab?.path ?? this.workspaceTree?.path;
      if (p) void backend.revealInExplorer(p);
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

      if (mod && !e.shiftKey && key === 'n') {
        e.preventDefault();
        newTabFn();
      } else if (mod && !e.shiftKey && key === 'o') {
        e.preventDefault();
        void openFilesFn();
      } else if (mod && e.shiftKey && key === 'o') {
        e.preventDefault();
        void openFolderFn();
      } else if (mod && e.shiftKey && key === 'f') {
        e.preventDefault();
        this.switchSidebarPanel('search');
      } else if (mod && !e.shiftKey && key === 's') {
        e.preventDefault();
        if (this.activeTab) void this.saveTab(this.activeTab, false);
      } else if (mod && e.shiftKey && key === 's') {
        e.preventDefault();
        if (this.activeTab) void this.saveTab(this.activeTab, true);
      } else if (mod && key === 'p') {
        e.preventDefault();
        window.print();
      } else if (mod && key === 'w') {
        e.preventDefault();
        if (this.activeTab) void this.requestCloseTab(this.activeTab.id);
      } else if (mod && e.key === '\\') {
        e.preventDefault();
        this.sidebarEl.classList.toggle('is-collapsed');
      } else if (e.altKey && e.key === '1') {
        e.preventDefault();
        setViewMode('editor');
      } else if (e.altKey && e.key === '2') {
        e.preventDefault();
        setViewMode('split');
      } else if (e.altKey && e.key === '3') {
        e.preventDefault();
        setViewMode('preview');
      } else if (e.key === 'F11') {
        e.preventDefault();
        toggleZen();
      } else if (e.key === 'F1') {
        e.preventDefault();
        (document.getElementById('shortcuts-dialog') as HTMLDialogElement).showModal();
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

    onBackendEvent('files-dropped', async ({ files, folder }) => {
      this.dropOverlayEl.hidden = true;
      if (folder) {
        await this.loadWorkspaceFolder(folder);
        this.sidebarEl.classList.remove('is-collapsed');
      }
      for (const f of files) {
        await this.openFileByPath(f);
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
            // Auto-reload unmodified tab smoothly
            tab.savedContent = disk.content;
            tab.currentContent = disk.content;
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
      await backend.clearDrafts().catch(() => {});
      await backend.forceCloseWindow();
    });
  }
}

const app = new MarkLiveApp();
void app.init();
