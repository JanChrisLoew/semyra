import { describe, expect, it } from 'vitest';
import { formatMarkdownDocument } from '../markdown-formatter';

describe('formatMarkdownDocument', () => {
  it('preserves YAML frontmatter and fenced code blocks verbatim while formatting Markdown', () => {
    const input = [
      '---',
      'name:   my-skill  ',
      'description: >-   ',
      '  Keep exact YAML.',
      '---',
      '',
      '',
      '',
      '##Heading without space   ',
      '',
      '* Item one',
      '+ Item two',
      '  * Nested item',
      '',
      '|Name|Age|',
      '|--|--:|',
      '|Alice|30|',
      '',
      '```markdown',
      '##DoNotTouchInsideCode',
      '*   Keep spaces',
      '```',
      '',
      '',
    ].join('\n');

    const formatted = formatMarkdownDocument(input);
    expect(formatted).toContain('name:   my-skill  \ndescription: >-   \n');
    expect(formatted).toContain('## Heading without space\n');
    expect(formatted).toContain('- Item one\n- Item two\n  - Nested item\n');
    expect(formatted).toContain('| Name  | Age |\n| ----- | --: |\n| Alice |  30 |\n');
    expect(formatted).toContain('```markdown\n##DoNotTouchInsideCode\n*   Keep spaces\n```\n');
    expect(formatted.endsWith('\n')).toBe(true);
    expect(formatted.endsWith('\n\n')).toBe(false);
  });

  it('preserves CRLF line endings when input uses CRLF', () => {
    const input = '#Title\r\n\r\n\r\n* A\r\n';
    const formatted = formatMarkdownDocument(input);
    expect(formatted).toBe('# Title\r\n\r\n- A\r\n');
  });

  it('preserves intentional two-space hard line breaks', () => {
    const input = 'Line one  \nLine two\n';
    expect(formatMarkdownDocument(input)).toBe('Line one  \nLine two\n');
  });
});
