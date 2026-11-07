import { backend, SearchFileResult } from './api';

export interface WorkspaceSearchDeps {
  searchInputEl: HTMLInputElement;
  clearBtn?: HTMLButtonElement | null;
  statusBadgeEl?: HTMLElement | null;
  caseToggleBtn: HTMLElement;
  resultsContainerEl: HTMLElement;
  getWorkspaceRootPath: () => string | null;
  onOpenMatch: (filePath: string, line: number) => Promise<void> | void;
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
      hint.textContent = 'Bitte öffne zuerst einen Arbeitsordner (Strg+Umschalt+O).';
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
      hint.textContent =
        'Suchbegriff eingeben, um alle Markdown-Dateien im Ordner zu durchsuchen.';
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
    hint.textContent =
      'Suchbegriff eingeben, um alle Markdown-Dateien im Ordner zu durchsuchen.';
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
  }

  private renderResults(results: SearchFileResult[]): void {
    this.deps.resultsContainerEl.replaceChildren();
    if (results.length === 0) {
      if (this.deps.statusBadgeEl) {
        this.deps.statusBadgeEl.textContent = '0';
        this.deps.statusBadgeEl.title = 'Keine Treffer gefunden';
      }
      const hint = document.createElement('p');
      hint.className = 'muted-hint';
      hint.textContent = 'Keine Treffer gefunden.';
      this.deps.resultsContainerEl.appendChild(hint);
      return;
    }

    const totalHits = results.reduce((acc, f) => acc + f.matches.length, 0);
    if (this.deps.statusBadgeEl) {
      this.deps.statusBadgeEl.textContent = String(totalHits);
      this.deps.statusBadgeEl.title = `${totalHits} Treffer in ${results.length} ${
        results.length === 1 ? 'Datei' : 'Dateien'
      }`;
    }

    const summary = document.createElement('div');
    summary.className = 'search-summary';
    summary.textContent = `${totalHits} Treffer in ${results.length} ${results.length === 1 ? 'Datei' : 'Dateien'}`;
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
        btn.title = `Zeile ${match.line}, Spalte ${match.column}`;

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
