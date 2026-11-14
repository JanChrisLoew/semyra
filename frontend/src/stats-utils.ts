import { estimateTokens } from './token-utils';
import { getLanguage, Language, t } from './i18n';

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
  lang: Language = getLanguage(),
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

  const isEn = lang === 'en';
  const minUnit = isEn ? 'min' : 'Min.';
  const zeroMin = isEn ? '0 min' : '0 Min.';
  const lessOneMin = isEn ? '< 1 min' : '< 1 Min.';

  // Reading time (~200 WPM)
  const readingTimeString =
    wordsTotal === 0
      ? zeroMin
      : wordsTotal < 150
        ? lessOneMin
        : `${Math.round(wordsTotal / 200)} ${minUnit}`;

  // Speaking time (~130 WPM)
  const speakingTimeString =
    wordsTotal === 0
      ? zeroMin
      : wordsTotal < 90
        ? lessOneMin
        : `${Math.round(wordsTotal / 130)} ${minUnit}`;

  // Flesch Reading Ease (Amstad formulation for German & English mixed technical text)
  // Score = 180 - (words / sentences) - (58.5 * (syllables / words))
  let fleschScore = 100;
  let fleschGrade = isEn ? 'Very Easy' : 'Sehr leicht';

  if (wordsTotal > 0) {
    const rawSentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const sentenceCount = Math.max(1, rawSentences.length);
    const totalSyllables = words.reduce((acc, w) => acc + estimateSyllables(w), 0);

    const asl = wordsTotal / sentenceCount;
    const asw = totalSyllables / wordsTotal;

    const rawScore = 180 - asl - 58.5 * asw;
    fleschScore = Math.min(100, Math.max(0, Math.round(rawScore)));

    if (fleschScore >= 80) {
      fleschGrade = t('docStats.gradeVeryEasy');
    } else if (fleschScore >= 65) {
      fleschGrade = t('docStats.gradeEasy');
    } else if (fleschScore >= 50) {
      fleschGrade = t('docStats.gradeModerate');
    } else if (fleschScore >= 35) {
      fleschGrade = t('docStats.gradeDifficult');
    } else {
      fleschGrade = t('docStats.gradeVeryDifficult');
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

export interface HeadingTokenCount {
  /** 1-based line number of the heading. */
  line: number;
  /** Heading level (1-6). */
  level: number;
  /** Cleaned heading text without `#` markers. */
  text: string;
  /** Estimated LLM tokens for this section up to the next heading of same/higher level or EOF. */
  tokens: number;
}

export interface MarkdownSection {
  /** Cleaned heading text without `#` markers. */
  heading: string;
  /** Extracted Markdown section starting at the heading line through the end of the section. */
  content: string;
}

interface ParsedHeading {
  line: number;
  level: number;
  text: string;
}

function parseMarkdownHeadings(lines: string[]): ParsedHeading[] {
  let startIdx = 0;
  if (lines.length >= 2 && /^(?:\uFEFF)?---[ \t]*$/.test(lines[0])) {
    for (let j = 1; j < lines.length; j++) {
      if (/^---[ \t]*$/.test(lines[j])) {
        startIdx = j + 1;
        break;
      }
    }
  }

  const headings: ParsedHeading[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!inFence) {
      const openMatch = line.match(/^[ ]{0,3}(`{3,}|~{3,})(.*)$/);
      if (openMatch && !(openMatch[1][0] === '`' && openMatch[2].includes('`'))) {
        inFence = true;
        fenceChar = openMatch[1][0];
        fenceLen = openMatch[1].length;
        continue;
      }

      const headingMatch = line.match(/^[ ]{0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/);
      if (headingMatch) {
        const rawText = headingMatch[2] ?? '';
        const text = rawText.replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim();
        headings.push({
          line: i + 1,
          level: headingMatch[1].length,
          text,
        });
      }
    } else {
      const closeMatch = line.match(/^[ ]{0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closeMatch && closeMatch[1][0] === fenceChar && closeMatch[1].length >= fenceLen) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
      }
    }
  }

  return headings;
}

function findSectionEndIndex(
  headings: ParsedHeading[],
  headingIdx: number,
  totalLines: number,
): number {
  const currentLevel = headings[headingIdx].level;
  for (let m = headingIdx + 1; m < headings.length; m++) {
    if (headings[m].level <= currentLevel) {
      return headings[m].line - 1;
    }
  }
  return totalLines;
}

/**
 * Computes estimated LLM token counts for each Markdown heading's section
 * (running up to the next heading of the same or higher level, or EOF).
 */
export function computeHeadingTokenCounts(content: string): HeadingTokenCount[] {
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  const headings = parseMarkdownHeadings(lines);

  return headings.map((h, idx) => {
    const endIdx = findSectionEndIndex(headings, idx, lines.length);
    const sectionText = lines.slice(h.line - 1, endIdx).join('\n');
    return {
      line: h.line,
      level: h.level,
      text: h.text,
      tokens: estimateTokens(sectionText),
    };
  });
}

/**
 * Extracts a single Markdown section starting at the given 1-based `headingLine`
 * up to the next heading of the same or higher level, or EOF.
 */
export function extractMarkdownSection(
  content: string,
  headingLine: number,
): MarkdownSection | null {
  if (!content || headingLine < 1) return null;
  const lines = content.split(/\r?\n/);
  const headings = parseMarkdownHeadings(lines);
  const idx = headings.findIndex((h) => h.line === headingLine);
  if (idx === -1) return null;

  const target = headings[idx];
  const endIdx = findSectionEndIndex(headings, idx, lines.length);
  const sectionContent = lines.slice(target.line - 1, endIdx).join('\n').trimEnd();

  return {
    heading: target.text,
    content: sectionContent,
  };
}
