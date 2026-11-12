import { describe, expect, it } from 'vitest';
import { lintMarkdownDocument } from '../markdown-lint';

describe('lintMarkdownDocument', () => {
  it('validates a compliant SKILL.md with matching folder name', () => {
    const content = [
      '---',
      'name: code-review',
      'description: Reviews pull requests for bugs and maintainability.',
      '---',
      '',
      '# Code Review',
      '',
      '- Check edge cases',
    ].join('\n');

    const res = lintMarkdownDocument(
      content,
      'C:\\Users\\demo\\AppData\\Local\\Semyra\\ai-library\\skills\\code-review\\SKILL.md',
    );
    expect(res.isSkillFile).toBe(true);
    expect(res.hasFrontmatter).toBe(true);
    expect(res.frontmatterValid).toBe(true);
    expect(res.issues).toEqual([]);
  });

  it('reports missing frontmatter, missing fields, and folder mismatch on SKILL.md', () => {
    const noFm = lintMarkdownDocument('# Just text', 'C:\\skills\\demo\\SKILL.md');
    expect(noFm.frontmatterValid).toBe(false);
    expect(noFm.issues.some((i) => i.code === 'skill.missingFrontmatter')).toBe(true);

    const badFm = [
      '---',
      'name: OtherName',
      '---',
      '',
      '# Title',
    ].join('\n');
    const res = lintMarkdownDocument(badFm, 'C:\\skills\\demo\\SKILL.md');
    expect(res.issues.some((i) => i.code === 'skill.invalidNameFormat')).toBe(true);
    expect(res.issues.some((i) => i.code === 'skill.nameFolderMismatch')).toBe(true);
    expect(res.issues.some((i) => i.code === 'skill.missingDescription')).toBe(true);
  });

  it('catches YAML tab indentation, unclosed quotes, and unclosed frontmatter', () => {
    const badYaml = [
      '---',
      'name: "unclosed',
      '\tbad: indent',
      'invalid line without colon',
      '---',
    ].join('\n');
    const res = lintMarkdownDocument(badYaml, 'C:\\skills\\x\\SKILL.md');
    expect(res.frontmatterValid).toBe(false);
    expect(res.issues.some((i) => i.code === 'yaml.unclosedQuote')).toBe(true);
    expect(res.issues.some((i) => i.code === 'yaml.tabIndent')).toBe(true);
    expect(res.issues.some((i) => i.code === 'yaml.invalidSyntax')).toBe(true);
  });

  it('detects Markdown structure issues outside fenced code blocks', () => {
    const md = [
      '##Heading without space',
      '',
      'Broken [link]() here.',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 | 3 |',
      '',
      '```ts',
      '##NotAHeadingInsideCode',
      'const x = "[ignored]()";',
    ].join('\n');

    const res = lintMarkdownDocument(md, 'C:\\docs\\notes.md');
    expect(res.isSkillFile).toBe(false);
    const codes = res.issues.map((i) => i.code);
    expect(codes).toContain('md.headingSpace');
    expect(codes).toContain('md.emptyLink');
    expect(codes).toContain('md.tableColumns');
    expect(codes).toContain('md.unclosedCodeFence');
    // Headings inside fenced code blocks must not be flagged
    expect(res.issues.filter((i) => i.code === 'md.headingSpace')).toHaveLength(1);
  });
});
