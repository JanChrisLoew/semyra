import { backend } from './api';
import {
  EXPORT_THEME_PALETTES,
  copyRichPreviewToClipboard,
  preparePreviewHtmlForExport,
  renderDocument,
} from './export-utils';
import { getLanguage, t } from './i18n';
import { baseNameOfPath } from './path-utils';
import { safeSetMarkdownHTML } from './sanitizer';

export interface DocumentSnapshot {
  name: string;
  content: string;
  baseDir: string | null;
}

function buildExportThemeOverrideStyle(theme: 'light' | 'dark'): string {
  const p = EXPORT_THEME_PALETTES[theme];
  const mermaidRule = theme === 'dark'
    ? `\n  .mermaid-wrapper { background: ${p.surface} !important; color: ${p.fg} !important; }`
    : '';
  return `<style data-semyra-export-theme="${theme}">
  :root {
    color-scheme: ${theme} !important;
    --bg: ${p.bg} !important;
    --fg: ${p.fg} !important;
    --muted: ${p.muted} !important;
    --border: ${p.border} !important;
    --surface: ${p.surface} !important;
    --accent: ${p.accent} !important;
    --warning: ${p.warning} !important;
  }
  .hl-comment { color: ${p.syntax.comment} !important; font-style: italic; }
  .hl-keyword, .hl-storage { color: ${p.syntax.keyword} !important; font-weight: 500; }
  .hl-string { color: ${p.syntax.string} !important; }
  .hl-constant, .hl-numeric { color: ${p.syntax.constant} !important; }
  .hl-entity.hl-name.hl-function, .hl-support.hl-function { color: ${p.syntax.func} !important; }
  .hl-entity.hl-name.hl-type, .hl-entity.hl-name.hl-class, .hl-entity.hl-name.hl-struct { color: ${p.syntax.type} !important; }${mermaidRule}
</style>`;
}

export class DocumentExportController {
  private printPending = false;

  constructor(
    private readonly snapshotActiveDocument: () => DocumentSnapshot | undefined,
    private readonly printHost: HTMLElement,
    private readonly notify: (message: string) => void,
  ) {}

  private async renderDocumentSnapshot(
    snapshot: DocumentSnapshot,
    options: { docKey: string; forceLightTheme?: boolean; theme?: 'light' | 'dark' },
  ): Promise<HTMLElement> {
    const preview = document.createElement('article');
    preview.className = 'markdown-body';
    const result = await renderDocument(snapshot.name, snapshot.content, snapshot.baseDir, options.docKey);
    if (result.superseded) {
      throw new Error('Export render was superseded');
    }
    await safeSetMarkdownHTML(preview, result.html, {
      forceLightTheme: options.forceLightTheme,
      theme: options.theme,
    });
    return preview;
  }

  private async withPrintDocument<T>(
    snapshot: DocumentSnapshot,
    docKey: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const printDocument = await this.renderDocumentSnapshot(snapshot, {
      docKey,
      forceLightTheme: true,
      theme: 'light',
    });
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
      const preview = await this.renderDocumentSnapshot(snapshot, { docKey: 'export-copy' });
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
      const preview = themeOverride === 'dark'
        ? await this.renderDocumentSnapshot(snapshot, { docKey: 'export-html', theme: 'dark' })
        : await this.renderDocumentSnapshot(snapshot, {
            docKey: 'export-html',
            forceLightTheme: true,
            theme: 'light',
          });
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
        const name = baseNameOfPath(res.path);
        const images = res.images;
        this.notify(images && (images.missing || images.external)
          ? t('toast.htmlExportImages', { name, ...images })
          : t('toast.htmlExportSuccess', { name }));
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
      const res = await this.withPrintDocument(snapshot, 'export-pdf', () => backend.executePdfExport(token));
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
      await this.withPrintDocument(snapshot, 'export-print', async () => {
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
