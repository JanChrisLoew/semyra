import { estimateTokens } from './token-utils';

export interface DetailedDocStats {
  charsTotal: number;
  charsNoSpaces: number;
  wordsTotal: number;
  wordsSelected: number;
  charsSelected: number;
  linesTotal: number;
  paragraphsTotal: number;
  readingTimeString: string;
  speakingTimeString: string;
  fleschScore: number;
  fleschGrade: string;
  tokensEstimate: number;
}

/**
 * Estimates the syllable count of a word using vowel-cluster grouping for German & English.
 */
export function estimateSyllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-zäöüß]/g, '');
  if (!clean) return 1;
  const matches = clean.match(/[aeiouyäöü]+/g);
  return matches ? Math.max(1, matches.length) : 1;
}

/**
 * Calculates in-depth document statistics including character breakdown,
 * speaking/reading duration, Flesch Reading Ease, and paragraph structure.
 */
export function calculateDetailedStats(
  text: string,
  selection?: { chars: number; words: number },
): DetailedDocStats {
  const charsTotal = text.length;
  const charsNoSpaces = text.replace(/\s/g, '').length;
  const linesTotal = text.length === 0 ? 0 : text.split(/\r?\n/).length;

  const rawParagraphs = text.split(/\r?\n\s*\r?\n/);
  const paragraphsTotal =
    text.trim() === ''
      ? 0
      : rawParagraphs.filter((p) => p.trim().length > 0).length;

  const words = text.trim().match(/\S+/g) ?? [];
  const wordsTotal = words.length;

  const wordsSelected = selection?.words ?? 0;
  const charsSelected = selection?.chars ?? 0;

  // Reading time (~200 WPM)
  const readingTimeString =
    wordsTotal === 0
      ? '0 Min.'
      : wordsTotal < 150
        ? '< 1 Min.'
        : `${Math.round(wordsTotal / 200)} Min.`;

  // Speaking time (~130 WPM)
  const speakingTimeString =
    wordsTotal === 0
      ? '0 Min.'
      : wordsTotal < 90
        ? '< 1 Min.'
        : `${Math.round(wordsTotal / 130)} Min.`;

  // Flesch Reading Ease (Amstad formulation for German & English mixed technical text)
  // Score = 180 - (words / sentences) - (58.5 * (syllables / words))
  let fleschScore = 100;
  let fleschGrade = 'Sehr leicht';

  if (wordsTotal > 0) {
    const rawSentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const sentenceCount = Math.max(1, rawSentences.length);
    const totalSyllables = words.reduce((acc, w) => acc + estimateSyllables(w), 0);

    const asl = wordsTotal / sentenceCount;
    const asw = totalSyllables / wordsTotal;

    const rawScore = 180 - asl - 58.5 * asw;
    fleschScore = Math.min(100, Math.max(0, Math.round(rawScore)));

    if (fleschScore >= 80) {
      fleschGrade = 'Sehr leicht';
    } else if (fleschScore >= 65) {
      fleschGrade = 'Leicht';
    } else if (fleschScore >= 50) {
      fleschGrade = 'Mittelschwer (Standard)';
    } else if (fleschScore >= 35) {
      fleschGrade = 'Anspruchsvoll';
    } else {
      fleschGrade = 'Sehr anspruchsvoll (Fachtext)';
    }
  } else {
    fleschScore = 100;
    fleschGrade = '–';
  }

  const tokensEstimate = estimateTokens(text);

  return {
    charsTotal,
    charsNoSpaces,
    wordsTotal,
    wordsSelected,
    charsSelected,
    linesTotal,
    paragraphsTotal,
    readingTimeString,
    speakingTimeString,
    fleschScore,
    fleschGrade,
    tokensEstimate,
  };
}
