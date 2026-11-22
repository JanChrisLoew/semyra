import { describe, expect, it, vi } from 'vitest';
import { NavigationHistoryController } from '../navigation-history';

describe('NavigationHistoryController', () => {
  it('navigates back and forward across open tabs without recording re-entrant transitions', async () => {
    const openTabs = new Set(['tab-1', 'tab-2', 'tab-3']);
    let activeId = 'tab-1';

    let history!: NavigationHistoryController;
    const activateTab = vi.fn((tabId: string) => {
      activeId = tabId;
      // Simulate activateTab calling history.record() while isNavigating is true
      history.record(tabId, `C:\\${tabId}.md`);
    });

    history = new NavigationHistoryController({
      hasOpenTab: (id) => openTabs.has(id),
      activateTab,
      openFileByPath: vi.fn(async () => false),
      getActiveTabId: () => activeId,
    });

    history.record('tab-1', 'C:\\tab-1.md');
    history.record('tab-2', 'C:\\tab-2.md');
    history.record('tab-3', 'C:\\tab-3.md');

    await history.navigate(-1);
    expect(activeId).toBe('tab-2');

    await history.navigate(-1);
    expect(activeId).toBe('tab-1');

    await history.navigate(1);
    expect(activeId).toBe('tab-2');
  });

  it('reopens closed tab by path and updates remapped paths', async () => {
    const openTabs = new Set(['tab-2']);
    let activeId = 'tab-2';

    const openFileByPath = vi.fn(async (path: string) => {
      if (path === 'C:\\Notes\\Renamed.md') {
        openTabs.add('tab-reopened');
        activeId = 'tab-reopened';
        return true;
      }
      return false;
    });

    const history = new NavigationHistoryController({
      hasOpenTab: (id) => openTabs.has(id),
      activateTab: (id) => {
        activeId = id;
      },
      openFileByPath,
      getActiveTabId: () => activeId,
    });

    history.record('tab-1', 'C:\\Notes\\Old.md');
    history.record('tab-2', 'C:\\Notes\\Current.md');
    history.updateTabPath('tab-1', 'C:\\Notes\\Old.md', 'C:\\Notes\\Renamed.md');

    await history.navigate(-1);
    expect(openFileByPath).toHaveBeenCalledWith('C:\\Notes\\Renamed.md');
    expect(activeId).toBe('tab-reopened');
  });
});
