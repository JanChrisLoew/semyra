import type { DraftEntry, FilePayload } from './api';

type DocumentVersion = Pick<FilePayload, 'content' | 'lineEnding'>;
export type DiskDocumentVersion = DocumentVersion & Pick<FilePayload, 'encoding'>;

export interface DocumentState {
  savedContent: string;
  savedLineEnding?: DocumentVersion['lineEnding'];
  currentContent: string;
  lineEnding: DocumentVersion['lineEnding'];
  encoding: string;
  isDirty: boolean;
  revision?: number;
  hasExternalConflict?: boolean;
  overwriteExpected?: DocumentVersion;
}

export interface FileDocument extends DocumentState {
  path: string | null;
  name: string;
  parentDir: string | null;
}

export function updateDocumentVersion(
  document: DocumentState,
  content: string,
  lineEnding: DocumentVersion['lineEnding'],
): boolean {
  const contentChanged = document.currentContent !== content;
  if (contentChanged || document.lineEnding !== lineEnding) {
    document.revision = (document.revision ?? 0) + 1;
  }
  document.currentContent = content;
  document.lineEnding = lineEnding;
  return contentChanged;
}

export function applyDocumentEdit(document: FileDocument, content: string): boolean {
  updateDocumentVersion(document, content, document.lineEnding);
  const wasDirty = document.isDirty;
  document.isDirty = content !== document.savedContent || (document.path !== null
    && document.savedLineEnding !== undefined && document.lineEnding !== document.savedLineEnding);
  return wasDirty !== document.isDirty;
}

export function setDocumentLineEnding(document: FileDocument, lineEnding: DocumentVersion['lineEnding']): void {
  updateDocumentVersion(document, document.currentContent, lineEnding);
  if (document.path) {
    document.isDirty = document.currentContent !== document.savedContent || lineEnding !== document.savedLineEnding;
  }
}

export function recordSavedDocumentVersion(
  document: DocumentState,
  content: string,
  lineEnding: DocumentVersion['lineEnding'],
  encoding = 'UTF-8',
): void {
  document.savedContent = content;
  document.savedLineEnding = lineEnding;
  document.encoding = encoding;
  document.isDirty = document.currentContent !== content || document.lineEnding !== lineEnding;
}

export function applyDiskDocumentVersion(document: DocumentState, version: DiskDocumentVersion): boolean {
  const contentChanged = updateDocumentVersion(document, version.content, version.lineEnding);
  recordSavedDocumentVersion(document, version.content, version.lineEnding, version.encoding || 'UTF-8');
  return contentChanged;
}

export function setExternalDocumentConflict(document: DocumentState, hasConflict: boolean): void {
  document.hasExternalConflict = hasConflict;
  document.overwriteExpected = undefined;
}

export function restoreDocumentDraft(document: DocumentState, draft: DraftEntry): void {
  const diskContent = document.savedContent;
  const diskLineEnding = document.lineEnding;
  const savedLineEnding = draft.savedLineEnding ?? diskLineEnding;
  document.currentContent = draft.content;
  document.lineEnding = draft.lineEnding;
  document.isDirty = draft.content !== diskContent || draft.lineEnding !== diskLineEnding;
  document.hasExternalConflict = document.isDirty
    && (diskContent !== draft.savedContent || diskLineEnding !== savedLineEnding);
  document.savedContent = document.isDirty ? draft.savedContent : diskContent;
  document.savedLineEnding = document.isDirty ? savedLineEnding : diskLineEnding;
}

export function expectedDiskVersion(document: DocumentState, automatic: boolean) {
  const overwrite = automatic ? undefined : document.overwriteExpected;
  return {
    content: overwrite?.content ?? document.savedContent,
    lineEnding: overwrite?.lineEnding ?? document.savedLineEnding,
  };
}

type DiskUpdate = { kind: 'ignore' | 'conflict' } | { kind: 'reload'; version: DiskDocumentVersion };

export function classifyDiskUpdate(
  document: DocumentState,
  localBeforeRead: DocumentVersion,
  disk: DiskDocumentVersion,
  discardLocal: boolean,
): DiskUpdate {
  const localChanged = localBeforeRead.content !== document.currentContent
    || localBeforeRead.lineEnding !== document.lineEnding;
  // ASCII bytes are identical in UTF-8 and Windows-1252. Keep the open tab's known encoding.
  if (document.encoding === 'Windows-1252' && disk.encoding === 'UTF-8' && !/[^\x00-\x7F]/.test(disk.content)) {
    disk = { ...disk, encoding: document.encoding };
  }
  const hasLineEndings = disk.content.includes('\n');
  const matchesLocal = document.currentContent === disk.content
    && (document.lineEnding === disk.lineEnding || (!hasLineEndings && !document.isDirty));
  if (!matchesLocal && (localChanged || (document.isDirty && !discardLocal))) {
    const diskChanged = disk.content !== document.savedContent
      || (hasLineEndings && disk.lineEnding !== document.savedLineEnding);
    return { kind: diskChanged ? 'conflict' : 'ignore' };
  }
  if (!discardLocal && !document.hasExternalConflict && !document.isDirty && matchesLocal
    && document.encoding === disk.encoding) {
    return { kind: 'ignore' };
  }
  return {
    kind: 'reload',
    version: {
      content: disk.content,
      lineEnding: hasLineEndings || discardLocal ? disk.lineEnding : document.lineEnding,
      encoding: disk.encoding,
    },
  };
}
