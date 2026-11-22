import { describe, expect, it, vi } from 'vitest';
import { safeSetMarkdownHTML } from '../sanitizer';

const mockMermaidRender = vi.fn();
const mockMermaidInitialize = vi.fn();

vi.mock('mermaid', () => ({
  default: {
    initialize: (...args: unknown[]) => mockMermaidInitialize(...args),
    render: (...args: unknown[]) => mockMermaidRender(...args),
  },
}));

describe('safeSetMarkdownHTML', () => {
  it('checks whether a render is current before updating the live DOM', async () => {
    const host = document.createElement('article');
    await safeSetMarkdownHTML(host, '<p>Newest preview</p>');
    let current = true;
    const pending = safeSetMarkdownHTML(host, '<p>Stale preview</p>', { isCurrent: () => current });
    current = false;
    expect(await pending).toBe(false);
    expect(host.textContent).toBe('Newest preview');
  });

  it('strips dangerous script tags and event attributes while preserving GFM attributes', async () => {
    const host = document.createElement('article');
    await safeSetMarkdownHTML(
      host,
      '<h1 id="titel" data-line="1" onclick="alert(1)">Hallo</h1><script>window.__xss = true;</script>',
    );

    const h1 = host.querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1?.getAttribute('id')).toBe('titel');
    expect(h1?.getAttribute('data-line')).toBe('1');
    expect(h1?.hasAttribute('onclick')).toBe(false);
    expect(host.querySelector('script')).toBeNull();
  });

  it('updates data-line attributes in place without recreating unchanged DOM nodes', async () => {
    const host = document.createElement('article');
    await safeSetMarkdownHTML(host, '<p data-line="2">Absatz bleibt identisch</p>');
    const originalParagraph = host.querySelector('p');
    expect(originalParagraph).not.toBeNull();

    await safeSetMarkdownHTML(host, '<p data-line="5">Absatz bleibt identisch</p>');
    const updatedParagraph = host.querySelector('p');
    expect(updatedParagraph).toBe(originalParagraph);
    expect(updatedParagraph?.getAttribute('data-line')).toBe('5');
  });

  it('preserves user open state on YAML frontmatter <details> cards across re-renders', async () => {
    const host = document.createElement('article');
    await safeSetMarkdownHTML(
      host,
      '<details class="frontmatter-card" data-line="1"><summary>YAML</summary><pre tabindex="0"><code>title: Test 1</code></pre></details>',
    );
    const details = host.querySelector('details') as HTMLDetailsElement;
    details.open = true;

    await safeSetMarkdownHTML(
      host,
      '<details class="frontmatter-card" data-line="1"><summary>YAML</summary><pre tabindex="0"><code>title: Test 2</code></pre></details>',
    );
    const nextDetails = host.querySelector('details') as HTMLDetailsElement;
    expect(nextDetails.open).toBe(true);
    expect(nextDetails.querySelector('code')?.textContent).toBe('title: Test 2');
  });

  it('preserves user open state on generic <details> elements across re-renders', async () => {
    const host = document.createElement('article');
    await safeSetMarkdownHTML(
      host,
      '<details data-line="1"><summary>Details</summary><p>Geheimer Inhalt</p></details>',
    );
    const details = host.querySelector('details') as HTMLDetailsElement;
    details.open = true;

    await safeSetMarkdownHTML(
      host,
      '<details data-line="1"><summary>Details</summary><p>Aktualisierter Inhalt</p></details>',
    );
    const nextDetails = host.querySelector('details') as HTMLDetailsElement;
    expect(nextDetails.open).toBe(true);
    expect(nextDetails.querySelector('p')?.textContent).toBe('Aktualisierter Inhalt');
  });

  it('renders cached KaTeX inline math blocks cleanly', async () => {
    const host = document.createElement('article');
    await safeSetMarkdownHTML(
      host,
      '<p data-line="1">Formel: <span class="math-inline" data-math="E = mc^2">E = mc^2</span></p>',
    );
    expect(host.querySelector('.katex')).not.toBeNull();
  });

  it('renders a neutral inline diagnostic hint and preserves source when Mermaid fails', async () => {
    mockMermaidRender.mockRejectedValueOnce(
      new Error('Syntax error in text <script>alert(1)</script>\nmermaid version 11.0.0'),
    );

    const host = document.createElement('article');
    await safeSetMarkdownHTML(
      host,
      '<div class="mermaid-wrapper" data-line="1" data-mermaid="graph TD; A--&gt;"><pre class="mermaid-source"><code>graph TD; A--&gt;</code></pre></div>',
    );

    const wrapper = host.querySelector('.mermaid-wrapper');
    expect(wrapper?.classList.contains('has-mermaid-error')).toBe(true);

    const hint = host.querySelector('.mermaid-error-hint');
    expect(hint).not.toBeNull();
    expect(hint?.getAttribute('role')).toBe('status');
    expect(hint?.querySelector('script')).toBeNull();
    expect(hint?.querySelector('.mermaid-error-message')?.textContent).toBe(
      'Syntax error in text <script>alert(1)</script>',
    );

    const sourceCode = host.querySelector('.mermaid-source code');
    expect(sourceCode?.textContent).toBe('graph TD; A-->');
  });

  it('renders Mermaid SVG and action buttons cleanly on success', async () => {
    mockMermaidRender.mockResolvedValueOnce({
      svg: '<svg viewBox="0 0 100 50"><text>OK</text></svg>',
    });

    const host = document.createElement('article');
    await safeSetMarkdownHTML(
      host,
      '<div class="mermaid-wrapper" data-line="1" data-mermaid="graph TD; A--&gt;B"><pre class="mermaid-source"><code>graph TD; A--&gt;B</code></pre></div>',
    );

    const wrapper = host.querySelector('.mermaid-wrapper');
    expect(wrapper?.classList.contains('has-mermaid-error')).toBe(false);
    expect(host.querySelector('.mermaid-error-hint')).toBeNull();
    expect(host.querySelector('.mermaid-actions')).not.toBeNull();
    expect(host.querySelector('svg')).not.toBeNull();
  });

  it('preserves frontmatter chips and nested <details> open state across re-renders', async () => {
    const host = document.createElement('article');
    await safeSetMarkdownHTML(
      host,
      '<div class="frontmatter-card" data-line="1"><div class="frontmatter-chips"><span class="frontmatter-chip"><span class="frontmatter-chip-key">title</span><span class="frontmatter-chip-val">V1</span></span></div><details><summary>Frontmatter (YAML)</summary><pre tabindex="0"><code>title: V1</code></pre></details></div>',
    );
    const details = host.querySelector('details') as HTMLDetailsElement;
    details.open = true;

    await safeSetMarkdownHTML(
      host,
      '<div class="frontmatter-card" data-line="1"><div class="frontmatter-chips"><span class="frontmatter-chip"><span class="frontmatter-chip-key">title</span><span class="frontmatter-chip-val">V2</span></span></div><details><summary>Frontmatter (YAML)</summary><pre tabindex="0"><code>title: V2</code></pre></details></div>',
    );
    const nextDetails = host.querySelector('details') as HTMLDetailsElement;
    expect(nextDetails.open).toBe(true);
    expect(host.querySelector('.frontmatter-chip-val')?.textContent).toBe('V2');
  });

  it('allows prompt-tag <section> blocks and data-prompt-tag while stripping XSS', async () => {
    const host = document.createElement('article');
    await safeSetMarkdownHTML(
      host,
      '<section class="prompt-tag-block" data-prompt-tag="role" data-line="3" onclick="alert(1)"><div class="prompt-tag-label">&lt;role&gt;</div><div class="prompt-tag-body"><p data-line="4">Be helpful</p><script>window.__xss=1</script></div></section>',
    );
    const section = host.querySelector('section.prompt-tag-block');
    expect(section).not.toBeNull();
    expect(section?.getAttribute('data-prompt-tag')).toBe('role');
    expect(section?.getAttribute('data-line')).toBe('3');
    expect(section?.hasAttribute('onclick')).toBe(false);
    expect(host.querySelector('.prompt-tag-label')?.textContent).toBe('<role>');
    expect(host.querySelector('.prompt-tag-body p')?.getAttribute('data-line')).toBe('4');
    expect(host.querySelector('script')).toBeNull();
  });

  it('uniquifies SVG IDs when restoring identical Mermaid diagrams from cache and supports explicit theme option', async () => {
    mockMermaidRender.mockImplementation(async (id: string) => ({
      svg: `<svg id="${id}" viewBox="0 0 100 50"><style>#${id} .edge{}</style><marker id="${id}_arrow"></marker></svg>`,
    }));

    const host = document.createElement('article');
    await safeSetMarkdownHTML(
      host,
      '<div class="mermaid-wrapper" data-line="1" data-mermaid="graph LR; X--&gt;Y"><pre class="mermaid-source"><code>graph LR; X--&gt;Y</code></pre></div>' +
        '<div class="mermaid-wrapper" data-line="5" data-mermaid="graph LR; X--&gt;Y"><pre class="mermaid-source"><code>graph LR; X--&gt;Y</code></pre></div>',
      { theme: 'dark' },
    );

    const svgs = host.querySelectorAll('svg');
    expect(svgs).toHaveLength(2);
    expect(svgs[0].id).toBeTruthy();
    expect(svgs[1].id).toBeTruthy();
    expect(svgs[0].id).not.toBe(svgs[1].id);
    expect(svgs[1].innerHTML).toContain(`#${svgs[1].id}`);
    expect(mockMermaidInitialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict', theme: 'dark' }),
    );
  });

  it('preserves <details open> state when nested inside list items', async () => {
    const host = document.createElement('article');
    await safeSetMarkdownHTML(
      host,
      '<ul data-line="1"><li data-line="1"><details><summary>Mehr</summary><p>Alt</p></details></li></ul>',
    );
    const details = host.querySelector('details') as HTMLDetailsElement;
    details.open = true;

    await safeSetMarkdownHTML(
      host,
      '<ul data-line="1"><li data-line="1"><details><summary>Mehr</summary><p>Neu</p></details></li></ul>',
    );
    const nextDetails = host.querySelector('details') as HTMLDetailsElement;
    expect(nextDetails.open).toBe(true);
    expect(nextDetails.querySelector('p')?.textContent).toBe('Neu');
  });

  it('preserves <details open> state when nested inside another <details> or table cell', async () => {
    const host = document.createElement('article');
    await safeSetMarkdownHTML(
      host,
      [
        '<details data-line="1"><summary>Außen</summary><details data-line="2"><summary>Innen</summary><p>Alt</p></details></details>',
        '<div class="table-wrapper" data-line="5"><table><thead><tr><th>Spalte</th></tr></thead><tbody><tr><td><details data-line="6"><summary>Zelle</summary><p>Alt Zelle</p></details></td></tr></tbody></table></div>',
      ].join(''),
    );
    const detailsList = Array.from(host.querySelectorAll('details')) as HTMLDetailsElement[];
    expect(detailsList).toHaveLength(3);
    detailsList[0].open = true;
    detailsList[1].open = true;
    detailsList[2].open = true;

    await safeSetMarkdownHTML(
      host,
      [
        '<details data-line="1"><summary>Außen</summary><details data-line="2"><summary>Innen</summary><p>Neu</p></details></details>',
        '<div class="table-wrapper" data-line="5"><table><thead><tr><th>Spalte</th></tr></thead><tbody><tr><td><details data-line="6"><summary>Zelle</summary><p>Neu Zelle</p></details></td></tr></tbody></table></div>',
      ].join(''),
    );
    const nextDetails = Array.from(host.querySelectorAll('details')) as HTMLDetailsElement[];
    expect(nextDetails).toHaveLength(3);
    expect(nextDetails[0].open).toBe(true);
    expect(nextDetails[1].open).toBe(true);
    expect(nextDetails[1].querySelector('p')?.textContent).toBe('Neu');
    expect(nextDetails[2].open).toBe(true);
    expect(nextDetails[2].querySelector('p')?.textContent).toBe('Neu Zelle');
  });
});
