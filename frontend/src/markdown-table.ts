/**
 * Pure GFM Markdown table parser, formatter, Tab/Shift+Tab cell navigator,
 * and HTML/TSV clipboard-to-Markdown table converter.
 */

export type TableColumnAlign = 'left' | 'center' | 'right';

export interface TableCellSpan {
  rowIdx: number;
  colIdx: number;
  /** Offset right after opening `|` (includes padding spaces) */
  rawFrom: number;
  /** Offset right before closing `|` */
  rawTo: number;
  /** Start of trimmed cell content (or insertion point if cell is empty) */
  selectFrom: number;
  /** End of trimmed cell content */
  selectTo: number;
}

export interface TableNavResult {
  changes?: { from: number; to: number; insert: string };
  selection: { anchor: number; head: number };
}

export interface TableFormatPatch {
  from: number;
  to: number;
  insert: string;
  formattedCount: number;
}

/**
 * Splits a Markdown table row on unescaped `|` characters while preserving `\|`.
 * Returns `null` if the line cannot be part of a pipe table.
 */
export function splitMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes('|')) return null;
  if (/^(?:```|~~~)/.test(trimmed)) return null;

  const pipePositions = findUnescapedPipes(trimmed);
  if (pipePositions.length === 0) return null;

  const parts: string[] = [];
  let start = 0;
  for (const idx of pipePositions) {
    parts.push(trimmed.slice(start, idx));
    start = idx + 1;
  }
  parts.push(trimmed.slice(start));

  // Strip optional leading and trailing outer pipes (`| a | b |` -> `[' a ', ' b ']`)
  if (pipePositions[0] === 0) {
    parts.shift();
  }
  if (pipePositions[pipePositions.length - 1] === trimmed.length - 1) {
    parts.pop();
  }

  if (parts.length === 0) return null;
  return parts.map((c) => c.trim());
}

function findUnescapedPipes(text: string): number[] {
  const indices: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '|') {
      let backslashes = 0;
      for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) {
        backslashes++;
      }
      if (backslashes % 2 === 0) {
        indices.push(i);
      }
    }
  }
  return indices;
}

export function isTableSeparatorRow(cells: string[]): boolean {
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

export function parseSeparatorAlignments(cells: string[]): TableColumnAlign[] {
  return cells.map((raw) => {
    const c = raw.trim();
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

function formatSeparatorCell(width: number, align: TableColumnAlign): string {
  const safeWidth = Math.max(3, width);
  if (align === 'center') {
    return `:${'-'.repeat(Math.max(1, safeWidth - 2))}:`;
  }
  if (align === 'right') {
    return `${'-'.repeat(Math.max(2, safeWidth - 1))}:`;
  }
  return '-'.repeat(safeWidth);
}

function padCellContent(text: string, width: number, align: TableColumnAlign): string {
  const padTotal = Math.max(0, width - text.length);
  if (align === 'right') {
    return `${' '.repeat(padTotal)}${text}`;
  }
  if (align === 'center') {
    const leftPad = Math.floor(padTotal / 2);
    const rightPad = padTotal - leftPad;
    return `${' '.repeat(leftPad)}${text}${' '.repeat(rightPad)}`;
  }
  return `${text}${' '.repeat(padTotal)}`;
}

/**
 * Formats an array of raw GFM table lines (where index 1 is the separator row)
 * into cleanly aligned Markdown pipe columns.
 */
export function formatMarkdownTableLines(lines: string[]): string[] {
  if (lines.length < 2) return lines;
  const parsedRows = lines.map(splitMarkdownTableRow);
  if (parsedRows.some((r) => r === null)) return lines;
  const rows = parsedRows as string[][];
  if (!isTableSeparatorRow(rows[1])) return lines;

  const indentMatch = /^(\s*)/.exec(lines[0]);
  const indent = indentMatch ? indentMatch[1] : '';

  const colCount = Math.max(...rows.map((r) => r.length));
  const rawAligns = parseSeparatorAlignments(rows[1]);
  const aligns: TableColumnAlign[] = Array.from(
    { length: colCount },
    (_, col) => rawAligns[col] ?? 'left',
  );

  const widths = Array.from({ length: colCount }, (_, col) => {
    let maxLen = 3;
    for (let r = 0; r < rows.length; r++) {
      if (r === 1) continue;
      const cell = rows[r][col] ?? '';
      if (cell.length > maxLen) {
        maxLen = cell.length;
      }
    }
    return maxLen;
  });

  return rows.map((row, rowIdx) => {
    if (rowIdx === 1) {
      const sepCells = widths.map((w, col) => formatSeparatorCell(w, aligns[col]));
      return `${indent}| ${sepCells.join(' | ')} |`;
    }
    const formattedCells = widths.map((w, col) =>
      padCellContent(row[col] ?? '', w, aligns[col]),
    );
    return `${indent}| ${formattedCells.join(' | ')} |`;
  });
}

/**
 * Finds the start/end 0-based line indices of a valid GFM table containing `lineIdx`.
 */
export function findTableBlockAtLine(
  lines: string[],
  lineIdx: number,
): { startLine: number; endLine: number } | null {
  if (lineIdx < 0 || lineIdx >= lines.length) return null;
  if (splitMarkdownTableRow(lines[lineIdx]) === null) return null;

  // Verify we aren't inside a fenced code block
  let inFence = false;
  let fenceMarker = '';
  for (let i = 0; i <= lineIdx; i++) {
    const m = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
    if (m) {
      const ch = m[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = ch;
      } else if (ch === fenceMarker) {
        inFence = false;
      }
    }
  }
  if (inFence) return null;

  let start = lineIdx;
  while (start > 0 && splitMarkdownTableRow(lines[start - 1]) !== null) {
    start--;
  }
  let end = lineIdx;
  while (end + 1 < lines.length && splitMarkdownTableRow(lines[end + 1]) !== null) {
    end++;
  }

  if (end - start < 1) return null;
  const sepCells = splitMarkdownTableRow(lines[start + 1]);
  if (!sepCells || !isTableSeparatorRow(sepCells)) return null;

  return { startLine: start, endLine: end };
}

function splitDocumentLinesWithOffsets(docText: string): Array<{
  text: string;
  from: number;
  to: number;
  eolLen: number;
}> {
  const result: Array<{ text: string; from: number; to: number; eolLen: number }> = [];
  let pos = 0;
  while (pos <= docText.length) {
    const nlIdx = docText.indexOf('\n', pos);
    if (nlIdx === -1) {
      result.push({
        text: docText.slice(pos),
        from: pos,
        to: docText.length,
        eolLen: 0,
      });
      break;
    }
    const hasCr = nlIdx > pos && docText[nlIdx - 1] === '\r';
    const textEnd = hasCr ? nlIdx - 1 : nlIdx;
    result.push({
      text: docText.slice(pos, textEnd),
      from: pos,
      to: textEnd,
      eolLen: hasCr ? 2 : 1,
    });
    pos = nlIdx + 1;
  }
  return result;
}

/**
 * Formats the GFM table under the cursor, or every GFM table in the document if the
 * cursor is outside a table. Returns `null` if no table required changes (or none exist).
 */
export function formatTableAtCursorOrAll(
  docText: string,
  cursorOffset: number,
): TableFormatPatch | null {
  const lineInfos = splitDocumentLinesWithOffsets(docText);
  const lines = lineInfos.map((l) => l.text);
  const eol = docText.includes('\r\n') ? '\r\n' : '\n';

  let cursorLine = 0;
  for (let i = 0; i < lineInfos.length; i++) {
    if (cursorOffset >= lineInfos[i].from && cursorOffset <= lineInfos[i].to) {
      cursorLine = i;
      break;
    }
  }

  const activeBlock = findTableBlockAtLine(lines, cursorLine);
  if (activeBlock) {
    const rawSlice = lines.slice(activeBlock.startLine, activeBlock.endLine + 1);
    const formatted = formatMarkdownTableLines(rawSlice).join(eol);
    const from = lineInfos[activeBlock.startLine].from;
    const to = lineInfos[activeBlock.endLine].to;
    return { from, to, insert: formatted, formattedCount: 1 };
  }

  // Otherwise format all GFM tables outside fenced code blocks
  let inFence = false;
  let fenceChar = '';
  let formattedCount = 0;
  const outLines = [...lines];

  let i = 0;
  while (i < lines.length) {
    const m = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
    if (m) {
      const ch = m[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
      } else if (ch === fenceChar) {
        inFence = false;
      }
      i++;
      continue;
    }

    if (!inFence && splitMarkdownTableRow(lines[i]) !== null) {
      let end = i;
      while (end + 1 < lines.length && splitMarkdownTableRow(lines[end + 1]) !== null) {
        end++;
      }
      if (end > i) {
        const sep = splitMarkdownTableRow(lines[i + 1]);
        if (sep && isTableSeparatorRow(sep)) {
          const formattedSlice = formatMarkdownTableLines(lines.slice(i, end + 1));
          for (let k = 0; k < formattedSlice.length; k++) {
            outLines[i + k] = formattedSlice[k];
          }
          formattedCount++;
        }
      }
      i = end + 1;
      continue;
    }
    i++;
  }

  if (formattedCount === 0) return null;
  return {
    from: 0,
    to: docText.length,
    insert: outLines.join(eol),
    formattedCount,
  };
}

function computeRowCellSpans(
  lineText: string,
  lineFromOffset: number,
  rowIdx: number,
): TableCellSpan[] {
  const pipes = findUnescapedPipes(lineText);
  if (pipes.length === 0) return [];

  const firstNonWs = lineText.search(/\S/);
  const lastNonWs = lineText.trimEnd().length - 1;
  const hasLeadingPipe = firstNonWs !== -1 && pipes[0] === firstNonWs;
  const hasTrailingPipe = lastNonWs >= 0 && pipes[pipes.length - 1] === lastNonWs;

  const boundaries: number[] = [];
  if (!hasLeadingPipe) {
    boundaries.push(firstNonWs >= 0 ? firstNonWs - 1 : -1);
  }
  boundaries.push(...pipes);
  if (!hasTrailingPipe) {
    boundaries.push(lineText.length);
  }

  const spans: TableCellSpan[] = [];
  for (let c = 0; c + 1 < boundaries.length; c++) {
    const rawFromLocal = boundaries[c] + 1;
    const rawToLocal = boundaries[c + 1];
    const rawSlice = lineText.slice(rawFromLocal, rawToLocal);
    const trimmed = rawSlice.trim();

    let selectFromLocal: number;
    let selectToLocal: number;
    if (trimmed.length > 0) {
      const leadSpaces = rawSlice.indexOf(trimmed);
      selectFromLocal = rawFromLocal + leadSpaces;
      selectToLocal = selectFromLocal + trimmed.length;
    } else {
      // Place cursor cleanly 1 space after `|` if available
      selectFromLocal =
        rawSlice.startsWith(' ') && rawFromLocal + 1 <= rawToLocal
          ? rawFromLocal + 1
          : rawFromLocal;
      selectToLocal = selectFromLocal;
    }

    spans.push({
      rowIdx,
      colIdx: c,
      rawFrom: lineFromOffset + rawFromLocal,
      rawTo: lineFromOffset + rawToLocal,
      selectFrom: lineFromOffset + selectFromLocal,
      selectTo: lineFromOffset + selectToLocal,
    });
  }
  return spans;
}

/**
 * Navigates to the next (`Tab`) or previous (`Shift+Tab`) GFM table cell,
 * skipping the separator row and appending a fresh row when pressing `Tab` in the last cell.
 */
export function navigateMarkdownTableCell(
  docText: string,
  cursorOffset: number,
  direction: 'next' | 'prev',
): TableNavResult | null {
  const lineInfos = splitDocumentLinesWithOffsets(docText);
  const lines = lineInfos.map((l) => l.text);
  const eol = docText.includes('\r\n') ? '\r\n' : '\n';

  let cursorLine = -1;
  for (let i = 0; i < lineInfos.length; i++) {
    if (cursorOffset >= lineInfos[i].from && cursorOffset <= lineInfos[i].to) {
      cursorLine = i;
      break;
    }
  }
  if (cursorLine === -1) return null;

  const block = findTableBlockAtLine(lines, cursorLine);
  if (!block) return null;

  const allEditableSpans: TableCellSpan[] = [];
  let separatorStartOffset = lineInfos[block.startLine + 1].from;
  let separatorEndOffset = lineInfos[block.startLine + 1].to;

  for (let l = block.startLine; l <= block.endLine; l++) {
    const relRow = l - block.startLine;
    if (relRow === 1) continue; // skip `| --- |` separator row
    const rowSpans = computeRowCellSpans(lines[l], lineInfos[l].from, relRow);
    allEditableSpans.push(...rowSpans);
  }

  if (allEditableSpans.length === 0) return null;

  // Determine current cell index
  let currentIdx = -1;
  if (cursorOffset >= separatorStartOffset && cursorOffset <= separatorEndOffset) {
    // Cursor is on the separator line -> jump into first body row (next) or last header cell (prev)
    const headerCount = allEditableSpans.filter((s) => s.rowIdx === 0).length;
    const targetIdx =
      direction === 'next'
        ? Math.min(headerCount, allEditableSpans.length - 1)
        : Math.max(0, headerCount - 1);
    const target = allEditableSpans[targetIdx];
    return {
      selection: { anchor: target.selectFrom, head: target.selectTo },
    };
  }

  for (let i = 0; i < allEditableSpans.length; i++) {
    const s = allEditableSpans[i];
    if (cursorOffset >= s.rawFrom && cursorOffset <= s.rawTo) {
      currentIdx = i;
      break;
    }
  }

  // Handle cursor positioned before leading `|` or after trailing `|` on a table row
  if (currentIdx === -1) {
    const relRow = cursorLine - block.startLine;
    const rowSpans = allEditableSpans.filter((s) => s.rowIdx === relRow);
    if (rowSpans.length > 0) {
      if (cursorOffset < rowSpans[0].rawFrom) {
        const first = rowSpans[0];
        if (direction === 'next') {
          return { selection: { anchor: first.selectFrom, head: first.selectTo } };
        }
        currentIdx = allEditableSpans.indexOf(first);
      } else {
        currentIdx = allEditableSpans.indexOf(rowSpans[rowSpans.length - 1]);
      }
    }
  }

  if (currentIdx === -1) return null;

  const targetIdx = direction === 'next' ? currentIdx + 1 : currentIdx - 1;

  if (targetIdx >= 0 && targetIdx < allEditableSpans.length) {
    const target = allEditableSpans[targetIdx];
    return {
      selection: { anchor: target.selectFrom, head: target.selectTo },
    };
  }

  if (direction === 'prev' && targetIdx < 0) {
    // Stay in the very first header cell rather than indenting/outdenting the table
    const first = allEditableSpans[0];
    return {
      selection: { anchor: first.selectFrom, head: first.selectTo },
    };
  }

  // direction === 'next' on the final cell -> format table + append a new empty row!
  const rawTableLines = lines.slice(block.startLine, block.endLine + 1);
  const parsedHeader = splitMarkdownTableRow(rawTableLines[0]) ?? [''];
  const parsedSep = splitMarkdownTableRow(rawTableLines[1]) ?? ['---'];
  const colCount = Math.max(parsedHeader.length, parsedSep.length);
  const emptyRow = `| ${Array.from({ length: colCount }, () => '').join(' | ')} |`;
  const formattedWithNewRow = formatMarkdownTableLines([...rawTableLines, emptyRow]);

  const blockFrom = lineInfos[block.startLine].from;
  const blockTo = lineInfos[block.endLine].to;
  const insertText = formattedWithNewRow.join(eol);

  const lastRowText = formattedWithNewRow[formattedWithNewRow.length - 1];
  const lastRowOffsetInInsert = insertText.length - lastRowText.length;
  const newRowSpans = computeRowCellSpans(
    lastRowText,
    blockFrom + lastRowOffsetInInsert,
    formattedWithNewRow.length - 1,
  );
  const firstNewCell = newRowSpans[0];
  const cursorPos = firstNewCell ? firstNewCell.selectFrom : blockFrom + insertText.length;

  return {
    changes: { from: blockFrom, to: blockTo, insert: insertText },
    selection: { anchor: cursorPos, head: cursorPos },
  };
}

function escapeUnescapedPipes(text: string): string {
  const pipes = findUnescapedPipes(text);
  if (pipes.length === 0) return text;
  let out = '';
  let last = 0;
  for (const idx of pipes) {
    out += `${text.slice(last, idx)}\\|`;
    last = idx + 1;
  }
  out += text.slice(last);
  return out;
}

function sanitizeCellText(raw: string): string {
  const joined = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((part) => part.trim())
    .filter((part, idx, arr) => part.length > 0 || arr.length === 1)
    .join('<br>');
  return escapeUnescapedPipes(joined).trim();
}

function extractHtmlCellText(cell: Element): string {
  const clone = cell.cloneNode(true) as Element;
  for (const br of Array.from(clone.querySelectorAll('br'))) {
    br.replaceWith('\n');
  }
  for (const block of Array.from(clone.querySelectorAll('p, div, li'))) {
    if (block.nextSibling) {
      block.append('\n');
    }
  }
  return clone.textContent ?? '';
}

function parseClipboardTsvGrid(plainData: string): string[][] | null {
  const normalized = plainData.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
      continue;
    }

    if (ch === '"' && currentCell.length === 0) {
      inQuotes = true;
    } else if (ch === '\t') {
      currentRow.push(currentCell);
      currentCell = '';
    } else if (ch === '\n') {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }

  if (inQuotes) return null;
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  // Trim trailing empty newline row that spreadsheets append on Ctrl+C
  if (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }

  if (rows.length < 2) return null;
  const colCount = rows[0].length;
  if (colCount < 2 || !rows.every((r) => r.length === colCount)) {
    return null;
  }
  return rows;
}

function buildMarkdownTableFromGrid(grid: string[][]): string | null {
  if (grid.length === 0) return null;
  const colCount = Math.max(...grid.map((r) => r.length));
  if (colCount === 0) return null;
  // Require at least 2 columns OR at least 2 rows so normal single-cell text isn't hijacked
  if (colCount < 2 && grid.length < 2) return null;

  const normalized = grid.map((row) =>
    Array.from({ length: colCount }, (_, c) => sanitizeCellText(row[c] ?? '')),
  );
  const header = normalized[0].map((h, i) => (h.length > 0 ? h : `Spalte ${i + 1}`));
  const sep = Array.from({ length: colCount }, () => '---');
  const body = normalized.slice(1);

  const rawLines = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ];
  return formatMarkdownTableLines(rawLines).join('\n');
}

/**
 * Converts clipboard HTML (`<table>` from Excel, Word, Sheets, browsers) or
 * multi-line tab-separated values (`\t` TSV) into an aligned GFM Markdown table.
 * Returns `null` if the clipboard payload is ordinary prose/code.
 */
export function convertClipboardToMarkdownTable(
  htmlData: string | undefined,
  plainData: string | undefined,
): string | null {
  if (htmlData && /<table[\s>]/i.test(htmlData) && typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(htmlData, 'text/html');
      const table = doc.querySelector('table');
      if (table && !table.querySelector('table')) {
        const trList = Array.from(table.querySelectorAll('tr'));
        const grid: string[][] = [];
        for (const tr of trList) {
          const cells = Array.from(tr.querySelectorAll(':scope > th, :scope > td'));
          if (cells.length === 0) continue;
          const rowValues: string[] = [];
          for (const cell of cells) {
            rowValues.push(extractHtmlCellText(cell));
            const colspan = Math.min(12, Math.max(1, Number(cell.getAttribute('colspan')) || 1));
            for (let k = 1; k < colspan; k++) {
              rowValues.push('');
            }
          }
          grid.push(rowValues);
        }
        if (grid.length >= 1 && Math.max(0, ...grid.map((r) => r.length)) >= 2) {
          const md = buildMarkdownTableFromGrid(grid);
          if (md) return md;
        }
      }
    } catch {
      // Fall back to TSV check
    }
  }

  if (plainData && plainData.includes('\t')) {
    const grid = parseClipboardTsvGrid(plainData);
    if (grid) {
      return buildMarkdownTableFromGrid(grid);
    }
  }

  return null;
}

export type TableEditAction =
  | { type: 'insert-row'; direction: 'above' | 'below' }
  | { type: 'delete-row' }
  | { type: 'insert-col'; direction: 'left' | 'right' }
  | { type: 'delete-col' };

export interface TableEditResult {
  from: number;
  to: number;
  insert: string;
  newCursorOffset: number;
}

export function isCursorInsideTable(docText: string, cursorOffset: number): boolean {
  const lineInfos = splitDocumentLinesWithOffsets(docText);
  let cursorLine = 0;
  for (let i = 0; i < lineInfos.length; i++) {
    if (cursorOffset >= lineInfos[i].from && cursorOffset <= lineInfos[i].to) {
      cursorLine = i;
      break;
    }
  }
  const lines = lineInfos.map((l) => l.text);
  return findTableBlockAtLine(lines, cursorLine) !== null;
}

export function modifyMarkdownTable(
  docText: string,
  cursorOffset: number,
  action: TableEditAction,
): TableEditResult | null {
  const lineInfos = splitDocumentLinesWithOffsets(docText);
  const lines = lineInfos.map((l) => l.text);
  const eol = docText.includes('\r\n') ? '\r\n' : '\n';

  let cursorLine = 0;
  for (let i = 0; i < lineInfos.length; i++) {
    if (cursorOffset >= lineInfos[i].from && cursorOffset <= lineInfos[i].to) {
      cursorLine = i;
      break;
    }
  }

  const activeBlock = findTableBlockAtLine(lines, cursorLine);
  if (!activeBlock) return null;

  const rawSlice = lines.slice(activeBlock.startLine, activeBlock.endLine + 1);
  const parsedRows: string[][] = [];
  for (const line of rawSlice) {
    const r = splitMarkdownTableRow(line);
    if (!r) return null;
    parsedRows.push(r);
  }

  if (parsedRows.length < 2) return null;

  const rowIdx = cursorLine - activeBlock.startLine;
  const colCount = Math.max(...parsedRows.map((r) => r.length));

  const spans = computeRowCellSpans(lines[cursorLine], lineInfos[cursorLine].from, rowIdx);
  let colIdx = 0;
  for (let c = 0; c < spans.length; c++) {
    if (cursorOffset >= spans[c].rawFrom && cursorOffset <= spans[c].rawTo) {
      colIdx = c;
      break;
    }
  }
  if (spans.length > 0 && cursorOffset > spans[spans.length - 1].rawTo) {
    colIdx = spans.length - 1;
  }

  let targetRow = rowIdx;
  let targetCol = colIdx;

  switch (action.type) {
    case 'insert-row': {
      if (action.direction === 'above') {
        targetRow = rowIdx <= 1 ? 2 : rowIdx;
      } else {
        targetRow = rowIdx <= 1 ? 2 : rowIdx + 1;
      }
      const newRow = Array.from({ length: colCount }, () => '');
      parsedRows.splice(targetRow, 0, newRow);
      break;
    }

    case 'delete-row': {
      if (rowIdx === 1) return null;
      if (rowIdx === 0) {
        if (parsedRows.length <= 2) return null;
        parsedRows[0] = parsedRows[2];
        parsedRows.splice(2, 1);
        targetRow = 0;
      } else {
        if (parsedRows.length <= 3) {
          parsedRows[2] = Array.from({ length: colCount }, () => '');
          targetRow = 2;
        } else {
          parsedRows.splice(rowIdx, 1);
          targetRow = Math.min(rowIdx, parsedRows.length - 1);
          if (targetRow === 1) targetRow = 0;
        }
      }
      break;
    }

    case 'insert-col': {
      targetCol = action.direction === 'left' ? colIdx : colIdx + 1;
      for (let r = 0; r < parsedRows.length; r++) {
        if (r === 1) {
          parsedRows[1].splice(targetCol, 0, '---');
        } else if (r === 0) {
          parsedRows[0].splice(targetCol, 0, `Spalte ${targetCol + 1}`);
        } else {
          parsedRows[r].splice(targetCol, 0, '');
        }
      }
      targetRow = rowIdx === 1 ? 2 : rowIdx;
      break;
    }

    case 'delete-col': {
      if (colCount <= 1) return null;
      targetCol = Math.min(colIdx, colCount - 1);
      for (let r = 0; r < parsedRows.length; r++) {
        parsedRows[r].splice(targetCol, 1);
      }
      targetCol = Math.min(targetCol, colCount - 2);
      targetRow = rowIdx === 1 ? 2 : rowIdx;
      break;
    }
  }

  const finalColCount = Math.max(...parsedRows.map((r) => r.length));
  for (const r of parsedRows) {
    while (r.length < finalColCount) {
      r.push('');
    }
  }

  const unformatted = parsedRows.map((r, rIdx) => {
    if (rIdx === 1) {
      return `| ${r.map((c) => (/^:?-+:?$/.test(c.trim()) ? c.trim() : '---')).join(' | ')} |`;
    }
    return `| ${r.join(' | ')} |`;
  });

  const formattedLines = formatMarkdownTableLines(unformatted);
  const insert = formattedLines.join(eol);

  const from = lineInfos[activeBlock.startLine].from;
  const to = lineInfos[activeBlock.endLine].to;

  targetRow = Math.min(targetRow, formattedLines.length - 1);
  let offsetInInsert = 0;
  for (let r = 0; r < targetRow; r++) {
    offsetInInsert += formattedLines[r].length + eol.length;
  }
  const rowSpans = computeRowCellSpans(formattedLines[targetRow], offsetInInsert, targetRow);
  const safeTargetCol = Math.min(targetCol, rowSpans.length - 1);
  const cellSpan = rowSpans[safeTargetCol] ?? rowSpans[rowSpans.length - 1];
  const newCursorOffset = from + (cellSpan ? cellSpan.selectFrom : offsetInInsert);

  return { from, to, insert, newCursorOffset };
}
