import { describe, expect, it, vi } from 'vitest';
import { SyncScrollController, SyncScrollDeps } from '../sync-scroll';

describe('SyncScrollController', () => {
  it('manages scroll locks during programmatic navigation', () => {
    vi.useFakeTimers();

    const appEl = document.createElement('div');
    appEl.setAttribute('data-view', 'split');
    const previewPaneEl = document.createElement('div');
    const previewContentEl = document.createElement('article');

    const deps: SyncScrollDeps = {
      appEl,
      previewPaneEl,
      previewContentEl,
      getEditor: () => ({}) as any,
      getOutline: () => [],
      onActiveHeadingChange: vi.fn(),
    };

    const controller = new SyncScrollController(deps);
    expect(controller.isEnabled()).toBe(true);

    // Call navigation lock with 300ms
    controller.lockScrollForNavigation('editor', 300);

    // Advance 200ms - lock should still be active
    vi.advanceTimersByTime(200);

    // Advance remaining 150ms - lock should expire
    vi.advanceTimersByTime(150);

    controller.setEnabled(false);
    expect(controller.isEnabled()).toBe(false);

    vi.useRealTimers();
  });

  it('updates active heading based on viewport outline tracking', () => {
    const appEl = document.createElement('div');
    appEl.setAttribute('data-view', 'preview');

    const previewPaneEl = document.createElement('div');
    // Mock getBoundingClientRect
    previewPaneEl.getBoundingClientRect = () =>
      ({ top: 0, bottom: 800, height: 800 } as DOMRect);

    const previewContentEl = document.createElement('article');
    const h1 = document.createElement('h1');
    h1.id = 'titel';
    h1.getBoundingClientRect = () =>
      ({ top: 30, bottom: 60, height: 30 } as DOMRect);
    previewContentEl.appendChild(h1);

    const h2 = document.createElement('h2');
    h2.id = 'kapitel-1';
    h2.getBoundingClientRect = () =>
      ({ top: 300, bottom: 330, height: 30 } as DOMRect);
    previewContentEl.appendChild(h2);

    const activeHeadingFn = vi.fn();
    const deps: SyncScrollDeps = {
      appEl,
      previewPaneEl,
      previewContentEl,
      getEditor: () => ({}) as any,
      getOutline: () => [
        { level: 1, text: 'Titel', slug: 'titel', line: 1 },
        { level: 2, text: 'Kapitel 1', slug: 'kapitel-1', line: 10 },
      ],
      onActiveHeadingChange: activeHeadingFn,
    };

    const controller = new SyncScrollController(deps);
    controller.updateActiveHeadingFromViewport();

    // Since h1 top is 30 <= threshold 56, and h2 top is 300 > 56, active slug is 'titel'
    expect(activeHeadingFn).toHaveBeenCalledWith('titel');
  });

  it('throttles rapid syncEditorToPreview calls with requestAnimationFrame', () => {
    vi.useFakeTimers();
    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });

    const appEl = document.createElement('div');
    appEl.setAttribute('data-view', 'split');
    const previewPaneEl = document.createElement('div');
    Object.defineProperty(previewPaneEl, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(previewPaneEl, 'clientHeight', { value: 500, configurable: true });
    previewPaneEl.getBoundingClientRect = () =>
      ({ top: 0, bottom: 500, height: 500 } as DOMRect);

    const previewContentEl = document.createElement('article');
    const edScrollDom = document.createElement('div');
    Object.defineProperty(edScrollDom, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(edScrollDom, 'clientHeight', { value: 500, configurable: true });
    edScrollDom.scrollTop = 100;

    const getTopViewportLine = vi.fn(() => 5);
    const controller = new SyncScrollController({
      appEl,
      previewPaneEl,
      previewContentEl,
      getEditor: () =>
        ({
          view: { scrollDOM: edScrollDom, state: { doc: { lines: 50 } } },
          getTopViewportLine,
          scrollToSourceLine: vi.fn(),
        }) as any,
      getOutline: () => [],
      onActiveHeadingChange: vi.fn(),
    });

    controller.syncEditorToPreview();
    controller.syncEditorToPreview();
    controller.syncEditorToPreview();

    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(getTopViewportLine).not.toHaveBeenCalled();

    rafCallbacks[0](16);
    expect(getTopViewportLine).toHaveBeenCalledTimes(1);

    controller.destroy();
    rafSpy.mockRestore();
    vi.useRealTimers();
  });

  it('caches [data-line] measurements across scrolls and invalidates on resize or DOM mutation', () => {
    vi.useFakeTimers();
    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });

    const appEl = document.createElement('div');
    appEl.setAttribute('data-view', 'split');
    const previewPaneEl = document.createElement('div');
    Object.defineProperty(previewPaneEl, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(previewPaneEl, 'clientHeight', { value: 500, configurable: true });
    previewPaneEl.getBoundingClientRect = () =>
      ({ top: 0, bottom: 500, height: 500 } as DOMRect);

    const previewContentEl = document.createElement('article');
    const p1 = document.createElement('p');
    p1.setAttribute('data-line', '1');
    const p1RectSpy = vi.fn(() => ({ top: 0, bottom: 100, height: 100 } as DOMRect));
    p1.getBoundingClientRect = p1RectSpy;

    const p2 = document.createElement('p');
    p2.setAttribute('data-line', '20');
    const p2RectSpy = vi.fn(() => ({ top: 800, bottom: 900, height: 100 } as DOMRect));
    p2.getBoundingClientRect = p2RectSpy;

    previewContentEl.append(p1, p2);

    const edScrollDom = document.createElement('div');
    Object.defineProperty(edScrollDom, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(edScrollDom, 'clientHeight', { value: 500, configurable: true });
    edScrollDom.scrollTop = 200;

    let currentTopLine = 10;
    const controller = new SyncScrollController({
      appEl,
      previewPaneEl,
      previewContentEl,
      getEditor: () =>
        ({
          view: { scrollDOM: edScrollDom, state: { doc: { lines: 40 } } },
          getTopViewportLine: () => currentTopLine,
          scrollToSourceLine: vi.fn(),
        }) as any,
      getOutline: () => [],
      onActiveHeadingChange: vi.fn(),
    });

    // First scroll frame measures [data-line] nodes
    controller.syncEditorToPreview();
    rafCallbacks.shift()!(16);
    expect(p1RectSpy).toHaveBeenCalledTimes(1);
    expect(p2RectSpy).toHaveBeenCalledTimes(1);

    // Advance past 90ms scroll lock and scroll again without DOM/size change
    vi.advanceTimersByTime(100);
    currentTopLine = 12;
    controller.syncEditorToPreview();
    rafCallbacks.shift()!(32);
    expect(p1RectSpy).toHaveBeenCalledTimes(1);
    expect(p2RectSpy).toHaveBeenCalledTimes(1);

    // Window resize invalidates cache -> next scroll re-measures
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(100);
    controller.syncEditorToPreview();
    rafCallbacks.shift()!(48);
    expect(p1RectSpy).toHaveBeenCalledTimes(2);
    expect(p2RectSpy).toHaveBeenCalledTimes(2);

    // DOM mutation invalidates cache -> next scroll re-measures
    p2.setAttribute('data-line', '25');
    vi.advanceTimersByTime(100);
    controller.syncEditorToPreview();
    rafCallbacks.shift()!(64);
    expect(p1RectSpy).toHaveBeenCalledTimes(3);
    expect(p2RectSpy).toHaveBeenCalledTimes(3);

    controller.destroy();
    rafSpy.mockRestore();
    vi.useRealTimers();
  });

  it('cancels setTimeout fallback accurately on destroy when requestAnimationFrame is unavailable', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const origRaf = window.requestAnimationFrame;
    const origCaf = window.cancelAnimationFrame;
    const cafSpy = vi.fn();
    Object.defineProperty(window, 'requestAnimationFrame', { value: undefined, configurable: true, writable: true });
    Object.defineProperty(window, 'cancelAnimationFrame', { value: cafSpy, configurable: true, writable: true });
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');

    try {
      const appEl = document.createElement('div');
      appEl.setAttribute('data-view', 'split');
      const getTopViewportLine = vi.fn(() => 1);
      const controller = new SyncScrollController({
        appEl,
        previewPaneEl: document.createElement('div'),
        previewContentEl: document.createElement('article'),
        getEditor: () =>
          ({
            view: { scrollDOM: document.createElement('div'), state: { doc: { lines: 10 } } },
            getTopViewportLine,
            scrollToSourceLine: vi.fn(),
          }) as any,
        getOutline: () => [],
        onActiveHeadingChange: vi.fn(),
      });

      controller.syncEditorToPreview();
      controller.destroy();

      expect(cafSpy).not.toHaveBeenCalled();
      expect(clearTimeoutSpy).toHaveBeenCalled();
      vi.advanceTimersByTime(50);
      expect(getTopViewportLine).not.toHaveBeenCalled();
    } finally {
      clearTimeoutSpy.mockRestore();
      Object.defineProperty(window, 'requestAnimationFrame', { value: origRaf, configurable: true, writable: true });
      Object.defineProperty(window, 'cancelAnimationFrame', { value: origCaf, configurable: true, writable: true });
      vi.useRealTimers();
    }
  });

  it('skips hidden elements inside closed <details> and honors suppressFor()', () => {
    vi.useFakeTimers();
    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });

    const appEl = document.createElement('div');
    appEl.setAttribute('data-view', 'split');
    const previewPaneEl = document.createElement('div');
    Object.defineProperty(previewPaneEl, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(previewPaneEl, 'clientHeight', { value: 500, configurable: true });
    previewPaneEl.getBoundingClientRect = () =>
      ({ top: 0, bottom: 500, height: 500, width: 500 } as DOMRect);

    const previewContentEl = document.createElement('article');
    const details = document.createElement('details');
    details.setAttribute('data-line', '1');
    details.getBoundingClientRect = () =>
      ({ top: 10 - previewPaneEl.scrollTop, bottom: 40 - previewPaneEl.scrollTop, height: 30, width: 500 } as DOMRect);
    const hiddenP = document.createElement('p');
    hiddenP.setAttribute('data-line', '5');
    hiddenP.getBoundingClientRect = () =>
      ({ top: 0, bottom: 0, height: 0, width: 0 } as DOMRect);
    details.appendChild(hiddenP);

    const visibleP = document.createElement('p');
    visibleP.setAttribute('data-line', '20');
    visibleP.getBoundingClientRect = () =>
      ({ top: 400 - previewPaneEl.scrollTop, bottom: 450 - previewPaneEl.scrollTop, height: 50, width: 500 } as DOMRect);
    previewContentEl.append(details, visibleP);

    const scrollToSourceLine = vi.fn();
    const edScrollDom = document.createElement('div');
    Object.defineProperty(edScrollDom, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(edScrollDom, 'clientHeight', { value: 500, configurable: true });

    const controller = new SyncScrollController({
      appEl,
      previewPaneEl,
      previewContentEl,
      getEditor: () =>
        ({
          view: { scrollDOM: edScrollDom, state: { doc: { lines: 40 } } },
          getTopViewportLine: () => 5,
          scrollToSourceLine,
        }) as any,
      getOutline: () => [],
      onActiveHeadingChange: vi.fn(),
    });

    // Suppressed sync must not schedule rAF
    controller.suppressFor(150);
    controller.syncEditorToPreview();
    expect(rafSpy).not.toHaveBeenCalled();

    // After suppression expires, closed <details> child at line 5 is ignored (interpolates 1..20, not 5..20)
    vi.advanceTimersByTime(160);
    previewPaneEl.scrollTop = 205;
    controller.syncPreviewToEditor();
    rafCallbacks.shift()!(16);
    expect(scrollToSourceLine).toHaveBeenCalledTimes(1);
    const targetLine = scrollToSourceLine.mock.calls[0][0] as number;
    expect(targetLine).toBeGreaterThan(10);
    expect(targetLine).toBeLessThan(12);

    controller.destroy();
    rafSpy.mockRestore();
    vi.useRealTimers();
  });

  it('keeps closed <details data-line> itself as a line anchor while excluding non-summary descendants', () => {
    vi.useFakeTimers();
    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });

    try {
      const appEl = document.createElement('div');
      appEl.setAttribute('data-view', 'split');
      const previewPaneEl = document.createElement('div');
      Object.defineProperty(previewPaneEl, 'scrollHeight', { value: 2000, configurable: true });
      Object.defineProperty(previewPaneEl, 'clientHeight', { value: 500, configurable: true });
      previewPaneEl.getBoundingClientRect = () =>
        ({ top: 0, bottom: 500, height: 500, width: 500 } as DOMRect);

      const previewContentEl = document.createElement('article');
      const introP = document.createElement('p');
      introP.setAttribute('data-line', '2');
      introP.getBoundingClientRect = () =>
        ({ top: 20 - previewPaneEl.scrollTop, bottom: 50 - previewPaneEl.scrollTop, height: 30, width: 500 } as DOMRect);

      const details = document.createElement('details');
      details.setAttribute('data-line', '10');
      details.getBoundingClientRect = () =>
        ({ top: 100 - previewPaneEl.scrollTop, bottom: 130 - previewPaneEl.scrollTop, height: 30, width: 500 } as DOMRect);
      const summary = document.createElement('summary');
      summary.textContent = 'Abschnitt';
      const hiddenP = document.createElement('p');
      hiddenP.setAttribute('data-line', '12');
      hiddenP.getBoundingClientRect = () =>
        ({ top: 0, bottom: 0, height: 0, width: 0 } as DOMRect);
      details.append(summary, hiddenP);

      const afterP = document.createElement('p');
      afterP.setAttribute('data-line', '20');
      afterP.getBoundingClientRect = () =>
        ({ top: 300 - previewPaneEl.scrollTop, bottom: 350 - previewPaneEl.scrollTop, height: 50, width: 500 } as DOMRect);

      previewContentEl.append(introP, details, afterP);

      const scrollToSourceLine = vi.fn();
      const edScrollDom = document.createElement('div');
      Object.defineProperty(edScrollDom, 'scrollHeight', { value: 2000, configurable: true });
      Object.defineProperty(edScrollDom, 'clientHeight', { value: 500, configurable: true });
      edScrollDom.scrollTop = 250;

      const controller = new SyncScrollController({
        appEl,
        previewPaneEl,
        previewContentEl,
        getEditor: () =>
          ({
            view: { scrollDOM: edScrollDom, state: { doc: { lines: 40 } } },
            getTopViewportLine: () => 10,
            scrollToSourceLine,
          }) as any,
        getOutline: () => [],
        onActiveHeadingChange: vi.fn(),
      });

      // Scroll halfway between closed <details> (line 10, top 100) and afterP (line 20, top 300)
      previewPaneEl.scrollTop = 200;
      controller.syncPreviewToEditor();
      rafCallbacks.shift()!(16);
      expect(scrollToSourceLine).toHaveBeenCalledTimes(1);
      // If details (line 10) were dropped it would interpolate 2..20 (~13.57); if hiddenP (line 12) were kept it would hit 12.
      expect(scrollToSourceLine.mock.calls[0][0]).toBeCloseTo(15, 2);

      // Verify editor -> preview also anchors directly on the closed <details> at line 10 (pvTop 100)
      vi.advanceTimersByTime(150);
      controller.syncEditorToPreview();
      rafCallbacks.shift()!(16);
      expect(previewPaneEl.scrollTop).toBe(100);

      controller.destroy();
    } finally {
      rafSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
