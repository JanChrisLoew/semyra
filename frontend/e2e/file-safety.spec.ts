import { expect, test, type Page } from '@playwright/test';

const path = 'C:\\Notes\\Draft.md';

async function openDraft(page: Page, autoSave = false) {
  let disk = 'Original';
  await page.route('**/api/**', async (route) => {
    const endpoint = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      '/api/startup': {
        initialFiles: [path],
        recoveredDrafts: [],
        uiPrefs: { autoSave, syncScroll: true, wordWrap: true, language: 'de' },
      },
      '/api/read-file': {
        path, content: disk, name: 'Draft.md', lineEnding: 'LF', encoding: 'UTF-8',
      },
      '/api/render': {
        html: '<p>Preview</p>',
        outline: [],
        stats: { words: 1, chars: 8, lines: 1, readingTimeSec: 1 },
      },
    };
    await route.fulfill({ json: responses[endpoint] ?? { ok: true } });
  });
  await page.goto('/');
  const editor = page.locator('.cm-content');
  await expect(editor).toHaveText(disk);
  return { editor, setDisk: (value: string) => { disk = value; } };
}

test('edits made while a save is in flight remain unsaved', async ({ page }) => {
  const { editor, setDisk } = await openDraft(page);
  let finishSave!: () => void;
  let sentContent = '';
  let expectedContent = '';
  let savedDrafts: unknown;
  await page.route('**/api/drafts/save', async (route) => {
    savedDrafts = route.request().postDataJSON().entries;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/write-file', async (route) => {
    ({ content: sentContent, expectedContent } = route.request().postDataJSON());
    await new Promise<void>((resolve) => { finishSave = resolve; });
    setDisk(sentContent);
    await route.fulfill({ json: { saved: true } });
  });
  await editor.fill('First version');
  await page.locator('#btn-save').click();
  await expect.poll(() => sentContent).toBe('First version');
  expect(expectedContent).toBe('Original');
  await editor.press('Control+a');
  await page.keyboard.insertText('Second version');
  await expect(editor).toHaveText('Second version');
  const response = page.waitForResponse('**/api/write-file');
  finishSave();
  await response;
  await expect.poll(() => savedDrafts).toMatchObject([{
    content: 'Second version',
    savedContent: 'First version',
  }]);
  await expect(page.locator('#status-save-badge')).toHaveClass(/is-dirty/);
});

test('an external change cancels an already scheduled auto-save', async ({ page }) => {
  const { editor, setDisk } = await openDraft(page, true);
  let writes = 0;
  await page.route('**/api/write-file', async (route) => {
    writes++;
    await route.fulfill({ json: { saved: false } });
  });
  await page.clock.install();
  await editor.fill('Local changes');
  setDisk('External changes');
  await page.evaluate((path) => window.__semyraReceive?.('fs-changed', { paths: [path] }), path);
  await expect(page.locator('#external-banner')).toBeVisible();
  await page.clock.fastForward(1500);
  await expect(editor).toHaveText('Local changes');
  expect(writes).toBe(0);
});

test('a workspace watch event disables replace until fresh matches arrive', async ({ page }) => {
  const root = 'C:\\Notes';
  await page.route('**/api/**', async (route) => {
    const endpoint = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      '/api/startup': {
        initialFiles: [],
        initialFolder: root,
        recoveredDrafts: [],
        uiPrefs: { language: 'de' },
      },
      '/api/list-tree': { path: root, name: 'Notes', isDir: true },
      '/api/render': { html: '', outline: [], stats: { words: 0, chars: 0, lines: 0, readingTimeSec: 0 } },
    };
    await route.fulfill({ json: responses[endpoint] ?? { ok: true } });
  });
  let searches = 0;
  let finishSearch!: () => void;
  await page.route('**/api/search-workspace', async (route) => {
    const version = ++searches;
    if (version > 1) await new Promise<void>((resolve) => { finishSearch = resolve; });
    await route.fulfill({ json: { results: [{
      path, name: 'Draft.md', relPath: 'Draft.md', contentVersion: `version-${version}`,
      matches: [{ line: 1, column: 1, preview: `needle version ${version}` }],
    }] } });
  });

  await page.goto('/');
  await expect(page.locator('#workspace-title')).toHaveText('Notes');
  await page.locator('#sidebar-tab-search').click();
  await page.locator('#workspace-search-input').fill('needle');
  const replace = page.locator('#btn-workspace-replace-all');
  await expect(page.getByText('needle version 1')).toBeVisible();
  await expect(replace).toBeEnabled();

  await page.evaluate((filePath) => window.__semyraReceive?.('fs-changed', { paths: [filePath] }), path);
  await expect(replace).toBeDisabled();
  await expect(page.getByText('needle version 1')).toBeHidden();
  await expect.poll(() => searches).toBe(2);
  finishSearch();
  await expect(page.getByText('needle version 2')).toBeVisible();
  await expect(replace).toBeEnabled();
});

test('pinning a dirty tab preserves its scheduled auto-save', async ({ page }) => {
  const { editor, setDisk } = await openDraft(page, true);
  const writes: string[] = [];
  await page.route('**/api/write-file', async (route) => {
    const { content } = route.request().postDataJSON();
    writes.push(content);
    setDisk(content);
    await route.fulfill({ json: { saved: true } });
  });
  await page.clock.install();
  await editor.fill('Local changes');

  const tab = page.getByRole('tab', { name: /^Draft\.md/ });
  await tab.click({ button: 'right' });
  await page.getByRole('button', { name: 'Tab anheften', exact: true }).click();
  await expect(page.locator('.tab-slot.is-pinned').getByRole('tab')).toHaveCount(1);
  await page.clock.fastForward(1500);

  await expect.poll(() => writes).toEqual(['Local changes']);
  await expect(page.locator('#status-save-badge')).not.toHaveClass(/is-dirty/);
});

test('cancelling tab close resumes auto-save', async ({ page }) => {
  const { editor } = await openDraft(page, true);
  await page.route('**/api/write-file', (route) => route.fulfill({ json: { saved: true } }));
  await page.clock.install();
  await editor.fill('Local changes');
  await page.getByRole('button', { name: 'Draft.md schließen' }).click();
  const dialog = page.locator('#unsaved-dialog');
  await dialog.locator('button[value="cancel"]').click();
  await expect(dialog).toBeHidden();
  const write = page.waitForRequest('**/api/write-file');
  await page.clock.fastForward(1500);
  expect((await write).postDataJSON().content).toBe('Local changes');
});

test('discard confirmation does not include later edits', async ({ page }) => {
  const startupPrefs = page.waitForResponse('**/api/prefs/save');
  const { editor } = await openDraft(page);
  await startupPrefs;
  let finishPrefs: (() => void) | undefined;
  await page.route('**/api/prefs/save', async (route) => {
    await new Promise<void>((resolve) => { finishPrefs = resolve; });
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/window/force-close', async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
  await editor.fill('Discard this');
  await page.evaluate(() => window.__semyraReceive?.('close-requested', {}));
  const discard = page.locator('#unsaved-dialog button[value="discard"]');
  await discard.click();
  await expect.poll(() => Boolean(finishPrefs)).toBe(true);
  await editor.press('Control+a');
  await page.keyboard.insertText('Keep this newer edit');
  await expect(editor).toHaveText('Keep this newer edit');
  const prefs = page.waitForResponse('**/api/prefs/save');
  finishPrefs!();
  await prefs;
  // The first close attempt must complete without closing, and a new one must ask again.
  await expect.poll(async () => {
    await page.evaluate(() => window.__semyraReceive?.('close-requested', {}));
    return discard.isVisible();
  }).toBe(true);
  await page.locator('#unsaved-dialog button[value="cancel"]').click();
  await expect(editor).toBeEditable();
  await expect(page.locator('#status-save-badge')).toHaveClass(/is-dirty/);
});

test('a failed settings write can be retried before closing the window', async ({ page }) => {
  await openDraft(page);
  await page.route('**/api/prefs/save', (route) => route.fulfill({
    status: 500, json: { error: 'Einstellungen konnten nicht gespeichert werden.' },
  }));
  await page.route('**/api/window/force-close', (route) => route.fulfill({ json: { ok: true } }));
  const warning = page.waitForEvent('dialog');
  await page.evaluate(() => window.__semyraReceive?.('close-requested', {}));
  const dialog = await warning;
  expect(dialog.message()).toContain('Einstellungen konnten nicht gespeichert werden');
  await dialog.dismiss();
  await expect(page.locator('.cm-content')).toBeEditable();

  await page.route('**/api/prefs/save', (route) => route.fulfill({ json: { ok: true } }));
  const close = page.waitForRequest('**/api/window/force-close');
  await page.evaluate(() => window.__semyraReceive?.('close-requested', {}));
  await close;
});

test('HTML export uses the original document after switching tabs', async ({ page }) => {
  await openDraft(page);
  let finishRender: (() => void) | undefined;
  await page.route('**/api/render', async (route) => {
    const { markdown } = route.request().postDataJSON();
    const original = markdown === 'Original';
    if (original) await new Promise<void>((resolve) => { finishRender = resolve; });
    await route.fulfill({
      json: {
        html: original ? '<p>Source document</p>' : '<p>Other document</p>',
        outline: [],
        stats: { words: 2, chars: 15, lines: 1, readingTimeSec: 1 },
      },
    });
  });
  await page.route('**/api/dialog/export-html', (route) => route.fulfill({ json: { exported: false } }));
  await page.locator('#btn-share-menu').click();
  await page.locator('#btn-share-export-html').click();
  await expect.poll(() => Boolean(finishRender)).toBe(true);
  await page.keyboard.press('Control+n');
  await expect(page.locator('#preview-content')).toHaveText('Other document');
  const exportRequest = page.waitForRequest('**/api/dialog/export-html');
  finishRender!();
  expect((await exportRequest).postDataJSON()).toMatchObject({
    title: 'Draft.md', markdown: 'Original', renderedHtml: '<p>Source document</p>',
  });
  await expect(page.locator('#preview-content')).toHaveText('Other document');
});

test('a watch event after saving still reloads a changed disk version', async ({ page }) => {
  const { editor, setDisk } = await openDraft(page);
  await page.route('**/api/write-file', async (route) => {
    setDisk(route.request().postDataJSON().content);
    await route.fulfill({ json: { saved: true } });
  });
  await editor.fill('Saved version');
  await page.locator('#btn-save').click();
  await expect(page.locator('#status-save-badge')).not.toHaveClass(/is-dirty/);
  setDisk('External version');
  await page.evaluate((filePath) => window.__semyraReceive?.('fs-changed', { paths: [filePath] }), path);
  await expect(editor).toHaveText('External version');
  await expect(page.locator('#status-save-badge')).not.toHaveClass(/is-dirty/);
});

test('PDF export keeps the selected document in the print layout after a tab switch', async ({ page }) => {
  await openDraft(page);
  let finishPicker: (() => void) | undefined;
  let finishPdf: (() => void) | undefined;
  await page.route('**/api/render', (route) => route.fulfill({
    json: {
      html: route.request().postDataJSON().markdown === 'Original'
        ? '<p>Source document</p>' : '<p>Other document</p>',
      outline: [],
      stats: { words: 2, chars: 15, lines: 1, readingTimeSec: 1 },
    },
  }));
  await page.route('**/api/dialog/pick-pdf-target', async (route) => {
    await new Promise<void>((resolve) => { finishPicker = resolve; });
    await route.fulfill({ json: { chosen: true, token: 1 } });
  });
  await page.route('**/api/export-pdf', async (route) => {
    await new Promise<void>((resolve) => { finishPdf = resolve; });
    await route.fulfill({ json: { exported: true, path: 'Draft.pdf' } });
  });

  await page.locator('#btn-share-menu').click();
  await page.locator('#btn-share-export-pdf').click();
  await expect.poll(() => Boolean(finishPicker)).toBe(true);
  await page.keyboard.press('Control+n');
  const livePreview = page.locator('#preview-content');
  await expect(livePreview).toHaveText('Other document');
  finishPicker!();
  await expect.poll(() => Boolean(finishPdf)).toBe(true);
  const printDocument = page.locator('.print-document');
  await expect(printDocument).toBeHidden();
  await page.emulateMedia({ media: 'print' });
  await expect(livePreview).toBeHidden();
  await expect(printDocument).toBeVisible();
  await expect(printDocument).toHaveText('Source document');
  finishPdf!();
  await expect(printDocument).toHaveCount(0);
});
