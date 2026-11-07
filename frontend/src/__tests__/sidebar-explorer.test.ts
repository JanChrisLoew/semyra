import { describe, expect, it, vi } from 'vitest';
import { FileTreeNode } from '../api';
import { SidebarExplorerController } from '../sidebar-explorer';

describe('SidebarExplorerController', () => {
  it('preserves expanded and collapsed subfolder <details> states across tree refreshes', () => {
    const fileTreeEl = document.createElement('div');
    const workspaceTitleEl = document.createElement('span');
    const contextPopoverEl = document.createElement('div');
    const onWorkspaceFolderLoaded = vi.fn();

    const explorer = new SidebarExplorerController({
      fileTreeEl,
      workspaceTitleEl,
      contextPopoverEl,
      getActiveFilePath: () => 'C:\\Docs\\Architektur\\ADR\\001.md',
      onOpenFilePath: vi.fn(),
      onOpenCreatedFile: vi.fn(),
      onTriggerOpenFolderDialog: vi.fn(),
      onWorkspaceFolderLoaded,
      onEntryRenamed: vi.fn(),
      onEntryDeleted: vi.fn(),
    });

    const sampleTree: FileTreeNode = {
      name: 'Docs',
      path: 'C:\\Docs',
      isDir: true,
      isMarkdown: false,
      children: [
        {
          name: 'Architektur',
          path: 'C:\\Docs\\Architektur',
          isDir: true,
          isMarkdown: false,
          children: [
            {
              name: 'ADR',
              path: 'C:\\Docs\\Architektur\\ADR',
              isDir: true,
              isMarkdown: false,
              children: [
                {
                  name: '001.md',
                  path: 'C:\\Docs\\Architektur\\ADR\\001.md',
                  isDir: false,
                  isMarkdown: true,
                },
              ],
            },
          ],
        },
      ],
    };

    explorer.setTree(sampleTree, true);
    expect(onWorkspaceFolderLoaded).toHaveBeenCalledTimes(1);

    // Depth 0 ('Architektur') defaults to open=true; depth 1 ('ADR') defaults to open=false
    const detailsBefore = fileTreeEl.querySelectorAll<HTMLDetailsElement>('details.tree-dir-details');
    expect(detailsBefore[0].open).toBe(true);
    expect(detailsBefore[1].open).toBe(false);

    // User manually opens nested 'ADR' folder and collapses top-level 'Architektur' or keeps it open
    detailsBefore[1].open = true;

    // Simulate background tree refresh (persistPrefs = false)
    explorer.setTree(sampleTree, false);

    // Does not trigger redundant recentFolders churn on same-root background refresh
    expect(onWorkspaceFolderLoaded).toHaveBeenCalledTimes(1);

    // Nested 'ADR' folder stays open, and active file remains highlighted
    const detailsAfter = fileTreeEl.querySelectorAll<HTMLDetailsElement>('details.tree-dir-details');
    expect(detailsAfter[1].open).toBe(true);

    const activeBtn = fileTreeEl.querySelector('.tree-row.is-active');
    expect(activeBtn?.getAttribute('data-filepath')).toBe('C:\\Docs\\Architektur\\ADR\\001.md');
  });
});
