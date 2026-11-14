import { HeadingItem } from './api';
import { MarkdownEditorController } from './editor';

export interface SyncScrollDeps {
  appEl: HTMLElement;
  previewPaneEl: HTMLElement;
  previewContentEl: HTMLElement;
  getEditor: () => MarkdownEditorController;
  getOutline: () => HeadingItem[];
  onActiveHeadingChange: (slug: string | null) => void;
}

interface LineAnchor {
  line: number;
  top: number;
}

interface HeadingAnchor {
  slug: string;
  top: number;
}

function escapeId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return id.replace(/([^\w-])/g, '\\$1');
}

export class SyncScrollController {
  private enabled = true;
  private scrollSyncLock: 'editor' | 'preview' | null = null;
  private scrollUnlockTimer: number | undefined;
  private lastActiveSlug: string | null = null;
  private deps: SyncScrollDeps;

  private pendingRafId: number | null = null;
  private pendingTimeoutId: number | null = null;
  private pendingSyncDirection: 'editor' | 'preview' | null = null;

  private cachedLineAnchors: LineAnchor[] | null = null;
  private cachedHeadingAnchors: HeadingAnchor[] | null = null;
  private cachedOutlineRef: HeadingItem[] | null = null;

  private mutationObserver: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly handleResize = (): void => {
    this.invalidateCache();
  };

  constructor(deps: SyncScrollDeps) {
    this.deps = deps;

    if (typeof MutationObserver !== 'undefined') {
      this.mutationObserver = new MutationObserver(() => {
        this.invalidateCache();
      });
      this.mutationObserver.observe(deps.previewContentEl, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-line', 'open', 'id'],
      });
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.invalidateCache();
      });
      this.resizeObserver.observe(deps.previewPaneEl);
      this.resizeObserver.observe(deps.previewContentEl);
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.handleResize, { passive: true });
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public invalidateCache(): void {
    this.cachedLineAnchors = null;
    this.cachedHeadingAnchors = null;
    this.cachedOutlineRef = null;
  }

  public destroy(): void {
    if (
      this.pendingRafId !== null &&
      typeof window !== 'undefined' &&
      typeof window.cancelAnimationFrame === 'function'
    ) {
      window.cancelAnimationFrame(this.pendingRafId);
      this.pendingRafId = null;
    }
    if (this.pendingTimeoutId !== null) {
      if (typeof window !== 'undefined') {
        window.clearTimeout(this.pendingTimeoutId);
      } else {
        globalThis.clearTimeout(this.pendingTimeoutId);
      }
      this.pendingTimeoutId = null;
    }
    this.pendingSyncDirection = null;
    window.clearTimeout(this.scrollUnlockTimer);
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.handleResize);
    }
    this.invalidateCache();
  }

  public lockScrollForNavigation(source: 'editor' | 'preview', durationMs = 450): void {
    this.scrollSyncLock = source;
    window.clearTimeout(this.scrollUnlockTimer);
    this.scrollUnlockTimer = window.setTimeout(() => {
      this.scrollSyncLock = null;
    }, durationMs);
  }

  private lockScrollSource(source: 'editor' | 'preview'): void {
    this.scrollSyncLock = source;
    window.clearTimeout(this.scrollUnlockTimer);
    this.scrollUnlockTimer = window.setTimeout(() => {
      this.scrollSyncLock = null;
    }, 90);
  }

  private flushPendingMutations(): void {
    if (this.mutationObserver && this.mutationObserver.takeRecords().length > 0) {
      this.invalidateCache();
    }
  }

  private getPreviewLineAnchors(): LineAnchor[] {
    this.flushPendingMutations();
    if (this.cachedLineAnchors !== null) {
      return this.cachedLineAnchors;
    }

    const { previewPaneEl, previewContentEl } = this.deps;
    const paneRect = previewPaneEl.getBoundingClientRect();
    const scrollTop = previewPaneEl.scrollTop;
    const nodes = previewContentEl.querySelectorAll<HTMLElement>('[data-line]');
    const anchors: LineAnchor[] = [];

    for (const el of nodes) {
      const line = Number(el.getAttribute('data-line'));
      if (!Number.isFinite(line)) continue;
      const top = el.getBoundingClientRect().top - paneRect.top + scrollTop;
      if (anchors.length === 0 || anchors[anchors.length - 1].line !== line) {
        anchors.push({ line, top });
      }
    }
    anchors.sort((a, b) => a.line - b.line);
    this.cachedLineAnchors = anchors;
    return anchors;
  }

  private getPreviewHeadingAnchors(outline: HeadingItem[]): HeadingAnchor[] {
    this.flushPendingMutations();
    if (this.cachedHeadingAnchors !== null && this.cachedOutlineRef === outline) {
      return this.cachedHeadingAnchors;
    }

    const { previewPaneEl, previewContentEl } = this.deps;
    const paneRect = previewPaneEl.getBoundingClientRect();
    const scrollTop = previewPaneEl.scrollTop;
    const anchors: HeadingAnchor[] = [];

    for (const item of outline) {
      const el = previewContentEl.querySelector<HTMLElement>(`#${escapeId(item.slug)}`);
      if (!el) continue;
      const top = el.getBoundingClientRect().top - paneRect.top + scrollTop;
      anchors.push({ slug: item.slug, top });
    }

    this.cachedHeadingAnchors = anchors;
    this.cachedOutlineRef = outline;
    return anchors;
  }

  public updateActiveHeadingFromViewport(): void {
    const outline = this.deps.getOutline();
    if (outline.length === 0) {
      this.emitActiveSlug(null);
      return;
    }

    const viewMode = this.deps.appEl.getAttribute('data-view') ?? 'split';
    let currentSlug: string | null = outline[0]?.slug ?? null;

    if (viewMode === 'editor') {
      const topLine = this.deps.getEditor().getTopViewportLine() + 1.5;
      for (const item of outline) {
        if (item.line <= topLine) {
          currentSlug = item.slug;
        } else {
          break;
        }
      }
    } else {
      const thresholdOffset = this.deps.previewPaneEl.scrollTop + 56;
      const headingAnchors = this.getPreviewHeadingAnchors(outline);
      for (const anchor of headingAnchors) {
        if (anchor.top <= thresholdOffset) {
          currentSlug = anchor.slug;
        } else {
          break;
        }
      }
    }

    this.emitActiveSlug(currentSlug);
  }

  private emitActiveSlug(slug: string | null): void {
    if (slug === this.lastActiveSlug) return;
    this.lastActiveSlug = slug;
    this.deps.onActiveHeadingChange(slug);
  }

  private scheduleSync(direction: 'editor' | 'preview'): void {
    // Do not let a locked echo overwrite a pending active-direction sync.
    if (
      this.pendingSyncDirection !== null &&
      this.pendingSyncDirection !== direction &&
      ((direction === 'editor' && this.scrollSyncLock === 'preview') ||
        (direction === 'preview' && this.scrollSyncLock === 'editor'))
    ) {
      return;
    }

    this.pendingSyncDirection = direction;
    if (this.pendingRafId !== null || this.pendingTimeoutId !== null) return;

    const runSync = () => {
      this.pendingRafId = null;
      this.pendingTimeoutId = null;
      const dir = this.pendingSyncDirection;
      this.pendingSyncDirection = null;
      if (dir === 'editor') {
        this.performSyncEditorToPreview();
      } else if (dir === 'preview') {
        this.performSyncPreviewToEditor();
      }
    };

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      this.pendingRafId = window.requestAnimationFrame(runSync);
    } else if (typeof window !== 'undefined') {
      this.pendingTimeoutId = window.setTimeout(runSync, 16);
    } else {
      this.pendingTimeoutId = globalThis.setTimeout(runSync, 16) as unknown as number;
    }
  }

  public syncEditorToPreview(): void {
    this.scheduleSync('editor');
  }

  public syncPreviewToEditor(): void {
    this.scheduleSync('preview');
  }

  private performSyncEditorToPreview(): void {
    this.updateActiveHeadingFromViewport();

    if (!this.enabled || this.scrollSyncLock === 'preview') return;
    if (this.deps.appEl.getAttribute('data-view') !== 'split') return;

    const editor = this.deps.getEditor();
    const { previewPaneEl } = this.deps;
    const edScroller = editor.view.scrollDOM;
    const edMax = edScroller.scrollHeight - edScroller.clientHeight;
    const pvMax = previewPaneEl.scrollHeight - previewPaneEl.clientHeight;
    if (edMax <= 0 || pvMax <= 0) return;

    this.lockScrollSource('editor');

    if (edScroller.scrollTop <= 2) {
      previewPaneEl.scrollTop = 0;
      return;
    }
    if (edScroller.scrollTop >= edMax - 2) {
      previewPaneEl.scrollTop = pvMax;
      return;
    }

    const topLine = editor.getTopViewportLine();
    const anchors = this.getPreviewLineAnchors();
    if (anchors.length === 0) {
      previewPaneEl.scrollTop = (edScroller.scrollTop / edMax) * pvMax;
      return;
    }

    let prev = { line: 1, top: 0 };
    let next = { line: editor.view.state.doc.lines + 1, top: pvMax };

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
    previewPaneEl.scrollTop = prev.top + (next.top - prev.top) * ratio;
  }

  private performSyncPreviewToEditor(): void {
    this.updateActiveHeadingFromViewport();

    if (!this.enabled || this.scrollSyncLock === 'editor') return;
    if (this.deps.appEl.getAttribute('data-view') !== 'split') return;

    const editor = this.deps.getEditor();
    const { previewPaneEl } = this.deps;
    const pvTop = previewPaneEl.scrollTop;
    const pvMax = previewPaneEl.scrollHeight - previewPaneEl.clientHeight;
    const edMax =
      editor.view.scrollDOM.scrollHeight - editor.view.scrollDOM.clientHeight;
    if (pvMax <= 0 || edMax <= 0) return;

    this.lockScrollSource('preview');

    if (pvTop <= 2) {
      editor.view.scrollDOM.scrollTop = 0;
      return;
    }
    if (pvTop >= pvMax - 2) {
      editor.view.scrollDOM.scrollTop = edMax;
      return;
    }

    const anchors = this.getPreviewLineAnchors();
    if (anchors.length === 0) {
      editor.view.scrollDOM.scrollTop = (pvTop / pvMax) * edMax;
      return;
    }

    let prev = { line: 1, top: 0 };
    let next = { line: editor.view.state.doc.lines + 1, top: pvMax };

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
    editor.scrollToSourceLine(targetLine);
  }
}
