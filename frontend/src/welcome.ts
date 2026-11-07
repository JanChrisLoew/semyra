export const WELCOME_MARKDOWN = `# Willkommen bei MarkLive 👋

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
