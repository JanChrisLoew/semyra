import katex from 'katex';
import 'katex/dist/katex.min.css';

const SAFE_ELEMENTS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr', 'div', 'span', 'blockquote',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'strong', 'b', 'em', 'i', 'del', 's', 'u', 'mark', 'sub', 'sup', 'small', 'kbd',
  'code', 'pre',
  'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'details', 'summary', 'input', 'button',
];

const SAFE_ATTRIBUTES = [
  'id', 'class', 'href', 'src', 'alt', 'title', 'loading',
  'type', 'checked', 'disabled', 'start', 'scope', 'colspan', 'rowspan', 'open',
  'tabindex', 'role', 'aria-label', 'aria-labelledby',
  'data-line', 'data-task-line', 'data-math', 'data-mermaid', 'data-lang',
];

let domPurifyPromise: Promise<typeof import('dompurify')['default']> | undefined;

function loadDOMPurify() {
  domPurifyPromise ??= import('dompurify').then((mod) => mod.default ?? mod);
  return domPurifyPromise;
}

type ElementWithSetHTML = Element & {
  setHTML?: (html: string, options?: { sanitizer?: unknown }) => void;
};

const MAX_KATEX_CACHE = 400;
const katexCache = new Map<string, string>();

function renderCachedKatex(tex: string, displayMode: boolean): string | null {
  const key = `${displayMode ? 'D' : 'I'}::${tex}`;
  const cached = katexCache.get(key);
  if (cached !== undefined) {
    // Refresh LRU order
    katexCache.delete(key);
    katexCache.set(key, cached);
    return cached;
  }
  try {
    const html = katex.renderToString(tex, { displayMode, throwOnError: false });
    if (katexCache.size >= MAX_KATEX_CACHE) {
      const oldest = katexCache.keys().next().value;
      if (oldest !== undefined) katexCache.delete(oldest);
    }
    katexCache.set(key, html);
    return html;
  } catch {
    return null;
  }
}

const MAX_MERMAID_CACHE = 80;
const mermaidCache = new Map<string, string>();
let mermaidModulePromise: Promise<typeof import('mermaid')['default']> | undefined;
let mermaidCounter = 0;
let lastMermaidTheme: 'dark' | 'default' | null = null;

function isDarkColorSchemeActive(): boolean {
  const metaContent = document
    .querySelector('meta[name="color-scheme"]')
    ?.getAttribute('content');
  if (metaContent === 'dark') return true;
  if (metaContent === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Safely sanitizes rendered Markdown HTML in an offscreen staging container,
 * applies cached KaTeX & Mermaid enhancements without flickering, and reconciles
 * changed DOM blocks incrementally into the live preview container.
 */
export async function safeSetMarkdownHTML(
  container: HTMLElement,
  rawHtml: string,
): Promise<void> {
  const staging = document.createElement('div') as HTMLElement & ElementWithSetHTML;
  let insertedViaNative = false;

  if ('setHTML' in Element.prototype && typeof staging.setHTML === 'function') {
    try {
      staging.setHTML(rawHtml, {
        sanitizer: {
          elements: SAFE_ELEMENTS,
          attributes: SAFE_ATTRIBUTES,
        },
      });
      insertedViaNative = true;
    } catch {
      insertedViaNative = false;
    }
  }

  if (!insertedViaNative) {
    const DOMPurify = await loadDOMPurify();
    staging.innerHTML = DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [...SAFE_ELEMENTS, '#text'],
      ALLOWED_ATTR: SAFE_ATTRIBUTES,
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: false,
    });
  }

  // Enhance KaTeX inline & display math blocks using LRU cache
  const inlineMathNodes = staging.querySelectorAll<HTMLElement>('.math-inline[data-math]');
  for (const node of inlineMathNodes) {
    const tex = node.getAttribute('data-math') ?? '';
    const rendered = renderCachedKatex(tex, false);
    if (rendered !== null) {
      node.innerHTML = rendered;
    } else {
      node.textContent = tex;
    }
  }

  const displayMathNodes = staging.querySelectorAll<HTMLElement>('.math-display[data-math]');
  for (const node of displayMathNodes) {
    const tex = node.getAttribute('data-math') ?? '';
    const rendered = renderCachedKatex(tex, true);
    if (rendered !== null) {
      node.innerHTML = rendered;
    } else {
      node.textContent = tex;
    }
  }

  // Lazy-load and cache Mermaid diagrams offscreen before reconciling into live DOM
  const mermaidNodes = staging.querySelectorAll<HTMLElement>('.mermaid-wrapper[data-mermaid]');
  if (mermaidNodes.length > 0) {
    await renderMermaidBlocksCached(mermaidNodes);
  }

  reconcileChildren(container, staging);
}

async function renderMermaidBlocksCached(nodes: NodeListOf<HTMLElement>): Promise<void> {
  const theme: 'dark' | 'default' = isDarkColorSchemeActive() ? 'dark' : 'default';

  // Fast-path: check if every Mermaid diagram in this document is already cached
  let hasUncached = false;
  for (const wrapper of nodes) {
    const def = (wrapper.getAttribute('data-mermaid') ?? '').trim();
    if (!def) continue;
    const cachedSvg = mermaidCache.get(`${theme}::${def}`);
    if (cachedSvg !== undefined) {
      wrapper.innerHTML = cachedSvg;
    } else {
      hasUncached = true;
    }
  }

  if (!hasUncached) return;

  try {
    mermaidModulePromise ??= import('mermaid').then((m) => m.default);
    const mermaid = await mermaidModulePromise;

    if (lastMermaidTheme !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme,
      });
      lastMermaidTheme = theme;
    }

    for (const wrapper of nodes) {
      const definition = (wrapper.getAttribute('data-mermaid') ?? '').trim();
      if (!definition) continue;
      const cacheKey = `${theme}::${definition}`;
      const existing = mermaidCache.get(cacheKey);
      if (existing !== undefined) {
        wrapper.innerHTML = existing;
        continue;
      }

      const id = `marklive-mermaid-${++mermaidCounter}`;
      try {
        const { svg } = await mermaid.render(id, definition);
        if (mermaidCache.size >= MAX_MERMAID_CACHE) {
          const oldest = mermaidCache.keys().next().value;
          if (oldest !== undefined) mermaidCache.delete(oldest);
        }
        mermaidCache.set(cacheKey, svg);
        wrapper.innerHTML = svg;
      } catch {
        // Clean up any orphaned temporary error element Mermaid might have appended
        document.getElementById(`d${id}`)?.remove();
        document.getElementById(id)?.remove();
      }
    }
  } catch {
    // Keep readable fallback code block
  }
}

function syncElementAttributes(target: Element, source: Element): void {
  const targetAttrs = target.getAttributeNames();
  for (const name of targetAttrs) {
    if (!source.hasAttribute(name)) {
      target.removeAttribute(name);
    }
  }
  for (const attr of Array.from(source.attributes)) {
    if (target.getAttribute(attr.name) !== attr.value) {
      target.setAttribute(attr.name, attr.value);
    }
  }
}

/**
 * Incrementally patches `container` child nodes to match `staging` without
 * destroying unchanged blocks, images, SVGs, or open <details> state.
 */
function reconcileChildren(container: HTMLElement, staging: HTMLElement): void {
  const nextChildren = Array.from(staging.childNodes);
  let cursor: ChildNode | null = container.firstChild;

  for (const nextNode of nextChildren) {
    if (!cursor) {
      container.appendChild(nextNode);
      continue;
    }

    if (cursor.isEqualNode(nextNode)) {
      cursor = cursor.nextSibling;
      continue;
    }

    if (
      cursor.nodeType === Node.ELEMENT_NODE &&
      nextNode.nodeType === Node.ELEMENT_NODE
    ) {
      const curEl = cursor as HTMLElement;
      const nextEl = nextNode as HTMLElement;

      if (curEl.tagName === nextEl.tagName && curEl.className === nextEl.className) {
        // Preserve user's expand/collapse toggle state on YAML frontmatter card
        if (
          curEl instanceof HTMLDetailsElement &&
          nextEl instanceof HTMLDetailsElement &&
          curEl.classList.contains('frontmatter-card')
        ) {
          nextEl.open = curEl.open;
        }

        // Fast attribute-only update when a block simply shifted line numbers (`data-line`)
        if (curEl.innerHTML === nextEl.innerHTML) {
          syncElementAttributes(curEl, nextEl);
          cursor = cursor.nextSibling;
          continue;
        }

        // Recurse into compound block wrappers (lists, blockquotes, alerts, tables)
        if (
          curEl.tagName === 'UL' ||
          curEl.tagName === 'OL' ||
          curEl.tagName === 'BLOCKQUOTE' ||
          curEl.classList.contains('gfm-alert') ||
          curEl.classList.contains('table-wrapper')
        ) {
          syncElementAttributes(curEl, nextEl);
          reconcileChildren(curEl, nextEl);
          cursor = cursor.nextSibling;
          continue;
        }
      }
    }

    const afterCursor = cursor.nextSibling;
    container.replaceChild(nextNode, cursor);
    cursor = afterCursor;
  }

  // Remove any trailing stale nodes
  while (cursor) {
    const toRemove = cursor;
    cursor = cursor.nextSibling;
    container.removeChild(toRemove);
  }
}
