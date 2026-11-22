export interface PreviewFindDeps {
  barEl: HTMLElement;
  inputEl: HTMLInputElement;
  countEl: HTMLElement;
  prevBtn?: HTMLElement | null;
  nextBtn?: HTMLElement | null;
  closeBtn?: HTMLElement | null;
  previewContentEl: HTMLElement;
  isPreviewOnlyMode: () => boolean;
  focusEditor: () => void;
}

export class PreviewFindController {
  private matches: HTMLElement[] = [];
  private activeIdx = -1;

  constructor(private readonly deps: PreviewFindDeps) {
    this.bindEvents();
  }

  public get isOpen(): boolean {
    return !this.deps.barEl.hidden;
  }

  private bindEvents(): void {
    this.deps.inputEl.addEventListener('input', () => {
      this.updateMatches(true);
    });
    this.deps.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.step(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
    this.deps.prevBtn?.addEventListener('click', () => {
      this.step(-1);
    });
    this.deps.nextBtn?.addEventListener('click', () => {
      this.step(1);
    });
    this.deps.closeBtn?.addEventListener('click', () => {
      this.close();
    });
  }

  public open(): void {
    this.deps.barEl.hidden = false;
    this.deps.inputEl.focus();
    this.deps.inputEl.select();
    if (this.deps.inputEl.value) {
      this.updateMatches(false);
    } else {
      this.deps.countEl.textContent = '0/0';
    }
  }

  public close(restoreFocus = true): void {
    const wasOpen = !this.deps.barEl.hidden;
    this.deps.barEl.hidden = true;
    this.clearHighlights();
    this.deps.countEl.textContent = '0/0';
    if (!restoreFocus || !wasOpen) return;
    if (this.deps.isPreviewOnlyMode()) {
      if (!this.deps.previewContentEl.hasAttribute('tabindex')) {
        this.deps.previewContentEl.tabIndex = -1;
      }
      this.deps.previewContentEl.focus({ preventScroll: true });
    } else {
      this.deps.focusEditor();
    }
  }

  public refreshIfOpen(): void {
    if (!this.deps.barEl.hidden && this.deps.inputEl.value) {
      this.updateMatches(false);
    }
  }

  public clearHighlights(): void {
    const marks = this.deps.previewContentEl.querySelectorAll<HTMLElement>('mark.preview-find-match');
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
    this.matches = [];
    this.activeIdx = -1;
  }

  public updateMatches(scrollToFirst: boolean): void {
    this.clearHighlights();
    const query = this.deps.inputEl.value;
    if (!query) {
      this.deps.countEl.textContent = '0/0';
      return;
    }
    const lowerQuery = query.toLowerCase();
    const walker = document.createTreeWalker(this.deps.previewContentEl, NodeFilter.SHOW_TEXT, {
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

    this.matches = matches;
    if (matches.length === 0) {
      this.activeIdx = -1;
      this.deps.countEl.textContent = '0/0';
      return;
    }
    this.activeIdx = 0;
    this.activateMatch(0, scrollToFirst);
  }

  public step(delta: -1 | 1): void {
    const count = this.matches.length;
    if (count === 0) return;
    const nextIdx = (this.activeIdx + delta + count) % count;
    this.activateMatch(nextIdx, true);
  }

  private activateMatch(index: number, scrollIntoView: boolean): void {
    for (const m of this.matches) {
      m.classList.remove('is-current');
    }
    const target = this.matches[index];
    if (!target) return;
    this.activeIdx = index;
    target.classList.add('is-current');
    this.deps.countEl.textContent = `${index + 1}/${this.matches.length}`;
    if (scrollIntoView) {
      target.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }
  }
}
