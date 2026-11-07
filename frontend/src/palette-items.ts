import { WorkspaceFileEntry } from './api';
import { PaletteItem } from './palette';
import { baseNameOfPath } from './path-utils';

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
}

export async function buildPaletteFileItems(ctx: PaletteFileContext): Promise<PaletteItem[]> {
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
      subtitle: tab.path ?? 'Ungespeicherter Tab',
      badge: tab.id === ctx.activeTabId ? 'Aktiv' : 'Geöffnet',
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
        badge: 'Arbeitsordner',
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
      badge: 'Zuletzt geöffnet',
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
      badge: 'Ordnerverlauf',
      run: () => ctx.onOpenFolder(folderPath),
    });
  }

  return items;
}

export function buildPaletteCommandItems(ctx: PaletteCommandContext): PaletteItem[] {
  return [
    {
      id: 'cmd:new-tab',
      kind: 'command',
      label: 'Datei: Neues Markdown-Dokument',
      shortcut: 'Strg+N',
      run: ctx.onNewTab,
    },
    {
      id: 'cmd:open-file',
      kind: 'command',
      label: 'Datei: Markdown-Datei öffnen…',
      shortcut: 'Strg+O',
      run: ctx.onOpenFileDialog,
    },
    {
      id: 'cmd:open-folder',
      kind: 'command',
      label: 'Arbeitsbereich: Ordner öffnen…',
      shortcut: 'Strg+Umschalt+O',
      run: ctx.onOpenFolderDialog,
    },
    ...(ctx.onReopenTab
      ? [
          {
            id: 'cmd:reopen-tab',
            kind: 'command' as const,
            label: 'Tab: Zuletzt geschlossenen Tab wiederherstellen',
            shortcut: 'Strg+Umschalt+T',
            run: ctx.onReopenTab,
          },
        ]
      : []),
    ...(ctx.onNextTab
      ? [
          {
            id: 'cmd:next-tab',
            kind: 'command' as const,
            label: 'Tab: Zum nächsten Tab wechseln',
            shortcut: 'Strg+BildAb',
            run: ctx.onNextTab,
          },
        ]
      : []),
    ...(ctx.onPrevTab
      ? [
          {
            id: 'cmd:prev-tab',
            kind: 'command' as const,
            label: 'Tab: Zum vorherigen Tab wechseln',
            shortcut: 'Strg+BildAuf',
            run: ctx.onPrevTab,
          },
        ]
      : []),
    {
      id: 'cmd:save',
      kind: 'command',
      label: 'Datei: Speichern',
      shortcut: 'Strg+S',
      run: ctx.onSave,
    },
    {
      id: 'cmd:save-as',
      kind: 'command',
      label: 'Datei: Speichern unter…',
      shortcut: 'Strg+Umschalt+S',
      run: ctx.onSaveAs,
    },
    {
      id: 'cmd:copy-rich',
      kind: 'command',
      label: 'Zwischenablage: Als formatierten Text kopieren (Word, Teams, Outlook)',
      shortcut: 'Strg+Umschalt+K',
      run: ctx.onCopyRichText,
    },
    {
      id: 'cmd:export-html',
      kind: 'command',
      label: 'Export: Als eigenständige 1-Datei-HTML exportieren…',
      run: ctx.onExportHtml,
    },
    {
      id: 'cmd:export-pdf',
      kind: 'command',
      label: 'Export: Direkt als PDF-Datei exportieren…',
      shortcut: 'Strg+Umschalt+D',
      run: ctx.onExportPdf,
    },
    {
      id: 'cmd:print',
      kind: 'command',
      label: 'Export: Drucken…',
      shortcut: 'Strg+P',
      run: ctx.onPrint,
    },
    {
      id: 'cmd:align-table',
      kind: 'command',
      label: 'Editor: Markdown-Tabelle ausrichten',
      shortcut: 'Alt+Umschalt+F',
      run: ctx.onAlignTable,
    },
    ...(ctx.onToggleTask
      ? [
          {
            id: 'cmd:toggle-task',
            kind: 'command' as const,
            label: 'Editor: Aufgabe der Zeile an-/abhaken',
            shortcut: 'Alt+C',
            run: ctx.onToggleTask,
          },
        ]
      : []),
    {
      id: 'cmd:view-split',
      kind: 'command',
      label: 'Ansicht: Split-Vorschau (Editor & Live-Vorschau)',
      shortcut: 'Alt+2',
      run: () => ctx.onSetViewMode('split'),
    },
    {
      id: 'cmd:view-editor',
      kind: 'command',
      label: 'Ansicht: Nur Editor',
      shortcut: 'Alt+1',
      run: () => ctx.onSetViewMode('editor'),
    },
    {
      id: 'cmd:view-preview',
      kind: 'command',
      label: 'Ansicht: Nur Lese-Vorschau',
      shortcut: 'Alt+3',
      run: () => ctx.onSetViewMode('preview'),
    },
    {
      id: 'cmd:toggle-wrap',
      kind: 'command',
      label: `Editor: Zeilenumbruch ${ctx.wordWrapActive ? 'deaktivieren' : 'aktivieren'}`,
      badge: ctx.wordWrapActive ? 'Aktiv' : 'Aus',
      shortcut: 'Alt+Z',
      run: ctx.onToggleWordWrap,
    },
    {
      id: 'cmd:toggle-spellcheck',
      kind: 'command',
      label: `Editor: Rechtschreibprüfung ${ctx.spellcheckActive ? 'deaktivieren' : 'aktivieren'}`,
      badge: ctx.spellcheckActive ? 'Aktiv' : 'Aus',
      run: ctx.onToggleSpellcheck,
    },
    {
      id: 'cmd:toggle-sync-scroll',
      kind: 'command',
      label: `Vorschau: Synchronisiertes Scrollen ${ctx.syncScrollActive ? 'ausschalten' : 'einschalten'}`,
      badge: ctx.syncScrollActive ? 'Aktiv' : 'Aus',
      run: ctx.onToggleSyncScroll,
    },
    {
      id: 'cmd:toggle-autosave',
      kind: 'command',
      label: `Datei: Auto-Save ${ctx.autoSaveActive ? 'ausschalten' : 'einschalten'}`,
      badge: ctx.autoSaveActive ? 'Aktiv' : 'Aus',
      run: ctx.onToggleAutoSave,
    },
    {
      id: 'cmd:toggle-eol',
      kind: 'command',
      label: `Dokument: Zeilenenden auf ${ctx.currentLineEnding === 'CRLF' ? 'LF (Unix)' : 'CRLF (Windows)'} umstellen`,
      badge: ctx.currentLineEnding,
      run: ctx.onToggleLineEnding,
    },
    {
      id: 'cmd:zoom-in',
      kind: 'command',
      label: 'Ansicht: Dokument vergrößern (Zoom +)',
      shortcut: 'Strg++',
      run: () => ctx.onZoomDelta(10),
    },
    {
      id: 'cmd:zoom-out',
      kind: 'command',
      label: 'Ansicht: Dokument verkleinern (Zoom -)',
      shortcut: 'Strg+-',
      run: () => ctx.onZoomDelta(-10),
    },
    {
      id: 'cmd:zoom-reset',
      kind: 'command',
      label: 'Ansicht: Dokument-Zoom auf 100 % zurücksetzen',
      shortcut: 'Strg+0',
      run: ctx.onZoomReset,
    },
    ...(ctx.onOpenEditorSearch
      ? [
          {
            id: 'cmd:editor-search',
            kind: 'command' as const,
            label: 'Suche: Im Dokument suchen',
            shortcut: 'Strg+F',
            run: ctx.onOpenEditorSearch,
          },
        ]
      : []),
    ...(ctx.onOpenEditorReplace
      ? [
          {
            id: 'cmd:editor-replace',
            kind: 'command' as const,
            label: 'Suche: Suchen & Ersetzen im Dokument öffnen',
            shortcut: 'Strg+H',
            run: ctx.onOpenEditorReplace,
          },
        ]
      : []),
    {
      id: 'cmd:search-workspace',
      kind: 'command',
      label: 'Suche: Volltextsuche im Arbeitsordner öffnen',
      shortcut: 'Strg+Umschalt+F',
      run: ctx.onOpenSearchPanel,
    },
    {
      id: 'cmd:outline',
      kind: 'command',
      label: 'Navigation: Dokument-Gliederung (Inhaltsverzeichnis) anzeigen',
      run: ctx.onOpenOutlinePanel,
    },
    {
      id: 'cmd:zen',
      kind: 'command',
      label: 'Ansicht: Zen-Fokusmodus umschalten',
      shortcut: 'F11',
      run: ctx.onToggleZen,
    },
    {
      id: 'cmd:theme',
      kind: 'command',
      label: 'Darstellung: Hell-/Dunkel-Design umschalten',
      run: ctx.onToggleTheme,
    },
    {
      id: 'cmd:reveal',
      kind: 'command',
      label: 'Windows: Aktuelle Datei im Explorer anzeigen',
      run: ctx.onRevealInExplorer,
    },
    {
      id: 'cmd:shortcuts',
      kind: 'command',
      label: 'Hilfe: Tastenkürzel-Übersicht anzeigen',
      shortcut: 'F1',
      run: ctx.onShowShortcuts,
    },
  ];
}
