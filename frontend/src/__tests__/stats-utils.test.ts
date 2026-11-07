import { describe, expect, it } from 'vitest';
import { calculateDetailedStats, estimateSyllables } from '../stats-utils';

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
});
