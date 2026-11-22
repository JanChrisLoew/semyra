export type DiffKind = 'context' | 'added' | 'removed';

export interface DiffLine {
  kind: DiffKind;
  text: string;
  localLine: number | null;
  diskLine: number | null;
}

export interface DiffLineItem {
  kind: 'line';
  line: DiffLine;
  index: number;
}

export interface CollapsedDiffPlaceholder {
  kind: 'collapsed';
  startIdx: number;
  endIdx: number;
  count: number;
}

export type CollapsedDiffItem = DiffLineItem | CollapsedDiffPlaceholder;

/**
 * Collapses long runs of unchanged `context` lines into expandable
 * `{ kind: 'collapsed', startIdx, endIdx, count }` placeholders while keeping
 * `added`/`removed` hunks and `contextLines` surrounding lines visible.
 */
export function buildCollapsedDiffItems(
  lines: DiffLine[],
  contextLines = 3
): CollapsedDiffItem[] {
  if (lines.length === 0) return [];

  const ctx = Math.max(0, Math.floor(contextLines));
  const visible = new Uint8Array(lines.length);

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind !== 'context') {
      const from = Math.max(0, i - ctx);
      const to = Math.min(lines.length - 1, i + ctx);
      for (let j = from; j <= to; j++) {
        visible[j] = 1;
      }
    }
  }

  const items: CollapsedDiffItem[] = [];
  let i = 0;
  while (i < lines.length) {
    if (visible[i] === 1) {
      items.push({ kind: 'line', line: lines[i], index: i });
      i++;
      continue;
    }

    const startIdx = i;
    while (i < lines.length && visible[i] === 0) {
      i++;
    }
    const endIdx = i - 1;
    const count = endIdx - startIdx + 1;

    // Avoid replacing a single line with a 1-line placeholder button.
    if (count === 1) {
      items.push({ kind: 'line', line: lines[startIdx], index: startIdx });
    } else {
      items.push({ kind: 'collapsed', startIdx, endIdx, count });
    }
  }

  return items;
}

/**
 * Computes a compact line-by-line diff between local editor content and disk content.
 * Falls back to a coarse prefix/suffix diff for very large files to stay O(1) responsive.
 */
export function computeLineDiff(localText: string, diskText: string): DiffLine[] {
  const localLines = localText.replace(/\r\n/g, '\n').split('\n');
  const diskLines = diskText.replace(/\r\n/g, '\n').split('\n');

  const n = localLines.length;
  const m = diskLines.length;

  // Guard against quadratic DP on huge files (> 1200 lines)
  if (n * m > 400_000) {
    let prefix = 0;
    while (prefix < n && prefix < m && localLines[prefix] === diskLines[prefix]) {
      prefix++;
    }
    let suffix = 0;
    while (
      suffix < n - prefix &&
      suffix < m - prefix &&
      localLines[n - 1 - suffix] === diskLines[m - 1 - suffix]
    ) {
      suffix++;
    }
    const out: DiffLine[] = [];
    for (let i = Math.max(0, prefix - 2); i < prefix; i++) {
      out.push({ kind: 'context', text: localLines[i], localLine: i + 1, diskLine: i + 1 });
    }
    for (let i = prefix; i < n - suffix; i++) {
      out.push({ kind: 'removed', text: localLines[i], localLine: i + 1, diskLine: null });
    }
    for (let j = prefix; j < m - suffix; j++) {
      out.push({ kind: 'added', text: diskLines[j], localLine: null, diskLine: j + 1 });
    }
    const sufStartLocal = n - suffix;
    const sufStartDisk = m - suffix;
    for (let k = 0; k < Math.min(2, suffix); k++) {
      out.push({
        kind: 'context',
        text: localLines[sufStartLocal + k],
        localLine: sufStartLocal + k + 1,
        diskLine: sufStartDisk + k + 1,
      });
    }
    return out;
  }

  // Standard LCS DP table
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (localLines[i] === diskLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (localLines[i] === diskLines[j]) {
      result.push({ kind: 'context', text: localLines[i], localLine: i + 1, diskLine: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ kind: 'removed', text: localLines[i], localLine: i + 1, diskLine: null });
      i++;
    } else {
      result.push({ kind: 'added', text: diskLines[j], localLine: null, diskLine: j + 1 });
      j++;
    }
  }
  while (i < n) {
    result.push({ kind: 'removed', text: localLines[i], localLine: i + 1, diskLine: null });
    i++;
  }
  while (j < m) {
    result.push({ kind: 'added', text: diskLines[j], localLine: null, diskLine: j + 1 });
    j++;
  }

  return result;
}
