import { expect, test } from '@playwright/test';

const diagram = 'flowchart LR\n  A[Start] --> B[Inspect the document] --> C[Finish]';

test('Mermaid opens from the preview and scales as an SVG beyond the fitted size', async ({ page }) => {
  await page.route('**/api/render', (route) => route.fulfill({
    json: {
      html: `<div class="mermaid-wrapper" data-line="1" data-mermaid="${diagram}"></div>`,
      outline: [],
      stats: { words: 0, chars: 0, lines: 1, readingTimeSec: 0 },
    },
  }));
  await page.goto('/');
  const preview = page.locator('#preview-content .mermaid-wrapper');
  const source = preview.locator(':scope > svg');
  await expect(source).toBeVisible();
  const originalSize = await source.boundingBox();
  await source.locator('.node').first().click();
  const dialog = page.locator('#mermaid-dialog');
  const zoomed = dialog.locator('.mermaid-dialog-stage > svg');
  await expect(dialog).toBeVisible();
  await expect.poll(async () => (await zoomed.boundingBox())!.width)
    .toBeGreaterThan(originalSize!.width);
  const dialogSize = (await dialog.boundingBox())!;
  const windowSize = page.viewportSize()!;
  expect(dialogSize.width).toBeCloseTo(windowSize.width * 0.84, 0);
  expect(dialogSize.height).toBeCloseTo(windowSize.height * 0.72, 0);
  await expect(zoomed).toHaveAttribute('viewBox', (await source.getAttribute('viewBox'))!);

  await dialog.getByRole('button', { name: 'Diagramm vergrößern' }).click();
  await expect(dialog.locator('output')).toHaveText('125%');
  const viewport = dialog.locator('#mermaid-dialog-body');
  await expect.poll(() => viewport.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  const zoomIn = dialog.getByRole('button', { name: 'Diagramm vergrößern' });
  for (let step = 0; step < 4; step++) await zoomIn.click();
  await expect(dialog.locator('output')).toHaveText('400%');
  await expect.poll(() => viewport.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  const bounds = (await viewport.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await expect(viewport).toHaveClass(/is-panning/);
  await page.mouse.move(bounds.x - 10, bounds.y - 10, { steps: 4 });
  await page.mouse.up();
  await expect(viewport).not.toHaveClass(/is-panning/);
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft > 0 && el.scrollTop > 0)).toBe(true);
  // The same viewport remains scrollable with the keyboard.
  await viewport.focus();
  const leftBeforeArrow = await viewport.evaluate(el => el.scrollLeft);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeLessThan(leftBeforeArrow);
  await dialog.getByRole('button', { name: 'Einpassen' }).click();
  await expect(dialog.locator('output')).toHaveText('100%');
  await expect.poll(() => viewport.evaluate(el => el.scrollWidth === el.clientWidth)).toBe(true);
  await expect(viewport).not.toHaveClass(/can-pan/);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Lesen', exact: true }).click();
  // The existing control is also available to keyboard users.
  const openButton = preview.getByRole('button', { name: 'Vergrößern' });
  await openButton.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('output')).toHaveText('100%');
});
