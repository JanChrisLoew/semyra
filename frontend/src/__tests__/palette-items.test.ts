import { describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n';
import { buildPaletteCommandItems, buildPaletteFileItems, buildPaletteHeadingItems } from '../palette-items';

describe('palette-items', () => {
  it('deduplicates open tabs, workspace files, recent files, and active workspace folder', async () => {
    const items = await buildPaletteFileItems({
      tabs: [
        { id: 't1', name: 'README.md', path: 'C:\\Projekte\\Semyra\\README.md' },
        { id: 't2', name: 'Unbenannt-1.md', path: null },
      ],
      activeTabId: 't1',
      workspaceRootPath: 'C:\\Projekte\\Semyra',
      getWorkspaceFiles: async () => [
        {
          name: 'README.md',
          path: 'c:\\projekte\\semyra\\readme.md', // case-insensitive duplicate of open tab
          relPath: 'README.md',
        },
        {
          name: 'AGENTS.md',
          path: 'C:\\Projekte\\Semyra\\AGENTS.md',
          relPath: 'AGENTS.md',
        },
      ],
      recentFiles: [
        'C:\\Projekte\\Semyra\\AGENTS.md', // duplicate of workspace file
        'C:\\Archiv\\Notiz.md',
      ],
      recentFolders: [
        'c:\\projekte\\semyra', // currently active workspace -> omitted
        'C:\\Archiv',
      ],
      onActivateTab: vi.fn(),
      onOpenFile: vi.fn(),
      onOpenFolder: vi.fn(),
    });

    expect(items.map((i) => i.id)).toEqual([
      'tab:t1',
      'tab:t2',
      'ws:C:\\Projekte\\Semyra\\AGENTS.md',
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

    const syncScrollCmd = cmds.find((c) => c.id === 'cmd:toggle-sync-scroll');
    expect(syncScrollCmd?.shortcut).toBe('Alt+Umschalt+Y');

    const autoSaveCmd = cmds.find((c) => c.id === 'cmd:toggle-autosave');
    expect(autoSaveCmd?.shortcut).toBe('Alt+Umschalt+A');

    const themeCmd = cmds.find((c) => c.id === 'cmd:theme');
    expect(themeCmd?.shortcut).toBe('Alt+Umschalt+T');

    const exportHtmlCmd = cmds.find((c) => c.id === 'cmd:export-html');
    expect(exportHtmlCmd?.shortcut).toBe('Strg+Umschalt+H');
  });

  it('provides tab navigation, markdown copy, and AI context commands when optional callbacks are supplied', () => {
    const onReopen = vi.fn();
    const onNext = vi.fn();
    const onPrev = vi.fn();
    const onToggle = vi.fn();
    const onCopyMd = vi.fn();
    const onCopyAi = vi.fn();
    const onInsertRowAbove = vi.fn();
    const onInsertColLeft = vi.fn();
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
      onToggleTask: onToggle,
      onCopyMarkdown: onCopyMd,
      onCopyAiContext: onCopyAi,
      onInsertTableRowAbove: onInsertRowAbove,
      onInsertTableColumnLeft: onInsertColLeft,
      onToggleSplitOrientation: vi.fn(),
      onShowDocStats: vi.fn(),
      splitOrientation: 'vertical',
    });

    const copyMdCmd = cmds.find((c) => c.id === 'cmd:copy-markdown');
    expect(copyMdCmd).toBeDefined();
    expect(copyMdCmd?.shortcut).toBe('Strg+Umschalt+C');
    copyMdCmd?.run();
    expect(onCopyMd).toHaveBeenCalledTimes(1);

    const copyAiCmd = cmds.find((c) => c.id === 'cmd:copy-ai-context');
    expect(copyAiCmd).toBeDefined();
    expect(copyAiCmd?.label).toContain('KI-Kontext');
    expect(copyAiCmd?.shortcut).toBe('Strg+Umschalt+A');
    copyAiCmd?.run();
    expect(onCopyAi).toHaveBeenCalledTimes(1);

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

    const taskCmd = cmds.find((c) => c.id === 'cmd:toggle-task');
    expect(taskCmd).toBeDefined();
    expect(taskCmd?.shortcut).toBe('Alt+C');
    taskCmd?.run();
    expect(onToggle).toHaveBeenCalledTimes(1);

    const rowAboveCmd = cmds.find((c) => c.id === 'cmd:table-row-above');
    expect(rowAboveCmd).toBeDefined();
    expect(rowAboveCmd?.label).toContain('Zeile oberhalb');
    rowAboveCmd?.run();
    expect(onInsertRowAbove).toHaveBeenCalledTimes(1);

    const colLeftCmd = cmds.find((c) => c.id === 'cmd:table-col-left');
    expect(colLeftCmd).toBeDefined();
    expect(colLeftCmd?.label).toContain('Spalte links');
    colLeftCmd?.run();
    expect(onInsertColLeft).toHaveBeenCalledTimes(1);

    const splitCmd = cmds.find((c) => c.id === 'cmd:toggle-split-orientation');
    expect(splitCmd).toBeDefined();
    expect(splitCmd?.shortcut).toBe('Alt+Umschalt+S');
    expect(splitCmd?.label).toContain('Zu horizontaler Teilung');

    const statsCmd = cmds.find((c) => c.id === 'cmd:show-doc-stats');
    expect(statsCmd).toBeDefined();
    expect(statsCmd?.label).toContain('Detaillierte Statistiken');
  });

  it('localizes command labels, badges, and shortcuts in English', () => {
    setLanguage('en', false);
    const noop = () => {};
    const cmds = buildPaletteCommandItems({
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
      wordWrapActive: true,
      onToggleWordWrap: noop,
      spellcheckActive: false,
      onToggleSpellcheck: noop,
      syncScrollActive: true,
      onToggleSyncScroll: noop,
      autoSaveActive: false,
      onToggleAutoSave: noop,
      currentLineEnding: 'CRLF',
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

    const syncScrollCmd = cmds.find((c) => c.id === 'cmd:toggle-sync-scroll')!;
    expect(syncScrollCmd.shortcut).toBe('Alt+Shift+Y');
    expect(syncScrollCmd.badge).toBe('Active');

    const autoSaveCmd = cmds.find((c) => c.id === 'cmd:toggle-autosave')!;
    expect(autoSaveCmd.shortcut).toBe('Alt+Shift+A');
    expect(autoSaveCmd.badge).toBe('Off');

    const saveCmd = cmds.find((c) => c.id === 'cmd:save')!;
    expect(saveCmd.shortcut).toBe('Ctrl+S');
    expect(saveCmd.label).toBe('File: Save');

    setLanguage('de', false);
  });

  it('builds localized heading-jump items and invokes onJumpToLine', () => {
    const onJumpToLine = vi.fn();
    setLanguage('de', false);
    const deItems = buildPaletteHeadingItems({
      headings: [
        { level: 1, text: 'Überblick', line: 3 },
        { level: 2, text: 'Architektur', line: 24 },
      ],
      onJumpToLine,
    });

    expect(deItems).toHaveLength(2);
    expect(deItems[0]).toMatchObject({
      id: 'heading:3:0',
      kind: 'heading',
      label: 'Überblick',
      subtitle: 'Zeile 3',
      badge: 'H1',
    });
    deItems[1].run();
    expect(onJumpToLine).toHaveBeenCalledWith(24);

    setLanguage('en', false);
    const enItems = buildPaletteHeadingItems({
      headings: [{ level: 3, text: 'Details', line: 42 }],
      onJumpToLine,
    });
    expect(enItems[0].subtitle).toBe('Line 42');
    expect(enItems[0].badge).toBe('H3');

    setLanguage('de', false);
  });

  it('includes workspace scaffolding commands when callbacks are provided', () => {
    const noop = vi.fn();
    const onScaffoldAgents = vi.fn();
    const onScaffoldSkill = vi.fn();

    setLanguage('de', false);
    const deCmds = buildPaletteCommandItems({
      wordWrapActive: false,
      spellcheckActive: false,
      syncScrollActive: false,
      autoSaveActive: false,
      currentLineEnding: 'CRLF',
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
      onScaffoldWorkspaceAgents: onScaffoldAgents,
      onScaffoldWorkspaceSkill: onScaffoldSkill,
    });

    const agentsDe = deCmds.find((c) => c.id === 'cmd:scaffold-workspace-agents')!;
    const skillDe = deCmds.find((c) => c.id === 'cmd:scaffold-workspace-skill')!;
    expect(agentsDe).toBeDefined();
    expect(agentsDe.label).toContain('AGENTS.md');
    expect(skillDe).toBeDefined();
    expect(skillDe.label).toContain('Workspace-Skill');

    agentsDe.run();
    skillDe.run();
    expect(onScaffoldAgents).toHaveBeenCalledTimes(1);
    expect(onScaffoldSkill).toHaveBeenCalledTimes(1);

    setLanguage('en', false);
    const enCmds = buildPaletteCommandItems({
      wordWrapActive: false,
      spellcheckActive: false,
      syncScrollActive: false,
      autoSaveActive: false,
      currentLineEnding: 'CRLF',
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
      onScaffoldWorkspaceAgents: onScaffoldAgents,
      onScaffoldWorkspaceSkill: onScaffoldSkill,
    });
    expect(enCmds.find((c) => c.id === 'cmd:scaffold-workspace-agents')?.label).toBe(
      'Workspace: Create AGENTS.md',
    );
    expect(enCmds.find((c) => c.id === 'cmd:scaffold-workspace-skill')?.label).toBe(
      'Workspace: Create Workspace Skill (.agents/skills/…)',
    );
    setLanguage('de', false);
  });

  it('provides themed HTML export and diff comparison commands when callbacks are supplied', () => {
    setLanguage('de', false);
    const noop = vi.fn();
    const onExportHtmlLight = vi.fn();
    const onExportHtmlDark = vi.fn();
    const onDiffWithSaved = vi.fn();
    const onCompareOpenTabs = vi.fn();

    const cmds = buildPaletteCommandItems({
      wordWrapActive: false,
      spellcheckActive: false,
      syncScrollActive: false,
      autoSaveActive: false,
      currentLineEnding: 'CRLF',
      onNewTab: noop,
      onOpenFileDialog: noop,
      onOpenFolderDialog: noop,
      onSave: noop,
      onSaveAs: noop,
      onCopyRichText: noop,
      onExportHtml: noop,
      onExportHtmlLight,
      onExportHtmlDark,
      onExportPdf: noop,
      onDiffWithSaved,
      onCompareOpenTabs,
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

    const lightCmd = cmds.find((c) => c.id === 'cmd:export-html-light');
    const darkCmd = cmds.find((c) => c.id === 'cmd:export-html-dark');
    const diffSavedCmd = cmds.find((c) => c.id === 'cmd:diff-with-saved');
    const compareTabsCmd = cmds.find((c) => c.id === 'cmd:compare-open-tabs');

    expect(lightCmd?.label).toContain('(Hell)');
    expect(darkCmd?.label).toContain('(Dunkel)');
    expect(diffSavedCmd?.label).toContain('Mit gespeichertem Stand vergleichen');
    expect(compareTabsCmd?.label).toContain('Offene Tabs vergleichen');

    lightCmd?.run();
    darkCmd?.run();
    diffSavedCmd?.run();
    compareTabsCmd?.run();

    expect(onExportHtmlLight).toHaveBeenCalledTimes(1);
    expect(onExportHtmlDark).toHaveBeenCalledTimes(1);
    expect(onDiffWithSaved).toHaveBeenCalledTimes(1);
    expect(onCompareOpenTabs).toHaveBeenCalledTimes(1);
  });
});
