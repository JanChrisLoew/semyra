import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from '../api';
import { DocumentAutoSave } from '../document-auto-save';
import { DocumentFileOperations } from '../document-file-operations';
import type { FileDocument } from '../document-state';

function openDocument(): FileDocument {
  return {
    path: 'C:\\Notes\\Draft.md',
    name: 'Draft.md',
    parentDir: 'C:\\Notes',
    savedContent: 'Saved',
    savedLineEnding: 'LF',
    currentContent: 'Edited',
    lineEnding: 'LF',
    encoding: 'UTF-8',
    isDirty: true,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('DocumentAutoSave', () => {
  it('debounces edits independently for each document', () => {
    const first = openDocument();
    const second = { ...openDocument(), path: 'C:\\Notes\\Other.md' };
    const save = vi.fn(async () => true);
    const autoSave = new DocumentAutoSave<typeof first>(() => false, save);
    autoSave.setEnabled(true);

    autoSave.schedule(first);
    autoSave.schedule(second);
    vi.advanceTimersByTime(500);
    autoSave.schedule(first);

    vi.advanceTimersByTime(400);
    expect(save.mock.calls).toEqual([[second]]);
    vi.advanceTimersByTime(500);
    expect(save.mock.calls).toEqual([[second], [first]]);
  });

  it('cancels all scheduled saves when disabled', () => {
    const first = openDocument();
    const second = { ...openDocument(), path: 'C:\\Notes\\Other.md' };
    const save = vi.fn(async () => true);
    const autoSave = new DocumentAutoSave<typeof first>(() => false, save);
    autoSave.setEnabled(true);
    autoSave.schedule(first);
    autoSave.schedule(second);

    autoSave.setEnabled(false);
    expect(autoSave.isEnabled).toBe(false);
    autoSave.setEnabled(true);
    vi.advanceTimersByTime(900);

    expect(save).not.toHaveBeenCalled();
  });

  it('schedules only dirty documents with a path and without a conflict or pending close', () => {
    const document = openDocument();
    const isClosing = vi.fn(() => false);
    const save = vi.fn(async () => true);
    const autoSave = new DocumentAutoSave<typeof document>(isClosing, save);
    autoSave.schedule(document);
    autoSave.setEnabled(true);

    autoSave.schedule({ ...document, path: null });
    autoSave.schedule({ ...document, isDirty: false });
    autoSave.schedule({ ...document, hasExternalConflict: true });
    isClosing.mockReturnValue(true);
    autoSave.schedule(document);

    vi.advanceTimersByTime(900);
    expect(save).not.toHaveBeenCalled();
  });

  it('can reject an automatic save if a conflict appears while it is waiting for a write', async () => {
    const document = openDocument();
    const operations = new DocumentFileOperations<FileDocument>({
      isOpen: () => true,
      getWorkspaceRoot: () => null,
      beforeSave: (target, automatic): boolean => !automatic || autoSave.canSave(target),
      onSaved: vi.fn(),
      onSaveConflict: vi.fn(),
      onSaveError: vi.fn(),
    });
    let finishWrite!: (value: { saved: boolean }) => void;
    const pendingWrite = new Promise<{ saved: boolean }>((resolve) => { finishWrite = resolve; });
    const write = vi.spyOn(backend, 'writeFile').mockReturnValueOnce(pendingWrite);
    const manual = operations.save(document);
    const save = vi.fn((target: FileDocument) => operations.save(target, false, true));
    const autoSave = new DocumentAutoSave<typeof document>(() => false, save);
    autoSave.setEnabled(true);
    autoSave.schedule(document);

    vi.advanceTimersByTime(900);
    expect(save).toHaveBeenCalledOnce();
    document.currentContent = 'Newer edit';
    document.hasExternalConflict = true;
    finishWrite({ saved: true });

    await expect(manual).resolves.toBe(true);
    await expect(save.mock.results[0].value).resolves.toBe(false);
    expect(write).toHaveBeenCalledOnce();
  });
});
