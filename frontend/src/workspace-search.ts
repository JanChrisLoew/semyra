import { backend, SearchFileResult, WorkspaceReplaceResult } from './api';
import { t } from './i18n';

export interface WorkspaceSearchDeps {
  searchInputEl: HTMLInputElement;
  replaceInputEl?: HTMLInputElement | null;
  replaceAllBtn?: HTMLButtonElement | null;
  clearBtn?: HTMLButtonElement | null;
  statusBadgeEl?: HTMLElement | null;
  caseToggleBtn: HTMLElement;
  resultsContainerEl: HTMLElement;
  getWorkspaceRootPath: () => string | null;
  onOpenMatch: (filePath: string, line: number) => Promise<void> | void;
  onFilesReplaced?: (res: WorkspaceReplaceResult) => Promise<void> | void;
}

/**
 * Sidebar full-text search controller across Markdown files in the active workspace.
 */
export class WorkspaceSearchController {
  private deps: WorkspaceSearchDeps;
  private caseSensitive = false;
  private debounceTimer: number | undefined;
  private searchSeq = 0;

  constructor(deps: WorkspaceSearchDeps) {
    this.deps = deps;
    this.bindEvents();
  }

  public focusAndRunIfPopulated(): void {
    this.deps.searchInputEl.focus();
    this.deps.searchInputEl.select();
    if (this.deps.searchInputEl.value.trim()) {
      void this.runSearch();
    }
  }

  public async runSearch(): Promise<void> {
    const query = this.deps.searchInputEl.value.trim();
    const rootPath = this.deps.getWorkspaceRootPath();
    this.updateClearBtnState();

    if (!rootPath) {
      if (this.deps.statusBadgeEl) {
        this.deps.statusBadgeEl.textContent = '';
      }
      this.deps.resultsContainerEl.replaceChildren();
      const hint = document.createElement('p');
      hint.className = 'muted-hint';
      hint.textContent = t('search.openFolderPrompt');
      this.deps.resultsContainerEl.appendChild(hint);
      return;
    }

    if (!query) {
      if (this.deps.statusBadgeEl) {
        this.deps.statusBadgeEl.textContent = '';
      }
      this.deps.resultsContainerEl.replaceChildren();
      const hint = document.createElement('p');
      hint.className = 'muted-hint';
      hint.textContent = t('sidebar.searchHint');
      this.deps.resultsContainerEl.appendChild(hint);
      return;
    }

    const seq = ++this.searchSeq;
    try {
      const { results } = await backend.searchWorkspace(rootPath, query, this.caseSensitive);
      if (seq !== this.searchSeq) return;
      this.renderResults(results);
    } catch (err) {
      console.error('Ordnersuche fehlgeschlagen:', err);
    }
  }

  private updateClearBtnState(): void {
    if (this.deps.clearBtn) {
      this.deps.clearBtn.hidden = !this.deps.searchInputEl.value;
    }
    if (this.deps.replaceAllBtn) {
      this.deps.replaceAllBtn.disabled = !this.deps.searchInputEl.value.trim();
    }
  }

  public clearSearch(): void {
    this.deps.searchInputEl.value = '';
    this.updateClearBtnState();
    if (this.deps.statusBadgeEl) {
      this.deps.statusBadgeEl.textContent = '';
    }
    this.deps.resultsContainerEl.replaceChildren();
    const hint = document.createElement('p');
    hint.className = 'muted-hint';
    hint.textContent = t('sidebar.searchHint');
    this.deps.resultsContainerEl.appendChild(hint);
    this.deps.searchInputEl.focus();
  }

  private bindEvents(): void {
    this.deps.searchInputEl.addEventListener('input', () => {
      this.updateClearBtnState();
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = window.setTimeout(() => {
        void this.runSearch();
      }, 180);
    });

    this.deps.searchInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.deps.searchInputEl.value) {
        e.preventDefault();
        this.clearSearch();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        window.clearTimeout(this.debounceTimer);
        void this.runSearch();
      }
    });

    this.deps.clearBtn?.addEventListener('click', () => {
      this.clearSearch();
    });

    this.deps.caseToggleBtn.addEventListener('click', () => {
      this.caseSensitive = !this.caseSensitive;
      this.deps.caseToggleBtn.classList.toggle('is-active', this.caseSensitive);
      this.deps.caseToggleBtn.setAttribute('aria-pressed', String(this.caseSensitive));
      if (this.deps.searchInputEl.value.trim()) {
        void this.runSearch();
      }
    });

    this.deps.replaceAllBtn?.addEventListener('click', () => {
      void this.runReplaceAll();
    });

    this.deps.replaceInputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.deps.searchInputEl.value.trim()) {
        e.preventDefault();
        void this.runReplaceAll();
      }
    });

    this.updateClearBtnState();
  }

  public async runReplaceAll(): Promise<void> {
    const query = this.deps.searchInputEl.value;
    const replacement = this.deps.replaceInputEl?.value ?? '';
    const rootPath = this.deps.getWorkspaceRootPath();
    if (!rootPath || !query.trim()) return;

    const confirmed = await this.confirmReplace(
      t('search.replaceConfirm', { query, replacement }),
    );
    if (!confirmed) return;

    try {
      const res = await backend.replaceWorkspace(
        rootPath,
        query,
        replacement,
        this.caseSensitive,
      );
      if (this.deps.onFilesReplaced) {
        await this.deps.onFilesReplaced(res);
      }
      await this.runSearch();
    } catch (err) {
      console.error('Ordner-Ersetzen fehlgeschlagen:', err);
    }
  }

  private confirmReplace(message: string): Promise<boolean> {
    const dialog = document.getElementById('workspace-replace-dialog') as HTMLDialogElement | null;
    const msgEl = document.getElementById('workspace-replace-dialog-msg');
    if (!dialog || !msgEl || typeof dialog.showModal !== 'function') {
      return Promise.resolve(window.confirm(message));
    }

    msgEl.textContent = message;
    dialog.returnValue = '';
    return new Promise<boolean>((resolve) => {
      const onClose = () => {
        dialog.removeEventListener('close', onClose);
        const confirmed = dialog.returnValue === 'confirm';
        dialog.returnValue = '';
        resolve(confirmed);
      };
      dialog.addEventListener('close', onClose);
      dialog.showModal();
    });
  }

  private renderResults(results: SearchFileResult[]): void {
    this.deps.resultsContainerEl.replaceChildren();
    if (results.length === 0) {
      if (this.deps.statusBadgeEl) {
        this.deps.statusBadgeEl.textContent = '0';
        this.deps.statusBadgeEl.title = t('search.noMatches');
      }
      const hint = document.createElement('p');
      hint.className = 'muted-hint';
      hint.textContent = t('search.noMatches');
      this.deps.resultsContainerEl.appendChild(hint);
      return;
    }

    const totalHits = results.reduce((acc, f) => acc + f.matches.length, 0);
    const fileLabel = results.length === 1 ? t('search.file') : t('search.files');
    const summaryText = t('search.summary', { count: totalHits, files: results.length, fileLabel });
    if (this.deps.statusBadgeEl) {
      this.deps.statusBadgeEl.textContent = String(totalHits);
      this.deps.statusBadgeEl.title = summaryText;
    }

    const summary = document.createElement('div');
    summary.className = 'search-summary';
    summary.textContent = summaryText;
    this.deps.resultsContainerEl.appendChild(summary);

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
        btn.title = t('search.matchLocation', { line: match.line, col: match.column });

        const lineBadge = document.createElement('span');
        lineBadge.className = 'search-line-badge';
        lineBadge.textContent = `${match.line}:`;

        const previewSpan = document.createElement('span');
        previewSpan.className = 'search-match-preview';
        previewSpan.textContent = match.preview;

        btn.append(lineBadge, previewSpan);
        btn.addEventListener('click', () => {
          void this.deps.onOpenMatch(fileRes.path, match.line);
        });
        group.appendChild(btn);
      }

      this.deps.resultsContainerEl.appendChild(group);
    }
  }
}
