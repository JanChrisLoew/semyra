// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CommandPaletteController, fuzzyMatch, PaletteDataSource } from '../palette';
import { setLanguage } from '../i18n';

describe('fuzzyMatch', () => {
  it('returns empty indices and zero score for an empty query', () => {
    expect(fuzzyMatch('', 'README.md')).toEqual({ score: 0, indices: [] });
  });

  it('matches case-insensitively and returns character indices', () => {
    const res = fuzzyMatch('rdm', 'README.md');
    expect(res).not.toBeNull();
    expect(res!.indices).toEqual([0, 3, 4]);
  });

  it('scores contiguous prefix matches higher than scattered matches', () => {
    const contiguous = fuzzyMatch('semy', 'Semyra.md');
    const scattered = fuzzyMatch('semy', 'my_system_summary_y.md');
    expect(contiguous).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(contiguous!.score).toBeGreaterThan(scattered!.score);
  });

  it('rewards word-boundary and path-separator matches', () => {
    const boundary = fuzzyMatch('gs', 'docs\\getting-started.md');
    const middle = fuzzyMatch('gs', 'docs\\longstringfile.md');
    expect(boundary).not.toBeNull();
    expect(middle).not.toBeNull();
    expect(boundary!.score).toBeGreaterThan(middle!.score);
  });

  it('returns null when characters do not appear in order', () => {
    expect(fuzzyMatch('xyz', 'README.md')).toBeNull();
  });
});

function createPaletteFixture(overrides: Partial<PaletteDataSource> = {}) {
  document.body.innerHTML = `
    <dialog id="palette-dialog">
      <input id="palette-input" type="search" />
      <div id="palette-results"></div>
    </dialog>
  `;

  const dialog = document.getElementById('palette-dialog') as HTMLDialogElement;
  const input = document.getElementById('palette-input') as HTMLInputElement;
  const resultsEl = document.getElementById('palette-results')!;

  dialog.showModal = vi.fn(() => {
    dialog.setAttribute('open', '');
  });
  dialog.close = vi.fn(() => {
    dialog.removeAttribute('open');
    dialog.dispatchEvent(new Event('close'));
  });

  const onJumpToLine = vi.fn();
  const source: PaletteDataSource = {
    getFileItems: vi.fn(async () => [
      { id: 'file:1', kind: 'file' as const, label: 'README.md', run: vi.fn() },
      { id: 'file:2', kind: 'file' as const, label: 'AGENTS.md', run: vi.fn() },
    ]),
    getCommandItems: vi.fn(() => [
      { id: 'cmd:1', kind: 'command' as const, label: 'Datei: Speichern', run: vi.fn() },
    ]),
    getHeadings: vi.fn(() => [
      { level: 1, text: 'Introduction', line: 1 },
      { level: 2, text: 'Getting Started', line: 12 },
      { level: 3, text: 'Installation Details', line: 28 },
    ]),
    onJumpToLine,
    ...overrides,
  };

  const controller = new CommandPaletteController(dialog, input, resultsEl, source);
  return { dialog, input, resultsEl, controller, source, onJumpToLine };
}

describe('CommandPaletteController A11y and # heading-jump mode', () => {
  beforeEach(() => {
    setLanguage('de', false);
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('sets listbox/option ARIA attributes and synchronizes aria-activedescendant on navigation', async () => {
    const { dialog, input, resultsEl, controller } = createPaletteFixture();

    controller.open('files');
    await Promise.resolve();
    await Promise.resolve();

    expect(resultsEl.getAttribute('role')).toBe('listbox');
    expect(input.getAttribute('aria-controls')).toBe('palette-results');

    const options = resultsEl.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(options).toHaveLength(2);
    expect(options[0].id).toBe('palette-option-0');
    expect(options[1].id).toBe('palette-option-1');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(options[1].getAttribute('aria-selected')).toBe('false');
    expect(input.getAttribute('aria-activedescendant')).toBe('palette-option-0');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(options[0].getAttribute('aria-selected')).toBe('false');
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe('palette-option-1');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(options[1].getAttribute('aria-selected')).toBe('false');
    expect(input.getAttribute('aria-activedescendant')).toBe('palette-option-0');

    dialog.close();
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('lists and filters active document headings when query starts with # and jumps to line on selection', async () => {
    const { dialog, input, resultsEl, controller, onJumpToLine } = createPaletteFixture();

    controller.open('files');
    await Promise.resolve();

    input.value = '#';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    let options = resultsEl.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(options).toHaveLength(3);
    expect(options[0].textContent).toContain('Introduction');
    expect(options[0].textContent).toContain('H1');
    expect(options[0].textContent).toContain('Zeile 1');
    expect(options[1].textContent).toContain('Getting Started');
    expect(options[1].textContent).toContain('H2');

    input.value = '#install';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    options = resultsEl.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain('Installation Details');
    expect(input.getAttribute('aria-activedescendant')).toBe('palette-option-0');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(dialog.close).toHaveBeenCalledTimes(1);
    expect(onJumpToLine).toHaveBeenCalledWith(28);
  });

  it('supports open("headings") and clears aria-activedescendant when no headings match', async () => {
    const { input, resultsEl, controller } = createPaletteFixture();

    controller.open('headings');
    await Promise.resolve();

    expect(input.value).toBe('# ');
    expect(resultsEl.querySelectorAll('[role="option"]')).toHaveLength(3);

    input.value = '#nonexistent-heading';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(resultsEl.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(resultsEl.textContent).toContain('Keine passenden Überschriften');
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  });
});
