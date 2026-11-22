/**
 * Estimates the number of LLM tokens for a given prompt, markdown text, or code snippet.
 * Calibrated against Byte Pair Encoding (BPE / cl100k) heuristics for mixed German/English
 * prose and formatted code.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const words = trimmed.match(/\S+/g)?.length ?? 0;
  return Math.ceil(Math.max(trimmed.length / 3.7, words * 1.25));
}
