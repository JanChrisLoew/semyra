import { backend, FilePayload, FileTreeNode, WorkspaceFileEntry } from './api';
import {
  baseNameOfPath,
  getFileExtension,
  isImagePath,
  isMarkdownPath,
  parentDirOfPath,
} from './path-utils';

type EntryDialogMode = 'new-file' | 'new-folder' | 'rename';

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
}

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
  private refreshDebounceTimer: number | undefined;
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
    if (!this.workspaceTree) return;
    await this.loadFolder(this.workspaceTree.path, false);
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

    this.deps.fileTreeEl.replaceChildren();
    const children = tree.children ?? [];
    if (children.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted-hint';
      p.textContent = 'Keine Markdown-Dateien in diesem Ordner.';
      this.deps.fileTreeEl.appendChild(p);
      return;
    }

    for (const node of children) {
      this.deps.fileTreeEl.appendChild(this.renderTreeNode(node, 0, preservedOpenDirs));
    }
    this.highlightActiveFile();
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

  public renderEmptyStateWithRecents(recentFolders: string[], recentFiles: string[]): void {
    if (this.workspaceTree) return;
    this.deps.fileTreeEl.replaceChildren();

    const wrap = document.createElement('div');
    wrap.className = 'empty-sidebar-state';

    const p = document.createElement('p');
    p.textContent = 'Öffne einen Ordner oder ziehe Dateien per Drag & Drop in das Fenster.';

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'secondary-action-btn';
    openBtn.textContent = 'Ordner auswählen…';
    openBtn.addEventListener('click', () => {
      void this.deps.onTriggerOpenFolderDialog();
    });

    wrap.append(p, openBtn);

    if (recentFolders.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'recent-section';
      const h = document.createElement('h3');
      h.className = 'recent-heading';
      h.textContent = 'Zuletzt geöffnete Ordner';
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
        removeBtn.title = 'Aus Verlauf entfernen';
        removeBtn.setAttribute('aria-label', `Ordner ${baseNameOfPath(folderPath)} aus Verlauf entfernen`);
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
      h.textContent = 'Zuletzt geöffnete Dateien';
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
        removeBtn.title = 'Aus Verlauf entfernen';
        removeBtn.setAttribute('aria-label', `Datei ${baseNameOfPath(filePath)} aus Verlauf entfernen`);
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
      summary.dataset.dirpath = node.path;
      summary.dataset.entryname = node.name;
      summary.title = node.path;
      summary.innerHTML = `<span class="tree-chevron">▶</span><span aria-hidden="true">📁</span><span></span>`;
      summary.lastElementChild!.textContent = node.name;
      details.appendChild(summary);

      const childrenBox = document.createElement('div');
      childrenBox.className = 'tree-children';
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

  private bindEvents(): void {
    document.getElementById('btn-sidebar-open-folder')?.addEventListener('click', () => {
      void this.deps.onTriggerOpenFolderDialog();
    });

    document.getElementById('btn-refresh-tree')?.addEventListener('click', () => {
      void this.refresh();
    });

    document.getElementById('btn-new-folder-file')?.addEventListener('click', () => {
      if (!this.workspaceTree) return;
      this.openEntryDialog('new-file', this.workspaceTree.path);
    });

    document.getElementById('btn-new-subfolder')?.addEventListener('click', () => {
      if (!this.workspaceTree) return;
      this.openEntryDialog('new-folder', this.workspaceTree.path);
    });

    this.deps.fileTreeEl.addEventListener('contextmenu', (e) => {
      this.openContextMenu(e);
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
      } else if (action === 'delete' && !target.isWorkspaceRoot) {
        void this.confirmMoveToRecycleBin(target);
      }
    });

    const entryDialog = document.getElementById('new-file-dialog') as HTMLDialogElement | null;
    const entryInput = document.getElementById('new-file-name') as HTMLInputElement | null;
    const entryError = document.getElementById('new-file-error');

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
      this.deps.onEntryDeleted(target.path);
      await this.refresh();
    } catch (err) {
      console.error('Löschen in Papierkorb fehlgeschlagen:', err);
    }
  }
}
