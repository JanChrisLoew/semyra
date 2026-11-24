import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n';
import { StatusBarController, type StatusBarTabLike } from '../status-bar';

describe('StatusBarController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setLanguage('de', false);
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  function createFixture(tab?: StatusBarTabLike) {
    const pathBtn = document.createElement('button');
    const saveBadge = document.createElement('span');
    const cursorEl = document.createElement('button');
    const docSummaryBtn = document.createElement('button');
    const zoomBtn = document.createElement('button');
    const eolBtn = document.createElement('button');
    const encodingEl = document.createElement('span');
    const toastEl = document.createElement('div');
    document.body.append(pathBtn, saveBadge, cursorEl, docSummaryBtn, zoomBtn, eolBtn, encodingEl, toastEl);

    const activeTab: StatusBarTabLike = tab ?? {
      name: 'README.md',
      path: 'C:\\Repo\\README.md',
      currentContent: '# Hallo Welt\n\nEin kurzer Testtext.',
      lineEnding: 'CRLF',
      encoding: 'UTF-8',
      isDirty: false,
      stats: { words: 5, chars: 33, lines: 3, readingTimeSec: 12 },
    };
    const onScheduleLintUpdate = vi.fn();

    const ctrl = new StatusBarController({
      pathBtn,
      saveBadge,
      cursorEl,
      docSummaryBtn,
      zoomBtn,
      eolBtn,
      encodingEl,
      toastEl,
      getActiveTab: () => activeTab,
      getZoomPercent: () => 115,
      getCursorPosition: () => ({ line: 3, col: 7 }),
      getSelectedText: () => 'Hallo Welt',
      onScheduleLintUpdate,
    });

    return {
      ctrl,
      activeTab,
      pathBtn,
      saveBadge,
      cursorEl,
      docSummaryBtn,
      zoomBtn,
      eolBtn,
      encodingEl,
      toastEl,
      onScheduleLintUpdate,
    };
  }

  it('updates status bar elements and debounces word/token statistics', () => {
    const fx = createFixture();
    fx.ctrl.update();

    expect(fx.pathBtn.textContent).toBe('C:\\Repo\\README.md');
    expect(fx.saveBadge.textContent).toBe('Gespeichert');
    expect(fx.saveBadge.classList.contains('is-dirty')).toBe(false);
    expect(fx.cursorEl.textContent).toBe('Zeile 3, Spalte 7');
    expect(fx.zoomBtn.textContent).toBe('115%');
    expect(fx.eolBtn.textContent).toBe('CRLF');
    expect(fx.encodingEl.textContent).toBe('UTF-8');
    expect(fx.onScheduleLintUpdate).toHaveBeenCalledWith(350);
    expect(fx.ctrl.isStatisticsPending()).toBe(true);

    vi.advanceTimersByTime(120);
    expect(fx.ctrl.isStatisticsPending()).toBe(false);
    expect(fx.docSummaryBtn.textContent).toContain('5 Wörter');
    expect(fx.docSummaryBtn.textContent).toContain('Tokens');
  });

  it('renders selection summary in English when language is en', () => {
    setLanguage('en', false);
    const fx = createFixture();
    fx.ctrl.setCursor(2, 4, 10, 2);
    vi.advanceTimersByTime(120);

    expect(fx.cursorEl.textContent).toBe('Line 2, Column 4');
    expect(fx.docSummaryBtn.textContent).toContain('2 of 5 words');
    expect(fx.docSummaryBtn.textContent).toContain('tokens');
  });

  it('suppresses toast updates while a modal dialog is open', () => {
    const fx = createFixture();
    const dlg = document.createElement('dialog');
    dlg.setAttribute('open', '');
    document.body.append(dlg);

    fx.ctrl.showToast('Hidden toast');
    expect(fx.toastEl.textContent).toBe('');
    expect(fx.toastEl.classList.contains('is-visible')).toBe(false);

    dlg.remove();
    fx.ctrl.showToast('Visible toast', 500);
    expect(fx.toastEl.textContent).toBe('Visible toast');
    expect(fx.toastEl.classList.contains('is-visible')).toBe(true);

    vi.advanceTimersByTime(500);
    expect(fx.toastEl.classList.contains('is-visible')).toBe(false);
    expect(fx.toastEl.textContent).toBe('');
  });
});
