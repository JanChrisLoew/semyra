import { expect, test, type Page } from '@playwright/test';

const workspace = 'C:\\PilotWorkspace';
const files = [
  { name: 'AGENTS.md', relPath: 'AGENTS.md', content: '# Saved instructions' },
  { name: 'NOTES.md', relPath: 'NOTES.md', content: '# Unrelated notes' },
  { name: 'PRODUCT_CONTEXT.md', relPath: 'docs/PRODUCT_CONTEXT.md', content: '# Product goals' },
  { name: 'SKILL.md', relPath: '.agents/skills/review/SKILL.md', content: '# Review skill' },
].map((file) => ({ ...file, path: `${workspace}\\${file.relPath.replaceAll('/', '\\')}` }));
const [agents, notes, productContext, skill] = files;
const editedInstructions = '# Updated instructions in the editor';

async function loadWorkspace(page: Page, initialFiles: string[]) {
  // Capture clipboard writes inside this page without using the shared OS clipboard.
  await page.addInitScript(() => {
    let clipboardText = '';
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (value: string) => { clipboardText = value; },
        readText: async () => clipboardText,
      },
    });
  });

  await page.route('**/api/**', async (route) => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint === '/api/read-file') {
      const { path } = route.request().postDataJSON();
      const file = files.find((candidate) => candidate.path === path);
      if (!file) {
        await route.fulfill({ status: 404, json: { error: 'Unknown fixture path' } });
        return;
      }
      await route.fulfill({ json: { ...file, lineEnding: 'LF', encoding: 'UTF-8', parentDir: null } });
      return;
    }

    const responses: Record<string, unknown> = {
      '/api/startup': {
        initialFiles,
        initialFolder: workspace,
        recoveredDrafts: [],
        uiPrefs: { autoSave: false, language: 'de' },
      },
      '/api/list-tree': { name: 'PilotWorkspace', path: workspace, isDir: true, isMarkdown: false, children: [] },
      '/api/workspace-files': { files: files.map(({ name, path, relPath }) => ({ name, path, relPath })) },
      '/api/render': { html: '<p>Preview</p>', outline: [], stats: { words: 1, chars: 7, lines: 1, readingTimeSec: 1 } },
    };
    await route.fulfill({ json: responses[endpoint] ?? { ok: true } });
  });

  await page.goto('/');
  await expect(page.locator('#workspace-title')).toHaveText('PilotWorkspace');
}

async function openWorkspace(page: Page) {
  await loadWorkspace(page, [agents.path, notes.path]);
  await expect(page.getByRole('tab', { name: 'NOTES.md', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'AGENTS.md', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Markdown-Editor', exact: true });
  await expect(editor).toHaveText(agents.content);
  await editor.fill(editedInstructions);
  await expect(editor).toHaveText(editedInstructions);
}

async function openWorkspaceBundle(page: Page) {
  await page.locator('#workspace-title').click({ button: 'right' });
  await page.locator('#tree-context-menu').getByRole('button', { name: 'KI-Kontext bündeln…' }).click();
  const bundle = page.getByRole('dialog', { name: 'KI-Kontext bündeln' });
  await expect(bundle).toBeVisible();
  return bundle;
}

test('bundles the selected tab and workspace files as XML from the command palette', async ({ page }) => {
  await openWorkspace(page);

  await page.keyboard.press('Control+Shift+P');
  const palette = page.getByRole('dialog', { name: 'Befehle', exact: true });
  await expect(palette).toBeVisible();
  await palette.getByRole('searchbox', { name: 'Datei oder Befehl suchen' }).fill('> KI-Kontext bündeln');
  await palette.getByRole('option', { name: 'Teilen: KI-Kontext bündeln…' }).click();

  const bundle = page.getByRole('dialog', { name: 'KI-Kontext bündeln' });
  const copy = bundle.getByRole('button', { name: 'Kontext kopieren' });
  await bundle.getByRole('button', { name: 'Keine', exact: true }).click();
  await expect(copy).toBeDisabled();
  await bundle.getByRole('checkbox', { name: /^AGENTS\.md/ }).check();
  await bundle.getByRole('checkbox', { name: /^PRODUCT_CONTEXT\.md/ }).check();
  await bundle.getByRole('checkbox', { name: /^SKILL\.md/ }).check();
  await expect(bundle.getByText(/^3 Dateien · ~/)).toBeVisible();
  await bundle.getByRole('button', { name: 'XML (<file>)' }).click();
  await copy.click();

  await expect(bundle).toBeHidden();
  await expect(page.getByText(/^3 Dateien .* als KI-Kontext kopiert$/)).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe([
    '<file path="AGENTS.md">', editedInstructions, '</file>', '',
    '<file path="docs/PRODUCT_CONTEXT.md">', productContext.content, '</file>', '',
    '<file path=".agents/skills/review/SKILL.md">', skill.content, '</file>', '',
  ].join('\n'));
});

test('bundles unopened workspace documents from the workspace context menu', async ({ page }) => {
  await loadWorkspace(page, []);
  await expect(page.getByRole('tab', { name: 'Willkommen.md', exact: true })).toBeVisible();

  const bundle = await openWorkspaceBundle(page);
  const copy = bundle.getByRole('button', { name: 'Kontext kopieren' });

  await expect(bundle.getByRole('checkbox', { name: /Willkommen\.md/ })).toHaveCount(0);
  await expect(copy).toBeDisabled();
  await bundle.getByRole('checkbox', { name: /^AGENTS\.md/ }).check();
  await bundle.getByRole('checkbox', { name: /^PRODUCT_CONTEXT\.md/ }).check();
  await bundle.getByRole('button', { name: 'XML (<file>)' }).click();
  await copy.click();

  await expect(bundle).toBeHidden();
  await expect(page.getByText(/^2 Dateien .* als KI-Kontext kopiert$/)).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe([
    '<file path="AGENTS.md">', agents.content, '</file>', '',
    '<file path="docs/PRODUCT_CONTEXT.md">', productContext.content, '</file>', '',
  ].join('\n'));
});

test('retries a failed workspace listing inside the bundle dialog', async ({ page }) => {
  await loadWorkspace(page, []);
  await expect(page.getByRole('tab', { name: 'Willkommen.md', exact: true })).toBeVisible();
  await page.route('**/api/workspace-files', (route) => route.fulfill({
    status: 500, json: { error: 'Test listing failure' },
  }), { times: 1 });
  const bundle = await openWorkspaceBundle(page);
  await expect(bundle.getByRole('alert')).toHaveText('Die Dateien aus dem Arbeitsordner konnten nicht geladen werden.');
  await expect(bundle.getByText('Keine Dateien zum Bündeln verfügbar.')).toHaveCount(0);

  await bundle.getByRole('button', { name: 'Erneut laden' }).click();
  await expect(bundle.getByRole('checkbox', { name: /^AGENTS\.md/ })).toBeVisible();
  await expect(bundle.getByRole('alert')).toHaveCount(0);
});

test('preserves selection after a clipboard error and copies on retry', async ({ page }) => {
  await loadWorkspace(page, []);
  await expect(page.getByRole('tab', { name: 'Willkommen.md', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const writeText = navigator.clipboard.writeText;
    let attempts = 0;
    navigator.clipboard.writeText = async (text) => {
      if (++attempts === 1) throw new Error('Test clipboard unavailable');
      await writeText(text);
    };
  });
  const bundle = await openWorkspaceBundle(page);
  const selected = bundle.getByRole('checkbox', { name: /^AGENTS\.md/ });
  const copy = bundle.getByRole('button', { name: 'Kontext kopieren' });
  await selected.check();
  await copy.click();
  await expect(bundle.getByRole('alert')).toContainText('konnte nicht in die Zwischenablage kopiert werden');
  await expect(selected).toBeChecked();

  await copy.click();
  await expect(bundle).toBeHidden();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(agents.content);
});

test('reports unreadable selected files and leaves the selection available for retry', async ({ page }) => {
  await loadWorkspace(page, []);
  let readable = false;
  await page.route('**/api/read-file', async (route) => {
    if (readable) await route.fallback();
    else await route.fulfill({ status: 500, json: { error: 'Test file unavailable' } });
  });
  const bundle = await openWorkspaceBundle(page);
  const selected = bundle.getByRole('checkbox', { name: /^AGENTS\.md/ });
  const copy = bundle.getByRole('button', { name: 'Kontext kopieren' });
  await selected.check();
  await copy.click();
  await expect(bundle.getByRole('alert')).toContainText('Eine ausgewählte Datei konnte nicht gelesen werden');
  await expect(selected).toBeChecked();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('');

  readable = true;
  await copy.click();
  await expect(bundle).toBeHidden();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(agents.content);
});

test('keeps the bundle open after a canceled or failed save', async ({ page }) => {
  await loadWorkspace(page, []);
  let attempts = 0;
  await page.route('**/api/dialog/save-file', (route) => {
    switch (++attempts) {
      case 1: return route.fulfill({ json: { saved: false } });
      case 2: return route.fulfill({ status: 500, json: { error: 'Test write failure' } });
      default: return route.fulfill({ json: { saved: true, path: workspace + '\\ai-context.md' } });
    }
  });
  const bundle = await openWorkspaceBundle(page);
  const selected = bundle.getByRole('checkbox', { name: /^AGENTS\.md/ });
  const save = bundle.getByRole('button', { name: 'Als Datei speichern' });
  await selected.check();
  await save.click();
  await expect.poll(() => attempts).toBe(1);
  await expect(save).toBeEnabled();
  await expect(selected).toBeChecked();
  await expect(bundle.getByRole('alert')).toHaveCount(0);

  await save.click();
  await expect(bundle.getByRole('alert')).toContainText('Der KI-Kontext konnte nicht gespeichert werden');
  await save.click();
  await expect(bundle).toBeHidden();
  await expect(page.getByText('KI-Kontext-Bündel gespeichert: ai-context.md')).toBeVisible();
});

test('Control+Shift+A copies only the active tab as Markdown context', async ({ page }) => {
  await openWorkspace(page);

  await page.keyboard.press('Control+Shift+A');

  await expect(page.getByText('Als KI-Kontext (AGENTS.md) kopiert')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'KI-Kontext bündeln' })).toBeHidden();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `\`\`\`md:AGENTS.md\n${editedInstructions}\n\`\`\`\n`,
  );
});
