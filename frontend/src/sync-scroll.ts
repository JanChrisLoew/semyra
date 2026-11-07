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

export class SyncScrollController {
  private enabled = true;
  private scrollSyncLock: 'editor' | 'preview' | null = null;
  private scrollUnlockTimer: number | undefined;
  private lastActiveSlug: string | null = null;
  private deps: SyncScrollDeps;

  constructor(deps: SyncScrollDeps) {
    this.deps = deps;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  private lockScrollSource(source: 'editor' | 'preview'): void {
    this.scrollSyncLock = source;
    window.clearTimeout(this.scrollUnlockTimer);
    this.scrollUnlockTimer = window.setTimeout(() => {
      this.scrollSyncLock = null;
    }, 90);
  }

  private getPreviewLineAnchors(): Array<{ line: number; top: number }> {
    const { previewPaneEl, previewContentEl } = this.deps;
    const paneRect = previewPaneEl.getBoundingClientRect();
    const scrollTop = previewPaneEl.scrollTop;
    const nodes = previewContentEl.querySelectorAll<HTMLElement>('[data-line]');
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
      const { previewPaneEl, previewContentEl } = this.deps;
      const paneRect = previewPaneEl.getBoundingClientRect();
      const thresholdY = paneRect.top + 56;
      for (const item of outline) {
        const el = previewContentEl.querySelector<HTMLElement>(`#${CSS.escape(item.slug)}`);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= thresholdY) {
          currentSlug = item.slug;
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

  public syncEditorToPreview(): void {
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

  public syncPreviewToEditor(): void {
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
    let next = { line: editor.view.state.doc.lines, top: pvMax };

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
