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
});
