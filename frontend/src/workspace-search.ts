import { backend, SearchFileResult, WorkspaceReplaceResult } from './api';
import { getLanguage, t } from './i18n';
import { isSameOrDescendantPath } from './path-utils';

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

interface SearchCriteria {
  rootPath: string;
  query: string;
  caseSensitive: boolean;
  useRegex: boolean;
  wholeWord: boolean;
}

interface SearchSelection {
  criteria: SearchCriteria;
  files: Set<string>;
  resultsByPath: Map<string, SearchFileResult>;
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
  private selection: SearchSelection | null = null;
  private replacePending = false;
  private debounceTimer: number | undefined;
  private searchSeq = 0;
  private refreshSelection: ReadonlySet<string> | undefined;

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

  public refreshAfterFileChanges(paths: readonly string[]): void {
    const criteria = this.getSearchCriteria();
    if (!criteria || !paths.some((path) => isSameOrDescendantPath(path, criteria.rootPath))) return;

    const selected = this.selection?.files ?? this.refreshSelection;
    this.invalidateResults();
    this.refreshSelection = selected;
    window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => { void this.runSearch(selected); }, 180);
  }

  public async runSearch(selected?: ReadonlySet<string>): Promise<void> {
    window.clearTimeout(this.debounceTimer);
    this.invalidateResults();
    this.refreshSelection = selected;
    const seq = this.searchSeq;
    const criteria = this.getSearchCriteria();
    if (!criteria) {
      this.renderHint(t(this.deps.getWorkspaceRootPath() ? 'sidebar.searchHint' : 'search.openFolderPrompt'));
      return;
    }

    const { rootPath, query, caseSensitive, useRegex, wholeWord } = criteria;
    try {
      const { results, truncated } = await backend.searchWorkspace(rootPath, query, caseSensitive, useRegex, wholeWord);
      if (seq !== this.searchSeq || !this.isCurrentSearch(criteria)) return;
      this.refreshSelection = undefined;
      this.renderResults(criteria, results, selected, Boolean(truncated));
    } catch (err) {
      if (seq !== this.searchSeq || !this.isCurrentSearch(criteria)) return;
      console.error('Ordnersuche fehlgeschlagen:', err);
      this.renderHint(
        err instanceof Error ? err.message : t('search.searchFailed', { err: String(err) }),
        'muted-hint search-error-hint',
      );
    }
  }

  private getSearchCriteria(): SearchCriteria | null {
    const rootPath = this.deps.getWorkspaceRootPath();
    const rawQuery = this.deps.searchInputEl.value;
    const trimmedQuery = rawQuery.trim();
    if (!rootPath || !trimmedQuery) return null;
    return {
      rootPath,
      query: this.useRegex ? rawQuery : trimmedQuery,
      caseSensitive: this.caseSensitive,
      useRegex: this.useRegex,
      wholeWord: this.wholeWord,
    };
  }

  private isCurrentSearch(criteria: SearchCriteria): boolean {
    const current = this.getSearchCriteria();
    return current !== null && current.rootPath === criteria.rootPath && current.query === criteria.query
      && current.caseSensitive === criteria.caseSensitive && current.useRegex === criteria.useRegex
      && current.wholeWord === criteria.wholeWord;
  }

  private invalidateResults(): void {
    ++this.searchSeq;
    this.selection = null;
    this.refreshSelection = undefined;
    this.deps.resultsContainerEl.replaceChildren();
    if (this.deps.statusBadgeEl) {
      this.deps.statusBadgeEl.textContent = '';
      this.deps.statusBadgeEl.title = '';
    }
    this.updateButtons();
  }

  private renderHint(message: string, className = 'muted-hint'): void {
    const hint = document.createElement('p');
    hint.className = className;
    hint.textContent = message;
    this.deps.resultsContainerEl.replaceChildren(hint);
  }

  private canReplace(selection: SearchSelection | null): selection is SearchSelection {
    return !this.replacePending && selection !== null && selection.files.size > 0
      && this.isCurrentSearch(selection.criteria);
  }

  private updateButtons(): void {
    if (this.deps.clearBtn) {
      this.deps.clearBtn.hidden = !this.deps.searchInputEl.value;
    }
    if (this.deps.replaceAllBtn) {
      this.deps.replaceAllBtn.disabled = !this.canReplace(this.selection);
    }
  }

  public clearSearch(): void {
    window.clearTimeout(this.debounceTimer);
    this.deps.searchInputEl.value = '';
    this.invalidateResults();
    this.renderHint(t('sidebar.searchHint'));
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
      this.invalidateResults();
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

    this.updateButtons();
  }

  public async runReplaceAll(): Promise<void> {
    const selection = this.selection;
    if (!this.canReplace(selection)) return;
    const { criteria, files } = selection;
    const { rootPath, query, caseSensitive, useRegex, wholeWord } = criteria;
    const replacement = this.deps.replaceInputEl?.value ?? '';
    const includeFiles = Array.from(files);

    const hits = includeFiles.reduce((sum, path) => sum + selection.resultsByPath.get(path)!.occurrenceCount, 0);
    this.replacePending = true;
    this.updateButtons();
    try {
      const confirmed = await this.confirmReplace(
        t(includeFiles.length === 1 ? 'search.replaceConfirmOne' : 'search.replaceConfirm', {
          query, replacement, hits, count: includeFiles.length,
        }),
      );
      if (!confirmed || this.selection !== selection || !this.isCurrentSearch(criteria)
        || (this.deps.replaceInputEl?.value ?? '') !== replacement
        || files.size !== includeFiles.length || includeFiles.some((path) => !files.has(path))) return;

      const res = await backend.replaceWorkspace(
        rootPath,
        query,
        replacement,
        caseSensitive,
        useRegex,
        wholeWord,
        includeFiles.map((path) => ({ path, contentVersion: selection.resultsByPath.get(path)!.contentVersion })),
      );
      if (this.deps.onFilesReplaced) {
        await this.deps.onFilesReplaced(res);
      }
      if (this.isCurrentSearch(criteria)) {
        await this.runSearch(this.selection?.files ?? this.refreshSelection ?? files);
      }
    } catch (err) {
      console.error('Ordner-Ersetzen fehlgeschlagen:', err);
      this.deps.onReplaceError?.();
    } finally {
      this.replacePending = false;
      this.updateButtons();
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

  private renderResults(
    criteria: SearchCriteria,
    results: SearchFileResult[],
    selected?: ReadonlySet<string>,
    truncated = false,
  ): void {
    if (results.length === 0) {
      if (this.deps.statusBadgeEl) {
        this.deps.statusBadgeEl.textContent = '0';
        this.deps.statusBadgeEl.title = t('search.noMatches');
      }
      this.renderHint(
        truncated
          ? `${t('search.noMatches')} · ${t('search.filesLimited', { max: 3500 })}`
          : t('search.noMatches'),
      );
      return;
    }

    const resultPaths = results.map((f) => f.path);
    const selectedFiles = new Set(resultPaths.filter((path) => !selected || selected.has(path)));
    const resultsByPath = new Map(results.map((result) => [result.path, result]));
    this.selection = { criteria, files: selectedFiles, resultsByPath };
    this.updateButtons();

    const isEn = getLanguage() === 'en';
    const totalHits = results.reduce((acc, f) => acc + f.occurrenceCount, 0);
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
    const shown = results.reduce((sum, file) => sum + file.matches.length, 0);
    const lines = results.reduce((sum, file) => sum + file.matchingLines, 0);
    const summaryParts = [summaryText];
    if (shown < lines) {
      summaryParts.push(t('search.previewLimited', { shown, lines }));
    }
    if (truncated) {
      summaryParts.push(t('search.filesLimited', { max: 3500 }));
    }
    summaryTextEl.textContent = summaryParts.join(' · ');

    const selectToggleBtn = document.createElement('button');
    selectToggleBtn.type = 'button';
    selectToggleBtn.className = 'search-select-toggle-btn';

    const syncSelectToggleBtn = () => {
      const allSelected = selectedFiles.size === resultPaths.length;
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
      const selectAll = selectedFiles.size < resultPaths.length;
      if (selectAll) {
        for (const path of resultPaths) selectedFiles.add(path);
      } else {
        selectedFiles.clear();
      }
      for (const cb of fileCheckboxes) {
        cb.checked = selectAll;
      }
      syncSelectToggleBtn();
      this.updateButtons();
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
      checkbox.checked = selectedFiles.has(fileRes.path);
      checkbox.setAttribute(
        'aria-label',
        isEn
          ? `Include ${fileRes.relPath || fileRes.name} in replace`
          : `${fileRes.relPath || fileRes.name} beim Ersetzen einbeziehen`,
      );
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedFiles.add(fileRes.path);
        } else {
          selectedFiles.delete(fileRes.path);
        }
        syncSelectToggleBtn();
        this.updateButtons();
      });
      fileCheckboxes.push(checkbox);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'search-file-name';
      nameSpan.textContent = fileRes.relPath || fileRes.name;

      const countSpan = document.createElement('span');
      countSpan.className = 'search-hit-count';
      countSpan.textContent = String(fileRes.occurrenceCount);

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
