import { describe, expect, it } from 'vitest';
import { listAiTemplates, getAiTemplate } from '../ai-templates';
import { lintMarkdownDocument } from '../markdown-lint';

describe('ai-templates', () => {
  it('provides all 4 curated templates in German and English', () => {
    const de = listAiTemplates('de');
    const en = listAiTemplates('en');
    expect(de).toHaveLength(4);
    expect(en).toHaveLength(4);
    expect(de.map((t) => t.id)).toEqual(['agents', 'prompt', 'skill', 'review']);
  });

  it('produces lint-clean Markdown and YAML frontmatter for every template', () => {
    for (const lang of ['de', 'en'] as const) {
      for (const tpl of listAiTemplates(lang)) {
        const fakePath = tpl.id === 'skill' ? 'C:\\ai-library\\skills\\custom-skill\\SKILL.md' : null;
        const result = lintMarkdownDocument(tpl.content, fakePath);
        expect(result.issues, `Template ${tpl.id} (${lang}) should have 0 lint issues`).toEqual([]);
      }
    }
  });

  it('returns valid SKILL.md frontmatter for skill template', () => {
    const skill = getAiTemplate('skill', 'en');
    expect(skill.suggestedName).toBe('SKILL.md');
    expect(skill.content).toContain('name: custom-skill');
    expect(skill.content).toContain('description:');
  });
});
