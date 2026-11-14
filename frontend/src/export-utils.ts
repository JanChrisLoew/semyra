/**
 * Preview HTML export & Rich-Text clipboard utilities.
 *
 * Ensures exported standalone HTML and rich clipboard payloads preserve rendered
 * KaTeX MathML (without duplicate `.katex-html` span trees), Mermaid SVGs,
 * task-list checked states, GFM alert colors, table alignments, and base64-inlined
 * local images, while stripping interactive editor-only chrome (`.copy-code-btn`).
 */

import { renderMermaidLightInClone } from './sanitizer';
import { backend } from './api';
import { getFileExtension, isMarkdownPath } from './path-utils';

const TEXT_LANGUAGES: Record<string, string> = {
  yml: 'yaml',
  txt: 'text',
  csv: 'text',
  log: 'text',
  env: 'properties',
  js: 'javascript',
  ts: 'typescript',
  rs: 'rust',
};

export function renderDocument(
  name: string,
  content: string,
  baseDir: string | null,
  docKey?: string,
) {
  if (isMarkdownPath(name)) return backend.renderMarkdown(content, baseDir, docKey);
  const ext = getFileExtension(name);
  const language = TEXT_LANGUAGES[ext] ?? (ext || 'text');
  let fence = '```';
  while (content.includes(fence)) fence += '`';
  return backend.renderMarkdown(`${fence}${language}\n${content}\n${fence}`, baseDir, docKey);
}

const ALERT_COLORS: Record<string, string> = {
  'gfm-alert-note': '#426b91',
  'gfm-alert-tip': '#24756c',
  'gfm-alert-important': '#8250df',
  'gfm-alert-warning': '#986c3d',
  'gfm-alert-caution': '#c42b1c',
};

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

  // Strip interactive copy buttons, mermaid action toolbars, font-dependent `.katex-html` spans, and `<annotation>`
  // TeX source nodes so native MathML renders once cleanly without raw TeX duplication in Word/Teams.
  for (const el of clone.querySelectorAll(
    '.copy-code-btn, .mermaid-actions, .katex-html, math annotation',
  )) {
    el.remove();
  }

  // Unwrap `<semantics>` inside `<math>` so pure Presentation MathML `<mrow>` sits directly under `<math>`
  for (const sem of Array.from(clone.querySelectorAll('math semantics'))) {
    const parent = sem.parentNode;
    if (!parent) continue;
    while (sem.firstChild) {
      parent.insertBefore(sem.firstChild, sem);
    }
    sem.remove();
  }
}

/**
 * Prepares a detached clone of `#preview-content` for standalone 1-file HTML export,
 * preserving client-rendered KaTeX MathML and rendering crisp light-theme Mermaid SVGs
 * without mutating or flashing the live preview DOM.
 */
export async function preparePreviewHtmlForExport(
  previewEl: HTMLElement,
  options?: { mermaidAlreadyLight?: boolean },
): Promise<string> {
  const clone = previewEl.cloneNode(true) as HTMLElement;
  syncTaskCheckboxesAndStripChrome(clone, previewEl);
  if (!options?.mermaidAlreadyLight) await renderMermaidLightInClone(clone);
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

function resolveCellTextAlign(cell: HTMLElement): 'left' | 'center' | 'right' {
  if (cell.classList.contains('align-center')) return 'center';
  if (cell.classList.contains('align-right')) return 'right';
  return 'left';
}

/**
 * Builds an Office-, Outlook-, Teams-, and Confluence-friendly HTML fragment with
 * inline structural styles (table borders + alignments, code blocks, blockquotes,
 * GFM alerts) and base64-inlined local images.
 */
export async function buildOfficeFriendlyHtml(
  previewEl: HTMLElement,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const clone = previewEl.cloneNode(true) as HTMLElement;
  syncTaskCheckboxesAndStripChrome(clone, previewEl);

  // Strip code-block header bar (language badge) so Word/Outlook/Teams receive clean <pre> blocks
  for (const hdr of clone.querySelectorAll('.code-block-header')) {
    hdr.remove();
  }

  await renderMermaidLightInClone(clone);
  await inlineLocalAssetImagesInDom(clone, fetchFn);

  for (const table of clone.querySelectorAll<HTMLElement>('table')) {
    table.setAttribute(
      'style',
      'border-collapse: collapse; margin: 12px 0; font-family: "Segoe UI", system-ui, sans-serif; font-size: 10.5pt;',
    );
  }
  for (const th of clone.querySelectorAll<HTMLElement>('th')) {
    const align = resolveCellTextAlign(th);
    th.setAttribute(
      'style',
      `border: 1px solid #d0d7de; padding: 6px 12px; background-color: #f6f8fa; font-weight: 600; text-align: ${align};`,
    );
  }
  for (const td of clone.querySelectorAll<HTMLElement>('td')) {
    const align = resolveCellTextAlign(td);
    td.setAttribute(
      'style',
      `border: 1px solid #d0d7de; padding: 6px 12px; text-align: ${align};`,
    );
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
      'margin: 10px 0; padding: 6px 14px; border-left: 3.5px solid #d0d7de; background-color: #f6f8fa; border-radius: 0 6px 6px 0; color: #202934;',
    );
  }
  for (const alert of clone.querySelectorAll<HTMLElement>('.gfm-alert')) {
    let accent = '#3b678f';
    for (const [cls, hex] of Object.entries(ALERT_COLORS)) {
      if (alert.classList.contains(cls)) {
        accent = hex;
        break;
      }
    }
    alert.setAttribute(
      'style',
      `margin: 12px 0; padding: 10px 14px; border-left: 4px solid ${accent}; background-color: #f6f8fa; border-radius: 4px;`,
    );
    const titleEl = alert.querySelector<HTMLElement>('.gfm-alert-title');
    if (titleEl) {
      titleEl.setAttribute(
        'style',
        `font-weight: 600; margin: 0 0 4px 0; color: ${accent};`,
      );
    }
  }
  for (const card of clone.querySelectorAll<HTMLElement>('.frontmatter-card')) {
    card.setAttribute(
      'style',
      'margin: 0 0 14px 0; border: 1px solid #d6dde4; border-radius: 6px; background-color: #f8fafc; font-size: 9.5pt;',
    );
  }
  for (const chips of clone.querySelectorAll<HTMLElement>('.frontmatter-chips')) {
    chips.setAttribute(
      'style',
      'display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; border-bottom: 1px solid #d6dde4;',
    );
  }
  for (const chip of clone.querySelectorAll<HTMLElement>('.frontmatter-chip')) {
    chip.setAttribute(
      'style',
      'display: inline-block; border: 1px solid #d6dde4; border-radius: 4px; background-color: #ffffff; font-size: 9pt;',
    );
  }
  for (const keyEl of clone.querySelectorAll<HTMLElement>('.frontmatter-chip-key')) {
    keyEl.setAttribute(
      'style',
      'padding: 2px 6px; font-family: Cascadia Mono, Consolas, monospace; font-weight: 600; color: #506173; background-color: #f0f3f6; border-right: 1px solid #d6dde4;',
    );
  }
  for (const valEl of clone.querySelectorAll<HTMLElement>('.frontmatter-chip-val')) {
    valEl.setAttribute('style', 'padding: 2px 7px; color: #202934;');
  }
  for (const block of clone.querySelectorAll<HTMLElement>('.prompt-tag-block')) {
    block.setAttribute(
      'style',
      'margin: 12px 0; border: 1px solid #d6dde4; border-left: 3px solid #426b91; border-radius: 6px; background-color: #f8fafc;',
    );
    const labelEl = block.querySelector<HTMLElement>('.prompt-tag-label');
    if (labelEl) {
      labelEl.setAttribute(
        'style',
        'padding: 5px 12px; font-family: Cascadia Mono, Consolas, monospace; font-size: 9pt; font-weight: 600; color: #426b91; background-color: #f0f3f6; border-bottom: 1px solid #d6dde4;',
      );
    }
    const bodyEl = block.querySelector<HTMLElement>('.prompt-tag-body');
    if (bodyEl) {
      bodyEl.setAttribute('style', 'padding: 10px 14px; color: #202934;');
    }
  }

  return `<div style="font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 11pt; line-height: 1.6; color: #1b1b1f;">${clone.innerHTML}</div>`;
}

/**
 * Extracts clean plain-text representation from a preview DOM element without
 * leaking `.copy-code-btn` ("Kopieren") labels or duplicated KaTeX `.katex-html` / `<annotation>` text.
 */
export function extractCleanPreviewPlainText(
  previewEl: HTMLElement,
  fallbackPlain: string,
): string {
  const clone = previewEl.cloneNode(true) as HTMLElement;
  syncTaskCheckboxesAndStripChrome(clone, previewEl);
  for (const hdr of clone.querySelectorAll('.code-block-header')) {
    hdr.remove();
  }
  const text = clone.textContent?.replace(/\n{3,}/g, '\n\n').trim();
  return text || fallbackPlain;
}

/**
 * Copies rendered HTML + clean plain-text fallback into the system clipboard.
 */
export async function copyRichPreviewToClipboard(
  previewEl: HTMLElement,
  fallbackPlain: string,
): Promise<void> {
  const html = await buildOfficeFriendlyHtml(previewEl);
  const plain = extractCleanPreviewPlainText(previewEl, fallbackPlain);

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
