import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { backend, SearchFileResult } from '../api';
import { WorkspaceSearchController } from '../workspace-search';

describe('WorkspaceSearchController', () => {
  let searchInputEl: HTMLInputElement;
  let clearBtn: HTMLButtonElement;
  let statusBadgeEl: HTMLElement;
  let caseToggleBtn: HTMLButtonElement;
  let resultsContainerEl: HTMLElement;
  let getWorkspaceRootPath: Mock<() => string | null>;
  let onOpenMatch: Mock<(filePath: string, line: number) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    searchInputEl = document.createElement('input');
    clearBtn = document.createElement('button');
    clearBtn.hidden = true;
    statusBadgeEl = document.createElement('span');
    caseToggleBtn = document.createElement('button');
    resultsContainerEl = document.createElement('div');
    getWorkspaceRootPath = vi.fn<() => string | null>().mockReturnValue('C:\\Projekte\\Notes');
    onOpenMatch = vi.fn<(filePath: string, line: number) => void>();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function createController(): WorkspaceSearchController {
    return new WorkspaceSearchController({
      searchInputEl,
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
        matches: [
          { line: 5, column: 3, preview: 'Semyra rocks' },
          { line: 12, column: 1, preview: 'Use Semyra daily' },
        ],
      },
      {
        path: 'C:\\Projekte\\Notes\\TODO.md',
        relPath: 'TODO.md',
        name: 'TODO.md',
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

    expect(searchSpy).toHaveBeenCalledWith('C:\\Projekte\\Notes', 'Semyra', false);
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
    expect(searchSpy).toHaveBeenLastCalledWith('C:\\Projekte\\Notes', 'Rust', false);

    caseToggleBtn.click();
    expect(caseToggleBtn.classList.contains('is-active')).toBe(true);
    expect(caseToggleBtn.getAttribute('aria-pressed')).toBe('true');

    await vi.runAllTimersAsync();
    expect(searchSpy).toHaveBeenLastCalledWith('C:\\Projekte\\Notes', 'Rust', true);
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
});
