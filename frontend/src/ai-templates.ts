import { getLanguage, Language } from './i18n';

export type AiTemplateId = 'agents' | 'prompt' | 'skill' | 'review';

export interface AiTemplateDefinition {
  id: AiTemplateId;
  title: string;
  description: string;
  suggestedName: string;
  content: string;
}

export function getAiTemplate(id: AiTemplateId, lang: Language = getLanguage()): AiTemplateDefinition {
  const isEn = lang === 'en';

  switch (id) {
    case 'agents':
      return {
        id,
        title: isEn ? 'Project Agent Guide (AGENTS.md)' : 'Projekt-Agentenleitfaden (AGENTS.md)',
        description: isEn
          ? 'Architecture, build/test commands, and invariants for coding agents.'
          : 'Architektur, Build-/Test-Befehle und Leitplanken für Coding-Agenten.',
        suggestedName: 'AGENTS.md',
        content: isEn
          ? `# AGENTS.md

## 1. Project Overview
- **Purpose:** Concise description of what this project does.
- **Tech Stack:** Main languages, frameworks, and runtime targets.

## 2. Build & Verification Commands
\`\`\`powershell
# Typecheck, tests, and build
\`\`\`

## 3. Architecture & Key Modules
- \`src/\`: Core application logic
- \`tests/\`: Automated test suite

## 4. Non-Negotiable Invariants
1. Preserve existing public contracts unless explicitly requested.
2. Run all relevant checks before concluding a task.
`
          : `# AGENTS.md

## 1. Projektüberblick
- **Zweck:** Kurze Beschreibung, was dieses Projekt leistet.
- **Tech-Stack:** Zentrale Sprachen, Frameworks und Zielplattformen.

## 2. Build- & Verifikationsbefehle
\`\`\`powershell
# Typprüfung, Tests und Build
\`\`\`

## 3. Architektur & Schlüsselmodule
- \`src/\`: Zentrale Anwendungslogik
- \`tests/\`: Automatisierte Test-Suite

## 4. Verbindliche Leitplanken
1. Bestehende Schnittstellen und Verträge ohne expliziten Auftrag nicht brechen.
2. Alle relevanten Tests und Prüfungen vor Abschluss ausführen.
`,
      };

    case 'prompt':
      return {
        id,
        title: isEn ? 'Structured System Prompt' : 'Strukturierter System-Prompt',
        description: isEn
          ? 'Reusable LLM prompt with frontmatter, role, context, and output contract.'
          : 'Wiederverwendbarer LLM-Prompt mit Frontmatter, Rolle, Kontext und Ausgabeformat.',
        suggestedName: isEn ? 'system-prompt.md' : 'system-prompt.md',
        content: isEn
          ? `---
name: system-prompt
model: default
version: 1.0
---

# System Prompt

<role>
You are a precise, analytical specialist focused on...
</role>

<context>
- Target audience:
- Constraints:
</context>

<instructions>
1. Analyze the input carefully before responding.
2. Base all claims strictly on provided facts.
3. Keep the output concise and structured.
</instructions>

<output_format>
- Use clear headings and bullet points.
- Highlight open risks or assumptions explicitly.
</output_format>
`
          : `---
name: system-prompt
model: default
version: 1.0
---

# System-Prompt

<role>
Du bist ein präziser, analytischer Spezialist mit Fokus auf...
</role>

<context>
- Zielgruppe:
- Rahmenbedingungen:
</context>

<instructions>
1. Analysiere die Eingabe sorgfältig vor der Antwort.
2. Stütze alle Aussagen strikt auf belegte Fakten.
3. Halte die Ausgabe klar strukturiert und prägnant.
</instructions>

<output_format>
- Nutze klare Überschriften und Aufzählungen.
- Kennzeichne offene Risiken oder Annahmen explizit.
</output_format>
`,
      };

    case 'skill':
      return {
        id,
        title: isEn ? 'Agent Skill (SKILL.md)' : 'Agent-Skill (SKILL.md)',
        description: isEn
          ? 'Standardized skill specification with valid YAML frontmatter.'
          : 'Standardisierte Skill-Spezifikation mit validem YAML-Frontmatter.',
        suggestedName: 'SKILL.md',
        content: isEn
          ? `---
name: custom-skill
description: Precisely describe what this skill does and when an agent should invoke it.
---

# Custom Skill

## Goal
Describe the expected outcome.

## Steps
1. Inspect the relevant files and constraints.
2. Apply the minimal, cleanest change.
3. Verify the result with automated checks.
`
          : `---
name: custom-skill
description: Beschreibe hier präzise, was dieser Skill tut und wann ein Agent ihn verwenden soll.
---

# Custom Skill

## Ziel
Beschreibe das erwartete Ergebnis.

## Schritte
1. Relevante Dateien und Rahmenbedingungen prüfen.
2. Minimale, saubere Änderung umsetzen.
3. Ergebnis mit automatisierten Prüfungen verifizieren.
`,
      };

    case 'review':
      return {
        id,
        title: isEn ? 'Code & Product Review Checklist' : 'Code- & Produkt-Review-Checkliste',
        description: isEn
          ? 'Structured review template with tasks and verification gates.'
          : 'Strukturierte Review-Vorlage mit Aufgabenliste und Prüfpunkten.',
        suggestedName: isEn ? 'review-checklist.md' : 'review-checkliste.md',
        content: isEn
          ? `# Review Checklist

## Scope & Context
- **Subject:** 
- **Goal:** 

## Verification Gates
- [ ] Correctness & edge cases verified
- [ ] Security & path/input validation checked
- [ ] Accessibility & dual-theme consistency checked
- [ ] Typecheck, unit tests, and build pass without warnings

## Findings
> [!NOTE]
> Summarize key observations, risks, and follow-up actions here.
`
          : `# Review-Checkliste

## Scope & Kontext
- **Gegenstand:** 
- **Ziel:** 

## Prüfpunkte
- [ ] Korrektheit & Randfälle verifiziert
- [ ] Sicherheit sowie Pfad-/Eingabevalidierung geprüft
- [ ] Barrierefreiheit & Dual-Theme-Konsistenz geprüft
- [ ] Typecheck, Unit-Tests und Build laufen ohne Warnungen durch

## Befunde
> [!NOTE]
> Zentrale Beobachtungen, Risiken und nächste Schritte hier festhalten.
`,
      };
  }
}

export function listAiTemplates(lang: Language = getLanguage()): AiTemplateDefinition[] {
  return (['agents', 'prompt', 'skill', 'review'] as AiTemplateId[]).map((id) =>
    getAiTemplate(id, lang),
  );
}
