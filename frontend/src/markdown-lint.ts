/**
 * Zero-dependency Markdown structure & YAML-Frontmatter / Agent-Skill validator.
 */
import { getLanguage, t } from './i18n';
import { isTableSeparatorRow, splitMarkdownTableRow } from './markdown-table';
import { baseNameOfPath, parentDirOfPath } from './path-utils';

export type LintSeverity = 'error' | 'warning';

export interface LintIssue {
  line: number;
  severity: LintSeverity;
  code: string;
  message: string;
}

export interface LintOptions {
  knownWorkspaceFiles?: readonly string[] | ReadonlySet<string>;
  currentFileRelPath?: string | null;
}

export interface LintResult {
  issues: LintIssue[];
  isSkillFile: boolean;
  hasFrontmatter: boolean;
  frontmatterValid: boolean;
}

interface ParsedFrontmatter {
  endLineIndex: number; // 0-based index of closing `---`
  issues: LintIssue[];
  values: Map<string, string>;
  keyLines: Map<string, number>;
}

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const YAML_KEY_RE = /^([A-Za-z0-9_-]+)\s*:(.*)$/;
const FENCE_RE = /^(\s*)(`{3,}|~{3,})/;
const EMPTY_LINK_RE = /\[[^\]]*\]\(\s*\)/;
const XML_PROMPT_TAG_RE =
  /<(\/?)(role|context|instructions|output_format|constraints|examples)(?:\s+[^<>]*)?(\/?)>/g;
const ATX_HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const URL_SCHEME_RE = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/;
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|ico|bmp)$/i;
const MARKDOWN_TEXT_EXT_RE = /\.(?:md|markdown|mdown|mkd|mdx|txt)$/i;

function lintMsg(de: string, en: string): string {
  return getLanguage() === 'en' ? en : de;
}

function hasUnclosedQuote(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return false;
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'") return false;
  if (trimmed.length === 1) return true;
  // Ignore trailing YAML comment only when closing quote precedes it
  let escaped = false;
  for (let i = 1; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (quote === '"' && ch === '\\' && !escaped) {
      escaped = true;
      continue;
    }
    if (ch === quote && !escaped) {
      return false;
    }
    escaped = false;
  }
  return true;
}

function stripYamlQuotes(val: string): string {
  const trimmed = val.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseYamlFrontmatter(lines: string[]): ParsedFrontmatter | null {
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return null;
  }

  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '---' || trimmed === '...') {
      closeIdx = i;
      break;
    }
  }

  const issues: LintIssue[] = [];
  const values = new Map<string, string>();
  const keyLines = new Map<string, number>();

  if (closeIdx === -1) {
    issues.push({
      line: 1,
      severity: 'error',
      code: 'yaml.unclosedFrontmatter',
      message: t('lint.yamlUnclosed'),
    });
    return { endLineIndex: lines.length - 1, issues, values, keyLines };
  }

  let currentTopKey: string | null = null;
  let inMultilineScalar = false;

  for (let i = 1; i < closeIdx; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    if (!line.trim() || line.trimStart().startsWith('#')) {
      continue;
    }
    if (/^\t+/.test(line)) {
      issues.push({
        line: lineNum,
        severity: 'error',
        code: 'yaml.tabIndent',
        message: t('lint.yamlTabIndent'),
      });
      continue;
    }

    const isIndented = /^\s+/.test(line);
    if (isIndented) {
      if (inMultilineScalar && currentTopKey) {
        const prev = values.get(currentTopKey) ?? '';
        const chunk = line.trim();
        values.set(currentTopKey, prev ? `${prev} ${chunk}` : chunk);
      }
      continue;
    }

    inMultilineScalar = false;
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      continue;
    }

    const match = trimmed.match(YAML_KEY_RE);
    if (!match) {
      issues.push({
        line: lineNum,
        severity: 'error',
        code: 'yaml.invalidSyntax',
        message: t('lint.yamlInvalidLine'),
      });
      currentTopKey = null;
      continue;
    }

    const key = match[1];
    const rawVal = match[2].trim();
    if (!keyLines.has(key)) {
      keyLines.set(key, lineNum);
    }
    if (values.has(key)) {
      issues.push({
        line: lineNum,
        severity: 'warning',
        code: 'yaml.duplicateKey',
        message: t('lint.yamlDuplicateKey', { key }),
      });
    }

    if (rawVal === '>' || rawVal === '>-' || rawVal === '|' || rawVal === '|-') {
      currentTopKey = key;
      inMultilineScalar = true;
      values.set(key, '');
    } else {
      currentTopKey = key;
      if (hasUnclosedQuote(rawVal)) {
        issues.push({
          line: lineNum,
          severity: 'error',
          code: 'yaml.unclosedQuote',
          message: t('lint.yamlUnclosedQuote'),
        });
      }
      values.set(key, stripYamlQuotes(rawVal));
    }
  }

  return { endLineIndex: closeIdx, issues, values, keyLines };
}

function findClosingBackticks(line: string, start: number, count: number): number {
  let i = start;
  while (i < line.length) {
    if (line[i] === '`') {
      let run = 0;
      while (i + run < line.length && line[i + run] === '`') {
        run++;
      }
      if (run === count) {
        return i;
      }
      i += run;
    } else {
      i++;
    }
  }
  return -1;
}

function stripInlineCode(line: string): string {
  if (!line.includes('`')) return line;
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] === '`') {
      let ticks = 0;
      while (i + ticks < line.length && line[i + ticks] === '`') {
        ticks++;
      }
      const closeIdx = findClosingBackticks(line, i + ticks, ticks);
      if (closeIdx !== -1) {
        out += ' '.repeat(closeIdx + ticks - i);
        i = closeIdx + ticks;
        continue;
      }
      out += '`'.repeat(ticks);
      i += ticks;
      continue;
    }
    out += line[i];
    i++;
  }
  return out;
}

function stripInlineMarkdownForSlug(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|~~|\*|_)/g, '');
}

function slugifyHeading(rawHeadingText: string, counts: Map<string, number>): string {
  const customMatch = rawHeadingText.match(/\s*\{#([A-Za-z0-9_.:-]+)\}\s*$/);
  if (customMatch) {
    return customMatch[1];
  }
  const plain = stripInlineMarkdownForSlug(rawHeadingText);
  let base = '';
  let prevDash = false;
  for (const ch of plain) {
    if (/[\p{L}\p{N}]/u.test(ch)) {
      base += ch.toLowerCase();
      prevDash = false;
    } else if ((/\s/.test(ch) || ch === '-' || ch === '_') && base.length > 0 && !prevDash) {
      base += '-';
      prevDash = true;
    }
  }
  base = base.replace(/-+$/, '');
  if (!base) {
    base = 'abschnitt';
  }
  const count = counts.get(base) ?? 0;
  counts.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

function extractLinkTarget(rawDest: string): string {
  const trimmed = rawDest.trim();
  if (trimmed.startsWith('<')) {
    const close = trimmed.indexOf('>');
    if (close > 0) {
      return trimmed.slice(1, close).trim();
    }
  }
  const spaceIdx = trimmed.search(/\s/);
  return spaceIdx >= 0 ? trimmed.slice(0, spaceIdx) : trimmed;
}

interface ExtractedMarkdownLink {
  isImage: boolean;
  target: string;
}

function extractMarkdownLinks(line: string): ExtractedMarkdownLink[] {
  const links: ExtractedMarkdownLink[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '\\') {
      i += 2;
      continue;
    }
    const isImage = line[i] === '!' && i + 1 < line.length && line[i + 1] === '[';
    const openBracket = isImage ? i + 1 : line[i] === '[' ? i : -1;
    if (openBracket === -1) {
      i++;
      continue;
    }

    let j = openBracket + 1;
    let foundCloseBracket = false;
    while (j < line.length) {
      if (line[j] === '\\') {
        j += 2;
        continue;
      }
      if (line[j] === ']') {
        foundCloseBracket = true;
        break;
      }
      j++;
    }
    if (!foundCloseBracket || j + 1 >= line.length || line[j + 1] !== '(') {
      i = openBracket + 1;
      continue;
    }

    const destStart = j + 2;
    let k = destStart;
    let depth = 1;
    let quote: string | null = null;
    while (k < line.length && depth > 0) {
      const ch = line[k];
      if (ch === '\\') {
        k += 2;
        continue;
      }
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
        if (depth === 0) break;
      }
      k++;
    }

    if (depth === 0) {
      const rawDest = line.slice(destStart, k);
      const target = extractLinkTarget(rawDest);
      if (target) {
        links.push({ isImage, target });
      }
      i = k + 1;
    } else {
      i = destStart;
    }
  }
  return links;
}

function shouldValidateWorkspaceLink(isImage: boolean, target: string): boolean {
  if (isImage) return false;
  const pathOnly = target.split('#')[0].split('?')[0].trim();
  if (!pathOnly || IMAGE_EXT_RE.test(pathOnly)) {
    return false;
  }
  return MARKDOWN_TEXT_EXT_RE.test(pathOnly);
}

function normalizeWorkspacePath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

function resolveRelativeWorkspacePath(currentRelPath: string, rawHref: string): string | null {
  const pathOnly = rawHref.split('#')[0].split('?')[0].trim();
  if (!pathOnly || pathOnly.endsWith('/')) {
    return null;
  }
  let decoded = pathOnly;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    // Keep raw path when percent-encoding is malformed
  }
  const normalizedHref = decoded.replace(/\\/g, '/');
  const baseParts = normalizedHref.startsWith('/')
    ? []
    : normalizeWorkspacePath(currentRelPath).split('/').slice(0, -1);

  for (const seg of normalizedHref.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (baseParts.length === 0) {
        return '__OUTSIDE_WORKSPACE__';
      }
      baseParts.pop();
    } else {
      baseParts.push(seg.toLowerCase());
    }
  }
  return baseParts.length > 0 ? baseParts.join('/') : null;
}

function checkXmlPromptTags(
  strippedLine: string,
  lineNum: number,
  xmlStack: Array<{ tag: string; line: number }>,
  issues: LintIssue[],
): void {
  XML_PROMPT_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = XML_PROMPT_TAG_RE.exec(strippedLine)) !== null) {
    const isClose = match[1] === '/';
    const tag = match[2];
    const isSelfClosing = match[3] === '/';
    if (!isClose && isSelfClosing) {
      continue;
    }
    if (!isClose) {
      xmlStack.push({ tag, line: lineNum });
      continue;
    }

    if (xmlStack.length === 0) {
      issues.push({
        line: lineNum,
        severity: 'warning',
        code: 'ai.mismatchedXmlTag',
        message: lintMsg(
          `Unerwartetes schließendes Prompt-Tag </${tag}> ohne passendes öffnendes Tag.`,
          `Unexpected closing prompt tag </${tag}> without a matching opening tag.`,
        ),
      });
      continue;
    }

    const top = xmlStack[xmlStack.length - 1];
    if (top.tag === tag) {
      xmlStack.pop();
      continue;
    }

    const matchIdx = xmlStack.map((entry) => entry.tag).lastIndexOf(tag);
    issues.push({
      line: lineNum,
      severity: 'warning',
      code: 'ai.mismatchedXmlTag',
      message: lintMsg(
        `Nicht passendes Prompt-Tag </${tag}> (erwartet </${top.tag}>).`,
        `Mismatched prompt tag </${tag}> (expected </${top.tag}>).`,
      ),
    });
    if (matchIdx !== -1) {
      xmlStack.length = matchIdx;
    }
  }
}

interface OpenPlaceholder {
  line: number;
  hasContent: boolean;
}

function checkTemplatePlaceholders(
  strippedLine: string,
  lineNum: number,
  openPlaceholder: OpenPlaceholder | null,
  issues: LintIssue[],
): OpenPlaceholder | null {
  let pos = 0;
  let active = openPlaceholder;

  if (active) {
    const nextOpen = strippedLine.indexOf('{{', pos);
    const closeIdx = strippedLine.indexOf('}}', pos);

    if (nextOpen !== -1 && (closeIdx === -1 || nextOpen < closeIdx)) {
      issues.push({
        line: active.line,
        severity: 'warning',
        code: 'ai.malformedPlaceholder',
        message: lintMsg(
          'Ungeschlossener Template-Platzhalter „{{…“ ohne schließendes „}}“.',
          'Unclosed template placeholder "{{…" without closing "}}".',
        ),
      });
      active = null;
      pos = nextOpen;
    } else if (closeIdx !== -1) {
      const hasContent =
        active.hasContent || strippedLine.slice(pos, closeIdx).trim().length > 0;
      if (!hasContent) {
        issues.push({
          line: active.line,
          severity: 'warning',
          code: 'ai.malformedPlaceholder',
          message: lintMsg(
            'Leerer Template-Platzhalter „{{}}“ gefunden.',
            'Empty template placeholder "{{}}" found.',
          ),
        });
      }
      active = null;
      pos = closeIdx + 2;
    } else {
      if (strippedLine.trim().length > 0) {
        active.hasContent = true;
      }
      return active;
    }
  }

  while (pos < strippedLine.length) {
    const openIdx = strippedLine.indexOf('{{', pos);
    if (openIdx === -1) break;

    const nextOpen = strippedLine.indexOf('{{', openIdx + 2);
    const closeIdx = strippedLine.indexOf('}}', openIdx + 2);

    if (nextOpen !== -1 && (closeIdx === -1 || nextOpen < closeIdx)) {
      issues.push({
        line: lineNum,
        severity: 'warning',
        code: 'ai.malformedPlaceholder',
        message: lintMsg(
          'Ungeschlossener Template-Platzhalter „{{…“ ohne schließendes „}}“.',
          'Unclosed template placeholder "{{…" without closing "}}".',
        ),
      });
      pos = openIdx + 2;
      continue;
    }

    if (closeIdx === -1) {
      return {
        line: lineNum,
        hasContent: strippedLine.slice(openIdx + 2).trim().length > 0,
      };
    }

    const inner = strippedLine.slice(openIdx + 2, closeIdx).trim();
    if (!inner) {
      issues.push({
        line: lineNum,
        severity: 'warning',
        code: 'ai.malformedPlaceholder',
        message: lintMsg(
          'Leerer Template-Platzhalter „{{}}“ gefunden.',
          'Empty template placeholder "{{}}" found.',
        ),
      });
    }
    pos = closeIdx + 2;
  }

  return null;
}

/**
 * Validates YAML frontmatter (especially Agent-Skill `SKILL.md` rules) and
 * general Markdown structure without external dependencies.
 */
export function lintMarkdownDocument(
  content: string,
  filePath?: string | null,
  options?: LintOptions,
): LintResult {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const fileName = filePath ? baseNameOfPath(filePath).toLowerCase() : '';
  const isSkillFile = fileName === 'skill.md';

  const fm = parseYamlFrontmatter(lines);
  const issues: LintIssue[] = [];
  let startLineIdx = 0;

  if (fm) {
    issues.push(...fm.issues);
    startLineIdx = fm.endLineIndex + 1;

    if (isSkillFile) {
      const nameVal = (fm.values.get('name') ?? '').trim();
      const descVal = (fm.values.get('description') ?? '').trim();

      if (!nameVal) {
        issues.push({
          line: 1,
          severity: 'error',
          code: 'skill.missingName',
          message: t('lint.skillMissingName'),
        });
      } else {
        const nameLine = fm.keyLines.get('name') ?? 2;
        if (!SKILL_NAME_RE.test(nameVal)) {
          issues.push({
            line: nameLine,
            severity: 'warning',
            code: 'skill.invalidNameFormat',
            message: t('lint.skillInvalidName'),
          });
        }
        if (filePath) {
          const parentPath = parentDirOfPath(filePath);
          const folderName = parentPath ? baseNameOfPath(parentPath) : '';
          if (folderName && folderName !== nameVal) {
            issues.push({
              line: nameLine,
              severity: 'warning',
              code: 'skill.nameFolderMismatch',
              message: t('lint.skillNameFolderMismatch', {
                name: nameVal,
                folder: folderName,
              }),
            });
          }
        }
      }

      if (!descVal) {
        issues.push({
          line: 1,
          severity: 'error',
          code: 'skill.missingDescription',
          message: t('lint.skillMissingDesc'),
        });
      }
    }
  } else if (isSkillFile) {
    issues.push({
      line: 1,
      severity: 'error',
      code: 'skill.missingFrontmatter',
      message: t('lint.skillMissingFrontmatter'),
    });
  }

  const frontmatterValid = fm
    ? fm.issues.every((i) => i.severity !== 'error')
    : !isSkillFile;

  // Markdown structure checks outside fenced code blocks and $$ math blocks
  let openFence: { char: string; len: number; line: number; token: string } | null =
    null;
  let inMathBlock = false;
  let tableHeaderCols: number | null = null;
  let openPlaceholder: OpenPlaceholder | null = null;
  const xmlStack: Array<{ tag: string; line: number }> = [];
  const headingSlugs = new Set<string>();
  const headingSlugsLower = new Set<string>();
  const headingSlugCounts = new Map<string, number>();
  const anchorLinks: Array<{ line: number; anchor: string }> = [];

  const currentFileRelPath = options?.currentFileRelPath?.trim() || null;
  let knownWorkspaceFilesSet: Set<string> | null = null;
  if (options?.knownWorkspaceFiles && currentFileRelPath) {
    knownWorkspaceFilesSet = new Set<string>();
    for (const rel of options.knownWorkspaceFiles) {
      knownWorkspaceFilesSet.add(normalizeWorkspacePath(rel));
    }
  }

  for (let i = startLineIdx; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    if (openFence) {
      const closeMatch = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (
        closeMatch &&
        closeMatch[1][0] === openFence.char &&
        closeMatch[1].length >= openFence.len
      ) {
        openFence = null;
      }
      continue;
    }

    if (trimmed === '$$') {
      inMathBlock = !inMathBlock;
      tableHeaderCols = null;
      continue;
    }
    if (inMathBlock) {
      continue;
    }

    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      const token = fenceMatch[2];
      openFence = { char: token[0], len: token.length, line: lineNum, token };
      tableHeaderCols = null;
      continue;
    }

    const stripped = stripInlineCode(line);

    const headingMatch = line.match(ATX_HEADING_RE);
    if (headingMatch) {
      const slug = slugifyHeading(headingMatch[2], headingSlugCounts);
      headingSlugs.add(slug);
      headingSlugsLower.add(slug.toLowerCase());
    }

    if (/^#{1,6}[^\s#]/.test(line)) {
      issues.push({
        line: lineNum,
        severity: 'warning',
        code: 'md.headingSpace',
        message: t('lint.mdHeadingSpace'),
      });
    }

    if (EMPTY_LINK_RE.test(stripped)) {
      issues.push({
        line: lineNum,
        severity: 'warning',
        code: 'md.emptyLink',
        message: t('lint.mdEmptyLink'),
      });
    }

    checkXmlPromptTags(stripped, lineNum, xmlStack, issues);
    openPlaceholder = checkTemplatePlaceholders(
      stripped,
      lineNum,
      openPlaceholder,
      issues,
    );

    for (const { isImage, target } of extractMarkdownLinks(stripped)) {
      if (!isImage && target.startsWith('#')) {
        if (target.length > 1) {
          anchorLinks.push({ line: lineNum, anchor: target.slice(1) });
        }
        continue;
      }

      if (
        knownWorkspaceFilesSet &&
        currentFileRelPath &&
        shouldValidateWorkspaceLink(isImage, target) &&
        !target.startsWith('#') &&
        !URL_SCHEME_RE.test(target)
      ) {
        const resolved = resolveRelativeWorkspacePath(currentFileRelPath, target);
        if (resolved && !knownWorkspaceFilesSet.has(resolved)) {
          issues.push({
            line: lineNum,
            severity: 'warning',
            code: 'md.brokenRelativeLink',
            message: lintMsg(
              `Relativer Link „${target}“ verweist auf keine bekannte Datei im Workspace.`,
              `Relative link "${target}" does not match any known file in the workspace.`,
            ),
          });
        }
      }
    }

    // GFM table column consistency check
    const rowCells = splitMarkdownTableRow(line);
    if (rowCells) {
      if (tableHeaderCols === null) {
        const nextRow =
          i + 1 < lines.length ? splitMarkdownTableRow(lines[i + 1]) : null;
        if (nextRow && isTableSeparatorRow(nextRow)) {
          tableHeaderCols = rowCells.length;
        }
      } else if (rowCells.length !== tableHeaderCols) {
        issues.push({
          line: lineNum,
          severity: 'warning',
          code: 'md.tableColumns',
          message: t('lint.mdTableColumns', {
            actual: rowCells.length,
            expected: tableHeaderCols,
          }),
        });
      }
    } else {
      tableHeaderCols = null;
    }
  }

  if (openPlaceholder) {
    issues.push({
      line: openPlaceholder.line,
      severity: 'warning',
      code: 'ai.malformedPlaceholder',
      message: lintMsg(
        'Ungeschlossener Template-Platzhalter „{{…“ ohne schließendes „}}“.',
        'Unclosed template placeholder "{{…" without closing "}}".',
      ),
    });
  }

  for (const unclosed of xmlStack) {
    issues.push({
      line: unclosed.line,
      severity: 'warning',
      code: 'ai.unclosedXmlTag',
      message: lintMsg(
        `Ungeschlossenes Prompt-Tag <${unclosed.tag}> ohne passendes </${unclosed.tag}>.`,
        `Unclosed prompt tag <${unclosed.tag}> without matching </${unclosed.tag}>.`,
      ),
    });
  }

  for (const link of anchorLinks) {
    let decodedAnchor = link.anchor;
    try {
      decodedAnchor = decodeURIComponent(link.anchor);
    } catch {
      // Keep raw anchor if percent-encoding is malformed
    }
    if (
      !headingSlugs.has(decodedAnchor) &&
      !headingSlugsLower.has(decodedAnchor.toLowerCase())
    ) {
      issues.push({
        line: link.line,
        severity: 'warning',
        code: 'md.brokenAnchor',
        message: lintMsg(
          `Interner Sprunglink „#${link.anchor}“ verweist auf keine Überschrift im Dokument.`,
          `Internal anchor link "#${link.anchor}" does not match any heading in this document.`,
        ),
      });
    }
  }

  if (openFence) {
    issues.push({
      line: openFence.line,
      severity: 'error',
      code: 'md.unclosedCodeFence',
      message: t('lint.mdUnclosedFence', { fence: openFence.token }),
    });
  }

  return {
    issues,
    isSkillFile,
    hasFrontmatter: fm !== null,
    frontmatterValid,
  };
}
