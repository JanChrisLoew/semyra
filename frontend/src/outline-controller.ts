import type { HeadingItem } from './api';
import { t } from './i18n';
import { isMarkdownPath } from './path-utils';
import { computeHeadingTokenCounts } from './stats-utils';

export interface OutlineControllerDeps {
  containerEl: HTMLElement;
  countBadgeEl?: HTMLElement | null;
  panelEl?: HTMLElement | null;
  getActiveDocument: () => { name: string; currentContent: string } | undefined;
  onNavigateToHeading: (line: number, slug: string) => void;
  onCopySectionAiContext: (line: number, slug: string) => void;
}

export class OutlineController {
  private activeHeadingSlug: string | null = null;

  constructor(private readonly deps: OutlineControllerDeps) {}

  public setActiveHeading(slug: string | null): void {
    this.activeHeadingSlug = slug;
    this.highlightCurrentHeading();
  }

  public render(outline: HeadingItem[]): void {
    this.deps.containerEl.replaceChildren();

    if (this.deps.countBadgeEl) {
      if (outline.length === 0) {
        this.deps.countBadgeEl.textContent = '';
      } else {
        this.deps.countBadgeEl.textContent = String(outline.length);
        this.deps.countBadgeEl.title =
          outline.length === 1
            ? t('outline.oneSection')
            : t('outline.sectionsCount', { count: outline.length });
      }
    }

    const activeDoc = this.deps.getActiveDocument();
    if (outline.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'muted-hint';
      hint.textContent =
        activeDoc && !isMarkdownPath(activeDoc.name)
          ? t('sidebar.emptyOutlineTextFile')
          : t('sidebar.emptyOutline');
      this.deps.containerEl.appendChild(hint);
      return;
    }

    const tokenByLine = new Map<number, number>();
    const outlinePanelHidden = this.deps.panelEl?.hidden ?? false;
    if (activeDoc && !outlinePanelHidden) {
      for (const tc of computeHeadingTokenCounts(activeDoc.currentContent)) {
        tokenByLine.set(tc.line, tc.tokens);
      }
    }

    for (const item of outline) {
      const row = document.createElement('div');
      row.className = 'outline-row';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `outline-item outline-lvl-${item.level}`;
      btn.dataset.headingSlug = item.slug;
      const headingLabel = item.text || t('outline.untitledHeading');
      const tok = tokenByLine.get(item.line);
      btn.title =
        tok && tok > 0
          ? `${t('outline.lineTooltip', { line: item.line, text: item.text })} (${t('outline.tokensTooltip', { tokens: tok })})`
          : t('outline.lineTooltip', { line: item.line, text: item.text });

      const textSpan = document.createElement('span');
      textSpan.className = 'outline-item-text';
      textSpan.textContent = headingLabel;
      btn.appendChild(textSpan);

      if (tok && tok > 0) {
        const tokSpan = document.createElement('span');
        tokSpan.className = 'outline-item-tokens';
        tokSpan.textContent = `~${tok} tok`;
        btn.appendChild(tokSpan);
      }

      btn.addEventListener('click', () => {
        this.deps.onNavigateToHeading(item.line, item.slug);
      });

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'mini-icon-btn outline-copy-btn';
      copyBtn.title = t('outline.copySection');
      copyBtn.setAttribute('aria-label', t('outline.copySection'));
      copyBtn.innerHTML =
        '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="4" width="7" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4 11H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deps.onCopySectionAiContext(item.line, item.slug);
      });

      row.appendChild(btn);
      row.appendChild(copyBtn);
      this.deps.containerEl.appendChild(row);
    }
    this.highlightCurrentHeading();
  }

  public highlightCurrentHeading(): void {
    const items = this.deps.containerEl.querySelectorAll<HTMLButtonElement>('.outline-item');
    for (const btn of items) {
      const isCurrent = Boolean(
        this.activeHeadingSlug && btn.dataset.headingSlug === this.activeHeadingSlug,
      );
      btn.classList.toggle('is-current', isCurrent);
      if (isCurrent) {
        btn.setAttribute('aria-current', 'location');
      } else {
        btn.removeAttribute('aria-current');
      }
    }
  }
}
