import { describe, expect, it, vi } from 'vitest';
import { DocumentCloseController, type UnsavedChoice } from '../document-close';
import type { FileDocument } from '../document-state';

type OpenDocument = FileDocument & { id: string };

function dirtyDocument(id: string): OpenDocument {
  return {
    id,
    path: `C:\\Notes\\${id}.md`,
    name: `${id}.md`,
    parentDir: 'C:\\Notes',
    savedContent: 'Saved',
    currentContent: 'Edited',
    lineEnding: 'LF',
    savedLineEnding: 'LF',
    encoding: 'UTF-8',
    isDirty: true,
    revision: 1,
  };
}

function closeController(documents: OpenDocument[]) {
  const files = {
    activeSave: vi.fn<(document: OpenDocument) => Promise<boolean> | undefined>(),
    save: vi.fn(async (_document: OpenDocument) => true),
    waitForActiveSaves: vi.fn(async () => []),
  };
  const autoSave = { cancel: vi.fn(), schedule: vi.fn() };
  const actions = {
    getDocuments: () => documents,
    promptTab: vi.fn<() => Promise<UnsavedChoice>>().mockResolvedValue('cancel'),
    promptWindow: vi.fn<() => Promise<UnsavedChoice>>().mockResolvedValue('cancel'),
    removeTab: vi.fn(),
    prepareWindowClose: vi.fn(async () => true),
    closeNativeWindow: vi.fn(async () => {}),
    onWindowCloseAborted: vi.fn(),
    onWindowCloseError: vi.fn(),
  };
  return { controller: new DocumentCloseController(files, autoSave, actions), files, autoSave, actions };
}

describe('DocumentCloseController', () => {
  it('waits for an active save before asking about closing a tab and resumes Auto-Save on cancel', async () => {
    const document = dirtyDocument('Draft');
    const { controller, files, autoSave, actions } = closeController([document]);
    let finishSave!: (value: boolean) => void;
    files.activeSave.mockReturnValue(new Promise((resolve) => { finishSave = resolve; }));

    const closing = controller.closeTab(document.id);
    expect(controller.isClosing(document)).toBe(true);
    expect(autoSave.cancel).toHaveBeenCalledExactlyOnceWith(document);
    expect(actions.promptTab).not.toHaveBeenCalled();
    finishSave(true);

    await expect(closing).resolves.toBe(false);
    expect(actions.promptTab).toHaveBeenCalledExactlyOnceWith(document);
    expect(actions.removeTab).not.toHaveBeenCalled();
    expect(controller.isClosing(document)).toBe(false);
    expect(autoSave.schedule).toHaveBeenCalledExactlyOnceWith(document);
  });

  it('keeps the window open if a second document changes while the first is saved', async () => {
    const first = dirtyDocument('First');
    const second = dirtyDocument('Second');
    const { controller, files, autoSave, actions } = closeController([first, second]);
    actions.promptWindow.mockResolvedValue('save');
    files.save.mockImplementationOnce(async () => {
      first.isDirty = false;
      second.revision = 2;
      return true;
    });

    await controller.closeWindow();

    expect(files.save).toHaveBeenCalledExactlyOnceWith(first);
    expect(actions.prepareWindowClose).not.toHaveBeenCalled();
    expect(actions.closeNativeWindow).not.toHaveBeenCalled();
    expect(actions.onWindowCloseAborted).toHaveBeenCalledOnce();
    expect(autoSave.schedule.mock.calls).toEqual([[first], [second]]);
  });

  it('closes after an unchanged discard confirmation and keeps Auto-Save suspended', async () => {
    const document = dirtyDocument('Draft');
    const { controller, files, autoSave, actions } = closeController([document]);
    actions.promptWindow.mockResolvedValue('discard');

    await controller.closeWindow();

    expect(files.save).not.toHaveBeenCalled();
    expect(actions.prepareWindowClose).toHaveBeenCalledOnce();
    expect(actions.closeNativeWindow).toHaveBeenCalledOnce();
    expect(actions.onWindowCloseAborted).not.toHaveBeenCalled();
    expect(autoSave.schedule).not.toHaveBeenCalled();
    expect(controller.isClosing(document)).toBe(true);
  });

  it('keeps a tab open when save fails or document revision changes during prompt', async () => {
    const document = dirtyDocument('Draft');
    const { controller, files, autoSave, actions } = closeController([document]);
    actions.promptTab.mockResolvedValue('save');
    files.save.mockResolvedValueOnce(false);

    await expect(controller.closeTab(document.id)).resolves.toBe(false);
    expect(actions.removeTab).not.toHaveBeenCalled();
    expect(autoSave.schedule).toHaveBeenCalledTimes(1);

    actions.promptTab.mockImplementationOnce(async () => {
      document.revision = 2;
      return 'discard';
    });
    await expect(controller.closeTab(document.id)).resolves.toBe(false);
    expect(actions.removeTab).not.toHaveBeenCalled();
    expect(autoSave.schedule).toHaveBeenCalledTimes(2);
  });

  it('aborts window close cleanly when prepareWindowClose returns false or closeNativeWindow throws', async () => {
    const document = dirtyDocument('Draft');
    const { controller, autoSave, actions } = closeController([document]);
    actions.promptWindow.mockResolvedValue('discard');
    actions.prepareWindowClose.mockResolvedValueOnce(false);

    await controller.closeWindow();
    expect(actions.closeNativeWindow).not.toHaveBeenCalled();
    expect(actions.onWindowCloseAborted).toHaveBeenCalledTimes(1);
    expect(controller.isClosing(document)).toBe(false);
    expect(autoSave.schedule).toHaveBeenCalledTimes(1);

    const err = new Error('native close failed');
    actions.prepareWindowClose.mockResolvedValueOnce(true);
    actions.closeNativeWindow.mockRejectedValueOnce(err);
    await controller.closeWindow();
    expect(actions.onWindowCloseError).toHaveBeenCalledExactlyOnceWith(err);
    expect(actions.onWindowCloseAborted).toHaveBeenCalledTimes(2);
    expect(controller.isClosing(document)).toBe(false);
    expect(autoSave.schedule).toHaveBeenCalledTimes(2);
  });
});
