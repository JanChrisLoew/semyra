import { describe, expect, it } from 'vitest';
import {
  buildAiContextBundle,
  extractTemplateVariables,
  formatAiContextEntry,
  interpolateTemplateVariables,
  toWorkspaceRelativeLabel,
} from '../ai-bundle';

describe('ai-bundle', () => {
  describe('toWorkspaceRelativeLabel', () => {
    it('returns workspace-relative POSIX path for Windows paths inside workspace', () => {
      expect(
        toWorkspaceRelativeLabel(
          'C:\\Users\\janlo\\Repo\\docs\\AGENTS.md',
          'C:\\Users\\janlo\\Repo',
          'AGENTS.md',
        ),
      ).toBe('docs/AGENTS.md');

      expect(
        toWorkspaceRelativeLabel(
          '\\\\?\\C:\\Users\\janlo\\Repo\\src\\prompt.md',
          'c:\\users\\janlo\\repo\\',
          'prompt.md',
        ),
      ).toBe('src/prompt.md');
    });

    it('returns workspace-relative path for POSIX paths', () => {
      expect(
        toWorkspaceRelativeLabel('/home/user/repo/notes/todo.md', '/home/user/repo/', 'todo.md'),
      ).toBe('notes/todo.md');
    });

    it('falls back to basename when outside workspace or without workspaceRoot', () => {
      expect(
        toWorkspaceRelativeLabel('D:\\Other\\secret.md', 'C:\\Repo', 'fallback.md'),
      ).toBe('secret.md');
      expect(
        toWorkspaceRelativeLabel('C:\\Docs\\readme.md', null, 'fallback.md'),
      ).toBe('readme.md');
    });

    it('falls back to fallbackName when filePath is empty or nullish', () => {
      expect(toWorkspaceRelativeLabel(null, 'C:\\Repo', 'Unbenannt.md')).toBe('Unbenannt.md');
      expect(toWorkspaceRelativeLabel('   ', 'C:\\Repo', 'Unbenannt.md')).toBe('Unbenannt.md');
    });
  });

  describe('formatAiContextEntry', () => {
    it('formats a single entry with safe fence escalation', () => {
      const out = formatAiContextEntry('AGENTS.md', 'Hello\n```\ncode\n```');
      expect(out.startsWith('````md:AGENTS.md\n')).toBe(true);
      expect(out.endsWith('\n````\n')).toBe(true);
    });

    it('formats as XML <file> element with escaped path attribute and </file> guard', () => {
      const out = formatAiContextEntry(
        'docs/"a&b"<c>.md',
        'Line 1\n</file>\n</FILE>\nLine 2',
        { format: 'xml' },
      );
      expect(out).toBe(
        '<file path="docs/&quot;a&amp;b&quot;&lt;c&gt;.md">\nLine 1\n&lt;/file>\n&lt;/FILE>\nLine 2\n</file>\n',
      );
    });

    it('strips leading YAML frontmatter when stripFrontmatter is true', () => {
      const input = '\uFEFF---\ntitle: Test\ntags: [a, b]\n---\n\n# Heading\n\n---\n\nBody';
      const out = formatAiContextEntry('doc.md', input, { stripFrontmatter: true });
      expect(out).toBe('```md:doc.md\n# Heading\n\n---\n\nBody\n```\n');
    });

    it('strips HTML comments outside fenced code blocks when stripComments is true', () => {
      const input = [
        '# Title',
        '<!-- secret comment -->',
        'Visible <!-- inline --> text',
        '<!--',
        '  multi-line',
        '-->',
        '```html',
        '<!-- keep inside backtick fence -->',
        '```',
        '~~~xml',
        '<!-- keep inside tilde fence -->',
        '~~~',
      ].join('\n');

      const out = formatAiContextEntry('doc.md', input, { stripComments: true });
      expect(out).not.toContain('secret comment');
      expect(out).not.toContain('inline');
      expect(out).not.toContain('multi-line');
      expect(out).toContain('Visible  text');
      expect(out).toContain('<!-- keep inside backtick fence -->');
      expect(out).toContain('<!-- keep inside tilde fence -->');
    });
  });

  describe('buildAiContextBundle', () => {
    it('builds a combined bundle and calculates aggregated tokens', () => {
      const res = buildAiContextBundle([
        { label: 'docs/AGENTS.md', content: '# Agent Guide\nKeep it clean.' },
        { label: 'src/prompt.md', content: 'You are helpful.' },
      ]);
      expect(res.fileCount).toBe(2);
      expect(res.totalTokens).toBeGreaterThan(10);
      expect(res.payload).toContain('```md:docs/AGENTS.md');
      expect(res.payload).toContain('```md:src/prompt.md');
    });

    it('applies XML format and stripping options across all bundle entries', () => {
      const res = buildAiContextBundle(
        [
          {
            label: 'a.md',
            content: '---\nk: v\n---\nHello <!-- hidden -->world',
          },
          {
            label: 'b.md',
            content: 'Second file',
          },
        ],
        { format: 'xml', stripFrontmatter: true, stripComments: true },
      );
      expect(res.fileCount).toBe(2);
      expect(res.payload).toContain('<file path="a.md">\nHello world\n</file>');
      expect(res.payload).toContain('<file path="b.md">\nSecond file\n</file>');
      expect(res.payload).not.toContain('k: v');
      expect(res.payload).not.toContain('hidden');
    });

    it('returns empty result for empty list', () => {
      const res = buildAiContextBundle([]);
      expect(res).toEqual({ payload: '', totalTokens: 0, fileCount: 0 });
    });
  });

  describe('template variables', () => {
    it('extracts unique variable names in order of first appearance', () => {
      const tpl =
        'Role: {{role}}\nTask: {{task_name}} for {{user.name}} ({{role}}) with {{model-id}}\nInvalid: {{}} {{ bad }}';
      expect(extractTemplateVariables(tpl)).toEqual([
        'role',
        'task_name',
        'user.name',
        'model-id',
      ]);
      expect(extractTemplateVariables('No placeholders here.')).toEqual([]);
    });

    it('interpolates provided values and preserves unmatched placeholders', () => {
      const tpl = 'Hello {{name}}, your {{item}} is {{status}}. {{toString}}';
      const out = interpolateTemplateVariables(tpl, {
        name: 'Alice',
        item: '',
      });
      expect(out).toBe('Hello Alice, your  is {{status}}. {{toString}}');
    });
  });
});
