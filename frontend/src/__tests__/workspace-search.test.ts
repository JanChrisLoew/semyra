import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { backend, SearchFileResult } from '../api';
import { WorkspaceSearchController } from '../workspace-search';

const guideResult: SearchFileResult = {
  path: 'C:\\Projekte\\Notes\\Guide.md',
  relPath: 'Guide.md',
  name: 'Guide.md',
  contentVersion: 'guide-v1',
  matches: [{ line: 1, column: 1, preview: 'old text' }],
};

describe('WorkspaceSearchController', () => {
  let searchInputEl: HTMLInputElement;
  let replaceInputEl: HTMLInputElement;
  let replaceAllBtn: HTMLButtonElement;
  let clearBtn: HTMLButtonElement;
  let statusBadgeEl: HTMLElement;
  let searchRowEl: HTMLElement;
  let caseToggleBtn: HTMLButtonElement;
  let resultsContainerEl: HTMLElement;
  let getWorkspaceRootPath: Mock<() => string | null>;
  let onOpenMatch: Mock<(filePath: string, line: number) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    searchInputEl = document.createElement('input');
    replaceInputEl = document.createElement('input');
    replaceAllBtn = document.createElement('button');
    clearBtn = document.createElement('button');
    clearBtn.hidden = true;
    statusBadgeEl = document.createElement('span');
    searchRowEl = document.createElement('div');
    caseToggleBtn = document.createElement('button');
    searchRowEl.appendChild(caseToggleBtn);
    resultsContainerEl = document.createElement('div');
    getWorkspaceRootPath = vi.fn<() => string | null>().mockReturnValue('C:\\Projekte\\Notes');
    onOpenMatch = vi.fn<(filePath: string, line: number) => void>();
  });

  afterEach(() => {
    document.getElementById('workspace-replace-dialog')?.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function createController(): WorkspaceSearchController {
    return new WorkspaceSearchController({
      searchInputEl,
      replaceInputEl,
      replaceAllBtn,
      clearBtn,
      statusBadgeEl,
      caseToggleBtn,
      resultsContainerEl,
      getWorkspaceRootPath,
      onOpenMatch,
    });
  }

  it('prompts to open workspace when no folder is active', async () => {
    getWorkspaceRootPath.mockReturnValue(null);
    const controller = createController();

    searchInputEl.value = 'Semyra';
    await controller.runSearch();

    expect(resultsContainerEl.textContent).toContain('Bitte öffne zuerst einen Arbeitsordner');
    expect(statusBadgeEl.textContent).toBe('');
  });

  it('shows clear button on input, debounces search, and renders hit results and badge', async () => {
    const mockResults: SearchFileResult[] = [
      {
        path: 'C:\\Projekte\\Notes\\Guide.md',
        relPath: 'Guide.md',
        name: 'Guide.md',
        contentVersion: 'guide-v1',
        matches: [
          { line: 5, column: 3, preview: 'Semyra rocks' },
          { line: 12, column: 1, preview: 'Use Semyra daily' },
        ],
      },
      {
        path: 'C:\\Projekte\\Notes\\TODO.md',
        relPath: 'TODO.md',
        name: 'TODO.md',
        contentVersion: 'todo-v1',
        matches: [{ line: 2, column: 7, preview: 'Test Semyra' }],
      },
    ];

    const searchSpy = vi.spyOn(backend, 'searchWorkspace').mockResolvedValue({ results: mockResults });
    createController();

    expect(clearBtn.hidden).toBe(true);

    searchInputEl.value = 'Semyra';
    searchInputEl.dispatchEvent(new Event('input'));

    expect(clearBtn.hidden).toBe(false);
    expect(searchSpy).not.toHaveBeenCalled();

    // Fast forward debounce timer (180ms)
    await vi.advanceTimersByTimeAsync(200);

    expect(searchSpy).toHaveBeenCalledWith('C:\\Projekte\\Notes', 'Semyra', false, false, false);
    expect(statusBadgeEl.textContent).toBe('3');
    expect(statusBadgeEl.title).toBe('3 Treffer in 2 Dateien');

    const matchButtons = resultsContainerEl.querySelectorAll<HTMLButtonElement>('.search-match-btn');
    expect(matchButtons.length).toBe(3);

    // Clicking first match invokes callback with correct file and line
    matchButtons[0].click();
    expect(onOpenMatch).toHaveBeenCalledWith('C:\\Projekte\\Notes\\Guide.md', 5);
  });

  it('clears search input, resets results, and hides clear button on Esc or clear button click', async () => {
    vi.spyOn(backend, 'searchWorkspace').mockResolvedValue({ results: [] });
    createController();

    searchInputEl.value = 'Suchtext';
    searchInputEl.dispatchEvent(new Event('input'));
    expect(clearBtn.hidden).toBe(false);

    // Test Esc key clearing
    const escEvent = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    searchInputEl.dispatchEvent(escEvent);

    expect(searchInputEl.value).toBe('');
    expect(clearBtn.hidden).toBe(true);
    expect(statusBadgeEl.textContent).toBe('');
    expect(resultsContainerEl.textContent).toContain('Suchbegriff eingeben');

    // Test clear button click
    searchInputEl.value = 'Weiterer Text';
    searchInputEl.dispatchEvent(new Event('input'));
    expect(clearBtn.hidden).toBe(false);

    clearBtn.click();
    expect(searchInputEl.value).toBe('');
    expect(clearBtn.hidden).toBe(true);
    expect(resultsContainerEl.textContent).toContain('Suchbegriff eingeben');
  });

  it('toggles case-sensitive mode and triggers re-search', async () => {
    const searchSpy = vi.spyOn(backend, 'searchWorkspace').mockResolvedValue({ results: [] });
    const controller = createController();

    searchInputEl.value = 'Rust';
    await controller.runSearch();
    expect(searchSpy).toHaveBeenLastCalledWith('C:\\Projekte\\Notes', 'Rust', false, false, false);

    caseToggleBtn.click();
    expect(caseToggleBtn.classList.contains('is-active')).toBe(true);
    expect(caseToggleBtn.getAttribute('aria-pressed')).toBe('true');

    await vi.runAllTimersAsync();
    expect(searchSpy).toHaveBeenLastCalledWith('C:\\Projekte\\Notes', 'Rust', true, false, false);
  });

  it('discards stale search responses arriving out of order (sequence guard)', async () => {
    let resolveFirst!: (val: { results: SearchFileResult[] }) => void;
    let resolveSecond!: (val: { results: SearchFileResult[] }) => void;

    const firstPromise = new Promise<{ results: SearchFileResult[] }>((res) => {
      resolveFirst = res;
    });
    const secondPromise = new Promise<{ results: SearchFileResult[] }>((res) => {
      resolveSecond = res;
    });

    const searchSpy = vi
      .spyOn(backend, 'searchWorkspace')
      .mockReturnValueOnce(firstPromise)
      .mockReturnValueOnce(secondPromise);

    const controller = createController();

    searchInputEl.value = 'A';
    void controller.runSearch(); // seq 1

    searchInputEl.value = 'AB';
    void controller.runSearch(); // seq 2

    // Second (newer) query resolves first
    resolveSecond({
      results: [
        {
          path: 'C:\\B.md',
          relPath: 'B.md',
          name: 'B.md',
          contentVersion: 'ab-v1',
          matches: [{ line: 1, column: 1, preview: 'AB match' }],
        },
      ],
    });
    await secondPromise;
    await vi.runAllTimersAsync();

    expect(statusBadgeEl.textContent).toBe('1');
    expect(resultsContainerEl.textContent).toContain('AB match');

    // First (stale) query resolves afterwards
    resolveFirst({
      results: [
        {
          path: 'C:\\A.md',
          relPath: 'A.md',
          name: 'A.md',
          contentVersion: 'stale-v1',
          matches: [{ line: 1, column: 1, preview: 'A stale match' }],
        },
      ],
    });
    await firstPromise;
    await vi.runAllTimersAsync();

    // Must still reflect the newer second query results
    expect(statusBadgeEl.textContent).toBe('1');
    expect(resultsContainerEl.textContent).toContain('AB match');
    expect(resultsContainerEl.textContent).not.toContain('A stale match');
    expect(searchSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps cleared results empty when an earlier search completes', async () => {
    let finishSearch!: (value: { results: SearchFileResult[] }) => void;
    vi.spyOn(backend, 'searchWorkspace').mockReturnValue(new Promise((resolve) => {
      finishSearch = resolve;
    }));
    const controller = createController();
    searchInputEl.value = 'old';
    const pending = controller.runSearch();

    controller.clearSearch();
    finishSearch({ results: [guideResult] });
    await pending;

    expect(resultsContainerEl.textContent).toContain('Suchbegriff eingeben');
    expect(resultsContainerEl.textContent).not.toContain('Guide.md');
    expect(statusBadgeEl.textContent).toBe('');
    expect(replaceAllBtn.disabled).toBe(true);
  });

  it('blocks replace during the debounce and after a search with no hits', async () => {
    vi.spyOn(backend, 'searchWorkspace')
      .mockResolvedValueOnce({ results: [guideResult] })
      .mockResolvedValueOnce({ results: [] });
    const replace = vi.spyOn(backend, 'replaceWorkspace').mockRejectedValue(new Error('Unexpected replacement'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const controller = createController();
    searchInputEl.value = 'old';
    await controller.runSearch();
    expect(replaceAllBtn.disabled).toBe(false);

    searchInputEl.value = 'new';
    searchInputEl.dispatchEvent(new Event('input'));
    expect(replaceAllBtn.disabled).toBe(true);
    replaceInputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await vi.advanceTimersByTimeAsync(180);
    expect(resultsContainerEl.textContent).toContain('Keine Treffer gefunden');
    expect(replaceAllBtn.disabled).toBe(true);
    await controller.runReplaceAll();

    expect(confirm).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each(['query', 'workspace', 'option', 'selection', 'replacement', 'filesystem'])(
    'cancels a confirmed replacement if the %s changed while the dialog was open',
    async (change) => {
      vi.spyOn(backend, 'searchWorkspace').mockResolvedValue({ results: [guideResult] });
      const replace = vi.spyOn(backend, 'replaceWorkspace').mockRejectedValue(new Error('Unexpected replacement'));
      const controller = createController();
      searchInputEl.value = 'old';
      replaceInputEl.value = 'replacement';
      await controller.runSearch();

      const dialog = document.createElement('dialog');
      dialog.id = 'workspace-replace-dialog';
      dialog.showModal = vi.fn();
      const message = document.createElement('p');
      message.id = 'workspace-replace-dialog-msg';
      dialog.append(message);
      document.body.append(dialog);

      const pending = controller.runReplaceAll();
      await controller.runReplaceAll();
      expect(dialog.showModal).toHaveBeenCalledTimes(1);
      expect(message.textContent).toBe('„old“ in der ausgewählten Datei durch „replacement“ ersetzen?');

      switch (change) {
        case 'query':
          searchInputEl.value = 'new';
          searchInputEl.dispatchEvent(new Event('input'));
          break;
        case 'workspace':
          getWorkspaceRootPath.mockReturnValue('C:\\Projekte\\Other');
          break;
        case 'option':
          caseToggleBtn.click();
          break;
        case 'selection': {
          const checkbox = resultsContainerEl.querySelector<HTMLInputElement>('.search-file-checkbox')!;
          checkbox.checked = false;
          checkbox.dispatchEvent(new Event('change'));
          break;
        }
        case 'replacement':
          replaceInputEl.value = 'different replacement';
          break;
        case 'filesystem':
          controller.refreshAfterFileChanges([guideResult.path]);
          expect(replaceAllBtn.disabled).toBe(true);
          break;
      }
      dialog.returnValue = 'confirm';
      dialog.dispatchEvent(new Event('close'));
      await pending;

      expect(replace).not.toHaveBeenCalled();
    },
  );

  it('toggles whole-word and regex modes and surfaces invalid regex errors', async () => {
    const searchSpy = vi.spyOn(backend, 'searchWorkspace').mockResolvedValue({ results: [] });
    const controller = createController();

    const wholeWordBtn = searchRowEl.querySelector<HTMLButtonElement>('#btn-search-whole-word')!;
    const regexBtn = searchRowEl.querySelector<HTMLButtonElement>('#btn-search-regex')!;
    expect(wholeWordBtn.textContent).toBe('\\b');
    expect(regexBtn.textContent).toBe('.*');

    searchInputEl.value = 'foo.*bar';
    wholeWordBtn.click();
    expect(wholeWordBtn.classList.contains('is-active')).toBe(true);
    expect(wholeWordBtn.getAttribute('aria-pressed')).toBe('true');
    await vi.runAllTimersAsync();
    expect(searchSpy).toHaveBeenLastCalledWith('C:\\Projekte\\Notes', 'foo.*bar', false, false, true);

    regexBtn.click();
    expect(regexBtn.classList.contains('is-active')).toBe(true);
    expect(regexBtn.getAttribute('aria-pressed')).toBe('true');
    await vi.runAllTimersAsync();
    expect(searchSpy).toHaveBeenLastCalledWith('C:\\Projekte\\Notes', 'foo.*bar', false, true, true);

    searchSpy.mockRejectedValueOnce(new Error('Ungültiger regulärer Ausdruck: unclosed group'));
    searchInputEl.value = '(unclosed';
    await controller.runSearch();
    expect(resultsContainerEl.textContent).toContain('Ungültiger regulärer Ausdruck');
    expect(statusBadgeEl.textContent).toBe('');
  });

  it('refreshes edited results while keeping the previously selected files', async () => {
    const second = { ...guideResult, path: 'C:/Projekte/Notes/Second.md', name: 'Second.md', relPath: 'Second.md' };
    const added = { ...second, path: 'C:/Projekte/Notes/Added.md', name: 'Added.md', relPath: 'Added.md' };
    const updated = { ...guideResult, contentVersion: 'guide-v2', matches: [{ line: 2, column: 1, preview: 'updated' }] };
    const search = vi.spyOn(backend, 'searchWorkspace')
      .mockResolvedValueOnce({ results: [guideResult, second] })
      .mockResolvedValueOnce({ results: [updated, second, added] });
    const controller = createController();
    searchInputEl.value = 'old';
    await controller.runSearch();
    const unchecked = resultsContainerEl.querySelectorAll<HTMLInputElement>('.search-file-checkbox')[1];
    unchecked.checked = false;
    unchecked.dispatchEvent(new Event('change'));

    controller.refreshAfterFileChanges(['C:/Projekte/Notes-other/Outside.md']);
    expect(replaceAllBtn.disabled).toBe(false);
    controller.refreshAfterFileChanges([guideResult.path]);
    controller.refreshAfterFileChanges([added.path]);
    expect(replaceAllBtn.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(180);

    expect(search).toHaveBeenCalledTimes(2);
    expect(resultsContainerEl.textContent).toContain('updated');
    expect([...resultsContainerEl.querySelectorAll<HTMLInputElement>('.search-file-checkbox')]
      .map((checkbox) => checkbox.checked)).toEqual([true, false, false]);
  });

  it('supports per-file checkboxes, Select All/None, and selective replaceWorkspace', async () => {
    const mockResults: SearchFileResult[] = [
      {
        path: 'C:\\Projekte\\Notes\\A.md',
        relPath: 'A.md',
        name: 'A.md',
        contentVersion: 'a-v1',
        matches: [{ line: 1, column: 1, preview: 'old text' }],
      },
      {
        path: 'C:\\Projekte\\Notes\\B.md',
        relPath: 'B.md',
        name: 'B.md',
        contentVersion: 'b-v1',
        matches: [{ line: 2, column: 1, preview: 'old text' }],
      },
    ];
    const searchSpy = vi.spyOn(backend, 'searchWorkspace').mockResolvedValue({ results: mockResults });
    const replaceSpy = vi.spyOn(backend, 'replaceWorkspace').mockResolvedValue({
      filesUpdated: 1,
      totalReplacements: 1,
      updatedPaths: ['C:\\Projekte\\Notes\\A.md'],
      failures: [],
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const controller = createController();
    searchInputEl.value = ' old ';
    replaceInputEl.value = 'new';
    await controller.runSearch();

    const checkboxes = resultsContainerEl.querySelectorAll<HTMLInputElement>('.search-file-checkbox');
    expect(checkboxes.length).toBe(2);
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(true);
    expect(replaceAllBtn.disabled).toBe(false);

    const toggleAllBtn = resultsContainerEl.querySelector<HTMLButtonElement>('.search-select-toggle-btn')!;
    expect(toggleAllBtn.textContent).toBe('Keine');
    toggleAllBtn.click();
    expect(checkboxes[0].checked).toBe(false);
    expect(checkboxes[1].checked).toBe(false);
    expect(replaceAllBtn.disabled).toBe(true);
    expect(toggleAllBtn.textContent).toBe('Alle');

    toggleAllBtn.click();
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(true);
    expect(replaceAllBtn.disabled).toBe(false);

    // Uncheck B.md so only A.md is included
    checkboxes[1].checked = false;
    checkboxes[1].dispatchEvent(new Event('change'));
    await controller.runReplaceAll();

    expect(searchSpy).toHaveBeenCalledWith('C:\\Projekte\\Notes', 'old', false, false, false);
    expect(replaceSpy).toHaveBeenCalledWith(
      'C:\\Projekte\\Notes',
      'old',
      'new',
      false,
      false,
      false,
      [{ path: 'C:\\Projekte\\Notes\\A.md', contentVersion: 'a-v1' }],
    );
  });
});
