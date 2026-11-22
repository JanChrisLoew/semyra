import { describe, expect, it } from 'vitest';
import {
  calculateDetailedStats,
  computeHeadingTokenCounts,
  estimateSyllables,
  extractMarkdownSection,
} from '../stats-utils';

describe('stats-utils', () => {
  describe('estimateSyllables', () => {
    it('estimates syllables for simple and complex words', () => {
      expect(estimateSyllables('Haus')).toBe(1);
      expect(estimateSyllables('Garten')).toBe(2);
      expect(estimateSyllables('Entwicklungsumgebung')).toBe(6);
      expect(estimateSyllables('')).toBe(1);
    });
  });

  describe('calculateDetailedStats', () => {
    it('handles empty document', () => {
      const stats = calculateDetailedStats('');
      expect(stats.charsTotal).toBe(0);
      expect(stats.charsNoSpaces).toBe(0);
      expect(stats.wordsTotal).toBe(0);
      expect(stats.linesTotal).toBe(0);
      expect(stats.paragraphsTotal).toBe(0);
      expect(stats.readingTimeString).toBe('0 Min.');
      expect(stats.speakingTimeString).toBe('0 Min.');
      expect(stats.fleschGrade).toBe('–');
      expect(stats.tokensEstimate).toBe(0);
    });

    it('calculates counts and paragraph structure accurately', () => {
      const doc = 'Erster Absatz mit ein paar Wörtern.\n\nZweiter Absatz mit mehr Text.';
      const stats = calculateDetailedStats(doc, { chars: 10, words: 2 });

      expect(stats.charsTotal).toBe(doc.length);
      expect(stats.charsNoSpaces).toBe(doc.replace(/\s/g, '').length);
      expect(stats.wordsTotal).toBe(11);
      expect(stats.paragraphsTotal).toBe(2);
      expect(stats.linesTotal).toBe(3);
      expect(stats.wordsSelected).toBe(2);
      expect(stats.charsSelected).toBe(10);
      expect(stats.readingTimeString).toBe('< 1 Min.');
      expect(stats.speakingTimeString).toBe('< 1 Min.');
      expect(stats.fleschScore).toBeGreaterThan(0);
      expect(stats.tokensEstimate).toBeGreaterThan(0);
    });

    it('calculates reading and speaking times for longer documents', () => {
      // 400 words
      const wordsArray = Array.from({ length: 400 }, () => 'Dokumentation');
      const longDoc = wordsArray.join(' ');
      const stats = calculateDetailedStats(longDoc);

      expect(stats.wordsTotal).toBe(400);
      expect(stats.readingTimeString).toBe('2 Min.'); // 400 / 200 = 2
      expect(stats.speakingTimeString).toBe('3 Min.'); // 400 / 130 = 3.07 -> 3
    });
  });

  describe('computeHeadingTokenCounts & extractMarkdownSection', () => {
    const sampleDoc = [
      '---',
      'title: Frontmatter',
      '---',
      '# Intro ##',
      'Welcome to Semyra.',
      '',
      '## Setup',
      'Install steps here.',
      '',
      '```bash',
      '# comment inside code block',
      'echo "ok"',
      '```',
      '',
      '### Details',
      'Deep dive text.',
      '',
      '## Usage',
      'Run the binary.',
      '',
      '# Appendix',
      'Extra notes.',
    ].join('\n');

    it('computes hierarchical section token counts and ignores frontmatter/code fences', () => {
      const counts = computeHeadingTokenCounts(sampleDoc);
      expect(counts.map((c) => ({ line: c.line, level: c.level, text: c.text }))).toEqual([
        { line: 4, level: 1, text: 'Intro' },
        { line: 7, level: 2, text: 'Setup' },
        { line: 15, level: 3, text: 'Details' },
        { line: 18, level: 2, text: 'Usage' },
        { line: 21, level: 1, text: 'Appendix' },
      ]);

      // Intro (H1) includes Setup, Details, Usage, so it has more tokens than Setup (H2) or Appendix (H1)
      expect(counts[0].tokens).toBeGreaterThan(counts[1].tokens);
      expect(counts[1].tokens).toBeGreaterThan(counts[2].tokens);
      expect(counts[4].tokens).toBeGreaterThan(0);
    });

    it('returns empty array for empty or headingless documents', () => {
      expect(computeHeadingTokenCounts('')).toEqual([]);
      expect(computeHeadingTokenCounts('Just plain text.\nNo headings.')).toEqual([]);
    });

    it('extracts a section by 1-based headingLine up to next same/higher heading or EOF', () => {
      const setup = extractMarkdownSection(sampleDoc, 7);
      expect(setup).not.toBeNull();
      expect(setup!.heading).toBe('Setup');
      expect(setup!.content).toContain('## Setup');
      expect(setup!.content).toContain('### Details');
      expect(setup!.content).not.toContain('## Usage');

      const appendix = extractMarkdownSection(sampleDoc, 21);
      expect(appendix).toEqual({
        heading: 'Appendix',
        content: '# Appendix\nExtra notes.',
      });
    });

    it('returns null when headingLine is invalid or not a heading', () => {
      expect(extractMarkdownSection(sampleDoc, 0)).toBeNull();
      expect(extractMarkdownSection(sampleDoc, 5)).toBeNull(); // body line
      expect(extractMarkdownSection(sampleDoc, 11)).toBeNull(); // # comment in code fence
      expect(extractMarkdownSection('', 1)).toBeNull();
    });
  });
});
