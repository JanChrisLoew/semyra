import { describe, expect, it, vi } from 'vitest';
import { buildOfficeFriendlyHtml, preparePreviewHtmlForExport } from '../export-utils';

describe('export-utils', () => {
  it('strips interactive copy buttons and syncs checkbox checked attributes without mutating live DOM', () => {
    const host = document.createElement('article');
    host.innerHTML = `
      <div class="code-block-wrapper">
        <button class="copy-code-btn">Kopieren</button>
        <pre><code>fn main() {}</code></pre>
      </div>
      <ul>
        <li><input type="checkbox" class="task-checkbox"> Offen</li>
        <li><input type="checkbox" class="task-checkbox"> Erledigt</li>
      </ul>
      <div class="mermaid-block"><svg><rect width="10" height="10"></rect></svg></div>
    `;
    const boxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    boxes[1].checked = true;

    const exported = preparePreviewHtmlForExport(host);

    // Live DOM still retains its copy button
    expect(host.querySelector('.copy-code-btn')).not.toBeNull();
    // Exported HTML strips copy button, preserves SVG, and serializes checked state
    expect(exported).not.toContain('copy-code-btn');
    expect(exported).toContain('<svg>');
    expect(exported).toContain('checked=""');
  });

  it('builds Office-friendly HTML with inline table styles and base64-inlined local assets', async () => {
    const host = document.createElement('article');
    host.innerHTML = `
      <table>
        <thead><tr><th>Spalte</th></tr></thead>
        <tbody><tr><td>Wert</td></tr></tbody>
      </table>
      <p><img src="/api/local-asset?path=C%3A%5Cdocs%5Cchart.png" alt="Diagramm"></p>
    `;

    const mockFetch = vi.fn(async () => {
      const pngBytes = new Uint8Array([137, 80, 78, 71]);
      return new Response(pngBytes, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }) as unknown as typeof fetch;

    const richHtml = await buildOfficeFriendlyHtml(host, mockFetch);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(richHtml).toContain('border-collapse: collapse');
    expect(richHtml).toContain('border: 1px solid #d0d7de');
    expect(richHtml).toContain('src="data:image/png;base64,');
  });
});
