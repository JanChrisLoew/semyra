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
      onOpenSearchPanel: noop,
      onOpenOutlinePanel: noop,
      onToggleZen: noop,
      onToggleTheme: noop,
      onRevealInExplorer: noop,
      onShowShortcuts: noop,
    });

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
});
