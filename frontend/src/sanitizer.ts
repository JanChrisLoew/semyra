import katex from 'katex';
import 'katex/dist/katex.min.css';
import { getLanguage } from './i18n';

const SAFE_ELEMENTS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr', 'div', 'span', 'section', 'blockquote',
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
  'data-prompt-tag',
  'data-i18n', 'data-i18n-title', 'data-i18n-aria',
];

let domPurifyPromise: Promise<{
  sanitize: (source: string, config?: Record<string, unknown>) => string;
}> | undefined;

function loadDOMPurify() {
  domPurifyPromise ??= import('dompurify').then((mod) => {
    const candidate = (mod.default ?? mod) as unknown as {
      isSupported?: boolean;
      sanitize?: (source: string, config?: Record<string, unknown>) => string;
      (win?: Window): { sanitize: (source: string, config?: Record<string, unknown>) => string };
    };
    if (candidate.isSupported && typeof candidate.sanitize === 'function') {
      return { sanitize: candidate.sanitize.bind(candidate) };
    }
    return candidate(window);
  });
  return domPurifyPromise;
}

type ElementWithSetHTML = Element & {
  setHTML?: (html: string, options?: { sanitizer?: unknown }) => void;
};

let nativeSetHTMLSupported: boolean | undefined;

function supportsNativeSetHTMLSanitizer(): boolean {
  if (nativeSetHTMLSupported !== undefined) return nativeSetHTMLSupported;
  try {
    const probe = document.createElement('div') as HTMLElement & ElementWithSetHTML;
    if (typeof probe.setHTML !== 'function') {
      nativeSetHTMLSupported = false;
      return false;
    }
    probe.setHTML('<p data-line="1" onclick="x()">ok</p><script>x()</script>', {
      sanitizer: {
        elements: ['p'],
        attributes: ['data-line'],
      },
    });
    const p = probe.querySelector('p');
    nativeSetHTMLSupported =
      probe.children.length === 1 &&
      p !== null &&
      p.getAttribute('data-line') === '1' &&
      !p.hasAttribute('onclick') &&
      probe.querySelector('script') === null;
  } catch {
    nativeSetHTMLSupported = false;
  }
  return nativeSetHTMLSupported;
}

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
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

/**
 * Safely sanitizes rendered Markdown HTML in an offscreen staging container,
 * applies cached KaTeX & Mermaid enhancements without flickering, and reconciles
 * changed DOM blocks incrementally into the live preview container.
 */
export async function safeSetMarkdownHTML(
  container: HTMLElement,
  rawHtml: string,
  options?: { forceLightTheme?: boolean; isCurrent?: () => boolean },
): Promise<boolean> {
  const staging = document.createElement('div') as HTMLElement & ElementWithSetHTML;
  let insertedViaNative = false;

  if (supportsNativeSetHTMLSanitizer() && typeof staging.setHTML === 'function') {
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
      ALLOWED_TAGS: SAFE_ELEMENTS,
      ALLOWED_ATTR: SAFE_ATTRIBUTES,
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
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
  const mermaidNodes = staging.querySelectorAll<HTMLElement>('.mermaid-wrapper');
  if (mermaidNodes.length > 0) {
    await renderMermaidBlocksCached(mermaidNodes, Boolean(options?.forceLightTheme));
  }

  if (options?.isCurrent?.() === false) return false;
  reconcileChildren(container, staging);
  return true;
}

/**
 * Re-renders any `[data-mermaid]` diagram blocks inside a detached export/clipboard
 * clone using Mermaid's light `'default'` theme without touching the live preview DOM.
 */
export async function renderMermaidLightInClone(root: HTMLElement): Promise<void> {
  const mermaidNodes = root.querySelectorAll<HTMLElement>('.mermaid-wrapper[data-mermaid]');
  if (mermaidNodes.length > 0) {
    await renderMermaidBlocksCached(mermaidNodes, true);
  }
}

function wrapMermaidHtml(svg: string): string {
  const isEn = getLanguage() === 'en';
  const copyTitle = isEn ? 'Copy diagram as SVG' : 'Diagramm als SVG kopieren';
  const copyLabel = isEn ? 'Copy SVG' : 'SVG kopieren';
  const zoomTitle = isEn ? 'Open diagram in full view' : 'Diagramm in Großansicht öffnen';
  const zoomLabel = isEn ? 'Zoom' : 'Vergrößern';
  return `<div class="mermaid-actions"><button type="button" class="mermaid-action-btn copy-mermaid-btn" title="${copyTitle}" aria-label="${copyLabel}">${copyLabel}</button><button type="button" class="mermaid-action-btn zoom-mermaid-btn" title="${zoomTitle}" aria-label="${zoomLabel}">${zoomLabel}</button></div>${svg}`;
}

function formatMermaidErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const firstLine =
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';
  if (!firstLine) {
    return getLanguage() === 'en'
      ? 'Unable to render Mermaid diagram.'
      : 'Mermaid-Diagramm konnte nicht gerendert werden.';
  }
  return firstLine.length > 220 ? `${firstLine.slice(0, 217)}…` : firstLine;
}

function renderMermaidErrorFallback(
  wrapper: HTMLElement,
  definition: string,
  error: unknown,
): void {
  wrapper.classList.add('has-mermaid-error');

  let sourcePre = wrapper.querySelector<HTMLPreElement>('pre.mermaid-source');
  if (!sourcePre) {
    sourcePre = document.createElement('pre');
    sourcePre.className = 'mermaid-source';
    const code = document.createElement('code');
    code.textContent = definition;
    sourcePre.appendChild(code);
  }

  const hint = document.createElement('div');
  hint.className = 'mermaid-error-hint';
  hint.setAttribute('role', 'status');

  const title = document.createElement('span');
  title.className = 'mermaid-error-title';
  title.textContent =
    getLanguage() === 'en' ? 'Mermaid syntax notice' : 'Mermaid-Syntaxhinweis';

  const message = document.createElement('span');
  message.className = 'mermaid-error-message';
  message.textContent = formatMermaidErrorMessage(error);

  hint.append(title, message);
  wrapper.replaceChildren(hint, sourcePre);
}

function getMermaidDefinition(wrapper: HTMLElement): string {
  const attr = wrapper.getAttribute('data-mermaid');
  if (attr && attr.trim()) return attr.trim();
  return (wrapper.querySelector('pre.mermaid-source code')?.textContent ?? '').trim();
}

async function renderMermaidBlocksCached(
  nodes: NodeListOf<HTMLElement>,
  forceLightTheme = false,
): Promise<void> {
  const theme: 'dark' | 'default' =
    !forceLightTheme && isDarkColorSchemeActive() ? 'dark' : 'default';

  // Fast-path: check if every Mermaid diagram in this document is already cached
  let hasUncached = false;
  for (const wrapper of nodes) {
    const def = getMermaidDefinition(wrapper);
    if (!def) continue;
    const cachedSvg = mermaidCache.get(`${theme}::${def}`);
    if (cachedSvg !== undefined) {
      wrapper.classList.remove('has-mermaid-error');
      wrapper.innerHTML = forceLightTheme ? cachedSvg : wrapMermaidHtml(cachedSvg);
    } else {
      hasUncached = true;
    }
  }

  if (!hasUncached) return;

  try {
    mermaidModulePromise ??= import('mermaid').then((m) => m.default);
    const mermaid = await mermaidModulePromise;

    for (const wrapper of nodes) {
      const definition = getMermaidDefinition(wrapper);
      if (!definition) continue;
      const cacheKey = `${theme}::${definition}`;
      const existing = mermaidCache.get(cacheKey);
      if (existing !== undefined) {
        wrapper.classList.remove('has-mermaid-error');
        wrapper.innerHTML = forceLightTheme ? existing : wrapMermaidHtml(existing);
        continue;
      }

      const id = `semyra-mermaid-${++mermaidCounter}`;
      try {
        const svg = await renderMermaidInTheme(mermaid, id, definition, theme);
        if (mermaidCache.size >= MAX_MERMAID_CACHE) {
          const oldest = mermaidCache.keys().next().value;
          if (oldest !== undefined) mermaidCache.delete(oldest);
        }
        mermaidCache.set(cacheKey, svg);
        wrapper.classList.remove('has-mermaid-error');
        wrapper.innerHTML = forceLightTheme ? svg : wrapMermaidHtml(svg);
      } catch (err) {
        // Clean up any orphaned temporary error element Mermaid might have appended
        document.getElementById(`d${id}`)?.remove();
        document.getElementById(id)?.remove();
        renderMermaidErrorFallback(wrapper, definition, err);
      }
    }
  } catch (err) {
    for (const wrapper of nodes) {
      const definition = getMermaidDefinition(wrapper);
      if (!definition) continue;
      if (!wrapper.querySelector('svg') && !wrapper.querySelector('.mermaid-error-hint')) {
        renderMermaidErrorFallback(wrapper, definition, err);
      }
    }
  }
}

let mermaidRenderQueue: Promise<unknown> = Promise.resolve();

function renderMermaidInTheme(
  mermaid: Awaited<NonNullable<typeof mermaidModulePromise>>,
  id: string,
  definition: string,
  theme: 'dark' | 'default',
): Promise<string> {
  const render = mermaidRenderQueue.then(async () => {
    // Mermaid's theme is module-wide, so switch it only when the preceding render has finished.
    if (lastMermaidTheme !== theme) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme });
      lastMermaidTheme = theme;
    }
    return (await mermaid.render(id, definition)).svg;
  });
  mermaidRenderQueue = render.catch(() => {});
  return render;
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
        // Preserve user's expand/collapse toggle state on <details> (frontmatter card or custom Markdown details)
        if (
          curEl instanceof HTMLDetailsElement &&
          nextEl instanceof HTMLDetailsElement
        ) {
          nextEl.open = curEl.open;
        }

        // Fast attribute-only update when a block simply shifted line numbers (`data-line`)
        if (curEl.innerHTML === nextEl.innerHTML) {
          syncElementAttributes(curEl, nextEl);
          cursor = cursor.nextSibling;
          continue;
        }

        // Recurse into compound block wrappers (lists, blockquotes, alerts, tables, frontmatter, prompt tags)
        if (
          curEl.tagName === 'UL' ||
          curEl.tagName === 'OL' ||
          curEl.tagName === 'BLOCKQUOTE' ||
          curEl.classList.contains('gfm-alert') ||
          curEl.classList.contains('table-wrapper') ||
          curEl.classList.contains('frontmatter-card') ||
          curEl.classList.contains('prompt-tag-block') ||
          curEl.classList.contains('prompt-tag-body')
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
