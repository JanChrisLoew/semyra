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

  function createController(
    doc: string,
    onCopyRichText = vi.fn(),
    onCopyMarkdown = vi.fn(),
  ) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ctrl = new MarkdownEditorController(host, doc, {
      onDocChanged: vi.fn(),
      onCursorChanged: vi.fn(),
      onEditorScrolled: vi.fn(),
      onFormatCommand: vi.fn(),
      onPasteImage: vi.fn(),
      onCopyRichText,
      onCopyMarkdown,
    });
    return { host, ctrl, onCopyRichText, onCopyMarkdown };
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

  it('routes Strg+Umschalt+C to onCopyMarkdown without modifying document', () => {
    const onCopyMarkdown = vi.fn();
    const { host, ctrl } = createController(
      '# Notizen\nMein Markdown Text\n',
      vi.fn(),
      onCopyMarkdown,
    );

    const shiftModC = new KeyboardEvent('keydown', {
      key: 'C',
      code: 'KeyC',
      keyCode: 67,
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    ctrl.view.contentDOM.dispatchEvent(shiftModC);
    expect(onCopyMarkdown).toHaveBeenCalledTimes(1);
    expect(ctrl.getContent()).toBe('# Notizen\nMein Markdown Text\n');

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

    // Strg+H opens the German search & replace bar and focuses the Replace field
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
    const replaceInput = ctrl.view.dom.querySelector<HTMLInputElement>(
      '.cm-search input[name="replace"]',
    );
    expect(replaceInput).not.toBeNull();
    expect(document.activeElement).toBe(replaceInput);

    // Folded scrollToSourceLine increases monotonically without per-line sawtooth jitter
    ctrl.view.dispatch({ selection: { anchor: 0 } });
    expect(foldCode(ctrl.view)).toBe(true);
    ctrl.scrollToSourceLine(1.5);
    const topEarly = ctrl.view.scrollDOM.scrollTop;
    ctrl.scrollToSourceLine(3.2);
    const topLate = ctrl.view.scrollDOM.scrollTop;
    expect(topLate).toBeGreaterThanOrEqual(topEarly);

    ctrl.view.destroy();
    host.remove();
  });

  it('switches list formats cleanly without stacking markers', () => {
    const { host, ctrl } = createController('- Punkt eins\n- Punkt zwei\n');

    // Select both lines
    ctrl.view.dispatch({ selection: { anchor: 0, head: ctrl.view.state.doc.length } });

    // Switch to ordered list
    ctrl.applyFormat('ol');
    expect(ctrl.view.state.doc.toString()).toBe('1. Punkt eins\n1. Punkt zwei\n');

    // Switch to task list
    ctrl.view.dispatch({ selection: { anchor: 0, head: ctrl.view.state.doc.length } });
    ctrl.applyFormat('task');
    expect(ctrl.view.state.doc.toString()).toBe('- [ ] Punkt eins\n- [ ] Punkt zwei\n');

    // Switch to blockquote
    ctrl.view.dispatch({ selection: { anchor: 0, head: ctrl.view.state.doc.length } });
    ctrl.applyFormat('quote');
    expect(ctrl.view.state.doc.toString()).toBe('> Punkt eins\n> Punkt zwei\n');

    ctrl.view.destroy();
    host.remove();
  });

  it('toggles task checkboxes on Alt+C / toggleCurrentTask', () => {
    const { host, ctrl } = createController('- [ ] Task eins\n- [x] Task zwei\n- Normaler Punkt\nKeine Liste\n');

    // Cursor on line 1: toggle unchecked -> checked
    ctrl.view.dispatch({ selection: { anchor: 4 } });
    expect(ctrl.toggleCurrentTask()).toBe(true);
    expect(ctrl.view.state.doc.line(1).text).toBe('- [x] Task eins');

    // Toggle checked -> unchecked
    expect(ctrl.toggleCurrentTask()).toBe(true);
    expect(ctrl.view.state.doc.line(1).text).toBe('- [ ] Task eins');

    // Cursor on line 3: upgrade bullet -> task checkbox
    ctrl.view.dispatch({ selection: { anchor: ctrl.view.state.doc.line(3).from } });
    expect(ctrl.toggleCurrentTask()).toBe(true);
    expect(ctrl.view.state.doc.line(3).text).toBe('- [ ] Normaler Punkt');

    // Cursor on line 4: prepend task checkbox
    ctrl.view.dispatch({ selection: { anchor: ctrl.view.state.doc.line(4).from } });
    expect(ctrl.toggleCurrentTask()).toBe(true);
    expect(ctrl.view.state.doc.line(4).text).toBe('- [ ] Keine Liste');

    ctrl.view.destroy();
    host.remove();
  });

  it('switches editor grammar dynamically via setLanguageForFile', async () => {
    const { host, ctrl } = createController('{\n  "name": "semyra"\n}\n');

    await ctrl.setLanguageForFile('package.json');
    expect(ctrl.getContent()).toContain('"name": "semyra"');

    await ctrl.setLanguageForFile('config.yaml');
    expect(ctrl.getContent()).toContain('"name": "semyra"');

    await ctrl.setLanguageForFile('README.md');
    expect(ctrl.getContent()).toContain('"name": "semyra"');

    ctrl.view.destroy();
    host.remove();
  });

  it('does not insert fallback ./bild.png when onPickImage resolves to null', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onPickImage = vi.fn().mockResolvedValue(null);
    const ctrl = new MarkdownEditorController(host, 'Hallo ', {
      onDocChanged: vi.fn(),
      onCursorChanged: vi.fn(),
      onEditorScrolled: vi.fn(),
      onFormatCommand: vi.fn(),
      onPasteImage: vi.fn(),
      onPickImage,
    });
    ctrl.view.dispatch({ selection: { anchor: 6 } });
    ctrl.applyFormat('image');
    await Promise.resolve();
    expect(onPickImage).toHaveBeenCalledTimes(1);
    expect(ctrl.getContent()).toBe('Hallo ');

    ctrl.view.destroy();
    host.remove();
  });

  it('updates i18n, aria-label, and format fallback snippets on swapState after setAppLanguage', () => {
    const { host, ctrl } = createController('Tab 1');
    const secondState = ctrl.createState('');

    ctrl.setAppLanguage('en');
    expect(ctrl.view.contentDOM.getAttribute('aria-label')).toBe('Markdown Editor');

    ctrl.swapState(secondState);
    expect(ctrl.view.contentDOM.getAttribute('aria-label')).toBe('Markdown Editor');
    expect(ctrl.view.dom.textContent).toContain('Write your Markdown here');

    ctrl.applyFormat('bold');
    expect(ctrl.getContent()).toBe('**bold text**');

    ctrl.view.destroy();
    host.remove();
  });
});
