import { foldCode, foldedRanges } from '@codemirror/language';
import { describe, expect, it, vi } from 'vitest';
import {
  computeSmartMarkdownEnter,
  formatSmartUrlPaste,
  MarkdownEditorController,
} from '../editor';

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

describe('MarkdownEditorController keybindings & folding integration', () => {
  // Polyfill Range geometry stubs missing in jsdom so CodeMirror drawSelection measures cleanly
  if (typeof Range !== 'undefined') {
    Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect ??= () => new DOMRect(0, 0, 0, 0);
  }

  function createController(doc: string, onCopyRichText = vi.fn()) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ctrl = new MarkdownEditorController(host, doc, {
      onDocChanged: vi.fn(),
      onCursorChanged: vi.fn(),
      onEditorScrolled: vi.fn(),
      onFormatCommand: vi.fn(),
      onPasteImage: vi.fn(),
      onCopyRichText,
    });
    return { host, ctrl, onCopyRichText };
  }

  it('does not swallow DE-QWERTZ AltGr characters ([ , ] , \\) and routes Strg+Umschalt+K without mutating text', () => {
    const { host, ctrl, onCopyRichText } = createController('# Kapitel\nZeile bleibt erhalten\n');

    for (const key of ['[', ']', '\\']) {
      const ev = new KeyboardEvent('keydown', {
        key,
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      ctrl.view.contentDOM.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }

    // Strg+Umschalt+K must trigger onCopyRichText and NEVER deleteLine or Mod-k link
    const shiftModK = new KeyboardEvent('keydown', {
      key: 'K',
      code: 'KeyK',
      keyCode: 75,
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    ctrl.view.contentDOM.dispatchEvent(shiftModK);
    expect(onCopyRichText).toHaveBeenCalledTimes(1);
    expect(ctrl.getContent()).toBe('# Kapitel\nZeile bleibt erhalten\n');

    ctrl.view.destroy();
    host.remove();
  });

  it('opens the German search/replace panel on Strg+H and auto-unfolds collapsed sections on jumpToLine', () => {
    const { host, ctrl } = createController('# Kapitel 1\nAbsatz A\nAbsatz B\n\n# Kapitel 2\n');

    // Fold `# Kapitel 1`
    ctrl.view.dispatch({ selection: { anchor: 0 } });
    expect(foldCode(ctrl.view)).toBe(true);

    let foldCount = 0;
    foldedRanges(ctrl.view.state).between(0, ctrl.view.state.doc.length, () => {
      foldCount++;
    });
    expect(foldCount).toBe(1);

    // Jumping into line 3 inside the folded section automatically unfolds it
    ctrl.jumpToLine(3);
    let afterJumpFolds = 0;
    foldedRanges(ctrl.view.state).between(0, ctrl.view.state.doc.length, () => {
      afterJumpFolds++;
    });
    expect(afterJumpFolds).toBe(0);

    // Strg+H opens the German search & replace bar
    const ctrlH = new KeyboardEvent('keydown', {
      key: 'h',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    ctrl.view.contentDOM.dispatchEvent(ctrlH);
    const searchPanel = ctrl.view.dom.querySelector('.cm-search');
    expect(searchPanel).not.toBeNull();
    expect(searchPanel!.textContent).toContain('Ersetzen');

    ctrl.view.destroy();
    host.remove();
  });
});
