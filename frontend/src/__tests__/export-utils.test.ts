import { describe, expect, it, vi } from 'vitest';
import { buildOfficeFriendlyHtml, preparePreviewHtmlForExport } from '../export-utils';

describe('export-utils', () => {
  it('strips interactive copy buttons and duplicate .katex-html spans while syncing checkboxes without mutating live DOM', () => {
    const host = document.createElement('article');
    host.innerHTML = `
      <div class="code-block-wrapper">
        <div class="code-block-header"><span class="code-lang-badge">rust</span><button class="copy-code-btn">Kopieren</button></div>
        <pre><code>fn main() {}</code></pre>
      </div>
      <p class="math-inline">
        <span class="katex"><span class="katex-mathml"><math><mi>E</mi></math></span><span class="katex-html" aria-hidden="true">E</span></span>
      </p>
      <ul>
        <li><input type="checkbox" class="task-checkbox"> Offen</li>
        <li><input type="checkbox" class="task-checkbox"> Erledigt</li>
      </ul>
      <div class="mermaid-block"><svg><rect width="10" height="10"></rect></svg></div>
    `;
    const boxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    boxes[1].checked = true;

    const exported = preparePreviewHtmlForExport(host);

    // Live DOM still retains its copy button and KaTeX HTML tree
    expect(host.querySelector('.copy-code-btn')).not.toBeNull();
    expect(host.querySelector('.katex-html')).not.toBeNull();
    // Exported HTML strips copy button & duplicate .katex-html, preserves MathML + SVG + checked state
    expect(exported).not.toContain('copy-code-btn');
    expect(exported).not.toContain('katex-html');
    expect(exported).toContain('<math><mi>E</mi></math>');
    expect(exported).toContain('<svg>');
    expect(exported).toContain('checked=""');
  });

  it('builds Office-friendly HTML with column alignments, GFM alert colors, stripped code headers, and base64 assets', async () => {
    const host = document.createElement('article');
    host.innerHTML = `
      <div class="code-block-wrapper">
        <div class="code-block-header"><span class="code-lang-badge">ts</span><button class="copy-code-btn">Kopieren</button></div>
        <pre><code>const x = 1;</code></pre>
      </div>
      <table>
        <thead><tr><th class="align-center">Zentriert</th><th class="align-right">Rechts</th></tr></thead>
        <tbody><tr><td class="align-center">A</td><td class="align-right">42</td></tr></tbody>
      </table>
      <div class="gfm-alert gfm-alert-warning">
        <div class="gfm-alert-title">Warnung</div>
        <p>Wichtiger Hinweis.</p>
      </div>
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
    expect(richHtml).not.toContain('code-block-header');
    expect(richHtml).toContain('border-collapse: collapse');
    expect(richHtml).toContain('text-align: center;');
    expect(richHtml).toContain('text-align: right;');
    expect(richHtml).toContain('border-left: 4px solid #d29922');
    expect(richHtml).toContain('src="data:image/png;base64,');
  });
});
