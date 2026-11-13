import { getFileExtension } from './path-utils';
import { estimateTokens } from './token-utils';

export interface AiBundleEntry {
  /** Display name or workspace-relative path shown in the fence header. */
  label: string;
  content: string;
}

export interface AiBundleResult {
  payload: string;
  totalTokens: number;
  fileCount: number;
}

/**
 * Formats a single document as a safely fenced Markdown block with file metadata.
 */
export function formatAiContextEntry(label: string, content: string): string {
  let fence = '```';
  while (content.includes(fence)) {
    fence += '`';
  }
  const ext = getFileExtension(label) || 'markdown';
  const body = content.endsWith('\n') ? content : `${content}\n`;
  return `${fence}${ext}:${label}\n${body}${fence}\n`;
}

/**
 * Combines multiple documents into a single LLM-ready Markdown context bundle
 * and computes the aggregated token estimate.
 */
export function buildAiContextBundle(entries: AiBundleEntry[]): AiBundleResult {
  if (entries.length === 0) {
    return { payload: '', totalTokens: 0, fileCount: 0 };
  }

  const blocks = entries.map((entry) => formatAiContextEntry(entry.label, entry.content));
  const payload = blocks.join('\n');
  return {
    payload,
    totalTokens: estimateTokens(payload),
    fileCount: entries.length,
  };
}
