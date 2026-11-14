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

function buildExportThemeOverrideStyle(theme: 'light' | 'dark'): string {
  if (theme === 'light') {
    return `<style data-semyra-export-theme="light">
  :root {
    color-scheme: light !important;
    --bg: #ffffff !important;
    --fg: #202934 !important;
    --muted: #506173 !important;
    --border: #d6dde4 !important;
    --surface: #f3f5f7 !important;
    --accent: #426b91 !important;
    --warning: #986c3d !important;
  }
  .hl-comment { color: #6e7781 !important; font-style: italic; }
  .hl-keyword, .hl-storage { color: #cf222e !important; font-weight: 500; }
  .hl-string { color: #0a3069 !important; }
  .hl-constant, .hl-numeric { color: #0550ae !important; }
  .hl-entity.hl-name.hl-function, .hl-support.hl-function { color: #8250df !important; }
  .hl-entity.hl-name.hl-type, .hl-entity.hl-name.hl-class, .hl-entity.hl-name.hl-struct { color: #953800 !important; }
</style>`;
  }
  return `<style data-semyra-export-theme="dark">
  :root {
    color-scheme: dark !important;
    --bg: #12161e !important;
    --fg: #edf2f5 !important;
    --muted: #8292a2 !important;
    --border: #323e4d !important;
    --surface: #1a212b !important;
    --accent: #83a5c6 !important;
    --warning: #d0a774 !important;
  }
  .hl-comment { color: #8b949e !important; font-style: italic; }
  .hl-keyword, .hl-storage { color: #ff7b72 !important; font-weight: 500; }
  .hl-string { color: #a5d6ff !important; }
  .hl-constant, .hl-numeric { color: #79c0ff !important; }
  .hl-entity.hl-name.hl-function, .hl-support.hl-function { color: #d2a8ff !important; }
  .hl-entity.hl-name.hl-type, .hl-entity.hl-name.hl-class, .hl-entity.hl-name.hl-struct { color: #ffa657 !important; }
  .mermaid-wrapper { background: #1a212b !important; color: #edf2f5 !important; }
</style>`;
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
    const result = await renderDocument(snapshot.name, snapshot.content, snapshot.baseDir, 'export');
    if (result.superseded) {
      throw new Error('Export render was superseded');
    }
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

  async exportHtml(themeOverride?: 'light' | 'dark'): Promise<void> {
    const snapshot = this.snapshotActiveDocument();
    if (!snapshot) return;
    try {
      let preview: HTMLElement;
      if (themeOverride === 'dark') {
        const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
        const prevContent = meta?.getAttribute('content') ?? null;
        if (meta) meta.setAttribute('content', 'dark');
        try {
          preview = await this.renderDocumentSnapshot(snapshot, false);
        } finally {
          if (meta) {
            if (prevContent !== null) meta.setAttribute('content', prevContent);
            else meta.removeAttribute('content');
          }
        }
      } else {
        preview = await this.renderDocumentSnapshot(snapshot, true);
      }
      const baseHtml = await preparePreviewHtmlForExport(preview, { mermaidAlreadyLight: true });
      const renderedHtml = themeOverride
        ? `${buildExportThemeOverrideStyle(themeOverride)}${baseHtml}`
        : baseHtml;
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
