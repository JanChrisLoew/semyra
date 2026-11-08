import { t } from './i18n';

export interface FuzzyMatchResult {
  score: number;
  indices: number[];
}

/**
 * Fast, dependency-free fuzzy matcher with bonuses for word boundaries,
 * path separators, prefix matches, and contiguous character runs.
 */
export function fuzzyMatch(query: string, candidate: string): FuzzyMatchResult | null {
  const q = query.trim().toLowerCase();
  if (!q) {
    return { score: 0, indices: [] };
  }

  const lower = candidate.toLowerCase();
  const indices: number[] = [];
  let qIdx = 0;
  let score = 0;
  let prevMatchIdx = -2;

  for (let i = 0; i < lower.length && qIdx < q.length; i++) {
    if (lower[i] === q[qIdx]) {
      indices.push(i);

      if (i === qIdx) {
        // Leading contiguous prefix match (e.g. "semy" -> "Semyra.md")
        score += 24;
      } else if (i === 0) {
        score += 18;
      } else {
        const prevChar = candidate[i - 1];
        if (prevChar === '\\' || prevChar === '/' || prevChar === '-' || prevChar === '_' || prevChar === ' ') {
          score += 14;
        } else if (
          prevChar === prevChar.toLowerCase() &&
          candidate[i] === candidate[i].toUpperCase() &&
          candidate[i] !== candidate[i].toLowerCase()
        ) {
          score += 12;
        }
      }

      if (i === prevMatchIdx + 1) {
        score += 16;
      } else {
        if (prevMatchIdx >= 0) {
          const gap = i - prevMatchIdx - 1;
          score -= Math.min(12, gap * 2);
        }
        score += 4;
      }

      prevMatchIdx = i;
      qIdx++;
    }
  }

  if (qIdx < q.length) {
    return null;
  }

  // Slight preference for shorter, tighter matches
  score -= Math.min(20, Math.floor((candidate.length - q.length) * 0.25));
  return { score, indices };
}

export interface PaletteItem {
  id: string;
  kind: 'tab' | 'recent' | 'file' | 'folder' | 'command';
  label: string;
  subtitle?: string;
  shortcut?: string;
  badge?: string;
  run: () => void | Promise<void>;
}

export interface PaletteDataSource {
  getFileItems: () => Promise<PaletteItem[]>;
  getCommandItems: () => PaletteItem[];
}

function buildHighlightedText(text: string, indices: number[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  if (indices.length === 0) {
    frag.appendChild(document.createTextNode(text));
    return frag;
  }

  const indexSet = new Set(indices);
  let i = 0;
  while (i < text.length) {
    const isHit = indexSet.has(i);
    let j = i + 1;
    while (j < text.length && indexSet.has(j) === isHit) {
      j++;
    }
    const slice = text.slice(i, j);
    if (isHit) {
      const mark = document.createElement('mark');
      mark.textContent = slice;
      frag.appendChild(mark);
    } else {
      frag.appendChild(document.createTextNode(slice));
    }
    i = j;
  }
  return frag;
}

export class CommandPaletteController {
  private dialog: HTMLDialogElement;
  private input: HTMLInputElement;
  private resultsEl: HTMLElement;
  private source: PaletteDataSource;

  private cachedFileItems: PaletteItem[] = [];
  private visibleEntries: Array<{ item: PaletteItem; indices: number[] }> = [];
  private selectedIndex = 0;
  private loadSeq = 0;

  constructor(
    dialog: HTMLDialogElement,
    input: HTMLInputElement,
    resultsEl: HTMLElement,
    source: PaletteDataSource,
  ) {
    this.dialog = dialog;
    this.input = input;
    this.resultsEl = resultsEl;
    this.source = source;
    this.bindEvents();
  }

  private bindEvents(): void {
    // Observe modal open state so declarative <button command="show-modal" commandfor="palette-dialog">
    // initializes the palette identically to programmatic shortcuts.
    const observer = new MutationObserver(() => {
      if (this.dialog.open) {
        void this.prepareOnOpen();
      }
    });
    observer.observe(this.dialog, { attributes: true, attributeFilter: ['open'] });

    this.dialog.addEventListener('close', () => {
      this.dialog.returnValue = '';
      this.input.value = '';
    });

    this.input.addEventListener('input', () => {
      this.selectedIndex = 0;
      this.renderFiltered();
    });

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        if (this.visibleEntries.length === 0) return;
        e.preventDefault();
        this.selectedIndex = (this.selectedIndex + 1) % this.visibleEntries.length;
        this.updateSelectionHighlight();
      } else if (e.key === 'ArrowUp') {
        if (this.visibleEntries.length === 0) return;
        e.preventDefault();
        this.selectedIndex =
          (this.selectedIndex - 1 + this.visibleEntries.length) % this.visibleEntries.length;
        this.updateSelectionHighlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const chosen = this.visibleEntries[this.selectedIndex]?.item;
        if (chosen) {
          this.executeItem(chosen);
        }
      }
    });
  }

  public open(mode: 'files' | 'commands'): void {
    this.input.value = mode === 'commands' ? '> ' : '';
    if (!this.dialog.open) {
      this.dialog.showModal();
    } else {
      void this.prepareOnOpen();
    }
  }

  private async prepareOnOpen(): Promise<void> {
    const seq = ++this.loadSeq;
    this.selectedIndex = 0;
    requestAnimationFrame(() => {
      this.input.focus();
      const len = this.input.value.length;
      this.input.setSelectionRange(len, len);
    });

    this.renderFiltered();
    const files = await this.source.getFileItems();
    if (seq !== this.loadSeq || !this.dialog.open) return;
    this.cachedFileItems = files;
    this.renderFiltered();
  }

  private renderFiltered(): void {
    const raw = this.input.value;
    const isCommandMode = raw.trimStart().startsWith('>');
    const query = isCommandMode ? raw.trimStart().slice(1).trim() : raw.trim();

    const pool = isCommandMode ? this.source.getCommandItems() : [
      ...this.cachedFileItems,
      ...(query ? this.source.getCommandItems() : []),
    ];

    const scored: Array<{ item: PaletteItem; score: number; indices: number[] }> = [];
    for (const item of pool) {
      if (!query) {
        scored.push({ item, score: 0, indices: [] });
        continue;
      }
      const primaryMatch = fuzzyMatch(query, item.label);
      const subtitleMatch = item.subtitle ? fuzzyMatch(query, item.subtitle) : null;

      if (primaryMatch) {
        scored.push({
          item,
          score: primaryMatch.score + (item.kind === 'tab' ? 6 : 0),
          indices: primaryMatch.indices,
        });
      } else if (subtitleMatch) {
        scored.push({
          item,
          score: subtitleMatch.score - 6,
          indices: [],
        });
      }
    }

    if (query) {
      scored.sort((a, b) => b.score - a.score);
    }

    this.visibleEntries = scored.slice(0, 60).map(({ item, indices }) => ({ item, indices }));
    if (this.selectedIndex >= this.visibleEntries.length) {
      this.selectedIndex = 0;
    }

    this.resultsEl.replaceChildren();
    if (this.visibleEntries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted-hint';
      empty.textContent = isCommandMode
        ? t('palette.noMatchingCommand')
        : t('palette.noMatchingFiles');
      this.resultsEl.appendChild(empty);
      return;
    }

    this.visibleEntries.forEach(({ item, indices }, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `palette-item ${idx === this.selectedIndex ? 'is-selected' : ''}`;
      btn.dataset.paletteIdx = String(idx);

      const mainCol = document.createElement('div');
      mainCol.className = 'palette-item-main';

      const titleRow = document.createElement('div');
      titleRow.className = 'palette-item-title';

      const iconSpan = document.createElement('span');
      iconSpan.className = 'palette-item-icon';
      iconSpan.setAttribute('aria-hidden', 'true');
      iconSpan.textContent =
        item.kind === 'command'
          ? '⚡'
          : item.kind === 'folder'
            ? '📁'
            : item.kind === 'tab'
              ? '📄'
              : '📝';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'palette-item-label';
      labelSpan.appendChild(buildHighlightedText(item.label, indices));
      titleRow.append(iconSpan, labelSpan);

      if (item.badge) {
        const badge = document.createElement('span');
        badge.className = 'palette-item-badge';
        badge.textContent = item.badge;
        titleRow.appendChild(badge);
      }

      mainCol.appendChild(titleRow);

      if (item.subtitle) {
        const sub = document.createElement('div');
        sub.className = 'palette-item-sub';
        sub.textContent = item.subtitle;
        mainCol.appendChild(sub);
      }

      btn.appendChild(mainCol);

      if (item.shortcut) {
        const kbd = document.createElement('kbd');
        kbd.className = 'palette-item-kbd';
        kbd.textContent = item.shortcut;
        btn.appendChild(kbd);
      }

      btn.addEventListener('pointerenter', () => {
        if (this.selectedIndex !== idx) {
          this.selectedIndex = idx;
          this.updateSelectionHighlight(false);
        }
      });

      btn.addEventListener('click', () => {
        this.executeItem(item);
      });

      this.resultsEl.appendChild(btn);
    });
  }

  private updateSelectionHighlight(scrollIntoView = true): void {
    const buttons = this.resultsEl.querySelectorAll<HTMLButtonElement>('.palette-item');
    buttons.forEach((btn, idx) => {
      const selected = idx === this.selectedIndex;
      btn.classList.toggle('is-selected', selected);
      if (selected && scrollIntoView) {
        btn.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  private executeItem(item: PaletteItem): void {
    this.dialog.close();
    void item.run();
  }
}
