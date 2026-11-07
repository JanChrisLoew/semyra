import { describe, expect, it } from 'vitest';
import { fuzzyMatch } from '../palette';

describe('fuzzyMatch', () => {
  it('returns empty indices and zero score for an empty query', () => {
    expect(fuzzyMatch('', 'README.md')).toEqual({ score: 0, indices: [] });
  });

  it('matches case-insensitively and returns character indices', () => {
    const res = fuzzyMatch('rdm', 'README.md');
    expect(res).not.toBeNull();
    expect(res!.indices).toEqual([0, 3, 4]);
  });

  it('scores contiguous prefix matches higher than scattered matches', () => {
    const contiguous = fuzzyMatch('mark', 'MarkLive.md');
    const scattered = fuzzyMatch('mark', 'my_archive_notes_k.md');
    expect(contiguous).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(contiguous!.score).toBeGreaterThan(scattered!.score);
  });

  it('rewards word-boundary and path-separator matches', () => {
    const boundary = fuzzyMatch('gs', 'docs\\getting-started.md');
    const middle = fuzzyMatch('gs', 'docs\\longstringfile.md');
    expect(boundary).not.toBeNull();
    expect(middle).not.toBeNull();
    expect(boundary!.score).toBeGreaterThan(middle!.score);
  });

  it('returns null when characters do not appear in order', () => {
    expect(fuzzyMatch('xyz', 'README.md')).toBeNull();
  });
});
