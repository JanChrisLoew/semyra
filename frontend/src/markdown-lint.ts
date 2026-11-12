/**
 * Zero-dependency Markdown structure & YAML-Frontmatter / Agent-Skill validator.
 */
import { t } from './i18n';
import { isTableSeparatorRow, splitMarkdownTableRow } from './markdown-table';
import { baseNameOfPath, parentDirOfPath } from './path-utils';

export type LintSeverity = 'error' | 'warning';

export interface LintIssue {
  line: number;
  severity: LintSeverity;
  code: string;
  message: string;
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
}

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const YAML_KEY_RE = /^([A-Za-z0-9_-]+)\s*:(.*)$/;
const FENCE_RE = /^(\s*)(`{3,}|~{3,})/;
const EMPTY_LINK_RE = /\[[^\]]*\]\(\s*\)/;

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

  if (closeIdx === -1) {
    issues.push({
      line: 1,
      severity: 'error',
      code: 'yaml.unclosedFrontmatter',
      message: t('lint.yamlUnclosed'),
    });
    return { endLineIndex: lines.length - 1, issues, values };
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

  return { endLineIndex: closeIdx, issues, values };
}

/**
 * Validates YAML frontmatter (especially Agent-Skill `SKILL.md` rules) and
 * general Markdown structure without external dependencies.
 */
export function lintMarkdownDocument(
  content: string,
  filePath?: string | null,
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
        if (!SKILL_NAME_RE.test(nameVal)) {
          issues.push({
            line: 2,
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
              line: 2,
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

    if (/^#{1,6}[^\s#]/.test(line)) {
      issues.push({
        line: lineNum,
        severity: 'warning',
        code: 'md.headingSpace',
        message: t('lint.mdHeadingSpace'),
      });
    }

    if (EMPTY_LINK_RE.test(line)) {
      issues.push({
        line: lineNum,
        severity: 'warning',
        code: 'md.emptyLink',
        message: t('lint.mdEmptyLink'),
      });
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
