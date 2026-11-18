export interface HeadingItem {
  level: number;
  text: string;
  slug: string;
  line: number;
}

export interface DocStats {
  words: number;
  chars: number;
  lines: number;
  readingTimeSec: number;
}

export interface RenderResult {
  html: string;
  outline: HeadingItem[];
  stats: DocStats;
  superseded?: boolean;
}

export interface FilePayload {
  path: string;
  name: string;
  content: string;
  lineEnding: 'CRLF' | 'LF';
  encoding: string;
  parentDir: string | null;
}

export interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  isMarkdown: boolean;
  children?: FileTreeNode[];
}

export interface WorkspaceFileEntry {
  path: string;
  name: string;
  relPath: string;
}

export interface DraftEntry {
  name: string;
  path: string | null;
  parentDir: string | null;
  content: string;
  savedContent: string;
  lineEnding: 'CRLF' | 'LF';
  savedLineEnding?: 'CRLF' | 'LF';
}

export interface SearchMatchItem {
  line: number;
  column: number;
  preview: string;
}

export interface WorkspaceReplaceResult {
  filesUpdated: number;
  totalReplacements: number;
  updatedPaths: string[];
  failures: Array<{ path: string; error: string }>;
}

export interface SearchFileResult {
  path: string;
  name: string;
  relPath: string;
  matches: SearchMatchItem[];
  contentVersion: string;
}

export interface UiSessionPrefs {
  splitRatio: number;
  splitOrientation?: 'vertical' | 'horizontal';
  zoomPercent: number;
  syncScroll: boolean;
  autoSave: boolean;
  wordWrap: boolean;
  spellcheck: boolean;
  formatBarVisible?: boolean;
  language?: 'de' | 'en';
  recentFiles: string[];
  recentFolders: string[];
  sessionFiles: string[];
  pinnedSessionFiles?: string[];
  activeSessionFile: string | null;
}

export interface StartupPayload {
  initialFiles: string[];
  initialFolder: string | null;
  recoveredDrafts: DraftEntry[];
  uiPrefs: UiSessionPrefs;
}

async function postJson<T>(endpoint: string, payload: unknown = {}): Promise<T> {
  const res = await fetch(`/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? `API-Fehler (${res.status})`);
  }
  return data as T;
}

export const backend = {
  getStartup: () => postJson<StartupPayload>('startup'),

  saveUiPrefs: (revision: number, prefs: UiSessionPrefs) =>
    postJson<{ ok: boolean }>('prefs/save', { revision, prefs }),

  renderMarkdown: (markdown: string, baseDir: string | null, docKey?: string) =>
    postJson<RenderResult>(
      'render',
      docKey !== undefined ? { markdown, baseDir, docKey } : { markdown, baseDir },
    ),

  readFile: (path: string) => postJson<FilePayload>('read-file', { path }),

  writeFile: (
    path: string,
    content: string,
    lineEnding: string,
    expectedContent: string,
    expectedLineEnding?: string,
  ) => postJson<{ saved: boolean }>('write-file', {
    path, content, lineEnding, expectedContent, expectedLineEnding,
  }),

  listTree: (path: string, activateWorkspace = true) =>
    postJson<FileTreeNode>('list-tree', { path, activateWorkspace }),

  listWorkspaceFiles: (path: string) =>
    postJson<{ files: WorkspaceFileEntry[] }>('workspace-files', { path }),

  createFile: (parentDir: string, fileName: string) =>
    postJson<FilePayload>('create-file', { parentDir, fileName }),

  createFolder: (parentDir: string, folderName: string) =>
    postJson<{ path: string }>('create-folder', { parentDir, folderName }),

  initAiLibrary: () =>
    postJson<{ root: string; tree: FileTreeNode }>('ai-library/init'),

  createAiSkill: (parentDir: string, skillName: string) =>
    postJson<FilePayload>('ai-library/create-skill', { parentDir, skillName }),

  renamePath: (path: string, newName: string) =>
    postJson<{ path: string; name: string }>('rename-path', { path, newName }),

  deletePath: (path: string) =>
    postJson<{ ok: boolean }>('delete-path', { path }),

  saveDrafts: (revision: number, entries: DraftEntry[], recoveryRestored: boolean) =>
    postJson<{ ok: boolean }>('drafts/save', { revision, entries, recoveryRestored }),

  savePastedImage: (
    baseDir: string | null,
    mimeType: string,
    dataBase64: string,
  ) =>
    postJson<{ savedPath: string; markdownSnippet: string }>(
      'save-pasted-image',
      { baseDir, mimeType, dataBase64 },
    ),

  importDroppedImage: (baseDir: string | null, sourcePath: string) =>
    postJson<{ savedPath: string; markdownSnippet: string }>(
      'import-dropped-image',
      { baseDir, sourcePath },
    ),

  searchWorkspace: (
    root: string,
    query: string,
    caseSensitive: boolean,
    useRegex = false,
    wholeWord = false,
  ) =>
    postJson<{ results: SearchFileResult[] }>('search-workspace', {
      root,
      query,
      caseSensitive,
      useRegex,
      wholeWord,
    }),

  replaceWorkspace: (
    root: string,
    query: string,
    replacement: string,
    caseSensitive: boolean,
    useRegex = false,
    wholeWord = false,
    includeFiles?: Array<string | Pick<SearchFileResult, 'path' | 'contentVersion'>>,
  ) =>
    postJson<WorkspaceReplaceResult>('replace-workspace', {
      root,
      query,
      replacement,
      caseSensitive,
      useRegex,
      wholeWord,
      ...(includeFiles !== undefined ? { includeFiles } : {}),
    }),

  revealInExplorer: (path: string) =>
    postJson<{ ok: boolean }>('reveal-in-explorer', { path }),

  openFilesDialog: (lang?: string) =>
    postJson<{ files: FilePayload[] }>('dialog/open-files', { lang }),

  openFolderDialog: (lang?: string) =>
    postJson<{ tree: FileTreeNode | null }>('dialog/open-folder', { lang }),

  saveFileDialog: (
    content: string,
    defaultName: string,
    defaultDir: string | null,
    lineEnding: string,
    lang?: string,
  ) =>
    postJson<{
      saved: boolean;
      path?: string;
      name?: string;
      parentDir?: string | null;
    }>('dialog/save-file', {
      content,
      defaultName,
      defaultDir,
      lineEnding,
      lang,
    }),

  exportHtmlDialog: (
    title: string,
    markdown: string,
    baseDir: string | null,
    defaultDir: string | null,
    renderedHtml?: string,
    lang?: string,
  ) =>
    postJson<{ exported: boolean; path?: string }>('dialog/export-html', {
      title,
      markdown,
      baseDir,
      defaultDir,
      renderedHtml,
      lang,
    }),

  pickPdfSavePath: (title: string, defaultDir: string | null, lang?: string) =>
    postJson<{ chosen: boolean; token?: number }>('dialog/pick-pdf-target', {
      title,
      defaultDir,
      lang,
    }),

  executePdfExport: (token: number) =>
    postJson<{ exported: boolean; path?: string }>('export-pdf', { token }),

  setWindowState: (opts: {
    title?: string;
    theme?: 'light' | 'dark' | 'system';
    fullscreen?: boolean;
  }) => postJson<{ ok: boolean }>('window/set-state', opts),

  forceCloseWindow: (recoveryRestored: boolean) =>
    postJson<{ ok: boolean }>('window/force-close', { recoveryRestored }),

  openExternalUrl: (url: string) =>
    postJson<{ ok: boolean }>('open-external', { url }),
};

type BackendEventMap = {
  'drag-enter': { count: number };
  'drag-leave': Record<string, never>;
  'files-dropped': { files: string[]; images?: string[]; folder: string | null };
  'fs-changed': { paths: string[] };
  'close-requested': Record<string, never>;
};

const listeners: {
  [K in keyof BackendEventMap]?: Array<(payload: BackendEventMap[K]) => void>;
} = {};

declare global {
  interface Window {
    __semyraReceive?: (eventName: string, payload: unknown) => void;
  }
}

const dispatchReceivedEvent = (eventName: string, payload: unknown) => {
  const list = listeners[eventName as keyof BackendEventMap];
  if (list) {
    for (const fn of list) {
      fn(payload as never);
    }
  }
};

window.__semyraReceive = dispatchReceivedEvent;

export function onBackendEvent<K extends keyof BackendEventMap>(
  event: K,
  handler: (payload: BackendEventMap[K]) => void,
): void {
  if (!listeners[event]) {
    listeners[event] = [];
  }
  listeners[event]!.push(handler);
}
