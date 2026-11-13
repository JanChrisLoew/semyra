import { describe, expect, it } from 'vitest';
import { computeLineDiff } from '../line-diff';

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
});
