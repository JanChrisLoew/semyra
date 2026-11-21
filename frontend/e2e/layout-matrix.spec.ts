import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Semyra Layout & Split Matrix', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the app shell and codemirror to be ready
    await page.waitForSelector('#app');
    await page.waitForSelector('.cm-editor');
  });

  test('3 View Modes × 2 Orientations Matrix guards against layout bugs', async ({ page }) => {
    const app = page.locator('#app');
    const editorPane = page.locator('#editor-pane');
    const previewPane = page.locator('#preview-pane');
    const splitResizer = page.locator('#split-resizer');
    const splitContainer = page.locator('#split-container');

    // 1. Initial default: Split View (vertical)
    await expect(app).toHaveAttribute('data-view', 'split');
    await expect(editorPane).toBeVisible();
    await expect(previewPane).toBeVisible();
    await expect(splitResizer).toBeVisible();

    const containerBox = await splitContainer.boundingBox();
    expect(containerBox).not.toBeNull();

    // 2. Switch to Horizontal Split (Alt+Shift+S)
    await page.keyboard.press('Alt+Shift+S');
    await expect(splitContainer).toHaveAttribute('data-orientation', 'horizontal');

    const editorBoxHoriz = await editorPane.boundingBox();
    const previewBoxHoriz = await previewPane.boundingBox();
    expect(editorBoxHoriz).not.toBeNull();
    expect(previewBoxHoriz).not.toBeNull();
    // In horizontal split, editor is above preview
    expect(editorBoxHoriz!.y + editorBoxHoriz!.height).toBeLessThanOrEqual(previewBoxHoriz!.y + 10);

    // 3. Switch to Editor-Only View from Horizontal Split (Regression check!)
    const btnViewEditor = page.locator('[data-set-view="editor"]');
    await btnViewEditor.click();
    await expect(app).toHaveAttribute('data-view', 'editor');

    await expect(previewPane).toBeHidden();
    await expect(splitResizer).toBeHidden();

    // The editor MUST now expand to full height and width, NOT stuck with previous split height
    const editorBoxFull = await editorPane.boundingBox();
    expect(editorBoxFull).not.toBeNull();
    expect(editorBoxFull!.height).toBeGreaterThanOrEqual(containerBox!.height - 10);
    expect(editorBoxFull!.width).toBeGreaterThanOrEqual(containerBox!.width - 10);

    // 4. Centered text column toggle in editor view (Alt+Shift+B)
    await page.keyboard.press('Alt+Shift+B');
    await expect(app).toHaveAttribute('data-editor-width', 'centered');

    // Toggle back to full width
    await page.keyboard.press('Alt+Shift+B');
    await expect(app).toHaveAttribute('data-editor-width', 'full');

    // 5. Switch to Reading View (Preview only)
    const btnViewPreview = page.locator('[data-set-view="preview"]');
    await btnViewPreview.click();
    await expect(app).toHaveAttribute('data-view', 'preview');
    await expect(editorPane).toBeHidden();
    await expect(previewPane).toBeVisible();

    const previewBoxFull = await previewPane.boundingBox();
    expect(previewBoxFull).not.toBeNull();
    expect(previewBoxFull!.width).toBeGreaterThanOrEqual(containerBox!.width - 10);

    // 6. Return to Split View and toggle back to Vertical
    const btnViewSplit = page.locator('[data-set-view="split"]');
    await btnViewSplit.click();
    await expect(app).toHaveAttribute('data-view', 'split');
    await page.keyboard.press('Alt+Shift+S');
    await expect(splitContainer).toHaveAttribute('data-orientation', 'vertical');

    const editorBoxVert = await editorPane.boundingBox();
    const previewBoxVert = await previewPane.boundingBox();
    expect(editorBoxVert).not.toBeNull();
    expect(previewBoxVert).not.toBeNull();
    // In vertical split, editor is left of preview
    expect(editorBoxVert!.x + editorBoxVert!.width).toBeLessThanOrEqual(previewBoxVert!.x + 10);
  });

  test('Sidebar toggle and keyboard navigation', async ({ page }) => {
    const sidebar = page.locator('#sidebar');
    const toggleBtn = page.locator('#btn-toggle-sidebar');
    const sidebarResizer = page.locator('#sidebar-resizer');

    await expect(sidebar).toBeVisible();
    await expect(sidebarResizer).toBeVisible();

    // Toggle sidebar collapsed
    await toggleBtn.click();
    await expect(sidebar).toHaveClass(/is-collapsed/);
    await expect(sidebarResizer).toBeHidden();

    // Toggle back
    await toggleBtn.click();
    await expect(sidebar).not.toHaveClass(/is-collapsed/);
    await expect(sidebarResizer).toBeVisible();
  });

  test('View Menu popover and Settings Dialog (Strg+,)', async ({ page }) => {
    const btnViewMenu = page.locator('#btn-view-menu');
    const viewPopover = page.locator('#view-popover');
    const btnSettings = page.locator('#btn-settings');
    const settingsDialog = page.locator('#settings-dialog');

    // 1. View Menu dropdown toggle
    await expect(btnViewMenu).toBeVisible();
    await btnViewMenu.click();
    await expect(viewPopover).toBeVisible();

    // Close by clicking elsewhere or hitting Escape
    await page.keyboard.press('Escape');
    await expect(viewPopover).toBeHidden();

    // 2. Open Settings Dialog via Toolbar button
    await expect(btnSettings).toBeVisible();
    await btnSettings.click();
    await expect(settingsDialog).toBeVisible();

    // Close via Escape
    await page.keyboard.press('Escape');
    await expect(settingsDialog).toBeHidden();

    // 3. Open Settings Dialog via Keyboard shortcut (Strg+,)
    await page.keyboard.press('Control+,');
    await expect(settingsDialog).toBeVisible();

    // Verify presence of setting groups and close via 'Fertig' button
    const themeSegmented = page.locator('.settings-segmented').first();
    await expect(themeSegmented).toBeVisible();

    const doneBtn = settingsDialog.locator('.settings-primary-btn');
    await doneBtn.click();
    await expect(settingsDialog).toBeHidden();
  });

  test('Language toggle reactively switches UI between German and English', async ({ page }) => {
    // 1. Initial language is German
    const viewBtn = page.locator('#btn-view-menu');
    await expect(viewBtn).toContainText('Ansicht');
    const shareBtn = page.locator('#btn-share-menu');
    await expect(shareBtn).toContainText('Teilen');

    // 2. Open Settings Dialog
    const btnSettings = page.locator('#btn-settings');
    await btnSettings.click();
    const settingsDialog = page.locator('#settings-dialog');
    await expect(settingsDialog).toBeVisible();

    // 3. Click English segmented button
    const btnEn = settingsDialog.locator('[data-lang-choice="en"]');
    await expect(btnEn).toBeVisible();
    await btnEn.click();

    // 4. Verify Settings dialog UI immediately updates to English
    const settingsTitle = settingsDialog.locator('#settings-dialog-title');
    await expect(settingsTitle).toHaveText('Settings');
    await expect(settingsDialog.locator('[data-lang-choice="de"]')).toHaveText('German');
    await expect(settingsDialog.locator('[data-lang-choice="en"]')).toHaveText('English');
    const doneBtn = settingsDialog.locator('.settings-primary-btn');
    await expect(doneBtn).toHaveText('Done');

    // Close settings
    await doneBtn.click();
    await expect(settingsDialog).toBeHidden();

    // 5. Verify Toolbar & Popovers update to English
    await expect(viewBtn).toContainText('View');
    await expect(shareBtn).toContainText('Share');

    // Verify keyboard shortcuts in menus are translated to English (e.g. Shift instead of Umschalt)
    await viewBtn.click();
    const syncScrollKbd = page.locator('#menu-toggle-sync-scroll .menu-item-shortcut');
    await expect(syncScrollKbd).toHaveText('Alt+Shift+Y');
    await page.keyboard.press('Escape');

    // Verify documentElement lang is en
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    // 6. Switch back to German
    await btnSettings.click();
    const btnDe = settingsDialog.locator('[data-lang-choice="de"]');
    await btnDe.click();
    await expect(settingsTitle).toHaveText('Einstellungen');
    await expect(settingsDialog.locator('[data-lang-choice="de"]')).toHaveText('Deutsch');
    await expect(settingsDialog.locator('[data-lang-choice="en"]')).toHaveText('Englisch');
    await expect(doneBtn).toHaveText('Fertig');
    await doneBtn.click();

    await expect(viewBtn).toContainText('Ansicht');
    await expect(shareBtn).toContainText('Teilen');

    // Verify keyboard shortcuts restore German naming (Alt+Umschalt+Y)
    await viewBtn.click();
    await expect(syncScrollKbd).toHaveText('Alt+Umschalt+Y');
    await page.keyboard.press('Escape');

    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  });

  test('Zen mode maintains view mode and respects full vs centered setting', async ({ page }) => {
    const app = page.locator('#app');

    // 1. Enter Zen mode via F11
    await page.keyboard.press('F11');
    await expect(app).toHaveClass(/is-zen/);

    // Initial width setting is 'full'
    await expect(app).toHaveAttribute('data-editor-width', 'full');

    // 2. Toggle to centered width (Alt+Shift+B)
    await page.keyboard.press('Alt+Shift+B');
    await expect(app).toHaveAttribute('data-editor-width', 'centered');

    // 3. Toggle back to full width
    await page.keyboard.press('Alt+Shift+B');
    await expect(app).toHaveAttribute('data-editor-width', 'full');

    // 4. Exit Zen mode via Escape
    await page.keyboard.press('Escape');
    await expect(app).not.toHaveClass(/is-zen/);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`Text contrast in the ${theme} workspace and settings`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      for (const view of ['workspace', 'settings']) {
        if (view === 'settings') {
          await page.locator('#btn-settings').click();
          await expect(page.locator('#settings-dialog')).toBeVisible();
        }
        const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
        const failures = result.violations.flatMap(v => v.nodes.map(n => [n.target, n.failureSummary]));
        expect.soft(failures, `${theme} ${view}`).toEqual([]);
      }
    });
  }

  test('Automated Accessibility Audit (axe-core)', async ({ page }) => {
    // Run axe accessibility audit on the active UI shell
    const results = await new AxeBuilder({ page })
      .disableRules(['scrollable-region-focusable'])
      .analyze();

    const criticalViolations = results.violations.filter(
      (v) =>
        (v.impact === 'critical' || v.impact === 'serious') &&
        // Ignore aria-required-children on #tab-bar caused by companion close buttons mandated by AGENTS.md
        !(v.id === 'aria-required-children' && v.nodes.some((n) => JSON.stringify(n.target).includes('tab-bar'))),
    );

    if (criticalViolations.length > 0) {
      console.error('Accessibility violations:', JSON.stringify(criticalViolations, null, 2));
    }
    expect(criticalViolations).toHaveLength(0);
  });
});
