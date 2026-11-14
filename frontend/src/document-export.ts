import { backend } from './api';
import { copyRichPreviewToClipboard, preparePreviewHtmlForExport, renderDocument } from './export-utils';
import { getLanguage, t } from './i18n';
import { baseNameOfPath } from './path-utils';
import { safeSetMarkdownHTML } from './sanitizer';

export interface DocumentSnapshot {
  name: string;
  content: string;
  baseDir: string | null;
}

export class DocumentExportController {
  private printPending = false;

  constructor(
    private readonly snapshotActiveDocument: () => DocumentSnapshot | undefined,
    private readonly printHost: HTMLElement,
    private readonly notify: (message: string) => void,
  ) {}

  private async renderDocumentSnapshot(snapshot: DocumentSnapshot, forceLightTheme = false): Promise<HTMLElement> {
    const preview = document.createElement('article');
    preview.className = 'markdown-body';
    const result = await renderDocument(snapshot.name, snapshot.content, snapshot.baseDir);
    await safeSetMarkdownHTML(preview, result.html, { forceLightTheme });
    return preview;
  }

  private async withPrintDocument<T>(snapshot: DocumentSnapshot, fn: () => Promise<T>): Promise<T> {
    const printDocument = await this.renderDocumentSnapshot(snapshot, true);
    printDocument.classList.add('print-document');
    printDocument.setAttribute('aria-hidden', 'true');
    this.printHost.append(printDocument);
    try {
      await Promise.all(Array.from(printDocument.querySelectorAll('img'), async (img) => {
        img.loading = 'eager';
        if (typeof img.decode === 'function') {
          await img.decode().catch(() => {});
        }
      }));
      return await fn();
    } finally {
      printDocument.remove();
    }
  }

  async copyRichText(): Promise<void> {
    const snapshot = this.snapshotActiveDocument();
    if (!snapshot) return;
    try {
      const preview = await this.renderDocumentSnapshot(snapshot);
      await copyRichPreviewToClipboard(preview, snapshot.content);
      this.notify(t('toast.copyRich'));
    } catch (err) {
      console.error('Formatierter Text konnte nicht kopiert werden:', err);
      this.notify(t('toast.copyFailed'));
    }
  }

  async exportHtml(): Promise<void> {
    const snapshot = this.snapshotActiveDocument();
    if (!snapshot) return;
    try {
      const preview = await this.renderDocumentSnapshot(snapshot, true);
      const renderedHtml = await preparePreviewHtmlForExport(preview, { mermaidAlreadyLight: true });
      const res = await backend.exportHtmlDialog(
        snapshot.name,
        snapshot.content,
        snapshot.baseDir,
        snapshot.baseDir,
        renderedHtml,
        getLanguage(),
      );
      if (res.exported && res.path) {
        this.notify(t('toast.htmlExportSuccess', { name: baseNameOfPath(res.path) }));
      }
    } catch (err) {
      console.error('HTML-Export fehlgeschlagen:', err);
      this.notify(t('toast.htmlExportFailed'));
    }
  }

  async exportPdf(): Promise<void> {
    const snapshot = this.snapshotActiveDocument();
    if (!snapshot || this.printPending) return;
    this.printPending = true;
    try {
      const pick = await backend.pickPdfSavePath(snapshot.name, snapshot.baseDir, getLanguage());
      if (!pick.chosen || pick.token === undefined) {
        return;
      }
      const token = pick.token;
      const res = await this.withPrintDocument(snapshot, () => backend.executePdfExport(token));
      if (res.exported && res.path) {
        this.notify(t('toast.pdfExportSuccess', { name: baseNameOfPath(res.path) }));
      }
    } catch (err) {
      console.error('PDF-Export fehlgeschlagen:', err);
      this.notify(t('toast.pdfExportFailed'));
    } finally {
      this.printPending = false;
    }
  }

  async print(): Promise<void> {
    const snapshot = this.snapshotActiveDocument();
    if (!snapshot || this.printPending) return;
    this.printPending = true;
    try {
      await this.withPrintDocument(snapshot, async () => {
        window.print();
      });
    } catch (err) {
      console.error('Druckvorbereitung fehlgeschlagen:', err);
      this.notify(t('toast.pdfExportFailed'));
    } finally {
      this.printPending = false;
    }
  }
}
