import {
  closeBrackets,
  closeBracketsKeymap,
} from '@codemirror/autocomplete';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  bracketMatching,
  foldedRanges,
  foldGutter,
  foldService,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
  syntaxTree,
  unfoldEffect,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import {
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
} from '@codemirror/search';
import { Compartment, EditorState, Extension, StateEffect } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { germanCodeMirrorPhrases } from './editor-l10n-de';
import {
  convertClipboardToMarkdownTable,
  formatTableAtCursorOrAll,
  navigateMarkdownTableCell,
} from './markdown-table';

const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '700', fontSize: '1.3em' },
  { tag: tags.heading2, fontWeight: '700', fontSize: '1.16em' },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: '650' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.monospace, tags.processingInstruction], color: 'var(--accent)' },
  { tag: [tags.link, tags.url], color: 'var(--accent)', textDecoration: 'underline' },
  { tag: tags.quote, color: 'var(--fg-secondary)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--fg-muted)' },
]);

export interface SmartEnterAction {
  type: 'continue' | 'exit';
  insertText?: string;
  replacementLine?: string;
}

/**
 * Pure helper computing Markdown list, task-list, numbered-list, and blockquote
 * continuation or clean exit on Enter.
 */
export function computeSmartMarkdownEnter(
  lineText: string,
  cursorOffsetInLine: number,
): SmartEnterAction | null {
  // 1. Task list item: - [ ] or * [x]
  const taskMatch = /^(\s*)([-*+])\s+\[[ xX]\](\s*)(.*)$/.exec(lineText);
  if (taskMatch) {
    const [, indent, bullet, spaceAfterBox, rest] = taskMatch;
    const prefixLen = lineText.length - rest.length;
    if (cursorOffsetInLine < prefixLen - spaceAfterBox.length) return null;
    if (rest.trim().length === 0 && cursorOffsetInLine === lineText.length) {
      return { type: 'exit', replacementLine: indent };
    }
    return { type: 'continue', insertText: `\n${indent}${bullet} [ ] ` };
  }

  // 2. Unordered list item: - item / * item / + item (avoid horizontal rules like --- or * * *)
  const ulMatch = /^(\s*)([-*+])\s+(.*)$/.exec(lineText);
  if (ulMatch) {
    const [, indent, bullet, rest] = ulMatch;
    if (/^([-*_])(?:\s*\1){2,}\s*$/.test(lineText)) return null;
    const prefixLen = lineText.length - rest.length;
    if (cursorOffsetInLine < prefixLen) return null;
    if (rest.trim().length === 0 && cursorOffsetInLine === lineText.length) {
      return { type: 'exit', replacementLine: indent };
    }
    return { type: 'continue', insertText: `\n${indent}${bullet} ` };
  }

  // 3. Ordered list item: 1. item / 1) item
  const olMatch = /^(\s*)(\d+)([.)])\s+(.*)$/.exec(lineText);
  if (olMatch) {
    const [, indent, numStr, delimiter, rest] = olMatch;
    const prefixLen = lineText.length - rest.length;
    if (cursorOffsetInLine < prefixLen) return null;
    if (rest.trim().length === 0 && cursorOffsetInLine === lineText.length) {
      return { type: 'exit', replacementLine: indent };
    }
    const nextNum = Number(numStr) + 1;
    return { type: 'continue', insertText: `\n${indent}${nextNum}${delimiter} ` };
  }

  // 4. Blockquote / GFM Alert: > quote
  const quoteMatch = /^(\s*(?:>\s*)+)(.*)$/.exec(lineText);
  if (quoteMatch) {
    const [, rawQuotePrefix, rest] = quoteMatch;
    if (cursorOffsetInLine < rawQuotePrefix.length) return null;
    if (rest.trim().length === 0 && cursorOffsetInLine === lineText.length) {
      return { type: 'exit', replacementLine: '' };
    }
    const normalizedPrefix = `${rawQuotePrefix.replace(/\s+$/, '')} `;
    return { type: 'continue', insertText: `\n${normalizedPrefix}` };
  }

  return null;
}

/**
 * Pure helper formatting a pasted HTTP(S) URL into `[selected](url)` when single-line text is selected.
 */
export function formatSmartUrlPaste(
  selectedText: string,
  pastedText: string,
): string | null {
  const trimmedUrl = pastedText.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmedUrl)) return null;
  if (!selectedText || selectedText.trim().length === 0) return null;
  if (selectedText.includes('\n') || selectedText.includes('\r')) return null;
  if (/^https?:\/\/\S+$/i.test(selectedText.trim())) return null;
  return `[${selectedText}](${trimmedUrl})`;
}

export interface EditorCallbacks {
  onDocChanged: (content: string) => void;
  onCursorChanged: (line: number, col: number) => void;
  onEditorScrolled: () => void;
  onFormatCommand: (cmd: FormatAction) => void;
  onPasteImage: (mimeType: string, dataUrl: string) => void;
  onCopyRichText?: () => void;
}

export type FormatAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'ul'
  | 'ol'
  | 'task'
  | 'quote'
  | 'alert'
  | 'code'
  | 'codeblock'
  | 'link'
  | 'image'
  | 'align-table'
  | 'math'
  | 'mermaid'
  | 'hr';

/**
 * Fold service supporting YAML frontmatter (`--- ... ---`) at line 1 and
 * hierarchical ATX Markdown heading sections (`#` .. `######`).
 */
const markdownSectionFoldService = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);

  // 1. YAML Frontmatter at line 1
  if (line.number === 1 && line.text.trim() === '---') {
    const maxLine = Math.min(state.doc.lines, 160);
    for (let l = 2; l <= maxLine; l++) {
      const candidate = state.doc.line(l);
      const t = candidate.text.trim();
      if (t === '---' || t === '...') {
        return { from: line.to, to: candidate.to };
      }
    }
    return null;
  }

  // 2. ATX Heading section (`#` .. `######`) outside fenced code blocks
  const headingMatch = /^(#{1,6})\s+\S/.exec(line.text);
  if (!headingMatch) return null;

  let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null =
    syntaxTree(state).resolveInner(line.from, 1);
  while (node) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return null;
    node = node.parent;
  }

  const level = headingMatch[1].length;
  let endLineNum = line.number;
  let inFence = false;
  let fenceChar = '';

  for (let l = line.number + 1; l <= state.doc.lines; l++) {
    const cur = state.doc.line(l);
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(cur.text);
    if (fenceMatch) {
      const ch = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
      } else if (ch === fenceChar) {
        inFence = false;
      }
      endLineNum = l;
      continue;
    }

    if (!inFence) {
      const nextHeading = /^(#{1,6})\s+\S/.exec(cur.text);
      if (nextHeading && nextHeading[1].length <= level) {
        break;
      }
    }
    endLineNum = l;
  }

  // Keep a clean blank separator line visible before the following heading
  while (endLineNum > line.number && state.doc.line(endLineNum).text.trim() === '') {
    endLineNum--;
  }

  if (endLineNum <= line.number) return null;
  return { from: line.to, to: state.doc.line(endLineNum).to };
});

export class MarkdownEditorController {
  public view: EditorView;
  private callbacks: EditorCallbacks;
  private wordWrapCompartment = new Compartment();
  private spellcheckCompartment = new Compartment();
  private wordWrapEnabled = true;
  private spellcheckEnabled = false;
  private sharedExtensions: Extension;

  constructor(host: HTMLElement, initialContent: string, callbacks: EditorCallbacks) {
    this.callbacks = callbacks;
    this.sharedExtensions = this.buildExtensions();

    this.view = new EditorView({
      state: this.createState(initialContent),
      parent: host,
    });
  }

  private wordWrapExtension(enabled: boolean): Extension {
    return enabled ? EditorView.lineWrapping : [];
  }

  private spellcheckExtension(enabled: boolean): Extension {
    return EditorView.contentAttributes.of({
      spellcheck: enabled ? 'true' : 'false',
      lang: 'de',
    });
  }

  private isInsideCodeContext(state: EditorState, pos: number): boolean {
    let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null =
      syntaxTree(state).resolveInner(pos, -1);
    while (node) {
      if (
        node.name === 'FencedCode' ||
        node.name === 'CodeBlock' ||
        node.name === 'CodeText' ||
        node.name === 'InlineCode'
      ) {
        return true;
      }
      node = node.parent;
    }
    return false;
  }

  private handleSmartEnter = (view: EditorView): boolean => {
    const { state } = view;
    if (state.selection.ranges.length !== 1 || !state.selection.main.empty) {
      return false;
    }
    const pos = state.selection.main.head;
    if (this.isInsideCodeContext(state, pos)) {
      return false;
    }
    const line = state.doc.lineAt(pos);
    const offset = pos - line.from;
    const action = computeSmartMarkdownEnter(line.text, offset);
    if (!action) return false;

    if (action.type === 'exit') {
      const rep = action.replacementLine ?? '';
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: rep },
        selection: { anchor: line.from + rep.length },
        scrollIntoView: true,
      });
      return true;
    }

    const insert = action.insertText ?? '\n';
    view.dispatch({
      changes: { from: pos, to: pos, insert },
      selection: { anchor: pos + insert.length },
      scrollIntoView: true,
    });
    return true;
  };

  private handleTableTab =
    (direction: 'next' | 'prev') =>
    (view: EditorView): boolean => {
      const { state } = view;
      if (state.selection.ranges.length !== 1) return false;
      const pos = state.selection.main.head;
      // Fast O(1) exit before any syntax-tree walk or document string allocation
      if (!state.doc.lineAt(pos).text.includes('|')) return false;
      if (this.isInsideCodeContext(state, pos)) return false;

      const nav = navigateMarkdownTableCell(state.doc.toString(), pos, direction);
      if (!nav) return false;

      view.dispatch({
        changes: nav.changes,
        selection: nav.selection,
        scrollIntoView: true,
      });
      return true;
    };

  public alignMarkdownTables(): number {
    const { state } = this.view;
    const pos = state.selection.main.head;
    const patch = formatTableAtCursorOrAll(state.doc.toString(), pos);
    if (!patch) return 0;

    if (state.sliceDoc(patch.from, patch.to) !== patch.insert) {
      const clampedAnchor = Math.min(pos, patch.from + patch.insert.length);
      this.view.dispatch({
        changes: { from: patch.from, to: patch.to, insert: patch.insert },
        selection: { anchor: clampedAnchor },
      });
    }
    this.view.focus();
    return patch.formattedCount;
  }

  private buildExtensions(): Extension {
    return [
      EditorState.phrases.of(germanCodeMirrorPhrases),
      lineNumbers(),
      foldGutter({
        openText: '▾',
        closedText: '▸',
      }),
      markdownSectionFoldService,
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      search({ top: true }),
      highlightSelectionMatches(),
      placeholder('Schreibe hier dein Markdown…'),
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
      }),
      syntaxHighlighting(markdownHighlightStyle),
      keymap.of([
        {
          key: 'Enter',
          run: this.handleSmartEnter,
        },
        {
          key: 'Tab',
          run: this.handleTableTab('next'),
          shift: this.handleTableTab('prev'),
        },
        {
          key: 'Alt-Shift-f',
          run: () => {
            this.alignMarkdownTables();
            return true;
          },
        },
        {
          key: 'Mod-b',
          run: () => {
            this.applyFormat('bold');
            return true;
          },
        },
        {
          key: 'Mod-i',
          run: () => {
            this.applyFormat('italic');
            return true;
          },
        },
        {
          key: 'Mod-Shift-x',
          run: () => {
            this.applyFormat('strike');
            return true;
          },
        },
        {
          key: 'Mod-Shift-e',
          run: () => {
            this.applyFormat('code');
            return true;
          },
        },
        {
          key: 'Mod-Shift-k',
          run: () => {
            this.callbacks.onCopyRichText?.();
            return true;
          },
        },
        {
          key: 'Mod-k',
          run: () => {
            this.applyFormat('link');
            return true;
          },
        },
        {
          key: 'Mod-Shift-c',
          run: () => {
            this.applyFormat('codeblock');
            return true;
          },
        },
        {
          key: 'Mod-Shift-q',
          run: () => {
            this.applyFormat('quote');
            return true;
          },
        },
        {
          key: 'Mod-Shift-m',
          run: () => {
            this.applyFormat('math');
            return true;
          },
        },
        {
          key: 'Mod-1',
          run: () => {
            this.applyFormat('h1');
            return true;
          },
        },
        {
          key: 'Mod-2',
          run: () => {
            this.applyFormat('h2');
            return true;
          },
        },
        {
          key: 'Mod-3',
          run: () => {
            this.applyFormat('h3');
            return true;
          },
        },
        {
          key: 'Mod-h',
          run: () => {
            this.openSearch(true);
            return true;
          },
        },
        indentWithTab,
        ...closeBracketsKeymap,
        // Strip Shift-Mod-k (`deleteLine`, conflicts with Rich-Text Copy Strg+Umschalt+K)
        // and Mod-Alt-\ (`indentSelection`, conflicts with AltGr+ß = `\` on DE-QWERTZ)
        ...defaultKeymap.filter(
          (k) => k.key !== 'Shift-Mod-k' && k.key !== 'Mod-Alt-\\',
        ),
        ...searchKeymap.filter((k) => k.key !== 'Mod-Alt-g'),
        ...historyKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          this.callbacks.onDocChanged(update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) {
          const pos = update.state.selection.main.head;
          const lineObj = update.state.doc.lineAt(pos);
          this.callbacks.onCursorChanged(lineObj.number, pos - lineObj.from + 1);
        }
      }),
      EditorView.domEventHandlers({
        scroll: () => {
          this.callbacks.onEditorScrolled();
        },
        paste: (event, view) => {
          const items = event.clipboardData?.items;
          if (items) {
            for (const item of Array.from(items)) {
              if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (!file) continue;
                event.preventDefault();
                const mime = file.type || item.type || 'image/png';
                const reader = new FileReader();
                reader.onload = () => {
                  if (typeof reader.result === 'string') {
                    this.callbacks.onPasteImage(mime, reader.result);
                  }
                };
                reader.readAsDataURL(file);
                return true;
              }
            }
          }

          // Smart URL paste over selected single-line text -> [selected](url)
          const plain = event.clipboardData?.getData('text/plain');
          const range = view.state.selection.main;
          if (plain && !range.empty) {
            const selected = view.state.sliceDoc(range.from, range.to);
            const mdLink = formatSmartUrlPaste(selected, plain);
            if (mdLink) {
              event.preventDefault();
              view.dispatch({
                changes: { from: range.from, to: range.to, insert: mdLink },
                selection: { anchor: range.from + mdLink.length },
              });
              return true;
            }
          }

          // Smart HTML <table> / TSV spreadsheet paste -> aligned GFM Markdown table
          if (!this.isInsideCodeContext(view.state, range.from)) {
            const html = event.clipboardData?.getData('text/html');
            const mdTable = convertClipboardToMarkdownTable(html, plain);
            if (mdTable) {
              event.preventDefault();
              const lineBefore = view.state.doc.lineAt(range.from);
              const needsLeadingNl = range.from > lineBefore.from;
              const prefix = needsLeadingNl ? '\n' : '';
              const insert = `${prefix}${mdTable}\n`;
              view.dispatch({
                changes: { from: range.from, to: range.to, insert },
                selection: { anchor: range.from + insert.length },
                scrollIntoView: true,
              });
              return true;
            }
          }
          return false;
        },
      }),
    ];
  }

  public createState(content: string): EditorState {
    return EditorState.create({
      doc: content,
      extensions: [
        this.sharedExtensions,
        this.wordWrapCompartment.of(this.wordWrapExtension(this.wordWrapEnabled)),
        this.spellcheckCompartment.of(this.spellcheckExtension(this.spellcheckEnabled)),
      ],
    });
  }

  public setWordWrap(enabled: boolean): void {
    this.wordWrapEnabled = enabled;
    this.view.dispatch({
      effects: this.wordWrapCompartment.reconfigure(this.wordWrapExtension(enabled)),
    });
  }

  public isWordWrapEnabled(): boolean {
    return this.wordWrapEnabled;
  }

  public setSpellcheck(enabled: boolean): void {
    this.spellcheckEnabled = enabled;
    this.view.dispatch({
      effects: this.spellcheckCompartment.reconfigure(this.spellcheckExtension(enabled)),
    });
  }

  public isSpellcheckEnabled(): boolean {
    return this.spellcheckEnabled;
  }

  public swapState(state: EditorState, scrollTop = 0): void {
    this.view.setState(state);
    this.view.dispatch({
      effects: [
        this.wordWrapCompartment.reconfigure(this.wordWrapExtension(this.wordWrapEnabled)),
        this.spellcheckCompartment.reconfigure(this.spellcheckExtension(this.spellcheckEnabled)),
      ],
    });
    requestAnimationFrame(() => {
      this.view.scrollDOM.scrollTop = scrollTop;
      const pos = this.view.state.selection.main.head;
      const lineObj = this.view.state.doc.lineAt(pos);
      this.callbacks.onCursorChanged(lineObj.number, pos - lineObj.from + 1);
    });
  }

  public getContent(): string {
    return this.view.state.doc.toString();
  }

  public replaceAllContent(newContent: string): void {
    this.view.dispatch({
      changes: {
        from: 0,
        to: this.view.state.doc.length,
        insert: newContent,
      },
    });
  }

  /**
   * Computes fractional 1-based line at the top of the editor viewport for smooth sync-scroll.
   */
  public getTopViewportLine(): number {
    const scroller = this.view.scrollDOM;
    const scrollTop = scroller.scrollTop;
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    if (maxScroll <= 1) return 1;
    if (scrollTop >= maxScroll - 2) {
      return this.view.state.doc.lines;
    }
    const block = this.view.lineBlockAtHeight(scrollTop);
    const startLine = this.view.state.doc.lineAt(block.from).number;
    const endLine = this.view.state.doc.lineAt(block.to).number;
    const lineSpan = Math.max(1, endLine - startLine + 1);
    const frac =
      block.height > 0 ? Math.max(0, Math.min(1, (scrollTop - block.top) / block.height)) : 0;
    return startLine + frac * lineSpan;
  }

  /**
   * Opens CodeMirror's localized search panel (`replace = false`) or search-and-replace
   * panel (`replace = true`), moving focus directly into the requested input field.
   */
  public openSearch(replace = false): void {
    openSearchPanel(this.view);
    const selector = replace
      ? '.cm-search input[name="replace"]'
      : '.cm-search input[name="search"]';
    const focusTarget = () => {
      const input = this.view.dom.querySelector<HTMLInputElement>(selector);
      if (input) {
        input.focus();
        input.select();
      }
    };
    focusTarget();
    requestAnimationFrame(focusTarget);
  }

  /**
   * Scrolls editor smoothly to a fractional 1-based source line, symmetrically
   * interpolating across collapsed/folded multi-line blocks without jitter.
   */
  public scrollToSourceLine(fractionalLine: number): void {
    const totalLines = this.view.state.doc.lines;
    const clamped = Math.max(1, Math.min(totalLines, fractionalLine));
    const lineNum = Math.floor(clamped);
    const lineObj = this.view.state.doc.line(lineNum);
    const block = this.view.lineBlockAt(lineObj.from);
    const startLine = this.view.state.doc.lineAt(block.from).number;
    const endLine = this.view.state.doc.lineAt(block.to).number;
    const lineSpan = Math.max(1, endLine - startLine + 1);
    const frac = Math.max(0, Math.min(1, (clamped - startLine) / lineSpan));
    this.view.scrollDOM.scrollTop = block.top + block.height * frac;
  }

  public jumpToLine(lineNumber: number): void {
    const clamped = Math.max(1, Math.min(this.view.state.doc.lines, lineNumber));
    const lineObj = this.view.state.doc.line(clamped);
    const effects: StateEffect<unknown>[] = [];

    // Automatically unfold any collapsed section enclosing `lineObj`
    foldedRanges(this.view.state).between(0, this.view.state.doc.length, (from, to) => {
      if (lineObj.from >= from && lineObj.from <= to) {
        effects.push(unfoldEffect.of({ from, to }));
      }
    });
    effects.push(EditorView.scrollIntoView(lineObj.from, { y: 'start', yMargin: 24 }));

    this.view.dispatch({
      selection: { anchor: lineObj.from },
      effects,
    });
    this.view.focus();
  }

  public toggleTaskOnLine(lineNumber: number, checked: boolean): void {
    if (lineNumber < 1 || lineNumber > this.view.state.doc.lines) return;
    const lineObj = this.view.state.doc.line(lineNumber);
    const updated = checked
      ? lineObj.text.replace(/(\[\s\])/, '[x]')
      : lineObj.text.replace(/(\[[xX]\])/, '[ ]');
    if (updated !== lineObj.text) {
      this.view.dispatch({
        changes: { from: lineObj.from, to: lineObj.to, insert: updated },
      });
    }
  }

  public insertSnippet(text: string): void {
    const { from, to } = this.view.state.selection.main;
    this.view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    this.view.focus();
  }

  public applyFormat(action: FormatAction): void {
    const { state } = this.view;
    const range = state.selection.main;
    const selected = state.sliceDoc(range.from, range.to);

    const wrapInline = (marker: string, fallback: string) => {
      const inner = selected || fallback;
      const replacement = `${marker}${inner}${marker}`;
      this.view.dispatch({
        changes: { from: range.from, to: range.to, insert: replacement },
        selection: {
          anchor: range.from + marker.length,
          head: range.from + marker.length + inner.length,
        },
      });
      this.view.focus();
    };

    const prefixLines = (prefix: string) => {
      const startLine = state.doc.lineAt(range.from);
      const endLine = state.doc.lineAt(range.to);
      const changes: Array<{ from: number; to: number; insert: string }> = [];
      for (let l = startLine.number; l <= endLine.number; l++) {
        const line = state.doc.line(l);
        if (line.text.startsWith(prefix)) {
          changes.push({ from: line.from, to: line.from + prefix.length, insert: '' });
        } else {
          const cleaned = line.text.replace(/^#{1,6}\s+/, '');
          changes.push({ from: line.from, to: line.to, insert: `${prefix}${cleaned}` });
        }
      }
      this.view.dispatch({ changes });
      this.view.focus();
    };

    switch (action) {
      case 'bold':
        wrapInline('**', 'fetter Text');
        break;
      case 'italic':
        wrapInline('*', 'kursiver Text');
        break;
      case 'strike':
        wrapInline('~~', 'durchgestrichen');
        break;
      case 'code':
        wrapInline('`', 'code');
        break;
      case 'h1':
        prefixLines('# ');
        break;
      case 'h2':
        prefixLines('## ');
        break;
      case 'h3':
        prefixLines('### ');
        break;
      case 'ul':
        prefixLines('- ');
        break;
      case 'ol':
        prefixLines('1. ');
        break;
      case 'task':
        prefixLines('- [ ] ');
        break;
      case 'quote':
        prefixLines('> ');
        break;
      case 'alert':
        this.insertSnippet('\n> [!NOTE]\n> Wichtiger Hinweis im Dokument.\n');
        break;
      case 'codeblock': {
        const inner = selected || 'println!("Hallo aus Rust!");';
        const snippet = `\n\`\`\`rust\n${inner}\n\`\`\`\n`;
        this.insertSnippet(snippet);
        break;
      }
      case 'link': {
        const label = selected || 'Linktext';
        const insert = `[${label}](https://)`;
        this.view.dispatch({
          changes: { from: range.from, to: range.to, insert },
          selection: {
            anchor: range.from + label.length + 3,
            head: range.from + insert.length - 1,
          },
        });
        this.view.focus();
        break;
      }
      case 'image':
        this.insertSnippet(`![${selected || 'Bildbeschreibung'}](./bild.png)`);
        break;
      case 'align-table':
        this.alignMarkdownTables();
        break;
      case 'math':
        this.insertSnippet(`\n$$\n\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}\n$$\n`);
        break;
      case 'mermaid':
        this.insertSnippet(
          `\n\`\`\`mermaid\nflowchart LR\n  A["Markdown Eingabe"] --> B["Rust Parser (pulldown-cmark)"]\n  B --> C["Live-Vorschau in Windows 11"]\n\`\`\`\n`,
        );
        break;
      case 'hr':
        this.insertSnippet('\n---\n');
        break;
    }
  }
}
