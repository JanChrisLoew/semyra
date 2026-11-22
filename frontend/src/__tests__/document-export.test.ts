import { afterEach, describe, expect, it, vi } from 'vitest';
import { backend } from '../api';
import { DocumentExportController } from '../document-export';
import * as exportUtils from '../export-utils';
import * as sanitizer from '../sanitizer';

function setupExportController() {
  const printHost = document.createElement('div');
  const notify = vi.fn();
  const controller = new DocumentExportController(
    () => ({ name: 'Guide.md', content: '# Hello', baseDir: 'C:\\Docs' }),
    printHost,
    notify,
  );
  return { controller, printHost, notify };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.head.innerHTML = '';
});

describe('DocumentExportController', () => {
  it('passes explicit theme without mutating global color-scheme meta on dark HTML export', async () => {
    const meta = document.createElement('meta');
    meta.name = 'color-scheme';
    meta.content = 'light';
    document.head.appendChild(meta);

    let metaDuringSafeSet: string | null = null;
    const renderDoc = vi.spyOn(exportUtils, 'renderDocument').mockResolvedValue({
      html: '<h1>Hello</h1>',
      outline: [],
      stats: { words: 1, chars: 7, lines: 1, readingTimeSec: 1 },
    });
    const safeSet = vi.spyOn(sanitizer, 'safeSetMarkdownHTML').mockImplementation(async (el) => {
      metaDuringSafeSet = meta.getAttribute('content');
      el.innerHTML = '<h1>Hello</h1>';
      return true;
    });
    vi.spyOn(exportUtils, 'preparePreviewHtmlForExport').mockResolvedValue('<h1>Hello</h1>');
    const exportDialog = vi.spyOn(backend, 'exportHtmlDialog').mockResolvedValue({
      exported: true,
      path: 'C:\\Docs\\Guide.html',
    });

    const { controller, notify } = setupExportController();
    await controller.exportHtml('dark');

    expect(renderDoc).toHaveBeenCalledWith('Guide.md', '# Hello', 'C:\\Docs', 'export-html');
    expect(safeSet).toHaveBeenCalledWith(expect.any(HTMLElement), '<h1>Hello</h1>', {
      forceLightTheme: undefined,
      theme: 'dark',
    });
    expect(metaDuringSafeSet).toBe('light');
    expect(meta.getAttribute('content')).toBe('light');
    expect(exportDialog).toHaveBeenCalledWith(
      'Guide.md',
      '# Hello',
      'C:\\Docs',
      'C:\\Docs',
      expect.stringContaining('data-semyra-export-theme="dark"'),
      expect.any(String),
    );
    expect(notify).toHaveBeenCalledOnce();
  });

  it('uses distinct docKeys for rich copy and print and cleans up printDocument on error', async () => {
    const renderDoc = vi.spyOn(exportUtils, 'renderDocument').mockResolvedValue({
      html: '<p>Body</p><img src="/api/local-asset?path=x.png">',
      outline: [],
      stats: { words: 1, chars: 4, lines: 1, readingTimeSec: 1 },
    });
    vi.spyOn(sanitizer, 'safeSetMarkdownHTML').mockImplementation(async (el, html) => {
      el.innerHTML = html;
      return true;
    });
    vi.spyOn(exportUtils, 'copyRichPreviewToClipboard').mockResolvedValue();

    const { controller, printHost, notify } = setupExportController();
    await controller.copyRichText();
    expect(renderDoc).toHaveBeenLastCalledWith('Guide.md', '# Hello', 'C:\\Docs', 'export-copy');

    vi.spyOn(backend, 'pickPdfSavePath').mockResolvedValue({ chosen: true, token: 42 });
    vi.spyOn(backend, 'executePdfExport').mockRejectedValue(new Error('print failed'));
    await controller.exportPdf();

    expect(renderDoc).toHaveBeenLastCalledWith('Guide.md', '# Hello', 'C:\\Docs', 'export-pdf');
    expect(printHost.querySelector('.print-document')).toBeNull();
    expect(notify).toHaveBeenCalledTimes(2);

    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    await controller.print();
    expect(renderDoc).toHaveBeenLastCalledWith('Guide.md', '# Hello', 'C:\\Docs', 'export-print');
    expect(printSpy).toHaveBeenCalledOnce();
    expect(printHost.querySelector('.print-document')).toBeNull();
  });

  it('prevents concurrent PDF/print runs while printPending is active', async () => {
    let resolvePick!: (val: { chosen: boolean; token?: number }) => void;
    const pickSpy = vi.spyOn(backend, 'pickPdfSavePath').mockReturnValue(
      new Promise((resolve) => {
        resolvePick = resolve;
      }),
    );

    const { controller } = setupExportController();
    const first = controller.exportPdf();
    const second = controller.print();

    expect(pickSpy).toHaveBeenCalledOnce();
    resolvePick({ chosen: false });
    await Promise.all([first, second]);
  });
});
