import { describe, expect, it } from 'vitest';
import css from '../styles/editor.css?raw';
import chromeCss from '../styles/chrome.css?raw';
import sidebarCss from '../styles/sidebar.css?raw';

/**
 * jsdom performs no layout, so these tests guard the CSS contract that fixed the
 * view-mode / split-orientation bugs (capped editor width, stale split height).
 */

function ruleBody(stylesheet: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(stylesheet);
  expect(match, `rule not found: ${selector}`).not.toBeNull();
  return match![1];
}

describe('view mode × split orientation CSS contract', () => {
  it('editor-only view fills the full width without a cap', () => {
    const body = ruleBody(css, '.app-shell[data-view="editor"] .editor-pane');
    expect(body).toContain('max-width: none');
    expect(body).toContain('flex: 1 1 auto');
    expect(body).not.toMatch(/margin:\s*0 auto/);
  });

  it('preview views do not cap the document width', () => {
    expect(ruleBody(css, '.app-shell[data-view="preview"] .markdown-body')).toContain('max-width: none');
    expect(ruleBody(css, '.app-shell[data-view="split"] .markdown-body')).toContain('max-width: none');
  });

  it('split panes are sized via flex so orientation switches cannot overflow', () => {
    expect(ruleBody(css, '.editor-pane')).toContain('flex: 0 1 var(--split-ratio)');
    expect(ruleBody(css, '.preview-pane')).toContain('flex: 1 1 0');
    const horizEditor = ruleBody(css, '.split-container[data-orientation="horizontal"] .editor-pane');
    const horizPreview = ruleBody(css, '.split-container[data-orientation="horizontal"] .preview-pane');
    expect(horizEditor).not.toMatch(/(^|[\s;])height:/);
    expect(horizPreview).not.toMatch(/(^|[\s;])height:/);
  });

  it('editor-only view rule comes after the orientation rules so it wins', () => {
    const horizontal = css.indexOf('.split-container[data-orientation="horizontal"] .editor-pane');
    const editorOnly = css.indexOf('.app-shell[data-view="editor"] .editor-pane');
    expect(editorOnly).toBeGreaterThan(horizontal);
  });

  it('centered text column only applies to the editor-only view', () => {
    const body = ruleBody(css, '.app-shell[data-view="editor"][data-editor-width="centered"] .codemirror-host .cm-content');
    expect(body).toContain('max-width: 100ch');
    expect(body).toContain('margin-inline: auto');
  });

  it('zen mode and preview mode default to full width when centering is inactive', () => {
    expect(ruleBody(css, '.app-shell.is-zen .codemirror-host .cm-content')).toContain('max-width: none');
    expect(ruleBody(css, '.app-shell[data-view="preview"] .markdown-body')).toContain('max-width: none');
  });

  it('centering in zen mode and preview mode only applies with [data-editor-width="centered"]', () => {
    expect(ruleBody(css, '.app-shell.is-zen[data-editor-width="centered"] .codemirror-host .cm-content')).toContain('max-width: 84ch');
    expect(ruleBody(css, '.app-shell[data-view="preview"][data-editor-width="centered"] .markdown-body')).toContain('max-width: 880px');
  });

  it('resizers enforce touch-action: none to prevent scroll contention', () => {
    expect(ruleBody(css, '.split-resizer')).toContain('touch-action: none');
    expect(ruleBody(sidebarCss, '.sidebar-resizer')).toContain('touch-action: none');
  });

  it('small buttons include invisible pseudo-element target extensions (WCAG 2.5.8)', () => {
    expect(chromeCss).toContain('.tab-close-btn::before');
    expect(sidebarCss).toContain('.mini-icon-btn::before');
    expect(sidebarCss).toContain('.recent-remove-btn::before');
    expect(sidebarCss).toContain('.search-clear-btn::before');
  });

  it('high contrast / forced-colors styles are defined for resizers and active indicators', () => {
    expect(chromeCss).toContain('@media (forced-colors: active)');
    expect(chromeCss).toContain('Highlight');
    expect(chromeCss).toContain('ButtonText');
  });

  it('defines container queries for split-view auto-stacking and primary-bar responsive collapse', () => {
    expect(css).toContain('@container split-view (max-width: 680px)');
    expect(chromeCss).toContain('@container (max-width: 900px)');
    expect(ruleBody(css, '.split-container')).toContain('container-name: split-view');
    expect(ruleBody(chromeCss, '.primary-bar')).toContain('container-type: inline-size');
  });

  it('popover menu section headers and dividers span all columns to prevent inline grid collision', () => {
    expect(chromeCss).toContain('.share-popover .menu-section-header');
    expect(chromeCss).toContain('.view-popover .menu-section-header');
    expect(chromeCss).toContain('grid-column: 1 / -1');
    expect(sidebarCss).toContain('[focusgroup~="menu"] > .menu-section-header');
    expect(sidebarCss).toContain('[focusgroup~="menu"] > .menu-divider');
  });
});
