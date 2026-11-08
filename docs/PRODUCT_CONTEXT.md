# Semyra — Produktkontext & Designidentität

> **Status:** Lebende Produktreferenz für Entwicklung und Design  
> **Stand:** 08.11.2026  
> **Produktname:** Semyra  
> **Claim:** *Markdown for the AI era.*  
> **Zielablage im Repository:** `docs/PRODUCT_CONTEXT.md`

## 1. Zweck dieses Dokuments

Dieses Dokument beschreibt die **beabsichtigte, langfristige Produktidentität** von Semyra und dient Menschen sowie Coding-Agenten als Kontext bei Entwicklungsentscheidungen. Es hält Produktzweck, Markenkern, bekannte Kernfunktionen, Gestaltungsprinzipien und konkrete Theme-Farben fest.

**Geltungsregel:** Dieses Dokument beschreibt Produkt- und Designziele. Bei Aussagen über *bereits implementierte* Details ist der aktuelle Repository-Code die technische Quelle der Wahrheit. Abweichungen zwischen Code und Soll-Design sind gezielt zu prüfen; es ist **kein Auftrag zu einem umfassenden Redesign**.

## 2. Produktdefinition und Name

**Semyra ist ein schneller, lokaler und fokussierter Markdown-Viewer und -Editor für Windows 11.** Er ermöglicht das Lesen, Bearbeiten und Visualisieren von Markdown-Dateien — von klassischer Projektdokumentation bis zu Prompts, Skills, Agentenanweisungen und LLM-Kontextdateien.

Der Name **Semyra** ist ein Kunstwort, inspiriert vom altgriechischen *sēmeîon* (σημεῖον: Zeichen/Kennzeichen) und der Idee semantisch bedeutsamer Textstrukturen. Er ist **keine wörtliche Übersetzung von Markdown**. Die Zeichen der Markdown-Syntax verwandeln einfachen Text in lesbare, strukturierte Informationen.

**Fokus und Ausrichtung:** Semyra ist als eigenständiger, langlebiger Produktname angelegt: Der Fokus bleibt Markdown, aber der Anwendungsfall umfasst heute auch Dateien, mit denen Menschen KI-Systemen Anweisungen, Fähigkeiten und Kontext bereitstellen.

**Verbindliche Benennung:**

- Produktname in UI, Titelleiste, About-Dialog, Dokumentation und Installationsoberflächen: **Semyra**.
- Primärer englischer Claim: **Markdown for the AI era.**
- Kurze deutsche Beschreibung: **Nativer Markdown-Viewer und -Editor für Dokumentation, Prompts, Skills und Agentenanweisungen.**
- Die grafische Wortmarke darf als `semyra` in Kleinschreibung gesetzt werden; normale Produktnennungen verwenden `Semyra`.

## 3. Markenkern und Produktversprechen

**Markenkern:** *Strukturierte Textdateien klar lesen, präzise bearbeiten und unmittelbar verstehen — für Menschen und KI-Workflows.*

**Markenattribute:**

| Attribut | Bedeutung im Produkt |
|---|---|
| **Klar** | Lesbarkeit und Orientierung stehen vor Dekoration. |
| **Fokussiert** | Das Dokument steht im Mittelpunkt, nicht das UI. |
| **Präzise** | Verlässliche Syntaxdarstellung, Zustände und Tastaturbedienung. |
| **Lokal & kontrollierbar** | Dateien und Arbeitsabläufe sind lokal nutzbar; keine KI-Cloud als Voraussetzung. |
| **Modern & performant** | Responsives, Windows-nahes Desktop-Werkzeug statt schwerfälligem Workspace. |
| **AI-ready** | Besonders geeignet für `.md`-Dateien in LLM-/Agenten-Workflows. |

**Wichtige Positionierungsgrenze:** „For the AI era“ bedeutet **nicht**, dass Semyra selbst ein LLM, Chatbot oder autonomer Agent ist. Semyra hilft dabei, die Dateien zu erstellen, zu prüfen und weiterzugeben, die solche Systeme verwenden. Integrierte Generierung, Agentenausführung oder Cloud-KI dürfen nicht behauptet werden, solange sie nicht tatsächlich implementiert sind.

**Zielgruppen:** Entwickler, technisch orientierte Power-User sowie Personen, die Markdown für Projektdokumentation, LLM-Prompts, `AGENTS.md`, `SKILL.md` und verwandte Agentenkonfigurationen einsetzen.

## 4. Kernfunktionen und Funktionsbereiche

Die folgende Übersicht bildet die Kernfähigkeiten von Semyra ab:

| Bereich | Kernfunktionen / Produktabsicht |
|---|---|
| **Lesen & Bearbeiten** | Markdown-Quelltexteditor, gerenderte Vorschau, Editor-/Split-/Preview-Modi, Live-Aktualisierung. |
| **Markdown-Darstellung** | GitHub-Flavored Markdown mit Tabellen, Aufgabenlisten, Codeblöcken und weiteren erweiterten Elementen; Syntaxhervorhebung; Mermaid-Diagramme; KaTeX-Formeln. |
| **Datei- und Projektarbeit** | Dateiexplorer, Ordnernavigation, mehrere Tabs, Multi-Window-Unterstützung, Drag & Drop sowie Dateiaktionen. |
| **Navigation** | Befehlspalette/Schnellwahl, Dateisuche und Arbeitsordner-Volltextsuche, Outline/Gliederung, Tastaturkürzel. |
| **Schreibkomfort** | Optionale Formatierungsleiste, Zeilenumbruch, Dokument-Zoom, Zen-Modus, synchronisiertes Scrollen und komfortable Markdown-Eingaben. |
| **KI-Workflows** | Arbeit an Prompts, Skills und Agentenanweisungen; Funktion „Copy for AI (with Metadata)“ zur Weitergabe von Kontext. |
| **Export & Teilen** | Markdown-Quelltext kopieren, formatierten Text kopieren, Standalone-HTML, PDF/Druck und „Save As“. |
| **Sitzung & Sicherheit** | Sitzungswiederherstellung, Recovery ungespeicherter Entwürfe, Speicherung vorhandener Einstellungen; Auto-Save als konfigurierbare Funktion. |
| **Windows & Personalisierung** | Native Windows-11-Integration, Dark/Light/System-Theme, Deutsch/Englisch, native Dateidialoge und Statusinformationen. |

**Technische Orientierung:** Rust-basierte Windows-Desktop-Anwendung mit `tao`/`wry` und WebView2; CodeMirror 6 Editor und Vite-Frontend. Windows x64 ist die primäre Zielplattform; ARM64 ist als potenzielle Zielarchitektur vorgesehen.

## 5. UX- und Designphilosophie

### 5.1 Leitprinzipien

1. **Neutral-first.** Midnight, Slate, Steel und Weißtöne bilden das Fundament. Farbige Akzente tragen Bedeutung.
2. **Dokument vor Marke.** Das Dokument bleibt neutral; Semyra braucht keine markenfarbigen Leseflächen.
3. **Evolution statt Redesign.** Die bestehende Informationsarchitektur bleibt erhalten: obere Toolbar/Tabs, Explorer links, Editor und Vorschau, Statusleiste, Dialoge und Befehlspalette.
4. **Native Utility statt AI-Showcase.** Keine dominanten Gradients, Glow-Effekte, Glassmorphism-Inszenierungen, Roboter- oder Sparkle-Motive.
5. **Semantische Zustände.** Aktiv, fokussiert, ungespeichert, deaktiviert oder fehlerhaft müssen eindeutig erkennbar sein — nicht allein über Farbe.
6. **Dark und Light sind gleichwertig.** Beide sind Varianten desselben Produkts, nicht zwei separate Designsprachen.
7. **Konsistenz vor Neuheit.** Vorhandene Komponenten und Design-Tokens bevorzugen; keine Designsystem-Doppelstrukturen schaffen.

### 5.2 Informationsarchitektur und Oberflächen

- **Editor:** funktional, gut lesbar, Mono-Schrift; Formatierung und Markdown-Syntax werden visuell unterscheidbar dargestellt.
- **Preview:** ruhige Lesefläche mit klarer Typografie und zurückhaltenden Trennlinien.
- **Explorer, Tabs, Toolbar und Statusleiste:** kompakte Desktop-Dichte; klare aktive, inaktive und Hover-Zustände.
- **Settings, Menüs, Tooltips, Befehlspalette:** dieselbe Surface-, Rahmen-, Schrift- und Fokuslogik in beiden Themes.
- **Light Mode:** reine weiße Dokumentenfläche; Sidebar/Chrome leicht abgesetzt, **keine beige Vollfläche**.
- **Dark Mode:** Midnight-/Slate-Abstufungen ohne reines Schwarz; Inhalte mit Ice-White-/Steel-Kontrasten.

## 6. Farben und Theme-Tokens

Die folgenden Werte sind **Design-Referenzwerte (Soll-Tokens)**:

### 6.1 Oberflächen und Text

| Semantik / Token | Dark | Light | Zweck |
|---|---|---|---|
| `--color-canvas` | `#12161E` / `#151A22` | `#FFFFFF` | Editor-/Preview-Grundfläche |
| `--color-chrome` | `#161B24` / `#171D25` | `#F3F5F7` | Toolbar, Tabs, Statusleiste |
| `--color-sidebar` | `#1A212B` / `#1D242E` | `#EAEFF4` / `#F7F8FA` | Navigation und Explorer |
| `--color-surface` | `#202935` / `#222A35` | `#FFFFFF` | Menüs, Dialogflächen, Panels |
| `--color-surface-raised` | `#273240` / `#293340` | `#F0F3F6` / `#F1F3F6` | Abgesetzte Controls und Hoverflächen |
| `--color-border` | `#323E4D` / `#354353` | `#D6DDE4` / `#D5DEE6` | Divider, Eingabekonturen, Panelgrenzen |
| `--color-text-primary` | `#EDF2F5` | `#202934` | Fließtext und primäre UI-Beschriftung |
| `--color-text-secondary` | `#8292A2` / `#9BAABA` | `#506173` / `#526477` | Hilfetext, sekundäre Daten |
| `--color-text-muted` | `#6E7E8E` / `#8E9BA9` | `#6B7C8E` / `#667687` | Untergeordnete Hinweise und Icons |

### 6.2 Interaktion, Status und Nebenakzente

| Semantik / Token | Dark | Light | Einsatzregel |
|---|---|---|---|
| `--color-accent` | `#83A5C6` | `#426B91` | **Steel Blue** für Fokus, Auswahl, aktive Controls |
| `--color-accent-subtle` | `#223344` / `#283A4C` | `#E4EDF5` / `#E5EDF5` | Hintergrund aktiver Tabs und Selektionen |
| `--color-focus-ring` | `#83A5C6` / `#A3C4DF` | `#426B91` / `#345F86` | Gut sichtbarer Tastaturfokus |
| `--color-dirty` / `--color-unsaved-dot` | `#D0A774` | `#986C3D` | **Amber** nur für ungespeicherte Änderungen |
| `--color-warm-neutral` | `#D5C7B5` / `#D8D0C3` | `#806B55` / `#D8D0C3` | Warm Stone/Beige: seltene Brandingdetails, nicht Dokumententext |
| `--color-teal-subtle` | `#63B9AC` | `#24756C` / `#267D73` | Optionaler, sehr seltener funktionaler Sonderstatus |

**Farbpriorität:** Neutrale Farben dominieren. **Steel Blue ist der einzige reguläre Interaktionsakzent**. Amber bezeichnet einen konkreten Status. Teal ist kein zweiter Standard-Akzent. Beige ist **keine reguläre Markdown-Textfarbe**.

### 6.3 Markdown-Inhalte — verbindliche Farbregeln

- **Normaler Text, Fett, Kursiv und Überschriften:** neutrale Textfarbe des jeweiligen Themes; Unterschiede primär über Größe, Gewicht und Schriftschnitt.
- **Kursiver Markdown-Text darf nicht automatisch beige/sandfarben werden.** Dies gilt für Editor und gerenderte Vorschau.
- **Blockquotes:** neutrale Schrift; dezente abgesetzte Fläche und linke Strukturkante. Kein warmer Textfarbzwang.
- **Links:** gedämpfter Steel-Blue-Ton, zusätzlich als Link erkennbar.
- **Inline-Code/Codeblöcke:** dezente eigene Hintergründe und lesbare Code-/Syntaxfarben.
- **Markdown-Syntaxzeichen im Editor:** zurückhaltend, aber klar von Inhalt unterscheidbar; vorhandenes fachlich sinnvolles Syntax-Highlighting erhalten.
- **Mermaid und KaTeX:** kontrastfähige Darstellung in beiden Themes; keine Markenfarbe nur zu Dekorationszwecken.

### 6.4 UI-Zustände und Tabs

**Aktiver Tab** und **ungespeicherter Inhalt** sind unabhängige Zustände:

| Tabstatus | Darstellung |
|---|---|
| Aktiv + gespeichert | Bestehende aktive Steel-Blue-Hervorhebung; kein Dirty-Punkt |
| Inaktiv + gespeichert | Neutral; kein Dirty-Punkt |
| Aktiv + ungespeichert | Aktive Hervorhebung **plus** kleiner Amber-Punkt vor dem Schließen-Symbol |
| Inaktiv + ungespeichert | Neutrale Darstellung **plus** kleiner Amber-Punkt vor dem Schließen-Symbol |

Der Dirty-Punkt erscheint bei Änderungen und verschwindet **sofort nach erfolgreichem Speichern**. Er funktioniert für neue Dokumente, Save As, Auto-Save und Tab-Wechsel jitterfrei ohne Layoutsprünge; ein passender Tooltip („Ungespeicherte Änderungen“) und barrierefreies ARIA-Label ergänzen die Farbe.

**Weitere Zustände:** Hover über leichte Surface-Änderung, Fokus über sichtbaren Ring, Selected über Fläche **und** Form/Kontur/Indikator. Kontrastziel mindestens 4,5:1 für normalen Text und 3:1 für große Schrift sowie Steuerelemente.

## 7. Typografie, Logo und Iconografie

**UI-Schrift:** Windows-naher System-Schriftstack (`Segoe UI Variable Text`, `Segoe UI`, system-ui). **Markdown-Editor:** Monospace-Schrift (`Cascadia Code`, `Cascadia Mono`, Consolas). **Preview:** ruhige, lesefreundliche Sans-Serif-Typografie mit klarer Überschriftenhierarchie.

**Wortmarke:** `semyra` oder regulär `Semyra`, sachlich, serifenlos, ohne zusätzliche Effekte.

**Bildmarke:** Reduziertes geometrisches **S-Monogramm**, erzeugt über die prozedurale Multi-DPI-Icon-Pipeline (`src/icon_gen.rs` & `build.rs`). Bei 16 × 16 px bis 256 × 256 px gestochen scharf.

**Iconografie:** konsistenter, reduzierter Linien- oder Glyphenstil; keine dekorativen AI-Sparkles. Branding soll nicht jede Toolbar-Aktion überlagern.

## 8. Inhalt, Sprache und Microcopy

- Tonalität: präzise, sachlich, ruhig und hilfreich — keine überhöhten KI-Versprechen.
- Deutsch und Englisch konsistent; vorhandene Sprachumschaltung respektieren.
- Funktionsbegriffe bevorzugen: *Öffnen, Bearbeiten, Vorschau, Speichern, Exportieren*.
- „Copy for AI (with Metadata)“ als konkrete Workflow-Funktion benennen, **nicht** als KI-generierte Verarbeitung missverstehen.
- In README, About und Hilfetexten: Semyra als verbindlicher Produktname.

## 9. Technische Leitplanken für Entwicklung und Agenten

1. **Kein unbeauftragtes Redesign:** Bestehende Panelstruktur, Interaktionen, Tastaturkürzel, Editor-Verhalten und Komponenten-Dichte erhalten.
2. **Theme semantisch implementieren:** Die vorhandene Token-/Theme-Architektur erweitern, nicht durch Hardcoded-Farben oder parallele Themes umgehen.
3. **Dokumenteninhalt schützen:** Styling-Änderungen dürfen Markdown-Semantik, Syntaxhervorhebung, Auswahl, Rendering oder Export nicht unbeabsichtigt verändern.
4. **Persistenz schützen:** Sessions, Recovery-Drafts, Einstellungen oder gespeicherte Dateien dürfen bei Weiterentwicklungen nicht verloren gehen. Technische IDs und Pfade nur nach sorgfältiger Impact-Analyse ändern.
5. **Tests gezielt ergänzen:** Beide Themes, Split/Editor/Preview, Kursiv/Fett, Dirty-State, Save/Save As/Auto-Save, Tastaturfokus, Menü/Settings/Befehlspalette und Regressions-Builds prüfen.
6. **Performance priorisieren:** Schnelles lokales Rendering und verzögerungsarme Eingabe sind wichtiger als dekorative Animationen.
7. **Funktionalität ehrlich dokumentieren:** Geplante Fähigkeiten nicht als bereits verfügbar ausgeben; besonders ARM64-Builds und KI-Integrationen gegen den Stand des Repositories prüfen.

## 10. Nicht-Ziele

Semyra soll **nicht** standardmäßig zu einem KI-Chatbot, Cloud-Workspace, umfassenden IDE-Ersatz oder visuell überladenen Wissensmanagement-System werden. Solche Funktionen wären eigenständige Produktentscheidungen, nicht stillschweigende Konsequenzen der Marke.

## 11. Pflegehinweise

Bei relevanten Änderungen an Positionierung, Design-Tokens oder Kernfunktionen dieses Dokument aktualisieren. Technische Details zu Implementierung, Tests und Build-Kommandos gehören in die jeweiligen Repository-Dokumente (`AGENTS.md`, `README.md`).
