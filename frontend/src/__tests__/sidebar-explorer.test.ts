import { describe, expect, it, vi } from 'vitest';
import { backend, FileTreeNode } from '../api';
import { SidebarExplorerController } from '../sidebar-explorer';

describe('SidebarExplorerController', () => {
  it.each(['switch', 'refresh', 'clear'])('handles a pending index after %s', async (action) => {
    const explorer = new SidebarExplorerController({
      fileTreeEl: document.createElement('div'),
      workspaceTitleEl: document.createElement('span'),
      contextPopoverEl: document.createElement('div'),
      getActiveFilePath: () => null,
      onOpenFilePath: vi.fn(),
      onOpenCreatedFile: vi.fn(),
      onTriggerOpenFolderDialog: vi.fn(),
      onWorkspaceFolderLoaded: vi.fn(),
      onEntryRenamed: vi.fn(),
      onEntryDeleted: vi.fn(),
    });
    const tree = { name: 'Notes', path: 'C:/Notes', isDir: true, isMarkdown: false };
    const nextTree = action === 'switch' ? { ...tree, path: 'C:/Other' } : tree;
    const oldFile = { path: 'C:/Notes/Old.md', relPath: 'Old.md', name: 'Old.md' };
    const newFile = { path: `${nextTree.path}/New.md`, relPath: 'New.md', name: 'New.md' };
    let finish!: (result: { files: typeof oldFile[] }) => void;
    const index = vi.spyOn(backend, 'listWorkspaceFiles')
      .mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ files: [newFile] });
    try {
      explorer.setTree(tree);
      const pending = explorer.getWorkspaceFiles();
      if (action === 'clear') explorer.clearWorkspace([], []);
      else explorer.setTree(nextTree, false);
      finish({ files: [oldFile] });

      await expect(pending).resolves.toEqual(action === 'refresh' ? [newFile] : null);
      await expect(explorer.getWorkspaceFiles()).resolves.toEqual(action === 'clear' ? [] : [newFile]);
    } finally {
      index.mockRestore();
    }
  });

  it('refreshes without activating a workspace and preserves expanded subfolders', async () => {
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

    const listTree = vi.spyOn(backend, 'listTree').mockResolvedValue(structuredClone(sampleTree));
    try {
      await explorer.refresh();
      expect(listTree).toHaveBeenCalledWith(sampleTree.path, false);
    } finally {
      listTree.mockRestore();
    }

    // Does not trigger redundant recentFolders churn on same-root background refresh
    expect(onWorkspaceFolderLoaded).toHaveBeenCalledTimes(1);

    // Nested 'ADR' folder stays open, and active file remains highlighted
    const detailsAfter = fileTreeEl.querySelectorAll<HTMLDetailsElement>('details.tree-dir-details');
    expect(detailsAfter[1].open).toBe(true);

    const activeBtn = fileTreeEl.querySelector('.tree-row.is-active');
    expect(activeBtn?.getAttribute('data-filepath')).toBe('C:\\Docs\\Architektur\\ADR\\001.md');
  });

  it('renders recent folders and files with remove buttons and triggers removal callbacks', () => {
    const fileTreeEl = document.createElement('div');
    const workspaceTitleEl = document.createElement('span');
    const contextPopoverEl = document.createElement('div');
    const onRemoveRecentFolder = vi.fn();
    const onRemoveRecentFile = vi.fn();

    const explorer = new SidebarExplorerController({
      fileTreeEl,
      workspaceTitleEl,
      contextPopoverEl,
      getActiveFilePath: () => null,
      onOpenFilePath: vi.fn(),
      onOpenCreatedFile: vi.fn(),
      onTriggerOpenFolderDialog: vi.fn(),
      onWorkspaceFolderLoaded: vi.fn(),
      onEntryRenamed: vi.fn(),
      onEntryDeleted: vi.fn(),
      onRemoveRecentFolder,
      onRemoveRecentFile,
    });

    explorer.renderEmptyStateWithRecents(
      ['C:\\Projekte\\Semyra', 'C:\\Docs'],
      ['C:\\Projekte\\Semyra\\README.md', 'C:\\Docs\\Notizen.md'],
    );

    const rows = fileTreeEl.querySelectorAll('.recent-entry-row');
    expect(rows).toHaveLength(4);

    const removeBtns = fileTreeEl.querySelectorAll<HTMLButtonElement>('.recent-remove-btn');
    expect(removeBtns).toHaveLength(4);

    // Click remove on first folder
    removeBtns[0].click();
    expect(onRemoveRecentFolder).toHaveBeenCalledWith('C:\\Projekte\\Semyra');

    // Click remove on first file
    removeBtns[2].click();
    expect(onRemoveRecentFile).toHaveBeenCalledWith('C:\\Projekte\\Semyra\\README.md');
  });

  it('marks active tree row with .context-active on contextmenu and clears it on popover toggle close', () => {
    const fileTreeEl = document.createElement('div');
    const workspaceTitleEl = document.createElement('span');
    const contextPopoverEl = document.createElement('div');
    contextPopoverEl.showPopover = vi.fn();
    contextPopoverEl.hidePopover = vi.fn();

    const explorer = new SidebarExplorerController({
      fileTreeEl,
      workspaceTitleEl,
      contextPopoverEl,
      getActiveFilePath: () => null,
      onOpenFilePath: vi.fn(),
      onOpenCreatedFile: vi.fn(),
      onTriggerOpenFolderDialog: vi.fn(),
      onWorkspaceFolderLoaded: vi.fn(),
      onEntryRenamed: vi.fn(),
      onEntryDeleted: vi.fn(),
    });

    explorer.setTree({
      name: 'Docs',
      path: 'C:\\Docs',
      isDir: true,
      isMarkdown: false,
      children: [
        {
          name: 'README.md',
          path: 'C:\\Docs\\README.md',
          isDir: false,
          isMarkdown: true,
        },
      ],
    });

    const fileBtn = fileTreeEl.querySelector<HTMLButtonElement>('.tree-row[data-filepath]')!;
    expect(fileBtn).not.toBeNull();
    expect(fileBtn.classList.contains('context-active')).toBe(false);

    // Trigger right click on file row
    const ctxEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fileBtn.dispatchEvent(ctxEvent);

    expect(fileBtn.classList.contains('context-active')).toBe(true);

    // Popover closes -> toggle event fires with newState: 'closed'
    const toggleEvent = new Event('toggle');
    Object.defineProperty(toggleEvent, 'newState', { value: 'closed' });
    contextPopoverEl.dispatchEvent(toggleEvent);

    expect(fileBtn.classList.contains('context-active')).toBe(false);
  });

  it('supports WAI-ARIA tree roles, roving tabindex, and arrow/Home/End keyboard navigation', () => {
    const fileTreeEl = document.createElement('div');
    const workspaceTitleEl = document.createElement('span');
    const contextPopoverEl = document.createElement('div');
    document.body.appendChild(fileTreeEl);

    try {
      const explorer = new SidebarExplorerController({
        fileTreeEl,
        workspaceTitleEl,
        contextPopoverEl,
        getActiveFilePath: () => null,
        onOpenFilePath: vi.fn(),
        onOpenCreatedFile: vi.fn(),
        onTriggerOpenFolderDialog: vi.fn(),
        onWorkspaceFolderLoaded: vi.fn(),
        onEntryRenamed: vi.fn(),
        onEntryDeleted: vi.fn(),
      });

      const tree: FileTreeNode = {
        name: 'Workspace',
        path: 'C:\\Workspace',
        isDir: true,
        isMarkdown: false,
        children: [
          {
            name: 'Docs',
            path: 'C:\\Workspace\\Docs',
            isDir: true,
            isMarkdown: false,
            children: [
              {
                name: 'Nested',
                path: 'C:\\Workspace\\Docs\\Nested',
                isDir: true,
                isMarkdown: false,
                children: [
                  {
                    name: 'deep.md',
                    path: 'C:\\Workspace\\Docs\\Nested\\deep.md',
                    isDir: false,
                    isMarkdown: true,
                  },
                ],
              },
              {
                name: 'guide.md',
                path: 'C:\\Workspace\\Docs\\guide.md',
                isDir: false,
                isMarkdown: true,
              },
            ],
          },
          {
            name: 'README.md',
            path: 'C:\\Workspace\\README.md',
            isDir: false,
            isMarkdown: true,
          },
        ],
      };

      explorer.setTree(tree, true);

      expect(fileTreeEl.getAttribute('role')).toBe('tree');

      const docsSummary = fileTreeEl.querySelector<HTMLElement>(
        'summary[data-entryname="Docs"]',
      )!;
      const nestedSummary = fileTreeEl.querySelector<HTMLElement>(
        'summary[data-entryname="Nested"]',
      )!;
      const deepBtn = fileTreeEl.querySelector<HTMLElement>(
        'button[data-entryname="deep.md"]',
      )!;
      const guideBtn = fileTreeEl.querySelector<HTMLElement>(
        'button[data-entryname="guide.md"]',
      )!;
      const readmeBtn = fileTreeEl.querySelector<HTMLElement>(
        'button[data-entryname="README.md"]',
      )!;

      // Roles and initial aria-expanded (depth 0 open, depth 1 closed)
      expect(docsSummary.getAttribute('role')).toBe('treeitem');
      expect(docsSummary.getAttribute('aria-expanded')).toBe('true');
      expect(nestedSummary.getAttribute('role')).toBe('treeitem');
      expect(nestedSummary.getAttribute('aria-expanded')).toBe('false');
      expect(readmeBtn.getAttribute('role')).toBe('treeitem');

      // Roving tabindex: first visible item has tabIndex 0, others -1
      expect(docsSummary.tabIndex).toBe(0);
      expect(nestedSummary.tabIndex).toBe(-1);
      expect(guideBtn.tabIndex).toBe(-1);
      expect(readmeBtn.tabIndex).toBe(-1);

      const pressKey = (key: string) => {
        const target = document.activeElement as HTMLElement;
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      };

      docsSummary.focus();
      expect(document.activeElement).toBe(docsSummary);

      // ArrowDown moves to Nested (first visible child of Docs)
      pressKey('ArrowDown');
      expect(document.activeElement).toBe(nestedSummary);
      expect(nestedSummary.tabIndex).toBe(0);
      expect(docsSummary.tabIndex).toBe(-1);

      // ArrowDown skips deep.md because Nested is collapsed, lands on guide.md
      pressKey('ArrowDown');
      expect(document.activeElement).toBe(guideBtn);

      // End jumps to last visible item (README.md)
      pressKey('End');
      expect(document.activeElement).toBe(readmeBtn);

      // Home jumps back to first visible item (Docs)
      pressKey('Home');
      expect(document.activeElement).toBe(docsSummary);

      // ArrowDown to Nested, then ArrowRight expands Nested without moving focus
      pressKey('ArrowDown');
      expect(document.activeElement).toBe(nestedSummary);
      pressKey('ArrowRight');
      expect((nestedSummary.parentElement as HTMLDetailsElement).open).toBe(true);
      expect(nestedSummary.getAttribute('aria-expanded')).toBe('true');
      expect(document.activeElement).toBe(nestedSummary);

      // Second ArrowRight moves into first child (deep.md)
      pressKey('ArrowRight');
      expect(document.activeElement).toBe(deepBtn);

      // ArrowLeft from file moves focus to parent folder (Nested)
      pressKey('ArrowLeft');
      expect(document.activeElement).toBe(nestedSummary);

      // ArrowLeft on expanded folder collapses it
      pressKey('ArrowLeft');
      expect((nestedSummary.parentElement as HTMLDetailsElement).open).toBe(false);
      expect(nestedSummary.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(nestedSummary);

      // ArrowLeft on collapsed folder moves focus to parent folder (Docs)
      pressKey('ArrowLeft');
      expect(document.activeElement).toBe(docsSummary);

      // ArrowUp at top stays on Docs
      pressKey('ArrowUp');
      expect(document.activeElement).toBe(docsSummary);
    } finally {
      fileTreeEl.remove();
    }
  });

  it('collapses all folders via collapseAll() and #btn-collapse-all button', () => {
    const fileTreeEl = document.createElement('div');
    const workspaceTitleEl = document.createElement('span');
    const contextPopoverEl = document.createElement('div');
    const collapseBtn = document.createElement('button');
    collapseBtn.id = 'btn-collapse-all';
    collapseBtn.hidden = true;
    document.body.append(fileTreeEl, collapseBtn);

    try {
      const explorer = new SidebarExplorerController({
        fileTreeEl,
        workspaceTitleEl,
        contextPopoverEl,
        getActiveFilePath: () => null,
        onOpenFilePath: vi.fn(),
        onOpenCreatedFile: vi.fn(),
        onTriggerOpenFolderDialog: vi.fn(),
        onWorkspaceFolderLoaded: vi.fn(),
        onEntryRenamed: vi.fn(),
        onEntryDeleted: vi.fn(),
      });

      explorer.setTree({
        name: 'Workspace',
        path: 'C:\\Workspace',
        isDir: true,
        isMarkdown: false,
        children: [
          {
            name: 'Docs',
            path: 'C:\\Workspace\\Docs',
            isDir: true,
            isMarkdown: false,
            children: [
              {
                name: 'Sub',
                path: 'C:\\Workspace\\Docs\\Sub',
                isDir: true,
                isMarkdown: false,
                children: [
                  {
                    name: 'a.md',
                    path: 'C:\\Workspace\\Docs\\Sub\\a.md',
                    isDir: false,
                    isMarkdown: true,
                  },
                ],
              },
            ],
          },
        ],
      });

      expect(collapseBtn.hidden).toBe(false);

      const details = fileTreeEl.querySelectorAll<HTMLDetailsElement>('details.tree-dir-details');
      details[1].open = true;
      details[1].querySelector('summary')?.setAttribute('aria-expanded', 'true');

      // Focus deep child before collapsing all
      const fileBtn = fileTreeEl.querySelector<HTMLElement>('button[data-filepath]')!;
      fileBtn.focus();

      collapseBtn.click();

      for (const d of details) {
        expect(d.open).toBe(false);
        expect(d.querySelector(':scope > summary')?.getAttribute('aria-expanded')).toBe('false');
      }

      // Focus moves to outermost visible parent summary so it isn't trapped in collapsed subtree
      const topSummary = details[0].querySelector<HTMLElement>(':scope > summary')!;
      expect(document.activeElement).toBe(topSummary);
      expect(topSummary.tabIndex).toBe(0);

      explorer.clearWorkspace([], []);
      expect(collapseBtn.hidden).toBe(true);
      expect(fileTreeEl.hasAttribute('role')).toBe(false);
    } finally {
      fileTreeEl.remove();
      collapseBtn.remove();
    }
  });
});
