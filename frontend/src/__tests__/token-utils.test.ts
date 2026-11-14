import { describe, expect, it } from 'vitest';
import { estimateTokens } from '../token-utils';

describe('estimateTokens', () => {
  it('returns 0 for empty or whitespace-only inputs', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('   \n\t  ')).toBe(0);
  });

  it('estimates tokens for short English and German text snippets', () => {
    // "Hello World" (11 chars, 2 words) -> max(11/3.7 ~= 2.97, 2*1.25 = 2.5) => 3 tokens
    const eng = estimateTokens('Hello World');
    expect(eng).toBeGreaterThanOrEqual(2);
    expect(eng).toBeLessThanOrEqual(4);

    // "Künstliche Intelligenz und maschinelles Lernen" (45 chars, 5 words)
    const ger = estimateTokens('Künstliche Intelligenz und maschinelles Lernen');
    expect(ger).toBeGreaterThanOrEqual(10);
    expect(ger).toBeLessThanOrEqual(16);
  });

  it('scales proportionally for larger Markdown documents and code blocks', () => {
    const markdown = `# System Prompt: Code Assistent\n\nDu bist ein spezialisierter Assistent.\n\n\`\`\`rust\nfn main() {\n    println!("Semyra");\n}\n\`\`\`\n`;
    const tokens = estimateTokens(markdown);
    expect(tokens).toBeGreaterThan(25);
    expect(tokens).toBeLessThan(60);
  });

  it('handles CRLF and leading/trailing whitespace consistently', () => {
    const lf = 'Alpha\nBeta\nGamma';
    const crlf = '  Alpha\r\nBeta\r\nGamma  ';
    expect(estimateTokens(crlf)).toBeGreaterThanOrEqual(estimateTokens(lf));
  });
});
