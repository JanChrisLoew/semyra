import { backend } from './api';
import {
  classifyDiskUpdate,
  expectedDiskVersion,
  recordSavedDocumentVersion,
  type DiskDocumentVersion,
  type FileDocument,
} from './document-state';
import { getLanguage, t } from './i18n';

interface DocumentFileOperationsDeps<T> {
  isOpen: (document: T) => boolean;
  getWorkspaceRoot: () => string | null;
  beforeSave: (document: T, automatic: boolean) => boolean;
  onSaved: (document: T, previousPath: string | null, savedAs: boolean) => void;
  onSaveConflict: (document: T) => void;
  onSaveError: (error: unknown) => void;
}

interface DiskSyncCallbacks {
  onConflict: () => void;
  onReload: (version: DiskDocumentVersion) => void;
  onError: (error: unknown) => void;
}

export class DocumentFileOperations<T extends FileDocument> {
  private readonly pendingSaves = new Map<T, Promise<boolean>>();
  private readonly diskReads = new WeakMap<T, symbol>();

  constructor(private readonly deps: DocumentFileOperationsDeps<T>) {}

  async save(document: T, forceSaveAs = false, automatic = false): Promise<boolean> {
    while (this.pendingSaves.has(document)) {
      await this.pendingSaves.get(document);
    }
    if (!this.deps.isOpen(document) || !this.deps.beforeSave(document, automatic)) return false;
    const pending = this.writeSnapshot(document, forceSaveAs, automatic);
    this.pendingSaves.set(document, pending);
    try {
      return await pending;
    } finally {
      this.pendingSaves.delete(document);
    }
  }

  private async writeSnapshot(document: T, forceSaveAs: boolean, automatic: boolean): Promise<boolean> {
    const { path, currentContent: content, lineEnding } = document;
    let encoding = 'UTF-8';
    const savedAs = !path || forceSaveAs;
    const stillAtOriginalPath = () => this.deps.isOpen(document) && document.path === path;
    try {
      if (savedAs) {
        const result = await backend.saveFileDialog(
          content, document.name, document.parentDir ?? this.deps.getWorkspaceRoot(), lineEnding, getLanguage(),
        );
        if (!result.saved || !result.path || !stillAtOriginalPath()) return false;
        document.path = result.path;
        document.name = result.name ?? document.name;
        document.parentDir = result.parentDir ?? document.parentDir;
      } else {
        const expected = expectedDiskVersion(document, automatic);
        const write = (convertWindows1252 = false) => backend.writeFile(
          path, content, lineEnding, expected.content, expected.lineEnding,
          { preferWindows1252: document.encoding === 'Windows-1252', convertWindows1252 },
        );
        let result = await write();
        if (!stillAtOriginalPath()) return false;
        if (result.conversionRequired) {
          if (automatic) {
            this.deps.onSaveError(new Error(t('encoding.autoSave')));
            return false;
          }
          if (!window.confirm(t('encoding.confirm', { name: document.name }))) return false;
          result = await write(true);
          if (!stillAtOriginalPath()) return false;
        }
        encoding = result.encoding ?? document.encoding;
        if (!result.saved) {
          this.deps.onSaveConflict(document);
          return false;
        }
      }
    } catch (err) {
      if (stillAtOriginalPath()) this.deps.onSaveError(err);
      return false;
    }

    this.diskReads.delete(document);
    recordSavedDocumentVersion(document, content, lineEnding, encoding);
    this.deps.onSaved(document, path, savedAs);
    return true;
  }

  activeSave(document: T): Promise<boolean> | undefined {
    return this.pendingSaves.get(document);
  }

  waitForActiveSaves(): Promise<boolean[]> {
    return Promise.all(this.pendingSaves.values());
  }

  async syncFromDisk(document: T, discardLocal: boolean, callbacks: DiskSyncCallbacks): Promise<void> {
    const { path, currentContent, lineEnding } = document;
    if (!path) return;
    while (this.pendingSaves.has(document)) {
      await this.pendingSaves.get(document);
    }
    const isSameOpenDocument = () => document.path === path && this.deps.isOpen(document);
    if (!isSameOpenDocument()) return;

    const read = Symbol();
    this.diskReads.set(document, read);
    const isCurrent = () => this.diskReads.get(document) === read && isSameOpenDocument();
    try {
      const payload = await backend.readFile(path);
      if (!isCurrent()) return;
      const update = classifyDiskUpdate(document, { content: currentContent, lineEnding }, payload, discardLocal);
      if (update.kind === 'conflict') {
        callbacks.onConflict();
      } else if (update.kind === 'reload') {
        callbacks.onReload(update.version);
      }
    } catch (err) {
      if (!isCurrent()) return;
      if (document.isDirty) callbacks.onConflict();
      callbacks.onError(err);
    }
  }
}
