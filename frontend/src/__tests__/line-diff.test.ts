import { describe, expect, it } from 'vitest';
import { buildCollapsedDiffItems, computeLineDiff, type DiffLine } from '../line-diff';

function makeContextLines(count: number, startLine = 1): DiffLine[] {
  return Array.from({ length: count }, (_, idx) => ({
    kind: 'context' as const,
    text: `line ${startLine + idx}`,
    localLine: startLine + idx,
    diskLine: startLine + idx,
  }));
}

describe('line-diff', () => {
  it('identifies added, removed, and context lines', () => {
    const local = 'line 1\nold line\nline 3';
    const disk = 'line 1\nnew line\nline 3\nline 4';
    const diff = computeLineDiff(local, disk);

    expect(diff).toEqual([
      { kind: 'context', text: 'line 1', localLine: 1, diskLine: 1 },
      { kind: 'removed', text: 'old line', localLine: 2, diskLine: null },
      { kind: 'added', text: 'new line', localLine: null, diskLine: 2 },
      { kind: 'context', text: 'line 3', localLine: 3, diskLine: 3 },
      { kind: 'added', text: 'line 4', localLine: null, diskLine: 4 },
    ]);
  });

  it('normalizes CRLF and LF before diffing', () => {
    const diff = computeLineDiff('a\r\nb', 'a\nb');
    expect(diff.every((d) => d.kind === 'context')).toBe(true);
  });

  it('returns empty array when buildCollapsedDiffItems receives empty input', () => {
    expect(buildCollapsedDiffItems([])).toEqual([]);
  });

  it('collapses long unchanged runs while keeping surrounding context lines', () => {
    const lines: DiffLine[] = [
      ...makeContextLines(6, 1), // indices 0..5 -> 0..2 collapsed (3), 3..5 context
      { kind: 'added', text: 'inserted', localLine: null, diskLine: 7 }, // index 6
      ...makeContextLines(10, 7), // indices 7..16 -> 7..9 context, 10..13 collapsed (4), 14..16 context
      { kind: 'removed', text: 'deleted', localLine: 17, diskLine: null }, // index 17
      ...makeContextLines(6, 18), // indices 18..23 -> 18..20 context, 21..23 collapsed (3)
    ];

    const collapsed = buildCollapsedDiffItems(lines, 3);

    expect(collapsed[0]).toEqual({ kind: 'collapsed', startIdx: 0, endIdx: 2, count: 3 });
    expect(collapsed.slice(1, 4).every((item) => item.kind === 'line')).toBe(true);
    expect(collapsed[4]).toEqual({
      kind: 'line',
      index: 6,
      line: { kind: 'added', text: 'inserted', localLine: null, diskLine: 7 },
    });
    expect(collapsed[8]).toEqual({ kind: 'collapsed', startIdx: 10, endIdx: 13, count: 4 });
    expect(collapsed[12]).toEqual({
      kind: 'line',
      index: 17,
      line: { kind: 'removed', text: 'deleted', localLine: 17, diskLine: null },
    });
    expect(collapsed[16]).toEqual({ kind: 'collapsed', startIdx: 21, endIdx: 23, count: 3 });
  });

  it('does not collapse a single-line gap between context windows', () => {
    const lines: DiffLine[] = [
      { kind: 'added', text: 'a', localLine: null, diskLine: 1 },
      ...makeContextLines(7, 2), // 3 after 'a' + 1 gap + 3 before 'b'
      { kind: 'added', text: 'b', localLine: null, diskLine: 9 },
    ];

    const collapsed = buildCollapsedDiffItems(lines, 3);
    expect(collapsed.every((item) => item.kind === 'line')).toBe(true);
    expect(collapsed).toHaveLength(9);
  });

  it('supports contextLines = 0', () => {
    const lines: DiffLine[] = [
      ...makeContextLines(3, 1),
      { kind: 'removed', text: 'old', localLine: 4, diskLine: null },
      ...makeContextLines(2, 5),
    ];

    const collapsed = buildCollapsedDiffItems(lines, 0);
    expect(collapsed).toEqual([
      { kind: 'collapsed', startIdx: 0, endIdx: 2, count: 3 },
      { kind: 'line', index: 3, line: { kind: 'removed', text: 'old', localLine: 4, diskLine: null } },
      { kind: 'collapsed', startIdx: 4, endIdx: 5, count: 2 },
    ]);
  });
});
