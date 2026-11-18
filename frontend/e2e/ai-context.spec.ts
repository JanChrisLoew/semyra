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

async function openWorkspace(page: Page) {
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
        initialFiles: [agents.path, notes.path],
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
  await expect(page.getByRole('tab', { name: 'NOTES.md', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'AGENTS.md', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Markdown-Editor', exact: true });
  await expect(editor).toHaveText(agents.content);
  await editor.fill(editedInstructions);
  await expect(editor).toHaveText(editedInstructions);
}

test('bundles the selected tab and workspace files as XML from the command palette', async ({ page }) => {
  await openWorkspace(page);

  await page.keyboard.press('Control+Shift+P');
  const palette = page.getByRole('dialog', { name: 'Befehle', exact: true });
  await expect(palette).toBeVisible();
  await palette.getByRole('searchbox', { name: 'Datei oder Befehl suchen' }).fill('> KI bündeln');
  await palette.getByRole('option', { name: 'Teilen: Mehrere Tabs für KI bündeln…' }).click();

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

test('Control+Shift+A copies only the active tab as Markdown context', async ({ page }) => {
  await openWorkspace(page);

  await page.keyboard.press('Control+Shift+A');

  await expect(page.getByText('Als KI-Kontext (AGENTS.md) kopiert')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'KI-Kontext bündeln' })).toBeHidden();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `\`\`\`md:AGENTS.md\n${editedInstructions}\n\`\`\`\n`,
  );
});
