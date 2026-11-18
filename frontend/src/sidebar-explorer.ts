import { backend, FilePayload, FileTreeNode, WorkspaceFileEntry } from './api';
import { t } from './i18n';
import {
  baseNameOfPath,
  getFileExtension,
  isImagePath,
  isMarkdownPath,
  parentDirOfPath,
} from './path-utils';

type EntryDialogMode = 'new-file' | 'new-folder' | 'new-skill' | 'new-ai-item' | 'rename';

interface ContextMenuTarget {
  path: string;
  parentDir: string;
  name: string;
  isDir: boolean;
  isWorkspaceRoot: boolean;
}

export interface SidebarExplorerDeps {
  fileTreeEl: HTMLElement;
  workspaceTitleEl: HTMLElement;
  contextPopoverEl: HTMLElement & {
    showPopover?: () => void;
    hidePopover?: () => void;
  };
  getActiveFilePath: () => string | null;
  onOpenFilePath: (filePath: string) => Promise<void> | void;
  onOpenCreatedFile: (payload: FilePayload) => void;
  onTriggerOpenFolderDialog: () => Promise<void> | void;
  onWorkspaceFolderLoaded: (folderPath: string, persistPrefs: boolean) => void;
  onEntryRenamed: (oldPath: string, newPath: string, newName: string) => void;
  onEntryDeleted: (deletedPath: string) => void;
  onRemoveRecentFolder?: (folderPath: string) => void;
  onRemoveRecentFile?: (filePath: string) => void;
  onCopyAtPath?: (entryPath: string) => Promise<void> | void;
  onScaffoldAgents?: (targetDir: string) => Promise<void> | void;
  onScaffoldSkill?: (targetDir: string) => Promise<void> | void;
}

export type SidebarExplorerCallbacks = SidebarExplorerDeps;

/**
 * Manages the sidebar file explorer tree, empty-state recent folders/files view,
 * context menu popover, file/folder creation & rename dialog, and Recycle Bin prompt.
 */
export class SidebarExplorerController {
  private deps: SidebarExplorerDeps;
  private workspaceTree: FileTreeNode | null = null;
  private workspaceFilesCache: WorkspaceFileEntry[] | null = null;
  private contextTarget: ContextMenuTarget | null = null;
  private loadSeq = 0;
  private refreshSeq = 0;
  private refreshDebounceTimer: number | undefined;
  private isAiLibraryMode = false;
  private selectedAiKind: 'prompt' | 'skill' = 'prompt';
  private entryDialogState: { mode: EntryDialogMode; targetPath: string } = {
    mode: 'new-file',
    targetPath: '',
  };

  constructor(deps: SidebarExplorerDeps) {
    this.deps = deps;
    this.bindEvents();
  }

  public get rootPath(): string | null {
    return this.workspaceTree?.path ?? null;
  }

  public get hasWorkspace(): boolean {
    return this.workspaceTree !== null;
  }

  public setAiLibraryMode(active: boolean): void {
    this.isAiLibraryMode = active;
  }

  public invalidateFilesCache(): void {
    this.workspaceFilesCache = null;
  }

  public async getWorkspaceFiles(): Promise<WorkspaceFileEntry[]> {
    if (!this.workspaceTree) return [];
    if (!this.workspaceFilesCache) {
      try {
        const res = await backend.listWorkspaceFiles(this.workspaceTree.path);
        this.workspaceFilesCache = res.files;
      } catch {
        this.workspaceFilesCache = [];
      }
    }
    return this.workspaceFilesCache;
  }

  public async loadFolder(path: string, persistPrefs = true): Promise<void> {
    const seq = ++this.loadSeq;
    try {
      const tree = await backend.listTree(path);
      if (seq !== this.loadSeq) return;
      this.setTree(tree, persistPrefs);
    } catch (err) {
      console.error('Ordnerbaum konnte nicht geladen werden:', err);
    }
  }

  public async refresh(): Promise<void> {
    window.clearTimeout(this.refreshDebounceTimer);
    const currentTree = this.workspaceTree;
    if (!currentTree) return;
    const loadSeq = this.loadSeq;
    const refreshSeq = ++this.refreshSeq;
    try {
      const tree = await backend.listTree(currentTree.path, false);
      if (loadSeq === this.loadSeq && refreshSeq === this.refreshSeq && this.workspaceTree === currentTree) {
        this.setTree(tree, false);
      }
    } catch (err) {
      console.error('Ordnerbaum konnte nicht geladen werden:', err);
    }
  }

  public scheduleRefresh(delayMs = 220): void {
    if (!this.workspaceTree) return;
    window.clearTimeout(this.refreshDebounceTimer);
    this.refreshDebounceTimer = window.setTimeout(() => {
      void this.refresh();
    }, delayMs);
  }

  public setTree(tree: FileTreeNode, persistPrefs = true): void {
    const isSameRoot =
      this.workspaceTree !== null &&
      this.workspaceTree.path.toLowerCase() === tree.path.toLowerCase();
    const preservedOpenDirs = isSameRoot ? this.collectOpenDirStates() : null;

    this.workspaceTree = tree;
    this.workspaceFilesCache = null;
    if (persistPrefs || !isSameRoot) {
      this.deps.onWorkspaceFolderLoaded(tree.path, persistPrefs);
    }

    this.deps.workspaceTitleEl.textContent = tree.name;
    this.deps.workspaceTitleEl.title = tree.path;
    const newFileBtn = document.getElementById('btn-new-folder-file');
    if (newFileBtn) newFileBtn.hidden = false;
    const newSubBtn = document.getElementById('btn-new-subfolder');
    if (newSubBtn) newSubBtn.hidden = false;
    const refreshBtn = document.getElementById('btn-refresh-tree');
    if (refreshBtn) refreshBtn.hidden = false;
    const collapseBtn = document.getElementById('btn-collapse-all');
    if (collapseBtn) collapseBtn.hidden = false;

    this.deps.fileTreeEl.replaceChildren();
    const children = tree.children ?? [];
    if (children.length === 0) {
      this.deps.fileTreeEl.removeAttribute('role');
      this.deps.fileTreeEl.removeAttribute('aria-label');
      const p = document.createElement('p');
      p.className = 'muted-hint';
      p.textContent = t('sidebar.emptyFolder');
      this.deps.fileTreeEl.appendChild(p);
      return;
    }

    this.deps.fileTreeEl.setAttribute('role', 'tree');
    this.deps.fileTreeEl.setAttribute('aria-label', t('sidebar.filesTitle'));
    for (const node of children) {
      this.deps.fileTreeEl.appendChild(this.renderTreeNode(node, 0, preservedOpenDirs));
    }
    this.highlightActiveFile();
    this.syncTreeTabindex();
  }

  private collectOpenDirStates(): Map<string, boolean> {
    const states = new Map<string, boolean>();
    for (const details of this.deps.fileTreeEl.querySelectorAll<HTMLDetailsElement>(
      'details.tree-dir-details',
    )) {
      const summary = details.querySelector<HTMLElement>(':scope > summary[data-dirpath]');
      const dirPath = summary?.dataset.dirpath;
      if (dirPath) {
        states.set(dirPath.toLowerCase(), details.open);
      }
    }
    return states;
  }

  public highlightActiveFile(): void {
    const activePath = this.deps.getActiveFilePath()?.toLowerCase() ?? '';
    const rows = this.deps.fileTreeEl.querySelectorAll<HTMLElement>('.tree-row[data-filepath]');
    for (const row of rows) {
      const p = (row.dataset.filepath ?? '').toLowerCase();
      row.classList.toggle('is-active', Boolean(activePath && p === activePath));
    }
  }

  public clearWorkspace(recentFolders: string[], recentFiles: string[]): void {
    ++this.loadSeq;
    this.workspaceTree = null;
    this.workspaceFilesCache = null;
    this.deps.workspaceTitleEl.textContent = t('sidebar.noFolder');
    this.deps.workspaceTitleEl.title = t('sidebar.noFolder');
    const newFileBtn = document.getElementById('btn-new-folder-file');
    if (newFileBtn) newFileBtn.hidden = true;
    const newSubBtn = document.getElementById('btn-new-subfolder');
    if (newSubBtn) newSubBtn.hidden = true;
    const refreshBtn = document.getElementById('btn-refresh-tree');
    if (refreshBtn) refreshBtn.hidden = true;
    const collapseBtn = document.getElementById('btn-collapse-all');
    if (collapseBtn) collapseBtn.hidden = true;
    this.renderEmptyStateWithRecents(recentFolders, recentFiles);
  }

  public collapseAll(): void {
    const detailsList = this.deps.fileTreeEl.querySelectorAll<HTMLDetailsElement>(
      'details.tree-dir-details',
    );
    for (const details of detailsList) {
      details.open = false;
      const summary = details.querySelector<HTMLElement>(':scope > summary.tree-row');
      summary?.setAttribute('aria-expanded', 'false');
    }

    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl && this.deps.fileTreeEl.contains(activeEl) && !this.isTreeRowVisible(activeEl)) {
      let current = activeEl.closest<HTMLDetailsElement>('details.tree-dir-details');
      let outermost = current;
      while (current) {
        outermost = current;
        current =
          current.parentElement?.closest<HTMLDetailsElement>('details.tree-dir-details') ?? null;
      }
      const targetSummary = outermost?.querySelector<HTMLElement>(':scope > summary.tree-row');
      if (targetSummary) {
        this.focusTreeRow(targetSummary);
        return;
      }
    }
    this.syncTreeTabindex();
  }

  public renderEmptyStateWithRecents(recentFolders: string[], recentFiles: string[]): void {
    if (this.workspaceTree) return;
    this.deps.fileTreeEl.removeAttribute('role');
    this.deps.fileTreeEl.removeAttribute('aria-label');
    this.deps.fileTreeEl.replaceChildren();

    const wrap = document.createElement('div');
    wrap.className = 'empty-sidebar-state';

    const p = document.createElement('p');
    p.textContent = t('sidebar.noFolderSub');

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'secondary-action-btn';
    openBtn.textContent = t('sidebar.openFolderBtn');
    openBtn.addEventListener('click', () => {
      void this.deps.onTriggerOpenFolderDialog();
    });

    wrap.append(p, openBtn);

    if (recentFolders.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'recent-section';
      const h = document.createElement('h3');
      h.className = 'recent-heading';
      h.textContent = t('sidebar.recentFolders');
      sec.appendChild(h);

      for (const folderPath of recentFolders.slice(0, 5)) {
        const row = document.createElement('div');
        row.className = 'recent-entry-row';

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
          void this.loadFolder(folderPath, true);
        });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'recent-remove-btn';
        removeBtn.title = t('sidebar.removeRecent');
        removeBtn.setAttribute(
          'aria-label',
          t('sidebar.removeFolderFromRecentTitle', { folder: baseNameOfPath(folderPath) }),
        );
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deps.onRemoveRecentFolder?.(folderPath);
        });

        row.append(btn, removeBtn);
        sec.appendChild(row);
      }
      wrap.appendChild(sec);
    }

    if (recentFiles.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'recent-section';
      const h = document.createElement('h3');
      h.className = 'recent-heading';
      h.textContent = t('sidebar.recentFiles');
      sec.appendChild(h);

      for (const filePath of recentFiles.slice(0, 6)) {
        const row = document.createElement('div');
        row.className = 'recent-entry-row';

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
          void this.deps.onOpenFilePath(filePath);
        });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'recent-remove-btn';
        removeBtn.title = t('sidebar.removeRecent');
        removeBtn.setAttribute(
          'aria-label',
          t('sidebar.removeFileFromRecentTitle', { file: baseNameOfPath(filePath) }),
        );
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deps.onRemoveRecentFile?.(filePath);
        });

        row.append(btn, removeBtn);
        sec.appendChild(row);
      }
      wrap.appendChild(sec);
    }

    this.deps.fileTreeEl.appendChild(wrap);
  }

  private renderTreeNode(
    node: FileTreeNode,
    depth: number,
    preservedOpenDirs: Map<string, boolean> | null,
  ): HTMLElement {
    if (node.isDir) {
      const details = document.createElement('details');
      details.className = 'tree-dir-details';
      const prevOpen = preservedOpenDirs?.get(node.path.toLowerCase());
      details.open = prevOpen !== undefined ? prevOpen : depth < 1;

      const summary = document.createElement('summary');
      summary.className = 'tree-row';
      summary.setAttribute('role', 'treeitem');
      summary.setAttribute('aria-expanded', details.open ? 'true' : 'false');
      summary.tabIndex = -1;
      summary.dataset.dirpath = node.path;
      summary.dataset.entryname = node.name;
      summary.title = node.path;
      summary.innerHTML = `<span class="tree-chevron">▶</span><span aria-hidden="true">📁</span><span></span>`;
      summary.lastElementChild!.textContent = node.name;
      details.appendChild(summary);

      details.addEventListener('toggle', () => {
        summary.setAttribute('aria-expanded', details.open ? 'true' : 'false');
        this.syncTreeTabindex();
      });

      const childrenBox = document.createElement('div');
      childrenBox.className = 'tree-children';
      childrenBox.setAttribute('role', 'group');
      for (const child of node.children ?? []) {
        childrenBox.appendChild(this.renderTreeNode(child, depth + 1, preservedOpenDirs));
      }
      details.appendChild(childrenBox);
      return details;
    }

    const isMd = isMarkdownPath(node.name);
    const isImg = isImagePath(node.name);
    const ext = getFileExtension(node.name);
    let icon = '📄';
    if (isMd) {
      icon = '📝';
    } else if (isImg) {
      icon = '🖼️';
    } else if (/^(?:json|yaml|yml|toml|ini|env)$/i.test(ext)) {
      icon = '⚙️';
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tree-row ${isMd ? '' : isImg ? 'is-non-md is-image' : 'is-text-entry'}`;
    btn.setAttribute('role', 'treeitem');
    btn.tabIndex = -1;
    btn.dataset.filepath = node.path;
    btn.dataset.entryname = node.name;
    btn.title = node.path;
    btn.innerHTML = `<span aria-hidden="true">${icon}</span><span></span>`;
    btn.lastElementChild!.textContent = node.name;
    btn.addEventListener('click', () => {
      if (isImg) {
        void backend.revealInExplorer(node.path);
      } else {
        void this.deps.onOpenFilePath(node.path);
      }
    });
    return btn;
  }

  private isTreeRowVisible(row: HTMLElement): boolean {
    let parent = row.parentElement;
    if (row.tagName === 'SUMMARY' && parent?.tagName === 'DETAILS') {
      parent = parent.parentElement;
    }
    while (parent && parent !== this.deps.fileTreeEl) {
      if (parent.tagName === 'DETAILS' && !(parent as HTMLDetailsElement).open) {
        return false;
      }
      parent = parent.parentElement;
    }
    return true;
  }

  private getVisibleTreeItems(): HTMLElement[] {
    return Array.from(
      this.deps.fileTreeEl.querySelectorAll<HTMLElement>('.tree-row[role="treeitem"]'),
    ).filter((el) => this.isTreeRowVisible(el));
  }

  private syncTreeTabindex(preferredEl?: HTMLElement | null): void {
    const allItems = this.deps.fileTreeEl.querySelectorAll<HTMLElement>('.tree-row[role="treeitem"]');
    if (allItems.length === 0) return;

    const visibleItems = Array.from(allItems).filter((el) => this.isTreeRowVisible(el));
    if (visibleItems.length === 0) return;

    const active =
      (preferredEl && visibleItems.includes(preferredEl) ? preferredEl : null) ??
      visibleItems.find((el) => el.classList.contains('is-active')) ??
      visibleItems.find((el) => el.tabIndex === 0) ??
      visibleItems[0];

    for (const item of allItems) {
      item.tabIndex = item === active ? 0 : -1;
    }
  }

  private focusTreeRow(row: HTMLElement): void {
    this.syncTreeTabindex(row);
    row.focus();
  }

  private handleTreeKeyNavigation(e: KeyboardEvent, focusedRow: HTMLElement): boolean {
    if (e.altKey || e.ctrlKey || e.metaKey) return false;
    const key = e.key;
    if (
      key !== 'ArrowDown' &&
      key !== 'ArrowUp' &&
      key !== 'ArrowRight' &&
      key !== 'ArrowLeft' &&
      key !== 'Home' &&
      key !== 'End'
    ) {
      return false;
    }

    const visibleItems = this.getVisibleTreeItems();
    const idx = visibleItems.indexOf(focusedRow);
    if (idx < 0) return false;

    e.preventDefault();

    if (key === 'ArrowDown') {
      if (idx < visibleItems.length - 1) {
        this.focusTreeRow(visibleItems[idx + 1]);
      }
      return true;
    }

    if (key === 'ArrowUp') {
      if (idx > 0) {
        this.focusTreeRow(visibleItems[idx - 1]);
      }
      return true;
    }

    if (key === 'Home') {
      this.focusTreeRow(visibleItems[0]);
      return true;
    }

    if (key === 'End') {
      this.focusTreeRow(visibleItems[visibleItems.length - 1]);
      return true;
    }

    if (key === 'ArrowRight') {
      if (focusedRow.tagName === 'SUMMARY' && focusedRow.parentElement?.tagName === 'DETAILS') {
        const details = focusedRow.parentElement as HTMLDetailsElement;
        if (!details.open) {
          details.open = true;
          focusedRow.setAttribute('aria-expanded', 'true');
          this.syncTreeTabindex(focusedRow);
        } else {
          const firstChild = details.querySelector<HTMLElement>(
            ':scope > .tree-children > .tree-row[role="treeitem"], :scope > .tree-children > details.tree-dir-details > summary.tree-row[role="treeitem"]',
          );
          if (firstChild) {
            this.focusTreeRow(firstChild);
          }
        }
      }
      return true;
    }

    // ArrowLeft
    if (focusedRow.tagName === 'SUMMARY' && focusedRow.parentElement?.tagName === 'DETAILS') {
      const details = focusedRow.parentElement as HTMLDetailsElement;
      if (details.open) {
        details.open = false;
        focusedRow.setAttribute('aria-expanded', 'false');
        this.syncTreeTabindex(focusedRow);
        return true;
      }
    }

    const parentDetails =
      focusedRow.tagName === 'SUMMARY'
        ? focusedRow.parentElement?.parentElement?.closest<HTMLDetailsElement>(
            'details.tree-dir-details',
          )
        : focusedRow.closest<HTMLDetailsElement>('details.tree-dir-details');
    const parentSummary = parentDetails?.querySelector<HTMLElement>(':scope > summary.tree-row');
    if (parentSummary && this.deps.fileTreeEl.contains(parentSummary)) {
      this.focusTreeRow(parentSummary);
    }
    return true;
  }

  private bindEvents(): void {
    document.getElementById('btn-sidebar-open-folder')?.addEventListener('click', () => {
      void this.deps.onTriggerOpenFolderDialog();
    });

    document.getElementById('btn-refresh-tree')?.addEventListener('click', () => {
      void this.refresh();
    });

    document.getElementById('btn-collapse-all')?.addEventListener('click', () => {
      this.collapseAll();
    });

    document.getElementById('btn-new-folder-file')?.addEventListener('click', () => {
      if (!this.workspaceTree) return;
      this.openEntryDialog(
        this.isAiLibraryMode ? 'new-ai-item' : 'new-file',
        this.workspaceTree.path,
      );
    });

    document.getElementById('btn-new-subfolder')?.addEventListener('click', () => {
      if (!this.workspaceTree) return;
      this.openEntryDialog('new-folder', this.workspaceTree.path);
    });

    this.deps.fileTreeEl.addEventListener('contextmenu', (e) => {
      this.openContextMenu(e);
    });

    this.deps.contextPopoverEl.addEventListener('toggle', (evt: Event) => {
      const toggleEvt = evt as unknown as { newState?: string };
      if (toggleEvt.newState === 'closed' || !this.deps.contextPopoverEl.matches?.(':popover-open')) {
        this.deps.fileTreeEl
          .querySelectorAll('.tree-row.context-active')
          .forEach((el) => el.classList.remove('context-active'));
      }
    });

    this.deps.fileTreeEl.addEventListener('focusin', (e: FocusEvent) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        '.tree-row[role="treeitem"]',
      );
      if (target && this.deps.fileTreeEl.contains(target) && this.isTreeRowVisible(target)) {
        this.syncTreeTabindex(target);
      }
    });

    this.deps.fileTreeEl.addEventListener('keydown', (e: KeyboardEvent) => {
      const focusedRow = (
        (e.target as HTMLElement | null) ?? (document.activeElement as HTMLElement | null)
      )?.closest<HTMLElement>('.tree-row');
      if (!focusedRow || !this.deps.fileTreeEl.contains(focusedRow)) return;

      if (this.handleTreeKeyNavigation(e, focusedRow)) return;

      if (e.key === 'F2') {
        e.preventDefault();
        const isDir = Boolean(focusedRow.dataset.dirpath);
        const path = isDir ? focusedRow.dataset.dirpath! : focusedRow.dataset.filepath!;
        const name = focusedRow.dataset.entryname ?? (isDir ? 'Ordner' : 'Datei.md');
        if (path) {
          this.openEntryDialog('rename', path, name);
        }
      } else if (e.key === 'Delete') {
        e.preventDefault();
        const isDir = Boolean(focusedRow.dataset.dirpath);
        const path = isDir ? focusedRow.dataset.dirpath! : focusedRow.dataset.filepath!;
        const name = focusedRow.dataset.entryname ?? (isDir ? 'Ordner' : 'Datei.md');
        if (path) {
          void this.confirmMoveToRecycleBin({
            path,
            parentDir: isDir ? path : (parentDirOfPath(path) ?? this.workspaceTree?.path ?? path),
            name,
            isDir,
            isWorkspaceRoot: false,
          });
        }
      } else if (e.altKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        const path = focusedRow.dataset.dirpath || focusedRow.dataset.filepath;
        if (path) {
          void backend.revealInExplorer(path);
        }
      }
    });

    this.deps.contextPopoverEl.addEventListener('click', (e) => {
      const actionBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-ctx-action]');
      if (!actionBtn || actionBtn.disabled || !this.contextTarget) return;

      const target = this.contextTarget;
      const action = actionBtn.dataset.ctxAction;
      this.deps.contextPopoverEl.hidePopover?.();

      if (action === 'new-file') {
        this.openEntryDialog('new-file', target.parentDir);
      } else if (action === 'new-folder') {
        this.openEntryDialog('new-folder', target.parentDir);
      } else if (action === 'rename' && !target.isWorkspaceRoot) {
        this.openEntryDialog('rename', target.path, target.name);
      } else if (action === 'reveal') {
        void backend.revealInExplorer(target.path);
      } else if (action === 'copy-at-path') {
        void this.deps.onCopyAtPath?.(target.path);
      } else if (action === 'scaffold-agents') {
        void this.deps.onScaffoldAgents?.(target.parentDir);
      } else if (action === 'scaffold-skill') {
        void this.deps.onScaffoldSkill?.(target.parentDir);
      } else if (action === 'delete' && !target.isWorkspaceRoot) {
        void this.confirmMoveToRecycleBin(target);
      }
    });

    const entryDialog = document.getElementById('new-file-dialog') as HTMLDialogElement | null;
    const entryInput = document.getElementById('new-file-name') as HTMLInputElement | null;
    const entryError = document.getElementById('new-file-error');

    document.getElementById('btn-ai-kind-prompt')?.addEventListener('click', () => {
      this.setAiDialogKind('prompt');
    });
    document.getElementById('btn-ai-kind-skill')?.addEventListener('click', () => {
      this.setAiDialogKind('skill');
    });

    entryDialog?.addEventListener('close', () => {
      entryDialog.returnValue = '';
    });

    document.getElementById('new-file-form')?.addEventListener('submit', async (e) => {
      if (!entryDialog || !entryInput || !entryError) return;
      const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
      if (submitter?.value !== 'create') return;
      e.preventDefault();

      const { mode, targetPath } = this.entryDialogState;
      const rawName = entryInput.value;

      try {
        if (mode === 'new-file') {
          const created = await backend.createFile(targetPath, rawName);
          entryDialog.close();
          await this.refresh();
          this.deps.onOpenCreatedFile(created);
        } else if (mode === 'new-ai-item') {
          const sep = targetPath.includes('\\') ? '\\' : '/';
          const created =
            this.selectedAiKind === 'skill'
              ? await backend.createAiSkill(`${targetPath}${sep}skills`, rawName)
              : await backend.createFile(`${targetPath}${sep}prompts`, rawName);
          entryDialog.close();
          await this.refresh();
          this.deps.onOpenCreatedFile(created);
        } else if (mode === 'new-skill') {
          const created = await backend.createAiSkill(targetPath, rawName);
          entryDialog.close();
          await this.refresh();
          this.deps.onOpenCreatedFile(created);
        } else if (mode === 'new-folder') {
          await backend.createFolder(targetPath, rawName);
          entryDialog.close();
          await this.refresh();
        } else if (mode === 'rename') {
          const renamed = await backend.renamePath(targetPath, rawName);
          entryDialog.close();
          this.deps.onEntryRenamed(targetPath, renamed.path, renamed.name);
          await this.refresh();
        }
      } catch (err) {
        entryError.textContent =
          err instanceof Error ? err.message : 'Aktion fehlgeschlagen.';
        entryError.classList.add('is-visible');
      }
    });
  }

  private openContextMenu(e: MouseEvent): void {
    if (!this.workspaceTree) return;
    e.preventDefault();

    const row = (e.target as HTMLElement).closest<HTMLElement>('.tree-row');
    this.deps.fileTreeEl
      .querySelectorAll('.tree-row.context-active')
      .forEach((r) => r.classList.remove('context-active'));
    if (row) {
      row.classList.add('context-active');
    }
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

    const renameBtn = document.getElementById('ctx-btn-rename') as HTMLButtonElement | null;
    const deleteBtn = document.getElementById('ctx-btn-delete') as HTMLButtonElement | null;
    if (renameBtn) renameBtn.disabled = this.contextTarget.isWorkspaceRoot;
    if (deleteBtn) deleteBtn.disabled = this.contextTarget.isWorkspaceRoot;

    this.deps.contextPopoverEl.style.left = `${e.clientX}px`;
    this.deps.contextPopoverEl.style.top = `${e.clientY}px`;
    this.deps.contextPopoverEl.showPopover?.();

    requestAnimationFrame(() => {
      const rect = this.deps.contextPopoverEl.getBoundingClientRect();
      const clampedLeft = Math.max(6, Math.min(e.clientX, window.innerWidth - rect.width - 8));
      const clampedTop = Math.max(6, Math.min(e.clientY, window.innerHeight - rect.height - 8));
      this.deps.contextPopoverEl.style.left = `${clampedLeft}px`;
      this.deps.contextPopoverEl.style.top = `${clampedTop}px`;

      const firstItem = this.deps.contextPopoverEl.querySelector<HTMLButtonElement>(
        '[focusgroup~="menu"] > button:not(:disabled)',
      );
      firstItem?.focus();
    });
  }

  public openNewSkillDialog(skillsDirPath: string): void {
    this.openEntryDialog('new-skill', skillsDirPath);
  }

  private setAiDialogKind(kind: 'prompt' | 'skill'): void {
    this.selectedAiKind = kind;
    const promptBtn = document.getElementById('btn-ai-kind-prompt');
    const skillBtn = document.getElementById('btn-ai-kind-skill');
    promptBtn?.classList.toggle('is-active', kind === 'prompt');
    promptBtn?.setAttribute('aria-pressed', kind === 'prompt' ? 'true' : 'false');
    skillBtn?.classList.toggle('is-active', kind === 'skill');
    skillBtn?.setAttribute('aria-pressed', kind === 'skill' ? 'true' : 'false');

    if (this.entryDialogState.mode === 'new-ai-item') {
      const labelEl = document.getElementById('new-file-label');
      const inputEl = document.getElementById('new-file-name') as HTMLInputElement | null;
      if (labelEl) {
        labelEl.textContent =
          kind === 'skill' ? t('aiLib.newSkillPromptLabel') : t('aiLib.newPromptLabel');
      }
      if (inputEl) {
        inputEl.placeholder =
          kind === 'skill'
            ? t('aiLib.newSkillPromptPlaceholder')
            : t('aiLib.newPromptPlaceholder');
        inputEl.focus();
      }
    }
  }

  private openEntryDialog(
    mode: EntryDialogMode,
    targetPath: string,
    initialValue = '',
  ): void {
    this.entryDialogState = { mode, targetPath };

    const dialog = document.getElementById('new-file-dialog') as HTMLDialogElement;
    const kindGroup = document.getElementById('new-ai-kind-group');
    const titleEl = document.getElementById('new-file-dialog-title')!;
    const labelEl = document.getElementById('new-file-label')!;
    const inputEl = document.getElementById('new-file-name') as HTMLInputElement;
    const submitBtn = document.getElementById('new-file-submit-btn') as HTMLButtonElement;
    const errorEl = document.getElementById('new-file-error')!;

    errorEl.textContent = '';
    errorEl.classList.remove('is-visible');
    if (kindGroup) {
      kindGroup.hidden = mode !== 'new-ai-item';
    }

    if (mode === 'new-file') {
      titleEl.textContent = t('newFileDialog.title');
      labelEl.textContent = t('newFileDialog.label');
      inputEl.placeholder = t('newFileDialog.placeholder');
      submitBtn.textContent = t('newFileDialog.create');
    } else if (mode === 'new-ai-item') {
      titleEl.textContent = t('aiLib.newPromptTitle');
      submitBtn.textContent = t('newFileDialog.create');
      this.setAiDialogKind(this.selectedAiKind);
    } else if (mode === 'new-skill') {
      titleEl.textContent = t('aiLib.newSkillPromptTitle');
      labelEl.textContent = t('aiLib.newSkillPromptLabel');
      inputEl.placeholder = t('aiLib.newSkillPromptPlaceholder');
      submitBtn.textContent = t('newFileDialog.create');
    } else if (mode === 'new-folder') {
      titleEl.textContent = t('newFolderDialog.title');
      labelEl.textContent = t('newFolderDialog.label');
      inputEl.placeholder = 'Chapter-1';
      submitBtn.textContent = t('newFolderDialog.create');
    } else {
      titleEl.textContent = t('renameDialog.title');
      labelEl.textContent = t('renameDialog.label');
      inputEl.placeholder = '';
      submitBtn.textContent = t('renameDialog.submit');
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
    desc.textContent = t('trashDialog.confirmItem', { name: target.name });

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
      this.deps.onEntryDeleted(target.path);
      await this.refresh();
    } catch (err) {
      console.error('Löschen in Papierkorb fehlgeschlagen:', err);
    }
  }
}
