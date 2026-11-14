import { baseNameOfPath, getFileExtension } from './path-utils';
import { estimateTokens } from './token-utils';

export type AiContextFormat = 'markdown' | 'xml';

export interface AiBundleOptions {
  /** Output wrapper format for each entry. Defaults to `'markdown'`. */
  format?: AiContextFormat;
  /** Strip leading YAML frontmatter (`--- ... ---`) before formatting. */
  stripFrontmatter?: boolean;
  /** Strip HTML `<!-- ... -->` comments outside fenced code blocks. */
  stripComments?: boolean;
}

export interface AiBundleEntry {
  /** Display name or workspace-relative path shown in the fence header. */
  label: string;
  content: string;
}

export interface AiBundleResult {
  payload: string;
  totalTokens: number;
  fileCount: number;
}

function normalizePathForCompare(p: string): string {
  return p.replace(/^\\\\\?\\/, '').replace(/\\/g, '/');
}

/**
 * Normalizes a file path into a workspace-relative POSIX-style label when inside
 * `workspaceRoot`, falling back to the file basename or `fallbackName`.
 */
export function toWorkspaceRelativeLabel(
  filePath: string | null | undefined,
  workspaceRoot: string | null | undefined,
  fallbackName: string,
): string {
  const trimmedPath = filePath?.trim();
  if (!trimmedPath) return fallbackName;

  const normFile = normalizePathForCompare(trimmedPath);
  const trimmedRoot = workspaceRoot?.trim();

  if (trimmedRoot) {
    const normRoot = normalizePathForCompare(trimmedRoot).replace(/\/+$/, '');
    const prefix = `${normRoot}/`;
    const isWindows = /^[a-zA-Z]:\//.test(normFile) || /^[a-zA-Z]:\//.test(prefix);
    const matches = isWindows
      ? normFile.toLowerCase().startsWith(prefix.toLowerCase())
      : normFile.startsWith(prefix);

    if (matches && normFile.length > prefix.length) {
      return normFile.slice(prefix.length);
    }
  }

  return baseNameOfPath(trimmedPath) || fallbackName;
}

/**
 * Strips a leading YAML frontmatter block (`--- ... ---`) if present.
 */
function stripLeadingFrontmatter(content: string): string {
  return content.replace(
    /^(?:\uFEFF)?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:(?:\r?\n)+|$)/,
    '',
  );
}

/**
 * Strips HTML `<!-- ... -->` comments outside fenced code blocks (` ``` ` / `~~~`).
 */
function stripHtmlCommentsOutsideFences(content: string): string {
  const lines = content.split(/\r?\n/);
  const segments: Array<{ isCode: boolean; text: string }> = [];
  let buffer: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  const flush = (isCode: boolean) => {
    if (buffer.length > 0) {
      segments.push({ isCode, text: buffer.join('\n') });
      buffer = [];
    }
  };

  for (const line of lines) {
    if (!inFence) {
      const openMatch = line.match(/^[ ]{0,3}(`{3,}|~{3,})(.*)$/);
      if (openMatch && !(openMatch[1][0] === '`' && openMatch[2].includes('`'))) {
        flush(false);
        inFence = true;
        fenceChar = openMatch[1][0];
        fenceLen = openMatch[1].length;
        buffer.push(line);
        continue;
      }
      buffer.push(line);
    } else {
      buffer.push(line);
      const closeMatch = line.match(/^[ ]{0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closeMatch && closeMatch[1][0] === fenceChar && closeMatch[1].length >= fenceLen) {
        flush(true);
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
      }
    }
  }
  flush(inFence);

  return segments
    .map((seg) => {
      if (seg.isCode) return seg.text;
      // Remove standalone comment lines completely, then strip any remaining inline comments
      return seg.text
        .replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*(?:\r?\n|$)/gm, '')
        .replace(/<!--[\s\S]*?-->/g, '');
    })
    .join('\n');
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;');
}

function escapeClosingFileTags(content: string): string {
  return content.replace(/<\/(file)(\s*>)/gi, '&lt;/$1$2');
}

function prepareEntryContent(content: string, options?: AiBundleOptions): string {
  let result = content;
  if (options?.stripFrontmatter) {
    result = stripLeadingFrontmatter(result);
  }
  if (options?.stripComments) {
    result = stripHtmlCommentsOutsideFences(result);
  }
  return result;
}

/**
 * Formats a single document as a safely fenced Markdown block or XML `<file>` element.
 */
export function formatAiContextEntry(
  label: string,
  content: string,
  options?: AiBundleOptions,
): string {
  const processed = prepareEntryContent(content, options);
  const format = options?.format ?? 'markdown';

  if (format === 'xml') {
    const safePath = escapeXmlAttr(label);
    const safeContent = escapeClosingFileTags(processed);
    const body = safeContent.endsWith('\n') ? safeContent : `${safeContent}\n`;
    return `<file path="${safePath}">\n${body}</file>\n`;
  }

  let fence = '```';
  while (processed.includes(fence)) {
    fence += '`';
  }
  const ext = getFileExtension(label) || 'markdown';
  const body = processed.endsWith('\n') ? processed : `${processed}\n`;
  return `${fence}${ext}:${label}\n${body}${fence}\n`;
}

/**
 * Combines multiple documents into a single LLM-ready context bundle
 * and computes the aggregated token estimate.
 */
export function buildAiContextBundle(
  entries: AiBundleEntry[],
  options?: AiBundleOptions,
): AiBundleResult {
  if (entries.length === 0) {
    return { payload: '', totalTokens: 0, fileCount: 0 };
  }

  const blocks = entries.map((entry) =>
    formatAiContextEntry(entry.label, entry.content, options),
  );
  const payload = blocks.join('\n');
  return {
    payload,
    totalTokens: estimateTokens(payload),
    fileCount: entries.length,
  };
}

const TEMPLATE_VAR_REGEX = /\{\{([a-zA-Z0-9_.-]+)\}\}/g;

/**
 * Extracts unique `{{varName}}` placeholders in order of first appearance.
 */
export function extractTemplateVariables(content: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const regex = new RegExp(TEMPLATE_VAR_REGEX.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

/**
 * Replaces `{{varName}}` placeholders with provided values, preserving unmatched placeholders.
 */
export function interpolateTemplateVariables(
  content: string,
  values: Record<string, string>,
): string {
  return content.replace(TEMPLATE_VAR_REGEX, (full, name: string) => {
    return Object.prototype.hasOwnProperty.call(values, name) && values[name] !== undefined
      ? values[name]
      : full;
  });
}
