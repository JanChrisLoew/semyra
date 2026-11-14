import { backend, SearchFileResult, WorkspaceReplaceResult } from './api';
import { getLanguage, t } from './i18n';

export interface WorkspaceSearchDeps {
  searchInputEl: HTMLInputElement;
  replaceInputEl?: HTMLInputElement | null;
  replaceAllBtn?: HTMLButtonElement | null;
  clearBtn?: HTMLButtonElement | null;
  statusBadgeEl?: HTMLElement | null;
  caseToggleBtn: HTMLElement;
  wholeWordToggleBtn?: HTMLElement | null;
  regexToggleBtn?: HTMLElement | null;
  resultsContainerEl: HTMLElement;
  getWorkspaceRootPath: () => string | null;
  onOpenMatch: (filePath: string, line: number) => Promise<void> | void;
  onFilesReplaced?: (res: WorkspaceReplaceResult) => Promise<void> | void;
  onReplaceError?: () => void;
}

/**
 * Sidebar full-text search controller across Markdown files in the active workspace.
 */
export class WorkspaceSearchController {
  private deps: WorkspaceSearchDeps;
  private caseSensitive = false;
  private wholeWord = false;
  private useRegex = false;
  private wholeWordBtn: HTMLElement;
  private regexBtn: HTMLElement;
  private selectedFiles = new Set<string>();
  private lastResultPaths: string[] = [];
  private hasRenderedResults = false;
  private debounceTimer: number | undefined;
  private searchSeq = 0;

  constructor(deps: WorkspaceSearchDeps) {
    this.deps = deps;
    const { wholeWordBtn, regexBtn } = this.ensureModeToggleButtons();
    this.wholeWordBtn = wholeWordBtn;
    this.regexBtn = regexBtn;
    this.bindEvents();
  }

  private ensureModeToggleButtons(): { wholeWordBtn: HTMLElement; regexBtn: HTMLElement } {
    const wholeWordBtn =
      this.deps.wholeWordToggleBtn ??
      this.createToggleButton('btn-search-whole-word', '\\b', 'search.wholeWordTitle');
    const regexBtn =
      this.deps.regexToggleBtn ??
      this.createToggleButton('btn-search-regex', '.*', 'search.regexTitle');

    if (
      !this.deps.wholeWordToggleBtn &&
      !this.deps.regexToggleBtn &&
      this.deps.caseToggleBtn.parentNode
    ) {
      this.deps.caseToggleBtn.after(wholeWordBtn, regexBtn);
    }

    return { wholeWordBtn, regexBtn };
  }

  private createToggleButton(id: string, label: string, i18nKey: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = id;
    btn.className = 'case-toggle-btn';
    btn.textContent = label;
    const title = t(i18nKey);
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.dataset.i18nTitle = i18nKey;
    btn.dataset.i18nAria = i18nKey;
    btn.setAttribute('aria-pressed', 'false');
    return btn;
  }

  public focusAndRunIfPopulated(): void {
    this.deps.searchInputEl.focus();
    this.deps.searchInputEl.select();
    if (this.deps.searchInputEl.value.trim()) {
      void this.runSearch();
    }
  }

  public async runSearch(): Promise<void> {
    const rawQuery = this.deps.searchInputEl.value;
    const query = this.useRegex ? rawQuery : rawQuery.trim();
    const rootPath = this.deps.getWorkspaceRootPath();
    this.updateClearBtnState();

    if (!rootPath) {
      this.resetSelectionState();
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

    if (!rawQuery.trim()) {
      this.resetSelectionState();
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
      const { results } = await backend.searchWorkspace(
        rootPath,
        query,
        this.caseSensitive,
        this.useRegex,
        this.wholeWord,
      );
      if (seq !== this.searchSeq) return;
      this.renderResults(results);
    } catch (err) {
      if (seq !== this.searchSeq) return;
      console.error('Ordnersuche fehlgeschlagen:', err);
      this.resetSelectionState();
      if (this.deps.statusBadgeEl) {
        this.deps.statusBadgeEl.textContent = '';
        this.deps.statusBadgeEl.title = '';
      }
      this.deps.resultsContainerEl.replaceChildren();
      const hint = document.createElement('p');
      hint.className = 'muted-hint search-error-hint';
      hint.textContent =
        err instanceof Error ? err.message : t('search.searchFailed', { err: String(err) });
      this.deps.resultsContainerEl.appendChild(hint);
    }
  }

  private resetSelectionState(): void {
    this.selectedFiles.clear();
    this.lastResultPaths = [];
    this.hasRenderedResults = false;
    this.updateClearBtnState();
  }

  private updateClearBtnState(): void {
    if (this.deps.clearBtn) {
      this.deps.clearBtn.hidden = !this.deps.searchInputEl.value;
    }
    if (this.deps.replaceAllBtn) {
      const hasQuery = Boolean(this.deps.searchInputEl.value.trim());
      const hasSelection = !this.hasRenderedResults || this.selectedFiles.size > 0;
      this.deps.replaceAllBtn.disabled = !hasQuery || !hasSelection;
    }
  }

  public clearSearch(): void {
    this.deps.searchInputEl.value = '';
    this.resetSelectionState();
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

  private toggleMode(
    btn: HTMLElement,
    active: boolean,
  ): void {
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
    if (this.deps.searchInputEl.value.trim()) {
      void this.runSearch();
    }
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
      this.toggleMode(this.deps.caseToggleBtn, this.caseSensitive);
    });

    this.wholeWordBtn.addEventListener('click', () => {
      this.wholeWord = !this.wholeWord;
      this.toggleMode(this.wholeWordBtn, this.wholeWord);
    });

    this.regexBtn.addEventListener('click', () => {
      this.useRegex = !this.useRegex;
      this.toggleMode(this.regexBtn, this.useRegex);
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
    if (this.hasRenderedResults && this.selectedFiles.size === 0) return;

    const confirmed = await this.confirmReplace(
      t('search.replaceConfirm', { query, replacement }),
    );
    if (!confirmed) return;

    const includeFiles = this.hasRenderedResults
      ? Array.from(this.selectedFiles)
      : undefined;

    try {
      const res = await backend.replaceWorkspace(
        rootPath,
        query,
        replacement,
        this.caseSensitive,
        this.useRegex,
        this.wholeWord,
        includeFiles,
      );
      if (this.deps.onFilesReplaced) {
        await this.deps.onFilesReplaced(res);
      }
      await this.runSearch();
    } catch (err) {
      console.error('Ordner-Ersetzen fehlgeschlagen:', err);
      this.deps.onReplaceError?.();
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
      this.resetSelectionState();
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

    this.lastResultPaths = results.map((f) => f.path);
    this.selectedFiles = new Set(this.lastResultPaths);
    this.hasRenderedResults = true;
    this.updateClearBtnState();

    const isEn = getLanguage() === 'en';
    const totalHits = results.reduce((acc, f) => acc + f.matches.length, 0);
    const fileLabel = results.length === 1 ? t('search.file') : t('search.files');
    const summaryText = t('search.summary', { count: totalHits, files: results.length, fileLabel });
    if (this.deps.statusBadgeEl) {
      this.deps.statusBadgeEl.textContent = String(totalHits);
      this.deps.statusBadgeEl.title = summaryText;
    }

    const summary = document.createElement('div');
    summary.className = 'search-summary';

    const summaryTextEl = document.createElement('span');
    summaryTextEl.className = 'search-summary-text';
    summaryTextEl.textContent = summaryText;

    const selectToggleBtn = document.createElement('button');
    selectToggleBtn.type = 'button';
    selectToggleBtn.className = 'search-select-toggle-btn';

    const syncSelectToggleBtn = () => {
      const allSelected = this.selectedFiles.size === this.lastResultPaths.length;
      selectToggleBtn.textContent = allSelected
        ? isEn
          ? 'None'
          : 'Keine'
        : isEn
          ? 'All'
          : 'Alle';
      selectToggleBtn.title = allSelected
        ? isEn
          ? 'Deselect all files'
          : 'Alle Dateien abwählen'
        : isEn
          ? 'Select all files'
          : 'Alle Dateien auswählen';
    };
    syncSelectToggleBtn();

    const fileCheckboxes: HTMLInputElement[] = [];
    selectToggleBtn.addEventListener('click', () => {
      const selectAll = this.selectedFiles.size < this.lastResultPaths.length;
      if (selectAll) {
        this.selectedFiles = new Set(this.lastResultPaths);
      } else {
        this.selectedFiles.clear();
      }
      for (const cb of fileCheckboxes) {
        cb.checked = selectAll;
      }
      syncSelectToggleBtn();
      this.updateClearBtnState();
    });

    summary.append(summaryTextEl, selectToggleBtn);
    this.deps.resultsContainerEl.appendChild(summary);

    for (const fileRes of results) {
      const group = document.createElement('div');
      group.className = 'search-file-group';

      const header = document.createElement('div');
      header.className = 'search-file-header';
      header.title = fileRes.path;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'search-file-checkbox';
      checkbox.checked = true;
      checkbox.setAttribute(
        'aria-label',
        isEn
          ? `Include ${fileRes.relPath || fileRes.name} in replace`
          : `${fileRes.relPath || fileRes.name} beim Ersetzen einbeziehen`,
      );
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selectedFiles.add(fileRes.path);
        } else {
          this.selectedFiles.delete(fileRes.path);
        }
        syncSelectToggleBtn();
        this.updateClearBtnState();
      });
      fileCheckboxes.push(checkbox);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'search-file-name';
      nameSpan.textContent = fileRes.relPath || fileRes.name;

      const countSpan = document.createElement('span');
      countSpan.className = 'search-hit-count';
      countSpan.textContent = String(fileRes.matches.length);

      header.append(checkbox, nameSpan, countSpan);
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
