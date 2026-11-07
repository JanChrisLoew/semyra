import { describe, expect, it } from 'vitest';
import { computeSmartMarkdownEnter, formatSmartUrlPaste } from '../editor';

describe('computeSmartMarkdownEnter', () => {
  it('continues unordered list items and exits on empty marker', () => {
    const cont = computeSmartMarkdownEnter('  - Erster Punkt', 16);
    expect(cont).toEqual({ type: 'continue', insertText: '\n  - ' });

    const exit = computeSmartMarkdownEnter('  - ', 4);
    expect(exit).toEqual({ type: 'exit', replacementLine: '  ' });
  });

  it('continues checked or unchecked task list items with a fresh unchecked box', () => {
    const cont = computeSmartMarkdownEnter('- [x] Erledigt', 14);
    expect(cont).toEqual({ type: 'continue', insertText: '\n- [ ] ' });

    const exit = computeSmartMarkdownEnter('- [ ] ', 6);
    expect(exit).toEqual({ type: 'exit', replacementLine: '' });
  });

  it('increments numbered list items and exits on empty numbered marker', () => {
    const cont = computeSmartMarkdownEnter('1. Schritt eins', 15);
    expect(cont).toEqual({ type: 'continue', insertText: '\n2. ' });

    const exit = computeSmartMarkdownEnter('2. ', 3);
    expect(exit).toEqual({ type: 'exit', replacementLine: '' });
  });

  it('continues blockquotes and exits on empty quote line', () => {
    const cont = computeSmartMarkdownEnter('> Zitatzeile', 12);
    expect(cont).toEqual({ type: 'continue', insertText: '\n> ' });

    const exit = computeSmartMarkdownEnter('> ', 2);
    expect(exit).toEqual({ type: 'exit', replacementLine: '' });
  });

  it('does not treat horizontal rules as list items', () => {
    expect(computeSmartMarkdownEnter('* * *', 5)).toBeNull();
    expect(computeSmartMarkdownEnter('- - -', 5)).toBeNull();
  });
});

describe('formatSmartUrlPaste', () => {
  it('wraps single-line selected text with a pasted HTTPS URL', () => {
    expect(formatSmartUrlPaste('Rust Dokumentation', 'https://doc.rust-lang.org')).toBe(
      '[Rust Dokumentation](https://doc.rust-lang.org)',
    );
  });

  it('ignores non-URLs, multi-line selections, or selections that are already URLs', () => {
    expect(formatSmartUrlPaste('Text', 'kein-link')).toBeNull();
    expect(formatSmartUrlPaste('Zeile 1\nZeile 2', 'https://example.com')).toBeNull();
    expect(formatSmartUrlPaste('https://old.example.com', 'https://new.example.com')).toBeNull();
  });
});
