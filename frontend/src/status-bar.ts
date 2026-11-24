import type { DocStats } from './api';
import { getLanguage, t } from './i18n';
import { estimateTokens } from './token-utils';

export interface StatusBarTabLike {
  name: string;
  path: string | null;
  currentContent: string;
  lineEnding: 'CRLF' | 'LF';
  encoding: string;
  isDirty: boolean;
  stats: DocStats;
}

export interface StatusBarDeps {
  pathBtn: HTMLButtonElement;
  saveBadge: HTMLElement;
  cursorEl: HTMLElement;
  docSummaryBtn: HTMLButtonElement | null;
  zoomBtn: HTMLButtonElement;
  eolBtn: HTMLButtonElement;
  encodingEl: HTMLElement;
  toastEl: HTMLElement;
  getActiveTab: () => StatusBarTabLike | undefined;
  getZoomPercent: () => number;
  getCursorPosition: () => { line: number; col: number } | null;
  getSelectedText: () => string;
  onScheduleLintUpdate?: (delayMs: number) => void;
}

export class StatusBarController {
  private readonly deps: StatusBarDeps;
  private lastSelection = { chars: 0, words: 0 };
  private statusStatsTimer: number | undefined;
  private toastTimer: number | undefined;
  private readonly documentTokenCounts = new WeakMap<
    StatusBarTabLike,
    { content: string; count: number }
  >();

  constructor(deps: StatusBarDeps) {
    this.deps = deps;
  }

  public getLastSelection(): { chars: number; words: number } {
    return this.lastSelection;
  }

  public isStatisticsPending(): boolean {
    return this.statusStatsTimer !== undefined;
  }

  public setZoomPercent(pct: number): void {
    this.deps.zoomBtn.textContent = `${pct}%`;
  }

  public setRestoredBadge(): void {
    this.deps.saveBadge.textContent = t('status.restored');
  }

  public setCursor(line: number, col: number, selChars = 0, selWords = 0): void {
    this.deps.cursorEl.textContent = t('status.cursor', { line, col });
    this.lastSelection = { chars: selChars, words: selWords };
    this.scheduleStatistics();
  }

  public updateSaveStatus(tab: StatusBarTabLike): void {
    this.deps.saveBadge.textContent = tab.isDirty
      ? t('status.unsaved')
      : tab.path
        ? t('status.saved')
        : t('status.draft');
    this.deps.saveBadge.classList.toggle('is-dirty', tab.isDirty);
  }

  public scheduleStatistics(updateLint = false): void {
    window.clearTimeout(this.statusStatsTimer);
    this.statusStatsTimer = window.setTimeout(() => {
      this.statusStatsTimer = undefined;
      this.updateWordCountDisplay();
    }, 120);
    if (updateLint) {
      this.deps.onScheduleLintUpdate?.(350);
    }
  }

  public update(): void {
    const tab = this.deps.getActiveTab();
    if (!tab) return;

    this.deps.pathBtn.textContent = tab.path ?? tab.name;
    this.updateSaveStatus(tab);
    const pos = this.deps.getCursorPosition();
    if (pos) {
      this.deps.cursorEl.textContent = t('status.cursor', {
        line: pos.line,
        col: pos.col,
      });
    }
    this.scheduleStatistics(true);
    this.deps.zoomBtn.textContent = `${this.deps.getZoomPercent()}%`;
    this.deps.eolBtn.textContent = tab.lineEnding;
    this.deps.encodingEl.textContent = tab.encoding;
  }

  private formatReadingTime(readingTimeSec: number, isEn: boolean): string {
    if (readingTimeSec < 60) {
      return isEn ? `${readingTimeSec}s read time` : `${readingTimeSec} Sek. Lesezeit`;
    }
    const mins = Math.ceil(readingTimeSec / 60);
    return isEn ? `~${mins} min read time` : `~${mins} Min. Lesezeit`;
  }

  public updateWordCountDisplay(): void {
    const tab = this.deps.getActiveTab();
    if (!tab) return;
    const { words, readingTimeSec } = tab.stats;
    let tokens = this.documentTokenCounts.get(tab);
    if (tokens?.content !== tab.currentContent) {
      tokens = { content: tab.currentContent, count: estimateTokens(tab.currentContent) };
      this.documentTokenCounts.set(tab, tokens);
    }
    const totalTokens = tokens.count;
    const selTokens =
      this.lastSelection.chars > 0 ? estimateTokens(this.deps.getSelectedText()) : 0;
    const isEn = getLanguage() === 'en';
    const locale = isEn ? 'en-US' : 'de-DE';
    const wordLabel = isEn
      ? words === 1
        ? 'word'
        : 'words'
      : words === 1
        ? 'Wort'
        : 'Wörter';
    const readingTimeStr = this.formatReadingTime(readingTimeSec, isEn);

    if (this.deps.docSummaryBtn) {
      if (this.lastSelection.chars > 0) {
        const selW = this.lastSelection.words;
        const selC = this.lastSelection.chars;
        this.deps.docSummaryBtn.textContent = isEn
          ? `${selW} of ${words.toLocaleString(locale)} words · ~${selTokens.toLocaleString(locale)} tokens`
          : `${selW} von ${words.toLocaleString(locale)} Wörtern · ~${selTokens.toLocaleString(locale)} Tokens`;
        this.deps.docSummaryBtn.title = isEn
          ? `Selection: ${selW.toLocaleString(locale)} words (${selC.toLocaleString(locale)} ch.), ~${selTokens.toLocaleString(locale)} tokens · Document: ${words.toLocaleString(locale)} words (~${totalTokens.toLocaleString(locale)} tokens, ${readingTimeStr}) · Click for details`
          : `Auswahl: ${selW.toLocaleString(locale)} Wörter (${selC.toLocaleString(locale)} Z.), ~${selTokens.toLocaleString(locale)} Tokens · Dokument: ${words.toLocaleString(locale)} Wörter (~${totalTokens.toLocaleString(locale)} Tokens, ${readingTimeStr}) · Klicken für Details`;
      } else {
        const tokenLabel = isEn ? 'tokens' : 'Tokens';
        this.deps.docSummaryBtn.textContent = `${words.toLocaleString(locale)} ${wordLabel} · ~${totalTokens.toLocaleString(locale)} ${tokenLabel}`;
        this.deps.docSummaryBtn.title = isEn
          ? `Document statistics: ${words.toLocaleString(locale)} words · ~${totalTokens.toLocaleString(locale)} tokens · ${readingTimeStr} · Click for details`
          : `Dokument-Statistiken: ${words.toLocaleString(locale)} Wörter · ~${totalTokens.toLocaleString(locale)} Tokens · ${readingTimeStr} · Klicken für Details`;
      }
    }
  }

  public showToast(message: string, durationMs = 2800): void {
    // Never mutate the polite live region while a modal dialog makes outside DOM inert
    if (document.querySelector('dialog[open]')) return;
    window.clearTimeout(this.toastTimer);
    this.deps.toastEl.textContent = message;
    this.deps.toastEl.classList.add('is-visible');
    this.toastTimer = window.setTimeout(() => {
      this.deps.toastEl.classList.remove('is-visible');
      this.deps.toastEl.textContent = '';
    }, durationMs);
  }
}
