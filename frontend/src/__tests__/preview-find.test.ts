/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { PreviewFindController } from '../preview-find';

function createFixture() {
  const barEl = document.createElement('div');
  barEl.hidden = true;
  const inputEl = document.createElement('input');
  const countEl = document.createElement('span');
  const prevBtn = document.createElement('button');
  const nextBtn = document.createElement('button');
  const closeBtn = document.createElement('button');
  const previewContentEl = document.createElement('article');
  previewContentEl.innerHTML =
    '<p>Hello Semyra world</p><p>Second semyra match</p><svg><text>semyra-in-svg</text></svg>';

  let previewOnly = true;
  const focusEditor = vi.fn();

  const ctrl = new PreviewFindController({
    barEl,
    inputEl,
    countEl,
    prevBtn,
    nextBtn,
    closeBtn,
    previewContentEl,
    isPreviewOnlyMode: () => previewOnly,
    focusEditor,
  });

  return {
    barEl,
    inputEl,
    countEl,
    prevBtn,
    nextBtn,
    closeBtn,
    previewContentEl,
    focusEditor,
    setPreviewOnly: (val: boolean) => {
      previewOnly = val;
    },
    ctrl,
  };
}

describe('PreviewFindController', () => {
  it('highlights case-insensitive matches outside SVG/Mermaid and steps through them', () => {
    const { barEl, inputEl, countEl, nextBtn, prevBtn, previewContentEl, ctrl } = createFixture();

    ctrl.open();
    expect(barEl.hidden).toBe(false);
    expect(countEl.textContent).toBe('0/0');

    inputEl.value = 'semyra';
    inputEl.dispatchEvent(new Event('input'));

    const marks = previewContentEl.querySelectorAll('mark.preview-find-match');
    expect(marks.length).toBe(2);
    expect(marks[0].classList.contains('is-current')).toBe(true);
    expect(countEl.textContent).toBe('1/2');

    nextBtn.click();
    expect(marks[1].classList.contains('is-current')).toBe(true);
    expect(countEl.textContent).toBe('2/2');

    prevBtn.click();
    expect(marks[0].classList.contains('is-current')).toBe(true);
    expect(countEl.textContent).toBe('1/2');
  });

  it('clears highlights on close and restores focus to editor when not in preview-only mode', () => {
    const { barEl, inputEl, previewContentEl, focusEditor, setPreviewOnly, ctrl } = createFixture();
    setPreviewOnly(false);

    ctrl.open();
    inputEl.value = 'world';
    inputEl.dispatchEvent(new Event('input'));
    expect(previewContentEl.querySelectorAll('mark.preview-find-match').length).toBe(1);

    ctrl.close(true);
    expect(barEl.hidden).toBe(true);
    expect(previewContentEl.querySelectorAll('mark.preview-find-match').length).toBe(0);
    expect(focusEditor).toHaveBeenCalledTimes(1);
  });
});
