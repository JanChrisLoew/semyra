/**
 * Zero-dependency Markdown formatter that protects YAML frontmatter, fenced
 * code blocks, and display math while normalizing headings, list markers,
 * GFM tables, trailing whitespace, and blank lines.
 */
import {
  formatMarkdownTableLines,
  isTableSeparatorRow,
  splitMarkdownTableRow,
} from './markdown-table';

const FENCE_OPEN_RE = /^(\s*)(`{3,}|~{3,})/;

function findFrontmatterEndLine(lines: string[]): number {
  if (lines.length === 0 || lines[0].trim() !== '---') return -1;
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '---' || trimmed === '...') {
      return i;
    }
  }
  return -1;
}

function trimTrailingPreservingHardBreak(line: string): string {
  // Preserve intentional 2-space Markdown hard break at end of non-empty line
  if (/[^\s]  $/.test(line)) {
    return line;
  }
  return line.replace(/[ \t]+$/, '');
}

function normalizeBodyLine(line: string): string {
  let next = trimTrailingPreservingHardBreak(line);
  // ATX heading: ensure single space after `#`
  const headingMatch = next.match(/^(#{1,6})\s*([^\s#].*)$/);
  if (headingMatch) {
    next = `${headingMatch[1]} ${headingMatch[2]}`;
  }
  // Unordered list marker: normalize `* ` / `+ ` to `- `
  next = next.replace(/^(\s*)[*+]\s+/, '$1- ');
  return next;
}

/**
 * Formats a Markdown document cleanly without external dependencies.
 * Preserves the original line ending convention (`CRLF` or `LF`).
 */
export function formatMarkdownDocument(content: string): string {
  if (!content) return content;

  const usesCrlf = content.includes('\r\n');
  const eol = usesCrlf ? '\r\n' : '\n';
  const lines = content.replace(/\r\n/g, '\n').split('\n');

  const out: string[] = [];
  let idx = 0;

  // 1. Preserve YAML frontmatter verbatim
  const fmEnd = findFrontmatterEndLine(lines);
  if (fmEnd !== -1) {
    for (let i = 0; i <= fmEnd; i++) {
      out.push(lines[i]);
    }
    idx = fmEnd + 1;
  }

  let openFence: { char: string; len: number } | null = null;
  let inMathBlock = false;
  let consecutiveBlanks = 0;

  while (idx < lines.length) {
    const line = lines[idx];
    const trimmed = line.trim();

    if (openFence) {
      out.push(line);
      const closeMatch = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (
        closeMatch &&
        closeMatch[1][0] === openFence.char &&
        closeMatch[1].length >= openFence.len
      ) {
        openFence = null;
      }
      consecutiveBlanks = 0;
      idx++;
      continue;
    }

    if (trimmed === '$$') {
      inMathBlock = !inMathBlock;
      out.push(line);
      consecutiveBlanks = 0;
      idx++;
      continue;
    }

    if (inMathBlock) {
      out.push(line);
      consecutiveBlanks = 0;
      idx++;
      continue;
    }

    const fenceMatch = line.match(FENCE_OPEN_RE);
    if (fenceMatch) {
      const token = fenceMatch[2];
      openFence = { char: token[0], len: token.length };
      out.push(line);
      consecutiveBlanks = 0;
      idx++;
      continue;
    }

    // Format contiguous GFM table blocks via markdown-table.ts
    const firstRow = splitMarkdownTableRow(line);
    const secondRow =
      idx + 1 < lines.length ? splitMarkdownTableRow(lines[idx + 1]) : null;
    if (firstRow && secondRow && isTableSeparatorRow(secondRow)) {
      const tableLines: string[] = [line, lines[idx + 1]];
      let scan = idx + 2;
      while (scan < lines.length && splitMarkdownTableRow(lines[scan]) !== null) {
        tableLines.push(lines[scan]);
        scan++;
      }
      out.push(...formatMarkdownTableLines(tableLines));
      consecutiveBlanks = 0;
      idx = scan;
      continue;
    }

    if (trimmed === '') {
      consecutiveBlanks++;
      if (consecutiveBlanks <= 1) {
        out.push('');
      }
      idx++;
      continue;
    }

    consecutiveBlanks = 0;
    out.push(normalizeBodyLine(line));
    idx++;
  }

  // Trim trailing blank lines and ensure a single trailing newline
  while (out.length > 0 && out[out.length - 1] === '') {
    out.pop();
  }
  if (out.length === 0) return '';
  return `${out.join(eol)}${eol}`;
}
