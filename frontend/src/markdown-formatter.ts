/**
 * Markdown formatter that protects YAML frontmatter, literal
 * code blocks, and display math while normalizing headings, list markers,
 * GFM tables, trailing whitespace, and blank lines.
 */
import { markdownLanguage } from '@codemirror/lang-markdown';
import { Text } from '@codemirror/state';
import {
  formatMarkdownTableLines,
  isTableSeparatorRow,
  splitMarkdownTableRow,
} from './markdown-table';

function findFormattingBoundaries(lines: string[], start: number) {
  const verbatim = new Set<number>();
  const hardBreaks = new Set<number>();
  if (start >= lines.length) return { verbatim, hardBreaks };
  const body = Text.of(lines.slice(start));
  markdownLanguage.parser.parse(body.toString()).iterate({
    enter(node) {
      if (node.name === 'HardBreak') {
        hardBreaks.add(start + body.lineAt(node.from).number - 1);
      }
      if (!['CodeBlock', 'FencedCode', 'HorizontalRule'].includes(node.name)) return;
      const first = body.lineAt(node.from).number;
      const last = body.lineAt(node.to).number;
      for (let line = first; line <= last; line++) verbatim.add(start + line - 1);
      return false;
    },
  });
  return { verbatim, hardBreaks };
}

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

function normalizeBodyLine(line: string, hardBreak: boolean): string {
  let next = hardBreak ? line : trimTrailingPreservingHardBreak(line);
  // ATX heading: ensure single space after `#`
  const headingMatch = next.match(/^(#{1,6})\s*([^\s#].*)$/);
  if (headingMatch) {
    next = `${headingMatch[1]} ${headingMatch[2]}`;
  }
  // Unordered list marker: normalize `* ` / `+ ` to `- `
  next = next.replace(/^(\s*)[*+](?=[ \t])/, '$1-');
  return next;
}

/**
 * Formats a Markdown document using the editor's Markdown grammar.
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

  const { verbatim, hardBreaks } = findFormattingBoundaries(lines, idx);
  let inMathBlock = false;
  let consecutiveBlanks = 0;

  while (idx < lines.length) {
    const line = lines[idx];
    const trimmed = line.trim();

    if (!inMathBlock && verbatim.has(idx)) {
      out.push(line);
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

    // Format contiguous GFM table blocks via markdown-table.ts
    const firstRow = splitMarkdownTableRow(line);
    const secondRow =
      idx + 1 < lines.length ? splitMarkdownTableRow(lines[idx + 1]) : null;
    if (firstRow && secondRow && !verbatim.has(idx + 1) && isTableSeparatorRow(secondRow)) {
      const tableLines: string[] = [line, lines[idx + 1]];
      let scan = idx + 2;
      while (scan < lines.length && !verbatim.has(scan) && splitMarkdownTableRow(lines[scan]) !== null) {
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
    out.push(normalizeBodyLine(line, hardBreaks.has(idx)));
    idx++;
  }

  // An unclosed fence can extend through the final empty lines.
  if (verbatim.has(lines.length - 1) && content.endsWith('\n')) return out.join(eol);
  // Trim trailing blank lines and ensure a single trailing newline
  while (out.length > 0 && out[out.length - 1] === '') {
    out.pop();
  }
  if (out.length === 0) return '';
  return `${out.join(eol)}${eol}`;
}
