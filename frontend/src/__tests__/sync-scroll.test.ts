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
});
