export type DiffKind = 'context' | 'added' | 'removed';

export interface DiffLine {
  kind: DiffKind;
  text: string;
  localLine: number | null;
  diskLine: number | null;
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
