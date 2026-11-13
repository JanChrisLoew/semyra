# Semyra — Work Log & Sessionshistorie

Dieses Dokument dient als fortlaufendes Protokoll über Entwicklungssessions, wesentliche Arbeitsinhalte, technische Entscheidungen, Testergebnisse und offene Punkte im Semyra-Projekt.

> [!NOTE]
> **Pflegepflicht gemäß `AGENTS.md`**: Am Ende jeder Arbeitssession oder größeren Feature- bzw. Refactoring-Sequenz ist hier ein neuer Eintrag mit Datum, Zielsetzung, vorgenommenen Änderungen, Testergebnissen und nächsten Schritten einzutragen.

---

## 2026-11-13 — Session 9: Produktreview & Maßnahmenpakete 1–5 (Doku-Sync, CI-Härtung, AI-Bundler & Templates, Diff & Workspace-Replace, Tab-Pinning)

### 1. Ziel & Scope
- Umfassendes Produktreview von Semyra inkl. Ableitung und schrittweiser Umsetzung von 5 konkreten Maßnahmenpaketen mit jeweiligem Review-Gate.

### 2. Durchgeführte Maßnahmen
- **Paket 1 — Doku-, Shortcut- & Token-Synchronisierung (`README.md`)**:
  - Tastaturtabelle in `README.md` auf die realen Bindings in `frontend/src/main.ts` (`Strg+Umschalt+K` Rich-Text, `Strg+Umschalt+C` Markdown, `Strg+Umschalt+A` KI-Kontext, `Strg+Umschalt+D` PDF, `Strg+Umschalt+H` HTML, `Strg+Umschalt+L` Formatieren, `Strg+J` Seitenleiste) sowie Theme-Hex-Werte (`#12161E` / `#1A212B` / `#F3F5F7`) an `tokens.css` angeglichen.
- **Paket 2 — CI/CD-Härtung (`.github/workflows/ci.yml`)**:
  - Playwright-E2E-/A11y-Tests (`npm run test:e2e`), ARM64-Cross-Check (`cargo check --locked --target aarch64-pc-windows-msvc`) sowie Tag-getriggerten x64-Inno-Setup-Build (`v*`) integriert.
- **Paket 3 — KI-Workflow-Veredelung (`frontend/src/ai-bundle.ts`, `frontend/src/ai-templates.ts`, `frontend/index.html`, `frontend/src/palette-items.ts`, `frontend/src/main.ts`, `frontend/src/styles/dialogs-print.css`)**:
  - **Multi-File AI Context Bundler**: Dialog (`#ai-bundle-dialog`, ausgelagert nach `frontend/src/ai-dialogs.ts`) zur Auswahl geöffneter Tabs sowie ungeöffneter Markdown-Dateien aus dem Arbeitsordner mit Live-Token-Summe (`estimateTokens`) und gebündeltem Fenced-Markdown-Export.
  - **Kuratierte KI-Vorlagen**: DE/EN-Templates für `AGENTS.md`, `system-prompt.md`, `SKILL.md` und `review-checkliste.md` über die Befehlspalette (`palette-items.ts`) abrufbar.
- **Paket 4 — Agenten-Kollaboration & Workspace-Produktivität (`frontend/src/line-diff.ts`, `src/fs_ops/search.rs`, `src/ipc.rs`, `frontend/src/api.ts`, `frontend/src/workspace-search.ts`, `frontend/index.html`, `frontend/src/main.ts`)**:
  - **Externe Änderungs-Diff-Ansicht**: `#external-banner` um `Vergleichen…` (`#btn-compare-external`) und `<dialog id="external-diff-dialog">` (`frontend/src/ai-dialogs.ts`) mit Zeilen-Diff (`computeLineDiff`) und `light-dark()`-Teal/Amber-Markierung erweitert.
  - **Workspace Suchen & Ersetzen**: Atomares Multi-File-Replace (`replace_in_workspace_files` + IPC `"replace-workspace"` über gemeinsame `collect_searchable_files_recursive`-Traversierung), natives Bestätigungs-`<dialog id="workspace-replace-dialog">`, Beibehaltung von `CRLF`/`LF` und Synchronisierung geöffneter Tabs.
- **Paket 5 — Frontend-Entkopplung & Tab-Komfort (`frontend/src/tab-utils.ts`, `frontend/src/main.ts`, `frontend/index.html`, `frontend/src/styles/chrome.css`, `frontend/src/i18n.ts`)**:
  - **Tab-Pinning**: `toggleTabPinned()` im Tab-Kontextmenü (`Tab anheften` / `Tab lösen`), Schutz angehefteter Tabs bei „Andere/Rechts schließen“ sowie Deduplizierung von `formatAiContextEntry`.
- **UI-/UX-Nachbesserung & Edge-Case-Härtung (`src/fs_ops/search.rs`, `frontend/src/ai-dialogs.ts`, `frontend/src/main.ts`, `frontend/src/styles/dialogs-print.css`, `frontend/src/tab-utils.ts`, `frontend/src/workspace-search.ts`)**:
  - **Unicode-Case-Folding-Fix**: `replace_text_occurrences` in `src/fs_ops/search.rs` mit exaktem `byte_map`-Mapping statt unsicherer Byte-Offsets im Lowercase-String (`ẞ`, `İ` etc. sicher abgedeckt).
  - **Konflikt-Banner & Dialog-Polish**: Sofortige Aktivierung von `#external-banner` bei Workspace-Replace auf aktivem Dirty-Tab (`main.ts`), `.dialog-text`-Styling (`dialogs-print.css`), Lazy-Token-Berechnung beim Anhaken ungeöffneter Workspace-Dateien im KI-Bundler (`ai-dialogs.ts`), Pin-Gruppenerhalt bei Tab-Drag (`reorderTabList`) sowie `Enter`-Taste & Disabled-State im Workspace-Ersetzen-Feld (`workspace-search.ts`).

### 3. Testergebnisse & Build-Status
- `scripts/Build-Release.ps1`:
  - `npm run typecheck` (`tsc --noEmit`): 0 Fehler.
  - `npm test` (`vitest run`): 22/22 Testdateien, 120/120 Tests bestanden.
  - `npm run build` (`vite build`): erfolgreich (`frontend/dist` aktualisiert).
  - `cargo test`: 15/15 Tests bestanden (0 Warnings).
  - `cargo build --release`: `target\release\Semyra.exe` (10,95 MB) erfolgreich gebaut.
- `npm run test:e2e` (`playwright test`): 6/6 E2E- & `@axe-core/playwright`-A11y-Tests bestanden.

---

## 2026-11-12 — Session 8: KI-Bibliothek (Prompts & Skills), YAML-/Markdown-Lint & eigener Markdown-Formatter

### 1. Ziel & Scope
- Persistente **KI-Bibliothek** unter `%LOCALAPPDATA%\Semyra\ai-library\` (`prompts/` und `skills/<skill-name>/SKILL.md` nach Agent-Skill-Standard) mit Umschalter `Arbeitsordner | KI-Bibliothek` in der Seitenleiste.
- Abhängigkeitsfreier **YAML-Frontmatter-, Agent-Skill- & Markdown-Struktur-Lint** direkt in Statusleiste und Diagnose-Dialog.
- Abhängigkeitsfreier **Markdown-Formatter** (`Strg+Umschalt+L` / Befehlspalette), der YAML-Frontmatter, Code-Fences und Math-Blöcke schützt und `markdown-table.ts` wiederverwendet.

### 2. Durchgeführte Maßnahmen
- **Sprint 1 — KI-Bibliothek (`src/fs_ops/workspace.rs`, `src/ipc.rs`, `frontend/src/api.ts`, `frontend/index.html`, `frontend/src/sidebar-explorer.ts`, `frontend/src/main.ts`, `frontend/src/styles/sidebar.css`)**:
  - `ensure_ai_library_tree()` legt `%LOCALAPPDATA%\Semyra\ai-library\{prompts,skills}` an; `create_ai_skill()` normalisiert den Skill-Slug und erstellt `<skill-name>/SKILL.md` mit validem Agent-Skill-YAML-Frontmatter.
  - IPC-Routen `ai-library/init` und `ai-library/create-skill` ergänzt (inkl. `state.set_workspace_folder` für sichere Datei-/Asset-Zugriffe, ohne `last_workspace` zu überschreiben).
  - Segmented-Switch `Arbeitsordner | KI-Bibliothek` und `+ Skill`-Aktion in die Seitenleiste integriert.
- **Sprint 2 — YAML- & Markdown-Lint (`frontend/src/markdown-lint.ts`, `frontend/src/__tests__/markdown-lint.test.ts`, `frontend/index.html`, `frontend/src/styles/dialogs-print.css`)**:
  - Prüft YAML-Frontmatter (Tabs, fehlende `:`, ungeschlossene Quotes, doppelte Keys, ungeschlossenes `---`), `SKILL.md`-Pflichtfelder (`name` im Lowercase-Hyphen-Format, Ordnernamen-Abgleich, `description`) sowie Markdown-Struktur (ungeschlossene Code-Fences, `#` ohne Leerzeichen, leere Links, GFM-Tabellen-Spalten).
  - Live-Status-Badge (`#status-lint-badge`) und Diagnose-Dialog (`#lint-dialog`) mit Klick-Sprung zur betroffenen Editor-Zeile (`editor.jumpToLine`).
- **Sprint 3 — Eigener Markdown-Formatter (`frontend/src/markdown-formatter.ts`, `frontend/src/__tests__/markdown-formatter.test.ts`, `frontend/src/palette-items.ts`, `frontend/src/main.ts`)**:
  - Schützt YAML-Frontmatter, Code-Fences, `$$`-Math-Blöcke sowie 2-Space-Hard-Breaks und formatiert Überschriften, Listen-Marker (`*`/`+` -> `-`), GFM-Tabellen (via `formatMarkdownTableLines`), Mehrfach-Leerzeilen und Dateiende unter Beibehaltung von `CRLF`/`LF`.
- **i18n (`frontend/src/i18n.ts`)**: Vollständige DE/EN-Übersetzungen ergänzt.

### 3. Testergebnisse & Build-Status
- `npm run typecheck` (`tsc --noEmit`): 0 Fehler.
- `npm test` (`vitest run`): 19/19 Testdateien, 110/110 Tests bestanden.
- `npm run build` (`vite build`): erfolgreich (`frontend/dist` aktualisiert).
- `npm run test:e2e` (`playwright test`): 6/6 E2E- & `@axe-core/playwright`-A11y-Tests bestanden.
- `cargo test`: 13/13 Tests bestanden (0 Warnings).

### 4. Entscheidungen & Nächste Schritte
- Bewusst ohne externe Lint-/Formatter-Dependencies (wie Prettier oder `@codemirror/lint`) umgesetzt, um `Semyra.exe` schlank zu halten und Semyra-spezifische YAML-/Prompt-/Alert-Konventionen exakt zu schützen.

---

## 2026-11-12 — Session 7: Repo-spezifische Antigravity-Skills eingerichtet

### 1. Ziel & Scope
- Einrichtung schlanker, nachhaltiger, projektspezifischer Workspace-Skills unter `.agents/skills/` für wiederkehrende Semyra-Workflows ohne Duplizierung von `AGENTS.md`.
- Struktur-, Pfad- und Testvalidierung der neuen Skills.

### 2. Durchgeführte Maßnahmen
- **`.agents/skills/semyra-ui-design/SKILL.md`** angelegt: Checkliste für `docs/PRODUCT_CONTEXT.md`-Design-Tokens (`tokens.css`, Steel Blue / Amber-Regel), Dual-Theme-Sync (`theme.ts`), WebView2- & A11y-Invarianten (kein `content-visibility: auto` auf `.markdown-body`, native `<dialog>`-Konventionen, `.tab-slot`-Semantik, deutsche UI-Texte).
- **`.agents/skills/semyra-markdown-export/SKILL.md`** angelegt: End-to-End-Checkliste für gekoppelte Änderungen über `src/markdown.rs`, `frontend/src/sanitizer.ts`, `frontend/src/sync-scroll.ts`, `src/fs_ops/html_export.rs` und `frontend/src/export-utils.ts` inkl. `is_local_asset_allowed`-Sicherheitsinvariante.
- **`.agents/skills/semyra-release/SKILL.md`** angelegt: Release- & Installer-Runbook (Versionsabgleich `Cargo.toml` / `frontend/package.json` / `installer/Semyra.iss`, `scripts/Build-Release.ps1`, `scripts/Build-Installer.ps1`).
- **`.agents/skills/semyra-codebase-review/SKILL.md`** angelegt & erweitert: Read-Only-Audit-Skill für Kohäsion, Semyra-Invarianten, Rust/TypeScript/WebView2-Best-Practices sowie **Stabilität, Nebenläufigkeit & Fehlerbehandlung** (inkl. Dry-Run- & Stabilitäts-Check).
- **Codebase-Review-Maßnahmen umgesetzt**:
  - `frontend/src/main.ts` (`openMermaidLightbox`): Statt `svgEl.outerHTML` + `body.innerHTML = svgHtml` wird nun direkt das `SVGElement` übergeben und per `body.replaceChildren(svgEl.cloneNode(true))` geklont (kein rohes `.innerHTML =` mehr auf Live-DOM in `main.ts`).
  - `frontend/src/main.ts` (`scheduleDraftSync` / `flushDraftSync`): Duplizierte `dirtyEntries`-Serialisierung und `saveDrafts`-Logik über `flushDraftSync()` dedupliziert; größere Aufteilung von `main.ts` bewusst verworfen, da Domänen-Helfer bereits sauber ausgelagert sind.
  - `frontend/src/styles/dialogs-print.css` (`@media print`): Veralteten Akzentwert `--accent: #005fb8 !important;` auf Semyras kanonischen Light-Akzent `var(--semyra-accent-light) !important` (`#426b91`) vereinheitlicht.

### 3. Testergebnisse & Build-Status
- Frontmatter- & Pfad-Validierung (`.agents/skills/*/SKILL.md`): Alle 3 Skills mit gültigem YAML-Frontmatter und 16/16 referenzierten Repo-Pfaden verifiziert.
- `npm run typecheck` (`tsc --noEmit`): 0 Fehler.
- `npm test` (`vitest run`): 17/17 Testdateien, 103/103 Tests bestanden.
- `npm run test:e2e` (`playwright test`): 6/6 E2E- & Accessibility-Tests (`@axe-core/playwright`) bestanden.
- `npm run build` (`vite build`): Erfolgreich (`frontend/dist` aktualisiert).
- `cargo check` & `cargo test`: 0 Warnings, 12/12 Tests bestanden.

### 4. Entscheidungen & Nächste Schritte
- Skills bewusst als On-Demand-Checklisten unter `.agents/skills/` abgelegt, während immer gültige Sicherheits- und Architekturregeln in `AGENTS.md` verbleiben.

---

## 2026-11-08 — Session 6: Installer-Architektur, Windows-11-Integration & ARM64-Fähigkeit

### 1. Ziel & Scope
- Analyse und Weiterentwicklung der Build- und Installer-Werkzeuge für produktiven Einsatz als echte Windows-Software.
- Vollständige Windows 11 "Standard-Apps"-Registrierung (Capabilities & RegisteredApplications) für `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` sowie Eintrag in "Installierte Apps" (Apps & Features).
- Etablierung eines automatisierten Inno-Setup-Build-Skripts (`scripts/Build-Installer.ps1`) und Anbindung an `Build-Release.ps1 -Installer`.
- Technische Prüfung der nativen ARM64-Kompilierung (`aarch64-pc-windows-msvc`).

### 2. Durchgeführte Maßnahmen
- **Inno Setup Script (`installer/Semyra.iss`) erweitert**:
  - Vollständige `Capabilities` und `RegisteredApplications`-Hierarchie für Windows 11 Default Apps.
  - Erweiterung der unterstützten Endungen: `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` in `OpenWithProgids` und `Applications\Semyra.exe\SupportedTypes`.
  - Erfolgreiche Kompilierung zu `target\installer\Semyra-Setup-x64.exe` (5,28 MB LZMA2-komprimierter Setup-Assistent).
- **PowerShell-Installer (`installer/Install-Semyra.ps1` & `Uninstall-Semyra.ps1`) modernisiert**:
  - Registriert Semyra benutzerbezogen (ohne UAC-Admin-Zwang) nach `%LOCALAPPDATA%\Programs\Semyra`.
  - Fügt Semyra zu Windows 11 "Installierte Apps" hinzu (mit Version 0.2.0, Publisher, Icon, Größe und Deinstallationsbefehl).
  - Trägt `HKCU:\Software\Semyra\Capabilities` und `HKCU:\Software\RegisteredApplications` ein, damit Semyra in den Windows-11-Einstellungen unter "Standard-Apps" wählbar ist.
- **Build-Automatisierung (`scripts/Build-Installer.ps1` & `Build-Release.ps1`)**:
  - Erstellung von `scripts/Build-Installer.ps1` mit automatischer Erkennung des Inno Setup Compilers (`ISCC.exe`).
  - Flag `-Installer` in `Build-Release.ps1` integriert.
- **ARM64-Architekturprüfung & nativer Release-Build (`aarch64-pc-windows-msvc`)**:
  - Rustup-Target `aarch64-pc-windows-msvc` hinzugefügt.
  - MSVC ARM64-Toolchain (`Hostx64\arm64\link.exe`, `cl.exe`, CRT-Libs) durch Installation von `Microsoft.VisualStudio.Component.VC.Tools.ARM64` erfolgreich bereitgestellt.
  - `cargo build --release --target aarch64-pc-windows-msvc` fehlerfrei ausgeführt: Natives Windows on ARM Binary `target\aarch64-pc-windows-msvc\release\Semyra.exe` (10,91 MB) kompiliert.
  - PE-Header-Prüfung (`dumpbin /headers`) bestätigt: `AA64 machine (ARM64)`.
  - `installer/Semyra.iss` auf Multi-Architektur (ISPP-Bedingung `/DArch=arm64` bzw. `x64`) erweitert.
  - `scripts/Build-Installer.ps1 -Architecture all` baut automatisiert beide Setup-Installationsassistenten: `Semyra-Setup-x64.exe` (5,28 MB) und `Semyra-Setup-arm64.exe` (5,16 MB).

### 3. Testergebnisse & Build-Status
- `scripts/Build-Installer.ps1 -Architecture all`:
  - `target\installer\Semyra-Setup-x64.exe` (5,28 MB) erfolgreich erzeugt.
  - `target\installer\Semyra-Setup-arm64.exe` (5,16 MB) erfolgreich erzeugt.
- `cargo build --release --target aarch64-pc-windows-msvc`: Erfolgreich (AA64 machine, 10,91 MB).
- `cargo check --target aarch64-pc-windows-msvc`: 0 Fehler (115/115 Crates verifiziert).
- `cargo test`: 12/12 Tests bestanden.

---

## 2026-11-08 — Session 5: Bereinigung des lokalen Build-Caches (`target/`) & Release-Verifikation

### 1. Ziel & Scope
- Vollständige Bereinigung veralteter, nicht getrackter Build-Artefakte aus früheren Kompiliervorgängen (unter dem alten Projektnamen MarkLive) aus dem lokalen `target/`-Verzeichnis.
- Rebuild und End-to-End-Verifikation mit `scripts/Build-Release.ps1`.

### 2. Durchgeführte Maßnahmen
- **Cargo Cache Purge**: Ausführung von `cargo clean`, wodurch 6.924 veraltete Dateien (4,0 GiB) inklusive aller alten `MarkLive.*`-Binärdateien und Fingerprints rückstandslos entfernt wurden.
- **Dateisystemprüfung**: Rekursiver Check über das gesamte Repository bestätigt: Außerhalb von `.git` und der historischen Dokumentation in `WORK_LOG.md` existieren keinerlei Dateien oder Verzeichnisse mehr mit `marklive` im Namen.
- **End-to-End Release Build**: Saubere Neuerstellung von Frontend und nativem Windows 11 Host über `scripts/Build-Release.ps1`.

### 3. Testergebnisse & Build-Status
- `npm run typecheck` (`tsc --noEmit`): 0 Fehler.
- `npm test` (Vitest): 17/17 Testdateien, 103/103 Tests bestanden (4,56s).
- `npm run build` (Vite): Produktionsbundle in `frontend/dist` fehlerfrei generiert.
- `cargo test`: 12/12 Rust-Unit-Tests bestanden (0,11s).
- `cargo build --release`: Standalone-Binary `target/release/Semyra.exe` (10,85 MB) erfolgreich und sauber kompiliert.

---

## 2026-11-08 — Session 4: GitHub README Transformation & Produkt-Showcase

### 1. Ziel & Scope
- Neugestaltung von [`README.md`](README.md) für den GitHub-Auftritt: Fokus auf eine hochwertige, produktzentrierte Vorstellung ("Markdown for the AI era"), bevor die technischen Spezifikationen und Entwicklungsanleitungen folgen.

### 2. Durchgeführte Maßnahmen
- **Hero-Bereich mit Badges**: Badges für Windows 11 x64, Rust 2021 Host, CodeMirror 6 / TypeScript, Standalone EXE (~10.8 MB), Zero Node.js/Electron Runtime und MIT-Lizenz.
- **Produktvorstellung & Kernvorteile**:
  - Klare Value-Proposition für Entwickler, Prompt-Designer und AI-Engineers.
  - Strukturierte Feature-Karten für Desktop-Performance, Semyra Fluent Design (Midnight/Slate & White/Slate, Steel Blue, Amber Dirty Indicator), GFM & KaTeX/Mermaid-Unterstützung, smartes Editing, Workspace-Navigation und Standalone-Export.
- **Tastatur-Kurzbefehle**: Übersichtliche Schnellreferenz für die wichtigsten Shortcuts.
- **Installation & Setup**: Portable Ausführung, 1-Klick Explorer-Integration (`Install-Semyra.ps1`) und Inno-Setup Installer (`Semyra.iss`).
- **Technische Spezifikationen & Architektur**: Mermaid-Architekturdiagramm (Rust Host -> IPC -> CodeMirror/DOM), Technologiematrix und Build-Anleitung.
- **Projektstruktur & Querverweise**: Direkte Verlinkung zu `docs/PRODUCT_CONTEXT.md`, `AGENTS.md` und `WORK_LOG.md`.

### 3. Testergebnisse & Build-Status
- Markdown-Rendering & Mermaid-Syntax validiert.
- `git grep -i "marklive"`: 0 Treffer im gesamten Repository.
- Git-Push: Alle Commits sauber auf GitHub `origin/main` (`https://github.com/JanChrisLoew/semyra.git`) gepusht.

---

## 2026-11-08 — Session 3: Vollständiges Rebranding-Abschlussreview, Repository-Bereinigung & Product Context

### 1. Ziel & Scope
- Vollständige Beseitigung aller verbliebenen MarkLive-Artefakte, Pfade, Protokoll-Handler und Konfigurations-Keys im gesamten Repository.
- Etablierung von [`docs/PRODUCT_CONTEXT.md`](docs/PRODUCT_CONTEXT.md) als verbindliche Produkt- und Designspezifikation für zukünftige Entwicklungen.
- Bereinigung von Legacy-Dokumenten und Bereitstellung der neuen Semyra-Inno-Setup- und PowerShell-Installer-Skripte.

### 2. Durchgeführte Maßnahmen
- **Repository-Bereinigung (`git grep -i "marklive"` -> 0 Treffer)**:
  - `src/main.rs`: Entfernung des alten `marklive`-Protokoll-Handlers (`marklive://`, `https://marklive.localhost`), Aktualisierung von Window-Title und Navigation-Checks.
  - `src/fs_ops/mod.rs` & `src/fs_ops/html_export.rs`: Entfernung des Legacy-AppData-Fallbacks (`%LOCALAPPDATA%\MarkLive`) und Asset-URL-Checks.
  - `src/icon_gen.rs`: Säuberung der internen Funktionssignaturen auf `render_semyra_rgba`.
  - `frontend/src/api.ts` & `frontend/src/main.ts`: Entfernung von `window.__markliveReceive` und alten `marklive.*` LocalStorage-Fallbacks. Type-Narrowing-Korrekturen in `saveTab` für strikte TypeScript-Konformität.
  - `frontend/src/i18n.ts` & `frontend/index.html`: Entfernung aller `(ehemals MarkLive)`-Texthinweise.
  - Test-Suiten aktualisiert: Sämtliche Dummy-Dateinamen und Pfade in `palette.test.ts`, `palette-items.test.ts`, `workspace-search.test.ts`, `sidebar-explorer.test.ts`, `token-utils.test.ts`, `editor-smart.test.ts` und `layout-matrix.spec.ts` auf Semyra umgestellt.
  - Legacy-Dateien gelöscht: `docs/DEV_AGENT_IMPLEMENTIERUNGSPROMPT.md`, `docs/SEMYRA_PRODUKTIDENTITAET_UND_REBRANDING.md`.
  - Installer modernisiert: `installer/Semyra.iss`, `installer/Install-Semyra.ps1`, `installer/Uninstall-Semyra.ps1`.
- **Product Context & Architektur-Governance**:
  - [`docs/PRODUCT_CONTEXT.md`](docs/PRODUCT_CONTEXT.md) im Repository verankert (inkl. Farbdefinitionen, Tab-Zuständen, Invarianten, Export-Standards).
  - In [`AGENTS.md`](AGENTS.md) verbindlich vorgeschrieben, dass `docs/PRODUCT_CONTEXT.md` für alle zukünftigen UI-, Theme- und Feature-Umbauten konsultiert werden muss.
- **Git-Workflow**:
  - Feature-Branch `feat/rebrand-semyra` erstellt, alle Änderungen atomar committed, erfolgreich in `main` gemergt und den Branch bereinigt.

### 3. Testergebnisse & Build-Status
- `tsc --noEmit`: 0 Typfehler.
- `vitest run`: 17/17 Testdateien erfolgreich, 103/103 Tests bestanden (4,37s).
- `cargo test`: 12/12 Rust-Unit-Tests erfolgreich bestanden (0,12s).
- `cargo check`: Fehlerfrei durchgelaufen.
- `scripts/Build-Release.ps1`: Erfolgreich gebaut (`target/release/Semyra.exe`, 10,85 MB).

---

## 2026-11-08 — Session 2: UI-Polish Iteration 2 (Neutrale Typografie & Tab-Speicherstatus)

### 1. Ziel & Scope
- Wiederherstellung neutraler Markdown-Textfarben im Editor und in der Vorschau (Beseitigung warmer Sand-/Beigetöne im Fließtext, Kursivschrift und Überschriften).
- Ergänzung eines dezenten, layoutsprungfreien Statuspunkts für ungespeicherte Änderungen in der Tab-Leiste (Dark: `#D0A774`, Light: `#986C3D`).
- Harmonisierung der Interaktionsakzente auf Steel Blue (`#83A5C6` Dark / `#426B91` Light).

### 2. Durchgeführte Maßnahmen
- **Markdown-Typografie (`tokens.css`, `markdown.css`)**:
  - `--color-text-primary` (`#EDF2F5` Dark / `#202934` Light) konsequent für Fließtext, Kursivschrift (`font-style: italic`), Fettschrift (`font-weight: 600`) und Blockquotes etabliert.
  - Warme Beigetöne aus Fließtext und Überschriften entfernt; Farbkodierung bleibt reserviert für Syntax-Tokens, Code, Links und Status.
- **Tab-Speicherstatus (`main.ts`, `chrome.css`, `tokens.css`)**:
  - CSS-Token `--color-status-dirty`: `#D0A774` (Dark) und `#986C3D` (Light).
  - Separater Indikator-Container `.tab-dirty-slot` (12px Breite) im festen 180px-Tab-Slot positioniert.
  - Bei ungespeicherten Änderungen rendert ein 6x6px runder Punkt (`.tab-dirty-indicator`) mit sanfter Einblend-Animation und Tooltip (`Ungespeicherte Änderungen`).
  - In-Place DOM-Aktualisierung bei Textänderungen und automatische Entfernung nach Save / Save-As / Auto-Save ohne Neu-Rendern der Tab-Leiste oder Layoutsprünge.
- **Interaktionsfarben**:
  - Fokus-Ringe, Segmented Controls, aktive Palette-Elemente und Treeview-Selektionen einheitlich an Steel Blue gekoppelt.

### 3. Testergebnisse & Build-Status
- `tsc --noEmit`: Bestanden.
- `vitest run`: 103/103 Tests bestanden.
- `cargo test`: 12/12 Tests bestanden.
- Standalone Release-Build erfolgreich validiert.

---

## 2026-11-08 — Session 1: Semyra UI- & Brand-System (Phase 1 Rebranding)

### 1. Ziel & Scope
- Umstellung der visuellen Produktidentität von MarkLive auf Semyra ("Markdown for the AI era").
- Einführung des soliden Fluent-Designsystems mit Midnight, Slate, Steel, Ice White, Steel Blue und Warm Beige/Amber.
- Eigenständige prozedurale Multi-DPI-Icon-Generierung in Rust für PE `.exe`-Ressourcen (`winres`) und Laufzeit-Fenster-Icon.

### 2. Durchgeführte Maßnahmen
- Rust-Backend: `src/icon_gen.rs` mit mathematisch gerendertem Semyra-S-Monogramm (Antialiased Geometrie in 16, 32, 48, 256 px).
- CSS-Tokensystem: Überarbeitung von `tokens.css` mit `light-dark()` Variablen für Fluent-Surfaces, Borders und Kontraste.
- UI-Komponenten: Überarbeitung von Header, Sidebar, Quick-Open-Palette, Search-Panel und Tab-Slot-Layout.
- Erstellung des umfassenden Reviews `SEMYRA_REBRANDING_ABSCHLUSSREVIEW.md`.

---
