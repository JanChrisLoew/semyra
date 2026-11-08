import { getLanguage, Language } from './i18n';

export const WELCOME_MARKDOWN_DE = `# Willkommen bei MarkLive 👋

**MarkLive** ist dein nativer **Windows 11 x64 Markdown-Editor** auf Basis von **Rust** (\`pulldown-cmark\` + \`syntect\`) mit sofortiger Live-Vorschau.

> [!TIP]
> Drücke **Strg + E** für die **Schnellauswahl** (Dateien & Verlauf) oder **Strg + Umschalt + P** für die **Befehlspalette**. Öffne Dateien über **Strg + O**, füge Screenshots per **Strg + V** ein oder ziehe Dateien & Bilder direkt per **Drag & Drop** ins Fenster!

## Highlights

- [x] **Echtzeit Split-View** mit inkrementellem DOM-Morphing & Sync-Scroll
- [x] **Schnellauswahl & Befehlspalette** (\`Strg + E\` / \`Strg + Umschalt + P\`) + **Sitzungs-Wiederherstellung**
- [x] **Smartes Markdown-Editing**: Automatische Listen-Fortsetzung (\`Enter\`) & URL-Paste auf Textauswahl
- [x] **GitHub-Flavored Markdown (GFM)**: Tabellen, interaktive Checklisten, Hinweise & YAML-Frontmatter
- [ ] Klicke direkt in der Vorschau auf diese Checkbox, um sie im Markdown abzuhaken!

## Syntax-Highlighting (Rust \`syntect\`)

\`\`\`rust
fn gruss_aus_windows_11(name: &str) -> String {
    format!("Hallo {name}, viel Spaß beim Schreiben in MarkLive!")
}
\`\`\`

## Tabellen & Mathematik

| Funktion | Tastenkürzel | Beschreibung |
| :--- | :---: | :--- |
| Schnellauswahl | \`Strg + E\` | Wechselt blitzschnell zwischen Tabs, Projektdateien & Verlauf |
| Befehlspalette | \`Strg + Umschalt + P\` | Führt alle Editor-, Ansichts- und Export-Befehle aus |
| Tabellen-Workflow | \`Tab\` / \`Alt + Umschalt + F\` | Springt von Zelle zu Zelle & richtet Spalten sauber aus |
| Rich-Text & PDF | \`Strg + Umschalt + K / D\` | Kopiert für Word/Teams/Outlook oder exportiert direkt als PDF |
| Volltextsuche | \`Strg + Umschalt + F\` | Durchsucht alle Markdown-Dateien im Arbeitsordner |
| Screenshot / Excel | \`Strg + V\` | Speichert Bilder, verlinkt Auswahl oder wandelt Tabellen um |
| Dokument-Zoom | \`Strg + + / - / 0\` | Skaliert Editor- und Vorschau-Typografie stufenlos |

Auch mathematische Formeln mit KaTeX wie $E = mc^2$ oder abgesetzte Gleichungen funktionieren sofort:

$$
f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} \\exp\\left(-\\frac{(x - \\mu)^2}{2\\sigma^2}\\right)
$$

## Mermaid-Diagramme

\`\`\`mermaid
flowchart LR
  Editor["CodeMirror 6 Editor"] --> Rust["Rust Markdown-Engine"]
  Rust --> Preview["Windows 11 Live-Vorschau"]
\`\`\`
`;

export const WELCOME_MARKDOWN_EN = `# Welcome to MarkLive 👋

**MarkLive** is your native **Windows 11 x64 Markdown editor** powered by **Rust** (\`pulldown-cmark\` + \`syntect\`) with instant live preview.

> [!TIP]
> Press **Ctrl + E** for **Quick Open** (files & history) or **Ctrl + Shift + P** for the **Command Palette**. Open files with **Ctrl + O**, paste screenshots via **Ctrl + V**, or drag & drop files and images directly into the window!

## Highlights

- [x] **Real-Time Split View** with incremental DOM morphing & synchronized scrolling
- [x] **Quick Open & Command Palette** (\`Ctrl + E\` / \`Ctrl + Shift + P\`) + **Session Restore**
- [x] **Smart Markdown Editing**: automatic list continuation (\`Enter\`) & smart URL link paste
- [x] **GitHub-Flavored Markdown (GFM)**: tables, interactive task checklists, alerts & YAML frontmatter
- [ ] Click this checkbox directly in the preview to toggle it in Markdown!

## Syntax Highlighting (Rust \`syntect\`)

\`\`\`rust
fn greetings_from_windows_11(name: &str) -> String {
    format!("Hello {name}, enjoy writing in MarkLive!")
}
\`\`\`

## Tables & Mathematics

| Feature | Keyboard Shortcut | Description |
| :--- | :---: | :--- |
| Quick Open | \`Ctrl + E\` | Switch between tabs, workspace files & history |
| Command Palette | \`Ctrl + Shift + P\` | Execute any editor, view, or export command |
| Table Workflow | \`Tab\` / \`Alt + Shift + F\` | Jump cell-to-cell & format columns cleanly |
| Rich Text & PDF | \`Ctrl + Shift + K / D\` | Copy for Word/Teams/Outlook or export directly to PDF |
| Workspace Search | \`Ctrl + Shift + F\` | Full-text search across all Markdown files |
| Screenshot / Excel | \`Ctrl + V\` | Save images, link selection, or convert tables |
| Document Zoom | \`Ctrl + + / - / 0\` | Smoothly scale typography in editor and preview |

Mathematical formulas with KaTeX like $E = mc^2$ and display equations work right out of the box:

$$
f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} \\exp\\left(-\\frac{(x - \\mu)^2}{2\\sigma^2}\\right)
$$

## Mermaid Diagrams

\`\`\`mermaid
flowchart LR
  Editor["CodeMirror 6 Editor"] --> Rust["Rust Markdown Engine"]
  Rust --> Preview["Windows 11 Live Preview"]
\`\`\`
`;

export const WELCOME_MARKDOWN = WELCOME_MARKDOWN_DE;

export function getWelcomeMarkdown(lang: Language = getLanguage()): string {
  return lang === 'en' ? WELCOME_MARKDOWN_EN : WELCOME_MARKDOWN_DE;
}
