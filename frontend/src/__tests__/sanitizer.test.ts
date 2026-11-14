import { describe, expect, it } from 'vitest';
import { safeSetMarkdownHTML } from '../sanitizer';

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
});
