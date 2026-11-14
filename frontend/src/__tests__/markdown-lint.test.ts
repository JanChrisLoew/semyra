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

  it('reports the actual 1-based line number for skill.invalidNameFormat', () => {
    const content = [
      '---',
      'description: Valid description comes first',
      'allowed-tools: read_file',
      'name: Invalid_Name',
      '---',
      '',
      '# Skill',
    ].join('\n');

    const res = lintMarkdownDocument(content, 'C:\\skills\\Invalid_Name\\SKILL.md');
    const invalidNameIssue = res.issues.find((i) => i.code === 'skill.invalidNameFormat');
    expect(invalidNameIssue).toBeDefined();
    expect(invalidNameIssue?.line).toBe(4);
  });

  it('detects unclosed and mismatched XML prompt tags outside code', () => {
    const valid = [
      '<role>Assistant</role>',
      '<context>',
      'Some `</instructions>` inline code',
      '</context>',
      '```xml',
      '<constraints>unclosed in fence',
      '```',
    ].join('\n');
    expect(lintMarkdownDocument(valid, 'prompt.md').issues).toEqual([]);

    const invalid = [
      '<role>',
      '<instructions>',
      '</role>',
      '</examples>',
      '<constraints>',
    ].join('\n');
    const res = lintMarkdownDocument(invalid, 'prompt.md');
    const mismatched = res.issues.filter((i) => i.code === 'ai.mismatchedXmlTag');
    const unclosed = res.issues.filter((i) => i.code === 'ai.unclosedXmlTag');
    expect(mismatched.map((i) => i.line)).toEqual([3, 4]);
    expect(unclosed.map((i) => i.line)).toEqual([5]);
  });

  it('detects malformed template placeholders outside fenced and inline code', () => {
    const content = [
      'Valid: {{user_name}} and {{ task.id }}',
      'Ignored inline: `{{unclosed` and `{{}}`',
      'Empty: {{}} and {{   }}',
      'Unclosed: {{missing_end',
      'Nested unclosed: {{outer {{inner}}',
      '```',
      '{{unclosed_in_fence',
      '```',
    ].join('\n');

    const res = lintMarkdownDocument(content, 'prompt.md');
    const placeholderIssues = res.issues.filter((i) => i.code === 'ai.malformedPlaceholder');
    expect(placeholderIssues.map((i) => i.line)).toEqual([3, 3, 4, 5]);
  });

  it('validates internal #heading anchors against GitHub-style slugs', () => {
    const content = [
      '[Jump to intro](#introduction)',
      '[Second](#second-heading-1)',
      '[Custom](#my-id)',
      '[Broken](#does-not-exist)',
      '[External](https://example.com#ignored)',
      '`[InlineCode](#ignored)`',
      '',
      '# Introduction',
      '## Second Heading',
      '## Second Heading',
      '### Custom Heading {#my-id}',
    ].join('\n');

    const res = lintMarkdownDocument(content, 'docs/guide.md');
    const brokenAnchors = res.issues.filter((i) => i.code === 'md.brokenAnchor');
    expect(brokenAnchors).toHaveLength(1);
    expect(brokenAnchors[0].line).toBe(4);
  });

  it('optionally validates relative Markdown/text links against knownWorkspaceFiles without flagging images or binary files', () => {
    const content = [
      '[Valid sibling](other.md)',
      '[Valid parent](../README.md#usage)',
      '[Valid asset](./assets/diagram.png?raw=1)',
      '[Missing doc](missing.md)',
      '![Missing image](../images/nope.png)',
      '[Image link](../images/photo.webp)',
      '[Binary doc](./files/spec.pdf)',
      '[Protocol-relative](//cdn.example.com/nope.md)',
      '[Parens valid](file_(v1).md)',
      '[Parens missing](missing_(v1).md)',
      '[External](https://example.com/nope.md)',
      '`[Ignored in code](nope.md)`',
    ].join('\n');

    // Without options, existing behavior is preserved (no brokenRelativeLink issues)
    const withoutOpts = lintMarkdownDocument(content, 'C:\\ws\\docs\\guide.md');
    expect(withoutOpts.issues.some((i) => i.code === 'md.brokenRelativeLink')).toBe(false);

    const knownFiles = new Set([
      'README.md',
      'docs\\guide.md',
      'docs\\other.md',
      'docs\\file_(v1).md',
      'docs\\assets\\diagram.png',
    ]);
    const withOpts = lintMarkdownDocument(content, 'C:\\ws\\docs\\guide.md', {
      knownWorkspaceFiles: knownFiles,
      currentFileRelPath: 'docs/guide.md',
    });
    const brokenRel = withOpts.issues.filter((i) => i.code === 'md.brokenRelativeLink');
    expect(brokenRel.map((i) => i.line)).toEqual([4, 10]);
  });

  it('matches #heading anchors case-insensitively', () => {
    const content = [
      '[Upper](#Introduction)',
      '[Mixed custom](#my-custom-id)',
      '[Missing](#No-Such-Heading)',
      '',
      '# Introduction',
      '## Custom {#My-Custom-ID}',
    ].join('\n');

    const res = lintMarkdownDocument(content, 'docs/guide.md');
    const brokenAnchors = res.issues.filter((i) => i.code === 'md.brokenAnchor');
    expect(brokenAnchors.map((i) => i.line)).toEqual([3]);
  });

  it('supports multi-line {{ ... }} template blocks without false positives', () => {
    const validMultiline = [
      '{{',
      '  user_prompt',
      '  | trim',
      '}}',
      'And inline {{ok}}.',
    ].join('\n');
    expect(
      lintMarkdownDocument(validMultiline, 'prompt.md').issues.filter(
        (i) => i.code === 'ai.malformedPlaceholder',
      ),
    ).toEqual([]);

    const emptyMultiline = ['{{', '   ', '}}'].join('\n');
    const emptyRes = lintMarkdownDocument(emptyMultiline, 'prompt.md').issues.filter(
      (i) => i.code === 'ai.malformedPlaceholder',
    );
    expect(emptyRes.map((i) => i.line)).toEqual([1]);

    const unclosedAtEof = ['{{', '  still_open'].join('\n');
    const eofRes = lintMarkdownDocument(unclosedAtEof, 'prompt.md').issues.filter(
      (i) => i.code === 'ai.malformedPlaceholder',
    );
    expect(eofRes.map((i) => i.line)).toEqual([1]);
  });
});
