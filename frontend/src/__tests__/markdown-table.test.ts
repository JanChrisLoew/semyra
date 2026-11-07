import { describe, expect, it } from 'vitest';
import {
  convertClipboardToMarkdownTable,
  formatMarkdownTableLines,
  formatTableAtCursorOrAll,
  navigateMarkdownTableCell,
  splitMarkdownTableRow,
} from '../markdown-table';

describe('markdown-table', () => {
  it('splits pipe rows while preserving escaped pipes', () => {
    expect(splitMarkdownTableRow('| Befehl | Syntax `a \\| b` |')).toEqual([
      'Befehl',
      'Syntax `a \\| b`',
    ]);
    expect(splitMarkdownTableRow('Normaler Absatz ohne Pipe')).toBeNull();
    expect(splitMarkdownTableRow('```rust')).toBeNull();
  });

  it('aligns left, center, and right GFM columns cleanly', () => {
    const raw = [
      '| Modul | Status | Größe |',
      '|:---|:---:|---:|',
      '| Rust Backend | Aktiv | 42 KB |',
      '| UI | Bereit | 8 KB |',
    ];
    const formatted = formatMarkdownTableLines(raw);
    expect(formatted).toEqual([
      '| Modul        | Status | Größe |',
      '| ------------ | :----: | ----: |',
      '| Rust Backend | Aktiv  | 42 KB |',
      '| UI           | Bereit |  8 KB |',
    ]);
  });

  it('formats tables outside fenced code blocks while leaving code blocks untouched', () => {
    const doc = [
      '```markdown',
      '| unformatiert | bleibt |',
      '|---|---|',
      '| a | b |',
      '```',
      '',
      '| Name | Wert |',
      '|---|---|',
      '| Alpha | 100 |',
    ].join('\n');

    const patch = formatTableAtCursorOrAll(doc, 0);
    expect(patch).not.toBeNull();
    expect(patch!.formattedCount).toBe(1);
    expect(patch!.insert).toContain('| unformatiert | bleibt |');
    expect(patch!.insert).toContain('| Name  | Wert |');
    expect(patch!.insert).toContain('| Alpha | 100  |');
  });

  it('navigates forward and backward across cells, skips separator row, and appends a row at end', () => {
    const doc = [
      '| Spalte 1 | Spalte 2 |',
      '| :--- | :--- |',
      '| Zelle A | Zelle B |',
    ].join('\n');

    // Cursor inside 'Spalte 1' -> Tab selects 'Spalte 2'
    const step1 = navigateMarkdownTableCell(doc, 3, 'next')!;
    expect(doc.slice(step1.selection.anchor, step1.selection.head)).toBe('Spalte 2');

    // Tab from 'Spalte 2' skips separator row -> selects 'Zelle A'
    const step2 = navigateMarkdownTableCell(doc, step1.selection.head, 'next')!;
    expect(doc.slice(step2.selection.anchor, step2.selection.head)).toBe('Zelle A');

    // Shift+Tab from 'Zelle A' jumps back over separator -> selects 'Spalte 2'
    const back = navigateMarkdownTableCell(doc, step2.selection.anchor, 'prev')!;
    expect(doc.slice(back.selection.anchor, back.selection.head)).toBe('Spalte 2');

    // Tab from 'Zelle A' -> selects 'Zelle B'
    const step3 = navigateMarkdownTableCell(doc, step2.selection.head, 'next')!;
    expect(doc.slice(step3.selection.anchor, step3.selection.head)).toBe('Zelle B');

    // Tab on final cell 'Zelle B' -> appends a new aligned row and positions cursor in first new cell
    const step4 = navigateMarkdownTableCell(doc, step3.selection.head, 'next')!;
    expect(step4.changes).toBeDefined();
    const updatedDoc = step4.changes!.insert;
    const updatedLines = updatedDoc.split('\n');
    expect(updatedLines).toHaveLength(4);
    expect(updatedLines[3]).toMatch(/^\|\s+\|\s+\|$/);
    expect(step4.selection.anchor).toBe(step4.selection.head);
  });

  it('converts HTML <table> and spreadsheet TSV clipboard data into aligned GFM tables', () => {
    const html = `
      <table>
        <tr><th>Feature</th><th>Shortcut</th></tr>
        <tr><td>Suche | Filter</td><td>Strg+F\nStrg+H</td></tr>
      </table>
    `;
    const fromHtml = convertClipboardToMarkdownTable(html, 'Feature\tShortcut');
    expect(fromHtml).toBe(
      [
        '| Feature         | Shortcut         |',
        '| --------------- | ---------------- |',
        '| Suche \\| Filter | Strg+F<br>Strg+H |',
      ].join('\n'),
    );

    const tsv = 'Quartal\tUmsatz\nQ1\t1200 €\nQ2\t1850 €\n';
    const fromTsv = convertClipboardToMarkdownTable(undefined, tsv);
    expect(fromTsv).toBe(
      [
        '| Quartal | Umsatz |',
        '| ------- | ------ |',
        '| Q1      | 1200 € |',
        '| Q2      | 1850 € |',
      ].join('\n'),
    );

    // Ordinary prose or single-line text is untouched
    expect(convertClipboardToMarkdownTable(undefined, 'Hallo Welt ohne Tabelle')).toBeNull();
  });
});
