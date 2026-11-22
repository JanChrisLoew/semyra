import { describe, expect, it } from 'vitest';
import {
  classifyDiskUpdate,
  expectedDiskVersion,
  recordSavedDocumentVersion,
  restoreDocumentDraft,
  updateDocumentVersion,
  type DocumentState,
} from '../document-state';

function openDocument(overrides: Partial<DocumentState> = {}): DocumentState {
  return {
    savedContent: 'Saved\n',
    savedLineEnding: 'LF',
    currentContent: 'Saved\n',
    lineEnding: 'LF',
    encoding: 'UTF-8',
    isDirty: false,
    ...overrides,
  };
}

describe('document versions', () => {
  it('advances the revision for content and line-ending changes only', () => {
    const document = openDocument();
    expect(updateDocumentVersion(document, 'Saved\n', 'LF')).toBe(false);
    expect(document.revision).toBeUndefined();

    expect(updateDocumentVersion(document, 'New edit\n', 'LF')).toBe(true);
    expect(document.revision).toBe(1);
    expect(updateDocumentVersion(document, 'New edit\n', 'CRLF')).toBe(false);
    expect(document).toMatchObject({ currentContent: 'New edit\n', lineEnding: 'CRLF', revision: 2 });
  });

  it('keeps a newer line-ending change dirty after the save completes', () => {
    const document = openDocument({ lineEnding: 'CRLF', encoding: 'Windows-1252' });
    recordSavedDocumentVersion(document, 'Saved\n', 'LF');

    expect(document).toMatchObject({ savedLineEnding: 'LF', lineEnding: 'CRLF', encoding: 'UTF-8', isDirty: true });
  });

  it('uses the confirmed overwrite baseline only for a manual save', () => {
    const document = openDocument({ overwriteExpected: { content: 'External\n', lineEnding: 'CRLF' } });

    expect(expectedDiskVersion(document, false)).toEqual({ content: 'External\n', lineEnding: 'CRLF' });
    expect(expectedDiskVersion(document, true)).toEqual({ content: 'Saved\n', lineEnding: 'LF' });
  });
});

describe('recovered drafts', () => {
  const draft = {
    name: 'Draft.md', path: 'C:\\Notes\\Draft.md', parentDir: 'C:\\Notes',
    content: 'Unsaved\n', savedContent: 'Saved\n', lineEnding: 'CRLF',
  } as const;

  it('uses the disk line ending as the baseline for an older draft without savedLineEnding', () => {
    const document = openDocument();
    restoreDocumentDraft(document, draft);

    expect(document).toMatchObject({
      currentContent: 'Unsaved\n', savedContent: 'Saved\n', lineEnding: 'CRLF',
      savedLineEnding: 'LF', isDirty: true, hasExternalConflict: false,
    });
  });

  it('keeps the draft dirty and signals a conflict when the underlying disk version changed', () => {
    const document = openDocument({ currentContent: 'External\n', savedContent: 'External\n' });
    restoreDocumentDraft(document, draft);

    expect(document).toMatchObject({
      currentContent: 'Unsaved\n', savedContent: 'Saved\n', isDirty: true, hasExternalConflict: true,
    });
  });
});

describe('disk update decisions', () => {
  it('ignores an unchanged disk snapshot while the editor has local changes', () => {
    const document = openDocument({ currentContent: 'Local edit\n', isDirty: true });
    const localBeforeRead = { content: document.currentContent, lineEnding: document.lineEnding };
    const disk = { content: 'Saved\n', lineEnding: 'LF', encoding: 'UTF-8' } as const;

    expect(classifyDiskUpdate(document, localBeforeRead, disk, false)).toEqual({ kind: 'ignore' });
    expect(classifyDiskUpdate(document, localBeforeRead, { ...disk, lineEnding: 'CRLF' }, false))
      .toEqual({ kind: 'conflict' });
  });

  it('protects edits made during an explicit reload', () => {
    const document = openDocument({ currentContent: 'New edit\n', isDirty: true });
    const disk = { content: 'External\n', lineEnding: 'LF', encoding: 'UTF-8' } as const;

    expect(classifyDiskUpdate(document, { content: 'Older edit\n', lineEnding: 'LF' }, disk, true))
      .toEqual({ kind: 'conflict' });
    expect(classifyDiskUpdate(document, { content: 'New edit\n', lineEnding: 'LF' }, disk, true))
      .toEqual({ kind: 'reload', version: disk });
  });

  it('preserves the line-ending preference when a background reload reads a single line', () => {
    const document = openDocument({ lineEnding: 'CRLF' });
    const disk = { content: 'External', lineEnding: 'LF', encoding: 'UTF-8' } as const;
    const localBeforeRead = { content: document.currentContent, lineEnding: document.lineEnding };

    expect(classifyDiskUpdate(document, localBeforeRead, disk, false))
      .toEqual({ kind: 'reload', version: { ...disk, lineEnding: 'CRLF' } });
    expect(classifyDiskUpdate(document, localBeforeRead, disk, true)).toEqual({ kind: 'reload', version: disk });
  });
});
