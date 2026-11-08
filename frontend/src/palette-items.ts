import { WorkspaceFileEntry } from './api';
import { PaletteItem } from './palette';
import { baseNameOfPath } from './path-utils';
import { getLanguage } from './i18n';

export interface PaletteTabSummary {
  id: string;
  name: string;
  path: string | null;
}

export interface PaletteFileContext {
  tabs: PaletteTabSummary[];
  activeTabId: string;
  workspaceRootPath: string | null;
  getWorkspaceFiles: () => Promise<WorkspaceFileEntry[]>;
  recentFiles: string[];
  recentFolders: string[];
  onActivateTab: (tabId: string) => void;
  onOpenFile: (filePath: string) => Promise<void> | void;
  onOpenFolder: (folderPath: string) => Promise<void> | void;
}

export interface PaletteCommandContext {
  wordWrapActive: boolean;
  spellcheckActive: boolean;
  syncScrollActive: boolean;
  autoSaveActive: boolean;
  currentLineEnding: 'CRLF' | 'LF';
  onNewTab: () => void;
  onOpenFileDialog: () => Promise<void> | void;
  onOpenFolderDialog: () => Promise<void> | void;
  onSave: () => void;
  onSaveAs: () => void;
  onCopyRichText: () => void;
  onExportHtml: () => void;
  onExportPdf: () => void;
  onPrint: () => void;
  onAlignTable: () => void;
  onSetViewMode: (mode: 'editor' | 'split' | 'preview') => void;
  onToggleWordWrap: () => void;
  onToggleSpellcheck: () => void;
  onToggleSyncScroll: () => void;
  onToggleAutoSave: () => void;
  onToggleLineEnding: () => void;
  onZoomDelta: (delta: number) => void;
  onZoomReset: () => void;
  onOpenEditorSearch?: () => void;
  onOpenEditorReplace?: () => void;
  onOpenSearchPanel: () => void;
  onOpenOutlinePanel: () => void;
  onToggleZen: () => void;
  onToggleTheme: () => void;
  onRevealInExplorer: () => void;
  onShowShortcuts: () => void;
  onReopenTab?: () => void;
  onNextTab?: () => void;
  onPrevTab?: () => void;
  onToggleTask?: () => void;
  onCopyMarkdown?: () => void;
  onCopyAiContext?: () => void;
  onInsertTableRowAbove?: () => void;
  onInsertTableRowBelow?: () => void;
  onDeleteTableRow?: () => void;
  onInsertTableColumnLeft?: () => void;
  onInsertTableColumnRight?: () => void;
  onDeleteTableColumn?: () => void;
  onToggleSplitOrientation?: () => void;
  onToggleCenteredEditor?: () => void;
  centeredEditorActive?: boolean;
  onShowDocStats?: () => void;
  onToggleFormatBar?: () => void;
  onScrollPreviewTop?: () => void;
  formatBarVisible?: boolean;
  splitOrientation?: 'vertical' | 'horizontal';
  onOpenSettings?: () => void;
}

export async function buildPaletteFileItems(ctx: PaletteFileContext): Promise<PaletteItem[]> {
  const isEn = getLanguage() === 'en';
  const items: PaletteItem[] = [];
  const seenPaths = new Set<string>();

  for (const tab of ctx.tabs) {
    if (tab.path) {
      seenPaths.add(tab.path.toLowerCase());
    }
    items.push({
      id: `tab:${tab.id}`,
      kind: 'tab',
      label: tab.name,
      subtitle: tab.path ?? (isEn ? 'Unsaved Tab' : 'Ungespeicherter Tab'),
      badge: tab.id === ctx.activeTabId ? (isEn ? 'Active' : 'Aktiv') : (isEn ? 'Open' : 'Geöffnet'),
      run: () => ctx.onActivateTab(tab.id),
    });
  }

  if (ctx.workspaceRootPath) {
    const wsFiles = await ctx.getWorkspaceFiles();
    for (const f of wsFiles) {
      const lower = f.path.toLowerCase();
      if (seenPaths.has(lower)) continue;
      seenPaths.add(lower);
      items.push({
        id: `ws:${f.path}`,
        kind: 'file',
        label: f.name,
        subtitle: f.relPath,
        badge: isEn ? 'Workspace' : 'Arbeitsordner',
        run: () => ctx.onOpenFile(f.path),
      });
    }
  }

  for (const recentPath of ctx.recentFiles) {
    const lower = recentPath.toLowerCase();
    if (seenPaths.has(lower)) continue;
    seenPaths.add(lower);
    items.push({
      id: `recent:${recentPath}`,
      kind: 'recent',
      label: baseNameOfPath(recentPath),
      subtitle: recentPath,
      badge: isEn ? 'Recent' : 'Zuletzt geöffnet',
      run: () => ctx.onOpenFile(recentPath),
    });
  }

  for (const folderPath of ctx.recentFolders) {
    if (ctx.workspaceRootPath?.toLowerCase() === folderPath.toLowerCase()) continue;
    items.push({
      id: `folder:${folderPath}`,
      kind: 'folder',
      label: baseNameOfPath(folderPath),
      subtitle: folderPath,
      badge: isEn ? 'Folder History' : 'Ordnerverlauf',
      run: () => ctx.onOpenFolder(folderPath),
    });
  }

  return items;
}

export function buildPaletteCommandItems(ctx: PaletteCommandContext): PaletteItem[] {
  const isEn = getLanguage() === 'en';
  return [
    {
      id: 'cmd:new-tab',
      kind: 'command',
      label: isEn ? 'File: New Markdown Document' : 'Datei: Neues Markdown-Dokument',
      shortcut: isEn ? 'Ctrl+N' : 'Strg+N',
      run: ctx.onNewTab,
    },
    {
      id: 'cmd:open-file',
      kind: 'command',
      label: isEn ? 'File: Open Markdown File…' : 'Datei: Markdown-Datei öffnen…',
      shortcut: isEn ? 'Ctrl+O' : 'Strg+O',
      run: ctx.onOpenFileDialog,
    },
    {
      id: 'cmd:open-folder',
      kind: 'command',
      label: isEn ? 'Workspace: Open Folder…' : 'Arbeitsbereich: Ordner öffnen…',
      shortcut: isEn ? 'Ctrl+Shift+O' : 'Strg+Umschalt+O',
      run: ctx.onOpenFolderDialog,
    },
    ...(ctx.onReopenTab
      ? [
          {
            id: 'cmd:reopen-tab',
            kind: 'command' as const,
            label: isEn ? 'Tab: Reopen Closed Tab' : 'Tab: Zuletzt geschlossenen Tab wiederherstellen',
            shortcut: isEn ? 'Ctrl+Shift+T' : 'Strg+Umschalt+T',
            run: ctx.onReopenTab,
          },
        ]
      : []),
    ...(ctx.onNextTab
      ? [
          {
            id: 'cmd:next-tab',
            kind: 'command' as const,
            label: isEn ? 'Tab: Switch to Next Tab' : 'Tab: Zum nächsten Tab wechseln',
            shortcut: isEn ? 'Ctrl+PageDown' : 'Strg+BildAb',
            run: ctx.onNextTab,
          },
        ]
      : []),
    ...(ctx.onPrevTab
      ? [
          {
            id: 'cmd:prev-tab',
            kind: 'command' as const,
            label: isEn ? 'Tab: Switch to Previous Tab' : 'Tab: Zum vorherigen Tab wechseln',
            shortcut: isEn ? 'Ctrl+PageUp' : 'Strg+BildAuf',
            run: ctx.onPrevTab,
          },
        ]
      : []),
    {
      id: 'cmd:save',
      kind: 'command',
      label: isEn ? 'File: Save' : 'Datei: Speichern',
      shortcut: isEn ? 'Ctrl+S' : 'Strg+S',
      run: ctx.onSave,
    },
    {
      id: 'cmd:save-as',
      kind: 'command',
      label: isEn ? 'File: Save As…' : 'Datei: Speichern unter…',
      shortcut: isEn ? 'Ctrl+Shift+S' : 'Strg+Umschalt+S',
      run: ctx.onSaveAs,
    },
    ...(ctx.onCopyMarkdown
      ? [
          {
            id: 'cmd:copy-markdown',
            kind: 'command' as const,
            label: isEn ? 'Clipboard: Copy Markdown Source' : 'Zwischenablage: Markdown-Quelltext kopieren',
            shortcut: isEn ? 'Ctrl+Shift+C' : 'Strg+Umschalt+C',
            run: ctx.onCopyMarkdown,
          },
        ]
      : []),
    ...(ctx.onCopyAiContext
      ? [
          {
            id: 'cmd:copy-ai-context',
            kind: 'command' as const,
            label: isEn ? 'Clipboard: Copy for AI Context (with File Header)' : 'Zwischenablage: Als KI-Kontext kopieren (mit Dateinamen-Block)',
            shortcut: isEn ? 'Ctrl+Shift+A' : 'Strg+Umschalt+A',
            run: ctx.onCopyAiContext,
          },
        ]
      : []),
    {
      id: 'cmd:copy-rich',
      kind: 'command',
      label: isEn ? 'Clipboard: Copy Formatted Text (Word, Teams, Outlook)' : 'Zwischenablage: Als formatierten Text kopieren (Word, Teams, Outlook)',
      shortcut: isEn ? 'Ctrl+Shift+K' : 'Strg+Umschalt+K',
      run: ctx.onCopyRichText,
    },
    {
      id: 'cmd:export-html',
      kind: 'command',
      label: isEn ? 'Export: Standalone 1-File HTML…' : 'Export: Als eigenständige 1-Datei-HTML exportieren…',
      shortcut: isEn ? 'Ctrl+Shift+H' : 'Strg+Umschalt+H',
      run: ctx.onExportHtml,
    },
    {
      id: 'cmd:export-pdf',
      kind: 'command',
      label: isEn ? 'Export: Directly Export as PDF Document…' : 'Export: Direkt als PDF-Datei exportieren…',
      shortcut: isEn ? 'Ctrl+Shift+D' : 'Strg+Umschalt+D',
      run: ctx.onExportPdf,
    },
    {
      id: 'cmd:print',
      kind: 'command',
      label: isEn ? 'Export: Print…' : 'Export: Drucken…',
      shortcut: isEn ? 'Ctrl+P' : 'Strg+P',
      run: ctx.onPrint,
    },
    {
      id: 'cmd:align-table',
      kind: 'command',
      label: isEn ? 'Table: Format & Align Markdown Table' : 'Tabelle: Markdown-Tabelle ausrichten',
      shortcut: isEn ? 'Alt+Shift+F' : 'Alt+Umschalt+F',
      run: ctx.onAlignTable,
    },
    ...(ctx.onInsertTableRowAbove
      ? [
          {
            id: 'cmd:table-row-above',
            kind: 'command' as const,
            label: isEn ? 'Table: Insert Row Above' : 'Tabelle: Zeile oberhalb einfügen',
            run: ctx.onInsertTableRowAbove,
          },
        ]
      : []),
    ...(ctx.onInsertTableRowBelow
      ? [
          {
            id: 'cmd:table-row-below',
            kind: 'command' as const,
            label: isEn ? 'Table: Insert Row Below' : 'Tabelle: Zeile unterhalb einfügen',
            run: ctx.onInsertTableRowBelow,
          },
        ]
      : []),
    ...(ctx.onDeleteTableRow
      ? [
          {
            id: 'cmd:table-delete-row',
            kind: 'command' as const,
            label: isEn ? 'Table: Delete Current Row' : 'Tabelle: Aktuelle Zeile löschen',
            run: ctx.onDeleteTableRow,
          },
        ]
      : []),
    ...(ctx.onInsertTableColumnLeft
      ? [
          {
            id: 'cmd:table-col-left',
            kind: 'command' as const,
            label: isEn ? 'Table: Insert Column Left' : 'Tabelle: Spalte links einfügen',
            run: ctx.onInsertTableColumnLeft,
          },
        ]
      : []),
    ...(ctx.onInsertTableColumnRight
      ? [
          {
            id: 'cmd:table-col-right',
            kind: 'command' as const,
            label: isEn ? 'Table: Insert Column Right' : 'Tabelle: Spalte rechts einfügen',
            run: ctx.onInsertTableColumnRight,
          },
        ]
      : []),
    ...(ctx.onDeleteTableColumn
      ? [
          {
            id: 'cmd:table-delete-col',
            kind: 'command' as const,
            label: isEn ? 'Table: Delete Current Column' : 'Tabelle: Aktuelle Spalte löschen',
            run: ctx.onDeleteTableColumn,
          },
        ]
      : []),
    ...(ctx.onToggleTask
      ? [
          {
            id: 'cmd:toggle-task',
            kind: 'command' as const,
            label: isEn ? 'Editor: Toggle Task Checkbox' : 'Editor: Aufgabe der Zeile an-/abhaken',
            shortcut: 'Alt+C',
            run: ctx.onToggleTask,
          },
        ]
      : []),
    {
      id: 'cmd:view-split',
      kind: 'command',
      label: isEn ? 'View: Split View (Editor & Live Preview)' : 'Ansicht: Split-Vorschau (Editor & Live-Vorschau)',
      shortcut: 'Alt+2',
      run: () => ctx.onSetViewMode('split'),
    },
    {
      id: 'cmd:view-editor',
      kind: 'command',
      label: isEn ? 'View: Editor Only' : 'Ansicht: Nur Editor',
      shortcut: 'Alt+1',
      run: () => ctx.onSetViewMode('editor'),
    },
    {
      id: 'cmd:view-preview',
      kind: 'command',
      label: isEn ? 'View: Preview Only' : 'Ansicht: Nur Lese-Vorschau',
      shortcut: 'Alt+3',
      run: () => ctx.onSetViewMode('preview'),
    },
    ...(ctx.onToggleSplitOrientation
      ? [
          {
            id: 'cmd:toggle-split-orientation',
            kind: 'command' as const,
            label: isEn
              ? `View: Rotate Split View (${ctx.splitOrientation === 'horizontal' ? 'To Vertical' : 'To Horizontal'})`
              : `Ansicht: Geteilte Ansicht drehen (${ctx.splitOrientation === 'horizontal' ? 'Zu vertikaler Teilung' : 'Zu horizontaler Teilung'})`,
            shortcut: isEn ? 'Alt+Shift+S' : 'Alt+Umschalt+S',
            run: () => ctx.onToggleSplitOrientation?.(),
          },
        ]
      : []),
    ...(ctx.onToggleCenteredEditor
      ? [
          {
            id: 'cmd:toggle-centered-editor',
            kind: 'command' as const,
            label: isEn
              ? `Editor: ${ctx.centeredEditorActive ? 'Use Full Width' : 'Centered Text Column'}`
              : `Editor: ${ctx.centeredEditorActive ? 'Volle Breite nutzen' : 'Zentrierte Textspalte'}`,
            badge: isEn
              ? (ctx.centeredEditorActive ? 'Centered' : 'Full Width')
              : (ctx.centeredEditorActive ? 'Zentriert' : 'Volle Breite'),
            shortcut: isEn ? 'Alt+Shift+B' : 'Alt+Umschalt+B',
            run: () => ctx.onToggleCenteredEditor?.(),
          },
        ]
      : []),
    ...(ctx.onShowDocStats
      ? [
          {
            id: 'cmd:show-doc-stats',
            kind: 'command' as const,
            label: isEn ? 'Document: Show Statistics & Readability' : 'Dokument: Detaillierte Statistiken & Lesbarkeit anzeigen',
            run: () => ctx.onShowDocStats?.(),
          },
        ]
      : []),
    ...(ctx.onToggleFormatBar
      ? [
          {
            id: 'cmd:toggle-format-bar',
            kind: 'command' as const,
            label: isEn
              ? `View: Formatting Bar ${ctx.formatBarVisible === false ? 'Show' : 'Hide'}`
              : `Ansicht: Formatierungsleiste ${ctx.formatBarVisible === false ? 'einblenden' : 'ausblenden'}`,
            shortcut: isEn ? 'Alt+Shift+R' : 'Alt+Umschalt+R',
            run: () => ctx.onToggleFormatBar?.(),
          },
        ]
      : []),
    ...(ctx.onScrollPreviewTop
      ? [
          {
            id: 'cmd:scroll-preview-top',
            kind: 'command' as const,
            label: isEn ? 'Preview: Scroll to Top' : 'Vorschau: Zum Seitenanfang scrollen',
            run: () => ctx.onScrollPreviewTop?.(),
          },
        ]
      : []),
    {
      id: 'cmd:toggle-wrap',
      kind: 'command',
      label: isEn
        ? `Editor: Word Wrap ${ctx.wordWrapActive ? 'Disable' : 'Enable'}`
        : `Editor: Zeilenumbruch ${ctx.wordWrapActive ? 'deaktivieren' : 'aktivieren'}`,
      badge: ctx.wordWrapActive ? (isEn ? 'Active' : 'Aktiv') : (isEn ? 'Off' : 'Aus'),
      shortcut: 'Alt+Z',
      run: ctx.onToggleWordWrap,
    },
    {
      id: 'cmd:toggle-spellcheck',
      kind: 'command',
      label: isEn
        ? `Editor: Spellcheck ${ctx.spellcheckActive ? 'Disable' : 'Enable'}`
        : `Editor: Rechtschreibprüfung ${ctx.spellcheckActive ? 'deaktivieren' : 'aktivieren'}`,
      badge: ctx.spellcheckActive ? (isEn ? 'Active' : 'Aktiv') : (isEn ? 'Off' : 'Aus'),
      run: ctx.onToggleSpellcheck,
    },
    {
      id: 'cmd:toggle-sync-scroll',
      kind: 'command',
      label: isEn
        ? `Preview: Sync Scroll ${ctx.syncScrollActive ? 'Disable' : 'Enable'}`
        : `Vorschau: Synchronisiertes Scrollen ${ctx.syncScrollActive ? 'ausschalten' : 'einschalten'}`,
      badge: ctx.syncScrollActive ? (isEn ? 'Active' : 'Aktiv') : (isEn ? 'Off' : 'Aus'),
      shortcut: isEn ? 'Alt+Shift+Y' : 'Alt+Umschalt+Y',
      run: ctx.onToggleSyncScroll,
    },
    {
      id: 'cmd:toggle-autosave',
      kind: 'command',
      label: isEn
        ? `File: Auto-Save ${ctx.autoSaveActive ? 'Disable' : 'Enable'}`
        : `Datei: Auto-Save ${ctx.autoSaveActive ? 'ausschalten' : 'einschalten'}`,
      badge: ctx.autoSaveActive ? (isEn ? 'Active' : 'Aktiv') : (isEn ? 'Off' : 'Aus'),
      shortcut: isEn ? 'Alt+Shift+A' : 'Alt+Umschalt+A',
      run: ctx.onToggleAutoSave,
    },
    {
      id: 'cmd:toggle-eol',
      kind: 'command',
      label: isEn
        ? `Document: Switch Line Endings to ${ctx.currentLineEnding === 'CRLF' ? 'LF (Unix)' : 'CRLF (Windows)'}`
        : `Dokument: Zeilenenden auf ${ctx.currentLineEnding === 'CRLF' ? 'LF (Unix)' : 'CRLF (Windows)'} umstellen`,
      badge: ctx.currentLineEnding,
      run: ctx.onToggleLineEnding,
    },
    {
      id: 'cmd:zoom-in',
      kind: 'command',
      label: isEn ? 'View: Zoom In (+)' : 'Ansicht: Dokument vergrößern (Zoom +)',
      shortcut: isEn ? 'Ctrl++' : 'Strg++',
      run: () => ctx.onZoomDelta(10),
    },
    {
      id: 'cmd:zoom-out',
      kind: 'command',
      label: isEn ? 'View: Zoom Out (-)' : 'Ansicht: Dokument verkleinern (Zoom -)',
      shortcut: isEn ? 'Ctrl+-' : 'Strg+-',
      run: () => ctx.onZoomDelta(-10),
    },
    {
      id: 'cmd:zoom-reset',
      kind: 'command',
      label: isEn ? 'View: Reset Zoom (100%)' : 'Ansicht: Dokument-Zoom auf 100 % zurücksetzen',
      shortcut: isEn ? 'Ctrl+0' : 'Strg+0',
      run: ctx.onZoomReset,
    },
    ...(ctx.onOpenEditorSearch
      ? [
          {
            id: 'cmd:editor-search',
            kind: 'command' as const,
            label: isEn ? 'Search: Find in Document' : 'Suche: Im Dokument suchen',
            shortcut: isEn ? 'Ctrl+F' : 'Strg+F',
            run: ctx.onOpenEditorSearch,
          },
        ]
      : []),
    ...(ctx.onOpenEditorReplace
      ? [
          {
            id: 'cmd:editor-replace',
            kind: 'command' as const,
            label: isEn ? 'Search: Find & Replace in Document' : 'Suche: Suchen & Ersetzen im Dokument öffnen',
            shortcut: isEn ? 'Ctrl+H' : 'Strg+H',
            run: ctx.onOpenEditorReplace,
          },
        ]
      : []),
    {
      id: 'cmd:search-workspace',
      kind: 'command',
      label: isEn ? 'Search: Full-Text Workspace Search' : 'Suche: Volltextsuche im Arbeitsordner öffnen',
      shortcut: isEn ? 'Ctrl+Shift+F' : 'Strg+Umschalt+F',
      run: ctx.onOpenSearchPanel,
    },
    {
      id: 'cmd:outline',
      kind: 'command',
      label: isEn ? 'Navigation: Show Document Outline' : 'Navigation: Dokument-Gliederung (Inhaltsverzeichnis) anzeigen',
      run: ctx.onOpenOutlinePanel,
    },
    {
      id: 'cmd:zen',
      kind: 'command',
      label: isEn ? 'View: Toggle Zen Focus Mode' : 'Ansicht: Zen-Fokusmodus umschalten',
      shortcut: 'F11',
      run: ctx.onToggleZen,
    },
    {
      id: 'cmd:theme',
      kind: 'command',
      label: isEn ? 'Appearance: Toggle Light/Dark Theme' : 'Darstellung: Hell-/Dunkel-Design umschalten',
      shortcut: isEn ? 'Alt+Shift+T' : 'Alt+Umschalt+T',
      run: ctx.onToggleTheme,
    },
    ...(ctx.onOpenSettings
      ? [
          {
            id: 'cmd:settings',
            kind: 'command' as const,
            label: isEn ? 'Settings: Open MarkLive Settings…' : 'Einstellungen: MarkLive-Optionen & Einstellungen öffnen…',
            shortcut: isEn ? 'Ctrl+,' : 'Strg+,',
            run: ctx.onOpenSettings,
          },
        ]
      : []),
    {
      id: 'cmd:reveal',
      kind: 'command',
      label: isEn ? 'Windows: Reveal Active File in Explorer' : 'Windows: Aktuelle Datei im Explorer anzeigen',
      run: ctx.onRevealInExplorer,
    },
    {
      id: 'cmd:shortcuts',
      kind: 'command',
      label: isEn ? 'Help: Show Keyboard Shortcuts' : 'Hilfe: Tastenkürzel-Übersicht anzeigen',
      shortcut: 'F1',
      run: ctx.onShowShortcuts,
    },
  ];
}
