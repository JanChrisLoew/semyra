import type { DocumentState } from './document-state';

type AutoSaveDocument = Pick<DocumentState, 'isDirty' | 'hasExternalConflict'> & { path: string | null };

const AUTO_SAVE_DELAY_MS = 900;

export class DocumentAutoSave<T extends AutoSaveDocument> {
  private enabled = false;
  private readonly timers = new Map<T, number>();

  constructor(
    private readonly isClosing: (document: T) => boolean,
    private readonly save: (document: T) => Promise<boolean>,
  ) {}

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      for (const timer of this.timers.values()) window.clearTimeout(timer);
      this.timers.clear();
    }
  }

  canSave(document: T): boolean {
    return this.enabled && Boolean(document.path) && document.isDirty
      && !document.hasExternalConflict && !this.isClosing(document);
  }

  cancel(document: T): void {
    window.clearTimeout(this.timers.get(document));
    this.timers.delete(document);
  }

  schedule(document: T): void {
    this.cancel(document);
    if (!this.canSave(document)) return;
    this.timers.set(document, window.setTimeout(() => {
      this.timers.delete(document);
      void this.save(document);
    }, AUTO_SAVE_DELAY_MS));
  }
}
