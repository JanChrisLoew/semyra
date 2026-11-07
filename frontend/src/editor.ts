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
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from '@codemirror/search';
import { EditorState, Extension } from '@codemirror/state';
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

export interface EditorCallbacks {
  onDocChanged: (content: string) => void;
  onCursorChanged: (line: number, col: number) => void;
  onEditorScrolled: () => void;
  onFormatCommand: (cmd: FormatAction) => void;
  onPasteImage: (mimeType: string, dataUrl: string) => void;
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
  | 'math'
  | 'mermaid'
  | 'hr';

export class MarkdownEditorController {
  public view: EditorView;
  private callbacks: EditorCallbacks;
  private sharedExtensions: Extension;

  constructor(host: HTMLElement, initialContent: string, callbacks: EditorCallbacks) {
    this.callbacks = callbacks;
    this.sharedExtensions = this.buildExtensions();

    this.view = new EditorView({
      state: this.createState(initialContent),
      parent: host,
    });
  }

  private buildExtensions(): Extension {
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      search({ top: true }),
      highlightSelectionMatches(),
      EditorView.lineWrapping,
      placeholder('Schreibe hier dein Markdown…'),
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
      }),
      syntaxHighlighting(markdownHighlightStyle),
      keymap.of([
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
          key: 'Mod-e',
          run: () => {
            this.applyFormat('code');
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
        indentWithTab,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
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
        paste: (event) => {
          const items = event.clipboardData?.items;
          if (!items) return false;
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
          return false;
        },
      }),
    ];
  }

  public createState(content: string): EditorState {
    return EditorState.create({
      doc: content,
      extensions: this.sharedExtensions,
    });
  }

  public swapState(state: EditorState, scrollTop = 0): void {
    this.view.setState(state);
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
    const lineObj = this.view.state.doc.lineAt(block.from);
    const frac = block.height > 0 ? Math.max(0, Math.min(1, (scrollTop - block.top) / block.height)) : 0;
    return lineObj.number + frac;
  }

  /**
   * Scrolls editor smoothly to a fractional 1-based source line.
   */
  public scrollToSourceLine(fractionalLine: number): void {
    const totalLines = this.view.state.doc.lines;
    const clamped = Math.max(1, Math.min(totalLines, fractionalLine));
    const lineNum = Math.floor(clamped);
    const frac = clamped - lineNum;
    const lineObj = this.view.state.doc.line(lineNum);
    const block = this.view.lineBlockAt(lineObj.from);
    this.view.scrollDOM.scrollTop = block.top + block.height * frac;
  }

  public jumpToLine(lineNumber: number): void {
    const clamped = Math.max(1, Math.min(this.view.state.doc.lines, lineNumber));
    const lineObj = this.view.state.doc.line(clamped);
    this.view.dispatch({
      selection: { anchor: lineObj.from },
      effects: EditorView.scrollIntoView(lineObj.from, { y: 'start', yMargin: 24 }),
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
