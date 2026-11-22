/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { LintController } from '../lint-controller';

describe('LintController', () => {
  it('updates badge status for valid and broken Markdown and jumps to clicked issue line', () => {
    const badgeBtn = document.createElement('button');
    const dialogEl = document.createElement('dialog');
    dialogEl.close = vi.fn();
    dialogEl.showModal = vi.fn();
    const listEl = document.createElement('div');
    const onJumpToLine = vi.fn();

    let activeContent = '# Valid Heading\n\nParagraph text.';
    const ctrl = new LintController({
      badgeBtn,
      dialogEl,
      listEl,
      getWorkspaceRoot: () => null,
      getWorkspaceFiles: vi.fn(async () => null),
      getActiveDocument: () => ({ currentContent: activeContent, path: 'C:\\Doc.md' }),
      onJumpToLine,
    });

    ctrl.updateStatus(activeContent, 'C:\\Doc.md');
    expect(badgeBtn.classList.contains('is-ok')).toBe(true);

    // Introduce an empty link warning
    activeContent = '# Heading\n\n[Broken]()';
    ctrl.openDialog();
    expect(badgeBtn.classList.contains('is-warning')).toBe(true);
    expect(dialogEl.showModal).toHaveBeenCalledTimes(1);

    const row = listEl.querySelector<HTMLButtonElement>('.lint-issue-row')!;
    expect(row).not.toBeNull();
    row.click();
    expect(dialogEl.close).toHaveBeenCalledTimes(1);
    expect(onJumpToLine).toHaveBeenCalledWith(3);
  });
});
