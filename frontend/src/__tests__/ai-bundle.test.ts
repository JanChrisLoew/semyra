import { describe, expect, it } from 'vitest';
import { buildAiContextBundle, formatAiContextEntry } from '../ai-bundle';

describe('ai-bundle', () => {
  it('formats a single entry with safe fence escalation', () => {
    const out = formatAiContextEntry('AGENTS.md', 'Hello\n```\ncode\n```');
    expect(out.startsWith('````md:AGENTS.md\n')).toBe(true);
    expect(out.endsWith('\n````\n')).toBe(true);
  });

  it('builds a combined bundle and calculates aggregated tokens', () => {
    const res = buildAiContextBundle([
      { label: 'docs/AGENTS.md', content: '# Agent Guide\nKeep it clean.' },
      { label: 'src/prompt.md', content: 'You are helpful.' },
    ]);
    expect(res.fileCount).toBe(2);
    expect(res.totalTokens).toBeGreaterThan(10);
    expect(res.payload).toContain('```md:docs/AGENTS.md');
    expect(res.payload).toContain('```md:src/prompt.md');
  });

  it('returns empty result for empty list', () => {
    const res = buildAiContextBundle([]);
    expect(res).toEqual({ payload: '', totalTokens: 0, fileCount: 0 });
  });
});
