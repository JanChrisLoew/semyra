import { describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import {
  convertClipboardToMarkdownTable,
  formatMarkdownTableLines,
  formatTableAtCursorOrAll,
  isCursorInsideTable,
  modifyMarkdownTable,
  navigateMarkdownTableCell,
  splitMarkdownTableRow,
} from '../markdown-table';

describe('markdown-table', () => {
  it('splits pipe rows while preserving escaped pipes and trailing double-backslashes', () => {
    expect(splitMarkdownTableRow('| Befehl | Syntax `a \\| b` |')).toEqual([
      'Befehl',
      'Syntax `a \\| b`',
    ]);
    expect(splitMarkdownTableRow('| Pfad | C:\\Temp\\\\|')).toEqual(['Pfad', 'C:\\Temp\\\\']);
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

  it('converts HTML <table> (<br> & <p> multiline) and RFC-4180 quoted TSV clipboard data into aligned GFM tables', () => {
    const html = `
      <table>
        <tr><th>Feature</th><th>Shortcut</th></tr>
        <tr><td>Suche | Filter</td><td>Strg+F<br>Strg+H</td></tr>
        <tr><td>C:\\Temp\\\\|Pfad</td><td><p>Zeile 1</p><p>Zeile 2</p></td></tr>
      </table>
    `;
    const fromHtml = convertClipboardToMarkdownTable(html, 'Feature\tShortcut');
    expect(fromHtml).toBe(
      [
        '| Feature         | Shortcut           |',
        '| --------------- | ------------------ |',
        '| Suche \\| Filter | Strg+F<br>Strg+H   |',
        '| C:\\Temp\\\\\\|Pfad | Zeile 1<br>Zeile 2 |',
      ].join('\n'),
    );

    const tsv = 'Quartal\tNotiz\nQ1\t"Umsatz +12%\nRekord"\nQ2\t1850 €\n';
    const fromTsv = convertClipboardToMarkdownTable(undefined, tsv);
    expect(fromTsv).toBe(
      [
        '| Quartal | Notiz                 |',
        '| ------- | --------------------- |',
        '| Q1      | Umsatz +12%<br>Rekord |',
        '| Q2      | 1850 €                |',
      ].join('\n'),
    );

    // Ordinary prose or single-line text is untouched
    expect(convertClipboardToMarkdownTable(undefined, 'Hallo Welt ohne Tabelle')).toBeNull();
  });

  it('detects when cursor is inside a Markdown table', () => {
    const doc = [
      'Einleitender Absatz.',
      '',
      '| Spalte A | Spalte B |',
      '| :--- | :--- |',
      '| 1 | 2 |',
      '',
      'Schlussabsatz.',
    ].join('\n');

    const tableStart = doc.indexOf('| Spalte A');
    const tableData = doc.indexOf('| 1 |');
    const outsidePos = 5;

    expect(isCursorInsideTable(doc, tableStart)).toBe(true);
    expect(isCursorInsideTable(doc, tableData)).toBe(true);
    expect(isCursorInsideTable(doc, outsidePos)).toBe(false);
  });

  it('modifies table by inserting and deleting rows with automatic column balancing', () => {
    const doc = [
      '| Name | Rolle |',
      '| :--- | :--- |',
      '| Alice | Admin |',
      '| Bob | Dev |',
    ].join('\n');

    // Insert row below 'Alice' (cursor at 'Alice')
    const alicePos = doc.indexOf('Alice');
    const insertedBelow = modifyMarkdownTable(doc, alicePos, {
      type: 'insert-row',
      direction: 'below',
    });
    expect(insertedBelow).not.toBeNull();
    const linesBelow = insertedBelow!.insert.split('\n');
    expect(linesBelow).toHaveLength(5);
    expect(linesBelow[2]).toContain('Alice');
    expect(linesBelow[3]).toMatch(/^\|\s+\|\s+\|$/);
    expect(linesBelow[4]).toContain('Bob');

    // Insert row above 'Alice'
    const insertedAbove = modifyMarkdownTable(doc, alicePos, {
      type: 'insert-row',
      direction: 'above',
    });
    expect(insertedAbove).not.toBeNull();
    const linesAbove = insertedAbove!.insert.split('\n');
    expect(linesAbove).toHaveLength(5);
    expect(linesAbove[2]).toMatch(/^\|\s+\|\s+\|$/);
    expect(linesAbove[3]).toContain('Alice');

    // Delete row 'Bob'
    const bobPos = doc.indexOf('Bob');
    const deletedBob = modifyMarkdownTable(doc, bobPos, { type: 'delete-row' });
    expect(deletedBob).not.toBeNull();
    expect(deletedBob!.insert).not.toContain('Bob');
    expect(deletedBob!.insert).toContain('Alice');

    // Rejects deleting separator row
    const sepPos = doc.indexOf(':---');
    expect(modifyMarkdownTable(doc, sepPos, { type: 'delete-row' })).toBeNull();
  });

  it('modifies table by inserting and deleting columns across all rows', () => {
    const doc = [
      '| A | B |',
      '| :--- | :--- |',
      '| 1 | 2 |',
    ].join('\n');

    const bPos = doc.indexOf('B');
    // Insert column right of 'B'
    const colRight = modifyMarkdownTable(doc, bPos, {
      type: 'insert-col',
      direction: 'right',
    });
    expect(colRight).not.toBeNull();
    const linesRight = colRight!.insert.split('\n');
    expect(linesRight[0]).toBe('| A   | B   | Spalte 3 |');
    expect(linesRight[1]).toBe('| --- | --- | -------- |');
    expect(linesRight[2]).toBe('| 1   | 2   |          |');

    // In English, new column header is 'Column 3'
    setLanguage('en', false);
    const colRightEn = modifyMarkdownTable(doc, bPos, {
      type: 'insert-col',
      direction: 'right',
    });
    expect(colRightEn!.insert.split('\n')[0]).toBe('| A   | B   | Column 3 |');
    setLanguage('de', false);

    // Delete column 'A'
    const aPos = doc.indexOf('A');
    const colDeleted = modifyMarkdownTable(doc, aPos, { type: 'delete-col' });
    expect(colDeleted).not.toBeNull();
    const linesDeleted = colDeleted!.insert.split('\n');
    expect(linesDeleted[0]).toBe('| B   |');
    expect(linesDeleted[2]).toBe('| 2   |');

    // Refuses to delete the last remaining column
    expect(modifyMarkdownTable(colDeleted!.insert, 2, { type: 'delete-col' })).toBeNull();
  });
});
