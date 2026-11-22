/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { OutlineController } from '../outline-controller';

describe('OutlineController', () => {
  it('renders heading items, skips token counts when panel is hidden, and highlights active heading', () => {
    const containerEl = document.createElement('div');
    const countBadgeEl = document.createElement('span');
    const panelEl = document.createElement('section');
    panelEl.hidden = true;

    const onNavigateToHeading = vi.fn();
    const onCopySectionAiContext = vi.fn();

    const ctrl = new OutlineController({
      containerEl,
      countBadgeEl,
      panelEl,
      getActiveDocument: () => ({
        name: 'Doc.md',
        currentContent: '# Intro\nHello world\n## Details\nMore text here',
      }),
      onNavigateToHeading,
      onCopySectionAiContext,
    });

    const outline = [
      { level: 1, text: 'Intro', slug: 'intro', line: 1 },
      { level: 2, text: 'Details', slug: 'details', line: 3 },
    ];

    ctrl.render(outline);
    expect(countBadgeEl.textContent).toBe('2');
    // When panel is hidden, token badges are skipped for performance
    expect(containerEl.querySelector('.outline-item-tokens')).toBeNull();

    // When panel is visible, token badges are rendered
    panelEl.hidden = false;
    ctrl.render(outline);
    expect(containerEl.querySelectorAll('.outline-item-tokens').length).toBeGreaterThan(0);

    ctrl.setActiveHeading('details');
    const items = containerEl.querySelectorAll<HTMLButtonElement>('.outline-item');
    expect(items[0].classList.contains('is-current')).toBe(false);
    expect(items[1].classList.contains('is-current')).toBe(true);
    expect(items[1].getAttribute('aria-current')).toBe('location');

    items[0].click();
    expect(onNavigateToHeading).toHaveBeenCalledWith(1, 'intro');

    const copyBtn = containerEl.querySelector<HTMLButtonElement>('.outline-copy-btn')!;
    copyBtn.click();
    expect(onCopySectionAiContext).toHaveBeenCalledWith(1, 'intro');
  });
});
