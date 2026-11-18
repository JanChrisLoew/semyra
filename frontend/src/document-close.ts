import type { DocumentAutoSave } from './document-auto-save';
import type { DocumentFileOperations } from './document-file-operations';
import type { FileDocument } from './document-state';

type CloseDocument = FileDocument & { id: string };
export type UnsavedChoice = 'save' | 'discard' | 'cancel';

interface DocumentCloseDeps<T> {
  getDocuments: () => readonly T[];
  promptTab: (document: T) => Promise<UnsavedChoice>;
  promptWindow: (documents: readonly T[]) => Promise<UnsavedChoice>;
  removeTab: (document: T) => void;
  prepareWindowClose: () => Promise<boolean>;
  closeNativeWindow: () => Promise<unknown>;
  onWindowCloseAborted: () => void;
  onWindowCloseError: (error: unknown) => void;
}

export class DocumentCloseController<T extends CloseDocument> {
  private closePending = false;
  private closingTab: T | null = null;

  constructor(
    private readonly files: Pick<DocumentFileOperations<T>, 'activeSave' | 'save' | 'waitForActiveSaves'>,
    private readonly autoSave: Pick<DocumentAutoSave<T>, 'cancel' | 'schedule'>,
    private readonly deps: DocumentCloseDeps<T>,
  ) {}

  isClosing(document: T): boolean {
    return this.closePending || this.closingTab === document;
  }

  async closeTab(id: string): Promise<boolean> {
    const document = this.deps.getDocuments().find((candidate) => candidate.id === id);
    if (!document) return true;
    if (this.closePending || this.closingTab) return false;
    this.closingTab = document;
    this.autoSave.cancel(document);
    try {
      await this.files.activeSave(document);
      if (document.isDirty) {
        const revision = document.revision;
        const choice = await this.deps.promptTab(document);
        if (choice === 'cancel' || document.revision !== revision) return false;
        if (choice === 'save' && (!await this.files.save(document) || document.isDirty)) return false;
      }
      this.deps.removeTab(document);
      return true;
    } finally {
      this.closingTab = null;
      if (this.deps.getDocuments().includes(document)) this.autoSave.schedule(document);
    }
  }

  async closeWindow(): Promise<void> {
    if (this.closePending || this.closingTab) return;
    this.closePending = true;
    let closed = false;
    try {
      await this.files.waitForActiveSaves();
      const dirtyDocuments = this.deps.getDocuments().filter((document) => document.isDirty);
      const revisions = new Map(dirtyDocuments.map((document) => [document, document.revision]));
      const choice = dirtyDocuments.length > 0 ? await this.deps.promptWindow(dirtyDocuments) : undefined;
      if (choice === 'cancel') return;
      if (choice === 'save') {
        for (const document of dirtyDocuments) {
          if (document.revision !== revisions.get(document)) return;
          if (!await this.files.save(document) || document.isDirty) return;
        }
      }
      if (!await this.deps.prepareWindowClose()) return;
      if (this.deps.getDocuments().some((document) => document.isDirty && (
        choice !== 'discard' || !revisions.has(document) || revisions.get(document) !== document.revision
      ))) return;

      await this.deps.closeNativeWindow();
      closed = true;
    } catch (err) {
      this.deps.onWindowCloseError(err);
    } finally {
      if (!closed) {
        this.deps.onWindowCloseAborted();
        this.closePending = false;
        for (const document of this.deps.getDocuments()) this.autoSave.schedule(document);
      }
    }
  }
}
