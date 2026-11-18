import { expect, test } from '@playwright/test';

const root = 'C:\\Notes';
const outside = 'C:\\Notes-Other\\Open.md';
const entry = { name: 'Fresh.md', relPath: 'Fresh.md', path: root + '\\Fresh.md' };

for (const changedPath of [outside, root + '\\Edited.md']) {
  const changedInWorkspace = changedPath !== outside;
  test(`quick open completes after an edit ${changedInWorkspace ? 'inside' : 'outside'} the workspace`, async ({ page }) => {
    let indexCalls = 0;
    let releaseIndex: (() => void) | undefined;
    await page.route('**/api/**', async (route) => {
      const endpoint = new URL(route.request().url()).pathname;
      if (endpoint === '/api/workspace-files') {
        const call = ++indexCalls;
        if (call === 1) {
          await route.fulfill({ status: 500, json: { error: 'Index unavailable at startup' } });
          return;
        }
        if (call === 2) await new Promise<void>((resolve) => { releaseIndex = resolve; });
        const stale = { name: 'Stale.md', relPath: 'Stale.md', path: root + '\\Stale.md' };
        await route.fulfill({ json: { files: [call === 2 && changedInWorkspace ? stale : entry] } });
        return;
      }
      const responses: Record<string, unknown> = {
        '/api/startup': {
          initialFolder: root, initialFiles: [outside], recoveredDrafts: [], uiPrefs: { language: 'de' },
        },
        '/api/list-tree': { path: root, name: 'Notes', isDir: true, children: [] },
        '/api/read-file': {
          path: outside, name: 'Open.md', parentDir: 'C:\\Notes-Other', content: '# Other',
          lineEnding: 'LF', encoding: 'UTF-8',
        },
        '/api/render': { html: '', outline: [], stats: { words: 0, chars: 0, lines: 0, readingTimeSec: 0 } },
      };
      await route.fulfill({ json: responses[endpoint] ?? { ok: true } });
    });

    const startupIndex = page.waitForResponse('**/api/workspace-files');
    await page.goto('/');
    await startupIndex;
    await expect(page.getByRole('tab', { name: 'Open.md', exact: true })).toBeVisible();
    await page.keyboard.press('Control+e');
    const palette = page.locator('#palette-dialog');
    await expect(palette).toBeVisible();
    await expect.poll(() => Boolean(releaseIndex)).toBe(true);

    await page.evaluate((path) => window.__semyraReceive?.('fs-changed', { paths: [path] }), changedPath);
    releaseIndex!();
    await expect(palette.getByRole('option', { name: /Fresh\.md/ })).toBeVisible();
    await expect(palette.getByRole('option', { name: /Stale\.md/ })).toHaveCount(0);
    if (changedInWorkspace) expect(indexCalls).toBeGreaterThanOrEqual(3);
    else expect(indexCalls).toBe(2);
  });
}
