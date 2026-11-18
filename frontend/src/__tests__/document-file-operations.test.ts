import { afterEach, describe, expect, it, vi } from 'vitest';
import { backend, type FilePayload } from '../api';
import { DocumentFileOperations } from '../document-file-operations';
import type { FileDocument } from '../document-state';

const path = 'C:\\Notes\\Draft.md';

function openDocument(): FileDocument {
  return {
    path,
    name: 'Draft.md',
    parentDir: 'C:\\Notes',
    savedContent: 'Saved\n',
    savedLineEnding: 'LF',
    currentContent: 'Saved\n',
    lineEnding: 'LF',
    encoding: 'UTF-8',
    isDirty: false,
  };
}

function fileOperations() {
  const deps = {
    isOpen: () => true,
    getWorkspaceRoot: () => 'C:\\Workspace',
    beforeSave: () => true,
    onSaved: vi.fn(),
    onSaveConflict: vi.fn(),
    onSaveError: vi.fn(),
  };
  return { operations: new DocumentFileOperations<FileDocument>(deps), ...deps };
}

function diskFile(content: string): FilePayload {
  return { path, name: 'Draft.md', parentDir: 'C:\\Notes', content, lineEnding: 'LF', encoding: 'UTF-8' };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}

function diskCallbacks() {
  return { onConflict: vi.fn(), onReload: vi.fn(), onError: vi.fn() };
}

afterEach(() => vi.restoreAllMocks());

describe('DocumentFileOperations', () => {
  it('starts the next save with the latest document content only after the active save finishes', async () => {
    const document = openDocument();
    document.currentContent = 'First edit\n';
    const { operations } = fileOperations();
    const firstWrite = deferred<{ saved: boolean }>();
    const writeFile = vi.spyOn(backend, 'writeFile')
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce({ saved: true });
    const first = operations.save(document);
    const next = operations.save(document);

    expect(operations.activeSave(document)).toBeDefined();
    expect(writeFile).toHaveBeenCalledExactlyOnceWith(path, 'First edit\n', 'LF', 'Saved\n', 'LF');
    document.currentContent = 'Latest edit\n';
    firstWrite.resolve({ saved: true });

    await expect(first).resolves.toBe(true);
    await expect(next).resolves.toBe(true);
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenNthCalledWith(2, path, 'Latest edit\n', 'LF', 'First edit\n', 'LF');
    expect(operations.activeSave(document)).toBeUndefined();
  });

  it('waits for an active save before reading the same document', async () => {
    const document = openDocument();
    const { operations } = fileOperations();
    const write = deferred<{ saved: boolean }>();
    vi.spyOn(backend, 'writeFile').mockReturnValueOnce(write.promise);
    const saving = operations.save(document);
    const readFile = vi.spyOn(backend, 'readFile').mockResolvedValue(diskFile('Disk after save\n'));
    const callbacks = diskCallbacks();
    const reading = operations.syncFromDisk(document, false, callbacks);

    expect(readFile).not.toHaveBeenCalled();
    write.resolve({ saved: true });
    await Promise.all([saving, reading]);

    expect(readFile).toHaveBeenCalledExactlyOnceWith(path);
    expect(callbacks.onReload).toHaveBeenCalledExactlyOnceWith({
      content: 'Disk after save\n', lineEnding: 'LF', encoding: 'UTF-8',
    });
  });

  it('discards reads started before a successful save even when a new read is in flight', async () => {
    const document = openDocument();
    const { operations } = fileOperations();
    const oldRead = deferred<FilePayload>();
    const newRead = deferred<FilePayload>();
    vi.spyOn(backend, 'readFile').mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
    vi.spyOn(backend, 'writeFile').mockResolvedValueOnce({ saved: true });
    const callbacks = diskCallbacks();

    const oldSync = operations.syncFromDisk(document, false, callbacks);
    await expect(operations.save(document)).resolves.toBe(true);
    const newSync = operations.syncFromDisk(document, false, callbacks);
    oldRead.resolve(diskFile('Superseded disk version\n'));
    await oldSync;
    expect(callbacks.onReload).not.toHaveBeenCalled();

    newRead.resolve(diskFile('Current disk version\n'));
    await newSync;
    expect(callbacks.onReload).toHaveBeenCalledExactlyOnceWith({
      content: 'Current disk version\n', lineEnding: 'LF', encoding: 'UTF-8',
    });
  });

  it('drops a disk response after the document path changes', async () => {
    const document = openDocument();
    const { operations } = fileOperations();
    const read = deferred<FilePayload>();
    vi.spyOn(backend, 'readFile').mockReturnValueOnce(read.promise);
    const callbacks = diskCallbacks();
    const sync = operations.syncFromDisk(document, false, callbacks);

    document.path = 'C:\\Notes\\Renamed.md';
    read.resolve(diskFile('Old path version\n'));
    await sync;

    expect(callbacks.onReload).not.toHaveBeenCalled();
    expect(callbacks.onConflict).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it.each([null, 'C:\\Notes\\Renamed.md'])(
    'keeps local edits dirty when a write completes after the path changes to %s',
    async (newPath) => {
      const document = openDocument();
      document.currentContent = 'Local edit\n';
      document.isDirty = true;
      const { operations, onSaved } = fileOperations();
      const write = deferred<{ saved: boolean }>();
      vi.spyOn(backend, 'writeFile').mockReturnValueOnce(write.promise);

      const saving = operations.save(document);
      document.path = newPath;
      write.resolve({ saved: true });

      await expect(saving).resolves.toBe(false);
      expect(document.savedContent).toBe('Saved\n');
      expect(document.isDirty).toBe(true);
      expect(onSaved).not.toHaveBeenCalled();
    },
  );

  it('ignores Save As completion after another action changes the tab path', async () => {
    const document = openDocument();
    const { operations, onSaved } = fileOperations();
    const dialog = deferred<{ saved: boolean; path: string }>();
    vi.spyOn(backend, 'saveFileDialog').mockReturnValueOnce(dialog.promise);

    const saving = operations.save(document, true);
    document.path = 'C:\\Notes\\Renamed.md';
    dialog.resolve({ saved: true, path: 'C:\\Workspace\\Copy.md' });

    await expect(saving).resolves.toBe(false);
    expect(document.path).toBe('C:\\Notes\\Renamed.md');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('updates a document location only when Save As succeeds', async () => {
    const document = openDocument();
    const { operations, onSaved } = fileOperations();
    const renamedPath = 'C:\\Workspace\\Renamed.md';
    const saveDialog = vi.spyOn(backend, 'saveFileDialog')
      .mockResolvedValueOnce({ saved: false })
      .mockResolvedValueOnce({ saved: true, path: renamedPath, name: 'Renamed.md', parentDir: 'C:\\Workspace' });

    await expect(operations.save(document, true)).resolves.toBe(false);
    expect(document.path).toBe(path);
    expect(onSaved).not.toHaveBeenCalled();

    await expect(operations.save(document, true)).resolves.toBe(true);
    expect(saveDialog).toHaveBeenLastCalledWith('Saved\n', 'Draft.md', 'C:\\Notes', 'LF', expect.any(String));
    expect(document).toMatchObject({ path: renamedPath, name: 'Renamed.md', parentDir: 'C:\\Workspace' });
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(document, path, true);
  });

  it('reports a write conflict without advancing the saved version', async () => {
    const document = openDocument();
    document.currentContent = 'Local edit\n';
    document.isDirty = true;
    const { operations, onSaved, onSaveConflict, onSaveError } = fileOperations();
    vi.spyOn(backend, 'writeFile').mockResolvedValueOnce({ saved: false });

    await expect(operations.save(document)).resolves.toBe(false);
    expect(document.savedContent).toBe('Saved\n');
    expect(document.isDirty).toBe(true);
    expect(onSaveConflict).toHaveBeenCalledExactlyOnceWith(document);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onSaveError).not.toHaveBeenCalled();
  });
});
