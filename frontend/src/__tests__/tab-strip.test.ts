import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n';
import { TabStripController, type TabStripItem } from '../tab-strip';

describe('TabStripController', () => {
  beforeEach(() => {
    setLanguage('de', false);
    document.body.innerHTML = `
      <nav class="tab-strip-wrap">
        <div id="tab-bar" role="tablist"></div>
      </nav>
      <div id="tab-context-menu" popover="auto">
        <button type="button" data-tab-ctx="close">Close</button>
        <button type="button" data-tab-ctx="close-others">Close others</button>
        <button type="button" data-tab-ctx="close-to-right">Close right</button>
        <button type="button" data-tab-ctx="toggle-pin"><span id="tab-ctx-pin-label">Pin</span></button>
        <button type="button" data-tab-ctx="save-as" id="tab-ctx-save-as">Save As</button>
        <button type="button" data-tab-ctx="reveal" id="tab-ctx-reveal">Reveal</button>
        <button type="button" data-tab-ctx="copy-path" id="tab-ctx-copy-path">Copy Path</button>
        <button type="button" data-tab-ctx="copy-at-path" id="tab-ctx-copy-at-path">Copy @Path</button>
        <button type="button" data-tab-ctx="diff-saved" id="tab-ctx-diff-saved">Diff</button>
        <button type="button" data-tab-ctx="compare-tabs" id="tab-ctx-compare-tabs">Compare</button>
      </div>
    `;
  });

  it('renders sibling tab buttons and close buttons with roving tabindex', () => {
    const tabs: TabStripItem[] = [
      { id: 't1', name: 'A.md', path: 'C:\\A.md', isDirty: false, isPinned: true },
      { id: 't2', name: 'B.md', path: null, isDirty: true },
    ];
    const onActivateTab = vi.fn();
    const onCloseTab = vi.fn();
    const onNewTab = vi.fn();
    const onReorderTabs = vi.fn();
    const onContextAction = vi.fn();

    const ctrl = new TabStripController({
      tabBarEl: document.getElementById('tab-bar')!,
      tabContextMenuEl: document.getElementById('tab-context-menu')!,
      tabStripWrapEl: document.querySelector('.tab-strip-wrap'),
      getTabs: () => tabs,
      onActivateTab,
      onCloseTab,
      onNewTab,
      onReorderTabs,
      onContextAction,
    });

    ctrl.render(tabs, 't1');

    const slots = document.querySelectorAll('.tab-slot');
    expect(slots).toHaveLength(2);
    const firstTabBtn = slots[0].querySelector('button[role="tab"]') as HTMLButtonElement;
    const firstCloseBtn = slots[0].querySelector('button.tab-close-btn') as HTMLButtonElement;
    expect(firstTabBtn.contains(firstCloseBtn)).toBe(false);
    expect(firstTabBtn.tabIndex).toBe(0);
    expect(firstTabBtn.getAttribute('aria-selected')).toBe('true');

    const secondTabBtn = slots[1].querySelector('button[role="tab"]') as HTMLButtonElement;
    expect(secondTabBtn.tabIndex).toBe(-1);
    expect(slots[1].querySelector('.tab-dirty-dot')).not.toBeNull();

    secondTabBtn.click();
    expect(onActivateTab).toHaveBeenCalledWith('t2');

    firstCloseBtn.click();
    expect(onCloseTab).toHaveBeenCalledWith('t1');

    ctrl.updateDirtyState('t1', true);
    expect(slots[0].querySelector('.tab-dirty-dot')).not.toBeNull();
    ctrl.updateDirtyState('t1', false);
    expect(slots[0].querySelector('.tab-dirty-dot')).toBeNull();
    ctrl.destroy();
  });

  it('opens tab context menu with proper disabled states and dispatches save-as action', () => {
    const tabs: TabStripItem[] = [
      { id: 't1', name: 'Draft.md', path: null, isDirty: true },
    ];
    const onContextAction = vi.fn();
    const ctrl = new TabStripController({
      tabBarEl: document.getElementById('tab-bar')!,
      tabContextMenuEl: document.getElementById('tab-context-menu')!,
      tabStripWrapEl: document.querySelector('.tab-strip-wrap'),
      getTabs: () => tabs,
      onActivateTab: vi.fn(),
      onCloseTab: vi.fn(),
      onNewTab: vi.fn(),
      onReorderTabs: vi.fn(),
      onContextAction,
    });

    ctrl.render(tabs, 't1');
    const slot = document.querySelector('.tab-slot')!;
    slot.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));

    expect((document.getElementById('tab-ctx-reveal') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('tab-ctx-save-as') as HTMLButtonElement).disabled).toBe(false);

    (document.getElementById('tab-ctx-save-as') as HTMLButtonElement).click();
    expect(onContextAction).toHaveBeenCalledWith('save-as', 't1');
    ctrl.destroy();
  });
});
