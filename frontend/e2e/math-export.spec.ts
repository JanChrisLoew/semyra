import { expect, test } from '@playwright/test';

test('renders formulas and Mermaid math labels for preview, clipboard, HTML and print', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: async ([item]: ClipboardItem[]) => {
        const html = await item.getType('text/html');
        document.body.dataset.copiedHtml = await html.text();
      } },
    });
  });
  await page.route('**/api/render', route => route.fulfill({ json: {
    html: '<p><span class="math-inline" data-math="x^2"></span></p>'
      + '<div class="mermaid-wrapper" data-mermaid="flowchart LR; A[&quot;$$y^2$$&quot;] --> B[Finish]"></div>',
    outline: [],
    stats: { words: 0, chars: 0, lines: 1, readingTimeSec: 0 },
  } }));
  await page.route('**/api/dialog/export-html', route => route.fulfill({ json: { exported: false } }));
  await page.route('**/api/dialog/pick-pdf-target', route => route.fulfill({ json: { chosen: true, token: 1 } }));
  await page.route('**/api/export-pdf', async route => {
    const print = page.locator('.print-document');
    await expect(print.locator('.math-inline math msup')).toHaveText('x2');
    await expect(print.locator('.mermaid-wrapper svg .node math msup')).toHaveText('y2');
    await route.fulfill({ json: { exported: true, path: 'formulas.pdf' } });
  });
  await page.goto('/');
  const preview = page.locator('#preview-content');
  await expect(preview.locator('.math-inline math msup')).toHaveText('x2');
  await expect(preview.locator('.mermaid-wrapper svg .node math msup')).toHaveText('y2');

  await page.locator('#btn-share-menu').click();
  await page.locator('#btn-share-copy-rich').click();
  await expect(page.locator('body')).toHaveAttribute('data-copied-html', /<math[\s>].*<msup>/s);
  const copiedHtml = await page.locator('body').getAttribute('data-copied-html');
  expect(copiedHtml).toContain('<svg');

  await page.locator('#btn-share-menu').click();
  const htmlRequest = page.waitForRequest('**/api/dialog/export-html');
  await page.locator('#btn-share-export-html').click();
  const { renderedHtml } = (await htmlRequest).postDataJSON();
  expect(renderedHtml).toMatch(/<math[\s>].*<msup>/s);
  expect(renderedHtml).toContain('<svg');
  expect(renderedHtml).toContain('<mi>y</mi>');

  await page.locator('#btn-share-menu').click();
  await page.locator('#btn-share-export-pdf').click();
  await expect(page.getByText(/formulas\.pdf/)).toBeVisible();
});
