/**
 * Preview HTML export & Rich-Text clipboard utilities.
 *
 * Ensures exported standalone HTML and rich clipboard payloads preserve rendered
 * KaTeX MathML, Mermaid SVGs, task-list checked states, and base64-inlined local images,
 * while stripping interactive editor-only buttons (`.copy-code-btn`).
 */

function syncTaskCheckboxesAndStripChrome(clone: HTMLElement, source: HTMLElement): void {
  const srcInputs = source.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  const dstInputs = clone.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  dstInputs.forEach((dst, idx) => {
    const isChecked = srcInputs[idx]?.checked ?? dst.hasAttribute('checked');
    if (isChecked) {
      dst.setAttribute('checked', '');
    } else {
      dst.removeAttribute('checked');
    }
    dst.setAttribute('disabled', '');
  });

  for (const btn of clone.querySelectorAll('.copy-code-btn')) {
    btn.remove();
  }
}

/**
 * Prepares the live `#preview-content` DOM for standalone 1-file HTML export,
 * preserving client-rendered KaTeX MathML and Mermaid `<svg>` diagrams.
 */
export function preparePreviewHtmlForExport(previewEl: HTMLElement): string {
  const clone = previewEl.cloneNode(true) as HTMLElement;
  syncTaskCheckboxesAndStripChrome(clone, previewEl);
  return clone.innerHTML;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function inlineLocalAssetImagesInDom(
  root: HTMLElement,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img[src]'));
  await Promise.all(
    images.map(async (img) => {
      const rawSrc = img.getAttribute('src') ?? '';
      if (!rawSrc.startsWith('/api/local-asset?')) return;
      try {
        const res = await fetchFn(rawSrc);
        if (!res.ok) return;
        const contentType =
          res.headers.get('content-type')?.split(';')[0].trim() || 'image/png';
        const buf = await res.arrayBuffer();
        const b64 = bytesToBase64(new Uint8Array(buf));
        img.setAttribute('src', `data:${contentType};base64,${b64}`);
      } catch {
        // Keep original src if asset cannot be fetched
      }
    }),
  );
}

/**
 * Builds an Office-, Outlook-, Teams-, and Confluence-friendly HTML fragment with
 * inline structural styles (table borders, code blocks, blockquotes, alerts) and
 * base64-inlined local images.
 */
export async function buildOfficeFriendlyHtml(
  previewEl: HTMLElement,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const clone = previewEl.cloneNode(true) as HTMLElement;
  syncTaskCheckboxesAndStripChrome(clone, previewEl);
  await inlineLocalAssetImagesInDom(clone, fetchFn);

  for (const table of clone.querySelectorAll<HTMLElement>('table')) {
    table.setAttribute(
      'style',
      'border-collapse: collapse; margin: 12px 0; font-family: "Segoe UI", system-ui, sans-serif; font-size: 10.5pt;',
    );
  }
  for (const th of clone.querySelectorAll<HTMLElement>('th')) {
    th.setAttribute(
      'style',
      'border: 1px solid #d0d7de; padding: 6px 12px; background-color: #f6f8fa; font-weight: 600; text-align: left;',
    );
  }
  for (const td of clone.querySelectorAll<HTMLElement>('td')) {
    td.setAttribute('style', 'border: 1px solid #d0d7de; padding: 6px 12px;');
  }
  for (const pre of clone.querySelectorAll<HTMLElement>('pre')) {
    pre.setAttribute(
      'style',
      'padding: 12px 14px; border-radius: 6px; background-color: #f6f8fa; border: 1px solid #d0d7de; font-family: Cascadia Mono, Consolas, monospace; font-size: 9.5pt; white-space: pre-wrap;',
    );
  }
  for (const code of clone.querySelectorAll<HTMLElement>('code')) {
    if (code.parentElement?.tagName !== 'PRE') {
      code.setAttribute(
        'style',
        'padding: 1px 4px; border-radius: 4px; background-color: #f0f2f5; font-family: Cascadia Mono, Consolas, monospace; font-size: 9.5pt;',
      );
    }
  }
  for (const quote of clone.querySelectorAll<HTMLElement>('blockquote')) {
    quote.setAttribute(
      'style',
      'margin: 10px 0; padding: 4px 14px; border-left: 4px solid #005fb8; color: #444c56;',
    );
  }
  for (const alert of clone.querySelectorAll<HTMLElement>('.markdown-alert')) {
    alert.setAttribute(
      'style',
      'margin: 12px 0; padding: 10px 14px; border-left: 4px solid #005fb8; background-color: #f6f8fa; border-radius: 4px;',
    );
  }

  return `<div style="font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 11pt; line-height: 1.6; color: #1b1b1f;">${clone.innerHTML}</div>`;
}

/**
 * Copies rendered HTML + plain text fallback into the system clipboard.
 */
export async function copyRichPreviewToClipboard(
  previewEl: HTMLElement,
  fallbackPlain: string,
): Promise<void> {
  const html = await buildOfficeFriendlyHtml(previewEl);
  const plain = previewEl.innerText?.trim() || fallbackPlain;

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    const item = new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plain], { type: 'text/plain' }),
    });
    await navigator.clipboard.write([item]);
    return;
  }

  await navigator.clipboard.writeText(plain);
}
