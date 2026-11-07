import { describe, expect, it, vi } from 'vitest';
import { buildPaletteCommandItems, buildPaletteFileItems } from '../palette-items';

describe('palette-items', () => {
  it('deduplicates open tabs, workspace files, recent files, and active workspace folder', async () => {
    const items = await buildPaletteFileItems({
      tabs: [
        { id: 't1', name: 'README.md', path: 'C:\\Projekte\\MarkLive\\README.md' },
        { id: 't2', name: 'Unbenannt-1.md', path: null },
      ],
      activeTabId: 't1',
      workspaceRootPath: 'C:\\Projekte\\MarkLive',
      getWorkspaceFiles: async () => [
        {
          name: 'README.md',
          path: 'c:\\projekte\\marklive\\readme.md', // case-insensitive duplicate of open tab
          relPath: 'README.md',
        },
        {
          name: 'AGENTS.md',
          path: 'C:\\Projekte\\MarkLive\\AGENTS.md',
          relPath: 'AGENTS.md',
        },
      ],
      recentFiles: [
        'C:\\Projekte\\MarkLive\\AGENTS.md', // duplicate of workspace file
        'C:\\Archiv\\Notiz.md',
      ],
      recentFolders: [
        'c:\\projekte\\marklive', // currently active workspace -> omitted
        'C:\\Archiv',
      ],
      onActivateTab: vi.fn(),
      onOpenFile: vi.fn(),
      onOpenFolder: vi.fn(),
    });

    expect(items.map((i) => i.id)).toEqual([
      'tab:t1',
      'tab:t2',
      'ws:C:\\Projekte\\MarkLive\\AGENTS.md',
      'recent:C:\\Archiv\\Notiz.md',
      'folder:C:\\Archiv',
    ]);
    expect(items[0].badge).toBe('Aktiv');
    expect(items[1].badge).toBe('Geöffnet');
  });

  it('reflects dynamic editor/document states in German command labels and badges', () => {
    const noop = vi.fn();
    const onSearch = vi.fn();
    const cmds = buildPaletteCommandItems({
      wordWrapActive: true,
      spellcheckActive: false,
      syncScrollActive: true,
      autoSaveActive: false,
      currentLineEnding: 'LF',
      onNewTab: noop,
      onOpenFileDialog: noop,
      onOpenFolderDialog: noop,
      onSave: noop,
      onSaveAs: noop,
      onCopyRichText: noop,
      onExportHtml: noop,
      onExportPdf: noop,
      onPrint: noop,
      onAlignTable: noop,
      onSetViewMode: noop,
      onToggleWordWrap: noop,
      onToggleSpellcheck: noop,
      onToggleSyncScroll: noop,
      onToggleAutoSave: noop,
      onToggleLineEnding: noop,
      onZoomDelta: noop,
      onZoomReset: noop,
      onOpenEditorSearch: onSearch,
      onOpenSearchPanel: noop,
      onOpenOutlinePanel: noop,
      onToggleZen: noop,
      onToggleTheme: noop,
      onRevealInExplorer: noop,
      onShowShortcuts: noop,
    });

    const searchCmd = cmds.find((c) => c.id === 'cmd:editor-search')!;
    expect(searchCmd).toBeDefined();
    expect(searchCmd.shortcut).toBe('Strg+F');
    expect(searchCmd.label).toContain('Im Dokument suchen');
    searchCmd.run();
    expect(onSearch).toHaveBeenCalledTimes(1);

    const wrapCmd = cmds.find((c) => c.id === 'cmd:toggle-wrap')!;
    expect(wrapCmd.label).toContain('deaktivieren');
    expect(wrapCmd.badge).toBe('Aktiv');

    const spellCmd = cmds.find((c) => c.id === 'cmd:toggle-spellcheck')!;
    expect(spellCmd.label).toContain('aktivieren');
    expect(spellCmd.badge).toBe('Aus');

    const eolCmd = cmds.find((c) => c.id === 'cmd:toggle-eol')!;
    expect(eolCmd.label).toContain('CRLF (Windows)');
    expect(eolCmd.badge).toBe('LF');
  });

  it('provides tab navigation and reopen commands when optional callbacks are supplied', () => {
    const onReopen = vi.fn();
    const onNext = vi.fn();
    const onPrev = vi.fn();
    const noop = vi.fn();

    const cmds = buildPaletteCommandItems({
      wordWrapActive: false,
      spellcheckActive: false,
      syncScrollActive: false,
      autoSaveActive: false,
      currentLineEnding: 'LF',
      onNewTab: noop,
      onOpenFileDialog: noop,
      onOpenFolderDialog: noop,
      onSave: noop,
      onSaveAs: noop,
      onCopyRichText: noop,
      onExportHtml: noop,
      onExportPdf: noop,
      onPrint: noop,
      onAlignTable: noop,
      onSetViewMode: noop,
      onToggleWordWrap: noop,
      onToggleSpellcheck: noop,
      onToggleSyncScroll: noop,
      onToggleAutoSave: noop,
      onToggleLineEnding: noop,
      onZoomDelta: noop,
      onZoomReset: noop,
      onOpenEditorSearch: noop,
      onOpenSearchPanel: noop,
      onOpenOutlinePanel: noop,
      onToggleZen: noop,
      onToggleTheme: noop,
      onRevealInExplorer: noop,
      onShowShortcuts: noop,
      onReopenTab: onReopen,
      onNextTab: onNext,
      onPrevTab: onPrev,
    });

    const reopenCmd = cmds.find((c) => c.id === 'cmd:reopen-tab');
    expect(reopenCmd).toBeDefined();
    expect(reopenCmd?.shortcut).toBe('Strg+Umschalt+T');
    reopenCmd?.run();
    expect(onReopen).toHaveBeenCalledTimes(1);

    const nextCmd = cmds.find((c) => c.id === 'cmd:next-tab');
    expect(nextCmd).toBeDefined();
    expect(nextCmd?.shortcut).toBe('Strg+BildAb');
    nextCmd?.run();
    expect(onNext).toHaveBeenCalledTimes(1);

    const prevCmd = cmds.find((c) => c.id === 'cmd:prev-tab');
    expect(prevCmd).toBeDefined();
    expect(prevCmd?.shortcut).toBe('Strg+BildAuf');
    prevCmd?.run();
    expect(onPrev).toHaveBeenCalledTimes(1);
  });
});
