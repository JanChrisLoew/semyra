# Semyra — Konzeptpapier zur Produktumbenennung und visuellen Identität

**Version:** 1.0 (Entscheidungsvorlage und Implementierungsspezifikation)  
**Stand:** 08.11.2026  
**Bisheriger Produktname:** MarkLive  
**Neuer Produktname:** Semyra  
**Produkttyp:** Lokale, native Windows-11-Desktop-Anwendung für Markdown; Rust-basierter Kern, WebView2-basierte Oberfläche  
**Plattformen:** Windows 11, x86-64 und ARM64 als Zielarchitekturen; vorhandene Build- und Release-Konfiguration ist maßgeblich  
**Status:** Vorgeschlagener interner Designstandard; externe Markenfreigabe separat prüfen.

---

## 1. Zweck und Geltungsbereich

Dieses Dokument definiert den Wechsel von **MarkLive** zu **Semyra**, die beabsichtigte Produktidentität und einen verbindlichen, implementierbaren Satz an Designregeln für Dark und Light Mode. Es ist eine **gezielte Evolution des bestehenden Produkts und kein Redesign**.

**In Scope:** sichtbarer Produktname, produktbezogene Metadaten, App-Icon/Logo-Integration, About-Ansicht, installer- und buildbezogene Produktbezeichnungen, konsistente Theme-Tokens und ausgewählte UI-Zustände; Dokumentation, Tests und erforderliche Migrationen.

**Out of Scope:** grundsätzliche Neuordnung des Layouts, Austausch des Editors/Renderers, Änderung der Markdown-Semantik, neue KI-Funktionalität, Änderung der Dateiformat-Unterstützung, pauschaler Austausch der Syntaxfarben und ungeprüfte Umbenennung persistenter technischer IDs.

**Referenz:** Der Ist-Zustand entspricht den bereitgestellten Screenshots der MarkLive-Anwendung: Dateiexplorer links, Editor-/Split-/Preview-Modi, Tabs und Toolbar oben, Statusleiste unten, Settings-Dialog; vorhandene Dark- und Light-Ansichten. Diese Informationsarchitektur bleibt erhalten.

## 2. Warum MarkLive zu Semyra wird

### 2.1 Ausgangslage

„MarkLive“ beschreibt relativ direkt Markdown und Live-Vorschau. Der Name ist funktional, aber stark an ein einzelnes Merkmal gebunden. Die Anwendung adressiert inzwischen einen breiteren Workflow: Markdown **lesen, bearbeiten, rendern und strukturieren**, auch wenn `.md`-Dateien in KI-gestützten Entwicklungsprozessen als Prompts, Skills, Agentenanweisungen oder Kontextdokumente verwendet werden.

### 2.2 Entscheidung

**Semyra** ist die Produktmarke; **„Markdown for the AI era.“** ist der primäre Claim und erläutert die Spezialisierung. Semyra bezeichnet weiterhin ein lokales Markdown-Werkzeug, nicht eine eigene KI-Plattform. Der Name muss nicht selbst „AI“ oder „Markdown“ enthalten, weil Untertitel und Produktbeschreibung diesen Kontext eindeutig vermitteln.

### 2.3 Bedeutung und sprachliche Herleitung

„Semyra“ ist ein **modernes Kunstwort**, konzeptionell inspiriert durch altgriechisch **σημεῖον (*sēmeîon*) = Zeichen/Kennzeichen** und die Begriffswelt der Semantik. Es ist **kein historisches griechisches Wort und keine wörtliche Übersetzung von „Markdown“**. Die gewählte Herleitung verweist darauf, dass Markdown aus einfachen, bedeutungstragenden Zeichen lesbare Strukturen macht. Die Wortendung „-yra“ dient der Eigenständigkeit und dem Klang, ohne beanspruchte sprachhistorische Bedeutung.

**Merksatz:** „Semyra macht strukturierte Textdateien für Menschen verständlich und für moderne KI-Workflows gut handhabbar.“

### 2.4 Strategische Gründe

1. **Langlebigkeit:** Der Name bleibt gültig, wenn Skills, Agentenanweisungen und Mermaid wichtiger werden oder weitere textbasierte Formate hinzukommen.
2. **Unterscheidbarkeit:** Eigenständigere Markenanmutung als eine rein beschreibende Kombination aus „Mark“ und „Live“.
3. **Produktnähe:** Anders als ein generischer KI-Name verspricht Semyra keine Chatbot- oder Modellfunktionen, die nicht Teil der Anwendung sind.
4. **Konsistenz:** Ein kurzer Produktname ist in Titelzeile, Einstellungen, Installer, Icons und Repository-Dokumentation leichter einheitlich darzustellen.

**Markenrechtlicher Vorbehalt:** Eine gleichlautende EU-Wortmarke in einer anderen Warenklasse wurde bei der Vorrecherche identifiziert. Die öffentliche kommerzielle Verwendung, Domain-Entscheidung und eventuelle Registrierung setzen eine gesonderte professionelle Marken- und Ähnlichkeitsprüfung voraus. Dieses Konzept ist **keine** Markenfreigabe.

## 3. Produktidentität und Positionierung

### 3.1 Produktdefinition

> **Semyra ist ein lokaler, schneller, fokussierter Markdown-Viewer und -Editor für das KI-Zeitalter.** Die Anwendung erleichtert das Lesen, Bearbeiten, Prüfen und Visualisieren strukturierter `.md`-Dateien – von Dokumentation über Prompts bis zu Skills und Agentenanweisungen.

### 3.2 Zielgruppen und typische Anwendungsfälle

- Entwicklerinnen und Entwickler, die `README.md`, `AGENTS.md`, `SKILL.md` und Dokumentation bearbeiten.
- Power-User, die Prompts und Kontextdateien für LLMs lesbar prüfen und versionieren.
- Nutzende, die Markdown mit Live-Preview, Syntaxdarstellung und Mermaid-Diagrammen lesen oder bearbeiten möchten.

### 3.3 Markenattribute

**Primär:** präzise, ruhig, klar, verlässlich.  
**Sekundär:** performant, lokal, modern, kompetent.  
**Nicht:** verspielt, bunt, „AI-magisch“, marketinglastig, überfrachtet.

### 3.4 Markenversprechen und Claims

- **Primärer Claim:** `Markdown for the AI era.`
- **Produktbeschreibung, kurz (DE):** `Semyra ist ein nativer Markdown-Viewer und -Editor für Windows – entwickelt für Dokumentation, Prompts, Skills und Agentenanweisungen.`
- **Produktbeschreibung, kurz (EN):** `A native Markdown viewer and editor for documentation, prompts, skills, and agent instructions.`
- **Funktionsnahe Dreierformel:** `Read. Edit. Structure.`

**Wichtig:** „AI-native“ darf nur in einem erklärenden Sinn für den unterstützten Workflow verwendet werden. Keine Werbung für integrierte LLMs, automatische Generierung oder agentische Ausführung, solange diese Funktionen tatsächlich nicht existieren.

### 3.5 Namens- und Schreibregeln

| Kontext | Verbindliche Schreibweise |
|---|---|
| Produkt in Text, Titelleisten, Dialogen, Installer | **Semyra** |
| Grafische Wortmarke, falls als Logo gesetzt | **semyra** (Kleinschreibung zulässig) |
| Claim | **Markdown for the AI era.** |
| Frühere Bezeichnung in Migrationshinweis | **MarkLive (previously)** / **ehemals MarkLive** |
| Technische Bezeichner | erst nach Impact-Analyse; siehe Abschnitt 8 |

Keine wechselnden Schreibweisen wie `SemyRA`, `Semyra AI`, `SEMYRA` in normaler Produkt-UI. Der Claim ist kein Bestandteil des Windows-Executable-Namens.

## 4. Leitprinzipien für das visuelle System

1. **Evolution statt Redesign:** Bestehende Panelaufteilung, UI-Dichte, Commands, Tastaturkürzel und Interaktionen bleiben bestehen.
2. **Neutral-first:** Neutrale Graublau- und gebrochene Weißtöne dominieren. Akzente dienen Bedienzuständen, nicht Dekoration.
3. **Dark und Light gleichwertig:** Alle Komponenten haben definierte semantische Tokens in beiden Themes.
4. **Dokument im Mittelpunkt:** Keine gefärbten Vollflächen hinter dem Lesetext, nur um die Marke stärker zu zeigen.
5. **Funktionsfarben sind keine Markenfarben:** Fehler, Warnung, Erfolg und Syntaxmarkierung müssen visuell unterscheidbar bleiben.
6. **Systemnähe:** Bestehende Windows-11-Anmutung, native Dialoge, hoher Kontrast und gut lesbare Dichte bewahren.
7. **Keine unnötigen neuen Abhängigkeiten:** Vorhandenes CSS-/Theme-System weiterverwenden, keine UI-Library allein für das Rebranding einführen.

## 5. Farbsystem — verbindliche Design-Tokens

### 5.1 Grundregel

Die folgenden Hex-Werte sind die **Soll-Design-Tokens**, keine Behauptung über bereits vorhandene CSS-Werte. Die Implementierung ordnet bestehende Farben schrittweise semantischen Tokens zu, statt jeden hartcodierten Farbwert blind zu ersetzen.

### 5.2 Core Surface + Text

| Semantisches Token | Dark Mode | Light Mode | Verwendung |
|---|---|---|---|
| `--color-canvas` | `#151A22` | `#FFFFFF` | primäre Editor- und Preview-Fläche |
| `--color-chrome` | `#171D25` | `#F3F5F7` | Toolbar, Tabs, Statusbar |
| `--color-sidebar` | `#1D242E` | `#F7F8FA` | Dateiexplorer / Navigation |
| `--color-surface` | `#222A35` | `#FFFFFF` | Settings-Cards, Menüs, Popovers |
| `--color-surface-raised` | `#293340` | `#F1F3F6` | Hoverflächen, abgesetzte Controls |
| `--color-border` | `#36414D` | `#DCE2E8` | Trennlinien, Konturen |
| `--color-text-primary` | `#EEF3F7` | `#202934` | normaler UI- und Preview-Text |
| `--color-text-secondary` | `#A9B5C2` | `#526172` | Hilfstexte, sekundäre Metadaten |
| `--color-text-muted` | `#8E9BA9` | `#667687` | wenig betonte Icons / Metadaten |
| `--color-text-inverse` | `#151A22` | `#FFFFFF` | Text auf betont dunklen/hellen Akzentflächen, nach Kontrastprüfung |

**Dark:** Midnight/Slate; keine reine Schwarzfläche `#000000`.  
**Light:** Haupt-Dokumentenfläche bleibt *reinweiß*; kein großflächiger beige getönter Lesebereich. Hellgraue Navigation wird beibehalten.

### 5.3 Interaktions- und Akzent-Tokens

| Token | Dark Mode | Light Mode | Verwendung |
|---|---|---|---|
| `--color-accent` | `#83A5C6` | `#426B91` | primärer ruhiger Steel-Blue-Akzent |
| `--color-accent-hover` | `#9DB8D2` | `#345B7E` | Hover bei Akzentaktionen |
| `--color-accent-subtle` | `#283A4C` | `#E5EDF5` | aktive Tabs, Auswahlhintergrund |
| `--color-accent-border` | `#5E809F` | `#A7BDD0` | Kontur ausgewählter Controls |
| `--color-focus-ring` | `#A3C4DF` | `#345F86` | klar sichtbarer Tastaturfokus |
| `--color-teal-subtle` | `#63B9AC` | `#267D73` | sehr selten: positiver/gezielter Funktionsakzent |
| `--color-warm-neutral` | `#D8D0C3` | `#D8D0C3` | Branding-/Illustrationsakzent, nicht Grundfläche |

**Verbindliche Akzenthierarchie:** Steel Blue ist die reguläre Interaktionsfarbe. Teal ist *kein* zweiter gleichberechtigter Primärakzent; niemals großflächig und nicht parallel auf denselben UI-Elementen. Beige dient primär Branding und kleinen warmen Nuancen; **nicht** für Standardbuttons, Navigation oder Dokumenthintergründe. Semantische Error-/Warning-/Success-Tokens aus der vorhandenen App behalten, anschließend nur bei Bedarf auf Kontrast prüfen.

### 5.4 Spezifische UI-Regeln

| Bereich | Dark Mode | Light Mode | Verbindliches Verhalten |
|---|---|---|---|
| Titel-/Menüleiste | `chrome` | `chrome` | zurückhaltend; bestehendes Layout behalten |
| Dateiexplorer | `sidebar` | `sidebar` | ausgewählte Datei über `accent-subtle`, ggf. feine Akzentkante |
| Editor | `canvas` | `canvas` | keine Markenflächen hinter dem Quelltext |
| Preview | `canvas` | `canvas` | Lesbarkeit und bestehende Typografie priorisieren |
| Editor-/Preview-Splitter | `border` | `border` | dünne funktionale Trennung |
| Tabs/Moduswechsel | `chrome`, aktiv: `accent-subtle` | entsprechend | aktive Zustände auch ohne Farbe identifizierbar |
| Menüs/Popovers | `surface` | `surface` | leichter Rand, nur sehr dezenter Schatten |
| Settings | `surface`/`canvas` | `surface`/`canvas` | bestehende Card-Gruppen und Dichte bewahren |
| Toggle aktiv | `accent` | `accent` | kein grelles Cyan, Status zusätzlich über Schalterstellung |
| Statusbar | `chrome` | `chrome` | zurückhaltende Metadaten, ausreichender Textkontrast |
| Markdown-Codeblöcke | bestehende dezente, vom Canvas unterscheidbare Fläche | entsprechend | Syntax-Theme separat behandeln |
| Mermaid | Canvas-konform | Canvas-konform | Text/Linien/Knoten in beiden Themes kontrastfähig |

**Syntax-Highlighting:** Nicht pauschal an die Markenpalette angleichen. Tokens für Code-Syntax, Links, Diff, Warnhinweise und Mermaid besitzen fachliche Semantik. Vorhandene gut lesbare Syntaxfarben bleiben zunächst erhalten. Nur offenkundige Kontrast- oder Inkonsistenzprobleme gezielt korrigieren.

### 5.5 Interaktionszustände und Barrierefreiheit

- **Hover:** subtiler Surface-Wechsel; kein Glow.
- **Selected/Active:** Akzentfläche plus Form, Kontur, Häkchen oder Position; nie ausschließlich durch Farbunterschied erklären.
- **Keyboard Focus:** sichtbarer Fokusrahmen in `focus-ring` mit hinreichender Abhebung gegen beide angrenzenden Flächen.
- **Disabled:** geringerer visueller Kontrast, aber weiterhin identifizierbar; wichtige Zustandsinformationen dürfen nicht verschwinden.
- **Kontrast:** normale UI-Texte nach Möglichkeit mindestens **4,5:1**, größere Texte mindestens **3:1**, relevante nichttextuelle UI-Grenzen und Fokusindikatoren mindestens **3:1** gegen relevante Nachbarfarben prüfen. Die angegebenen Token sind Entwurfswerte; Komponenten-Kombinationen müssen mit Messung validiert werden, nicht aus dem Bauch heraus.
- **Motion:** keine animierten Marken-Glows; OS-Präferenz für reduzierte Bewegung respektieren.
- **System Theme:** `System` folgt der Windows-Einstellung; `Light` und `Dark` überschreiben diese explizit. Theme-Wechsel dürfen nicht Editorinhalt, Auswahl oder Dateistatus beeinflussen.

### 5.6 Empfohlene CSS-Umsetzung (Beispiel, nicht Framework-Vorschrift)

```css
:root[data-theme="dark"] {
  --color-canvas: #151A22;
  --color-chrome: #171D25;
  --color-sidebar: #1D242E;
  --color-surface: #222A35;
  --color-surface-raised: #293340;
  --color-border: #36414D;
  --color-text-primary: #EEF3F7;
  --color-text-secondary: #A9B5C2;
  --color-text-muted: #8E9BA9;
  --color-accent: #83A5C6;
  --color-accent-hover: #9DB8D2;
  --color-accent-subtle: #283A4C;
  --color-accent-border: #5E809F;
  --color-focus-ring: #A3C4DF;
  --color-teal-subtle: #63B9AC;
  --color-warm-neutral: #D8D0C3;
}

:root[data-theme="light"] {
  --color-canvas: #FFFFFF;
  --color-chrome: #F3F5F7;
  --color-sidebar: #F7F8FA;
  --color-surface: #FFFFFF;
  --color-surface-raised: #F1F3F6;
  --color-border: #DCE2E8;
  --color-text-primary: #202934;
  --color-text-secondary: #526172;
  --color-text-muted: #667687;
  --color-accent: #426B91;
  --color-accent-hover: #345B7E;
  --color-accent-subtle: #E5EDF5;
  --color-accent-border: #A7BDD0;
  --color-focus-ring: #345F86;
  --color-teal-subtle: #267D73;
  --color-warm-neutral: #D8D0C3;
}
```

Falls die bestehende App Klassen statt `data-theme` verwendet, **keinen Theme-Mechanismus nur wegen dieses Beispiels austauschen**. Tokens an vorhandene Architektur anbinden, ohne Seiteneffekte auf WebView2 oder Theme-Persistenz.

## 6. Logo, Typografie und Iconografie

### 6.1 Logo-Strategie

**Designbrief, noch keine freigegebene finale Vektordatei:** flaches, geometrisches, gut erkennbares **S-Monogramm**, abgeleitet aus zwei bis drei versetzten Strich-/Textsegmenten. Die Form darf die Idee von strukturierten Zeichen andeuten. Sie soll eigenständig sein, aber nicht wie ein generisches KI-Sparkle, Roboterkopf oder Augensymbol aussehen.

**Vorgaben:**
- Primärlogo monochrom: hell auf Midnight, dunkel auf Ice White.
- Optionale Akzentversion mit **einem** dezenten Steel-Blue-Detail; keine bunten oder 3D-Verläufe.
- 16, 20, 24, 32, 48, 64, 128 und 256 px prüfen; ab 16 px keine filigranen Details.
- Wortmarke `semyra` in zurückhaltender serifenloser Schrift; keine dekorative KI-Symbolik.
- App-Icon braucht ausreichenden Sicherheitsabstand und muss auf hellen und dunklen Windows-Taskleisten erkennbar bleiben.
- **Keine** automatisierte blinde Ersetzung des bisherigen Icons, bevor ein freigegebenes Masterasset vorliegt. Bis dahin bestehendes Icon funktional erhalten oder einen explizit als vorläufig markierten neutralen Platzhalter verwenden.

### 6.2 Typografie

- **UI:** bestehende gut lesbare Windows-nahe Sans-Serif beibehalten (z. B. Segoe UI / vorhandener Font-Stack). Neue Webfont-Abhängigkeit ist nicht Teil des Rebrandings.
- **Marketing/Wortmarke:** Inter oder Geist als gestalterische Orientierung; Nutzung nur bei sauberer Einbindung/Lizenzierung.
- **Quelltext:** vorhandene Monospace-Schrift und Editor-Metriken beibehalten. JetBrains Mono ist eine optionale, nicht verpflichtende Alternative.
- **Hierarchie:** bestehende Überschriften- und Zeilenhöhen möglichst beibehalten; Kontrast und Zustände wichtiger als neue Schriftgewichte.

### 6.3 Icons

Ein konsistenter, reduzierter Linienstil. Gewichte, optische Größe und Ausrichtung in Toolbar, Explorer und Settings harmonisieren. Keine dekorativen Markenicons an jeder Stelle. Dateityp-Icons dürfen weiterhin funktional unterscheidbar sein.

## 7. Tonalität, Microcopy und Nutzerkommunikation

- Deutsch und Englisch sachlich, präzise, knapp; Produktbegriffe konsistent übersetzen.
- Verben bevorzugen: **Öffnen, Bearbeiten, Vorschau, Exportieren, Speichern**.
- Funktionsbeschreibung statt Marketingfloskeln. Nicht „revolutionary“, „magical“ oder „AI-powered“, sofern keine echte KI-Funktion implementiert ist.
- `Semyra` in About, Fenstertitel und Hilfetexten; bestehende Versionsnummer und Shortcuts beibehalten.
- README-Rebranding mit einem einmaligen Hinweis: `Semyra (formerly MarkLive)`; nach Übergangszeit nur noch `Semyra`, sofern keine Migration dokumentiert werden muss.

## 8. Technische Umbenennung und Datensicherheit

**Grundsatz:** Der sichtbare Markenwechsel ist unabhängig von technischen Persistenz- und Kompatibilitätsbezeichnern umzusetzen. Erst inventarisieren, dann ändern.

### 8.1 Inventar vor jeder Änderung

Suche im gesamten Repository **case-insensitive** nach: `MarkLive`, `marklive`, `MARKLIVE`, `MarkLive.exe`, `marklive.localhost` sowie AppData-Pfaden, App-IDs, Protokollen, Registry-/Installer-Schlüsseln, Paketnamen, Build-Artifacts, Dateizuordnungen, Update-Konfiguration und Testfixtures. Dokumentiere Treffer in drei Klassen:

- **A — Anzeige/Branding:** sicher auf `Semyra` umstellen (Fenstertitel, About, Dokumentation, Installer-Anzeigename).
- **B — Release-Artefakte:** kontrolliert umbenennen (z. B. künftiger EXE-Dateiname, Installer, Icon-Assets), Auswirkungen auf Skripte/Tests prüfen.
- **C — Persistenz/Identität:** **nicht automatisch umbenennen**, z. B. `%LOCALAPPDATA%\MarkLive`, gespeicherte Recovery-Dateien, WebView2 UserDataFolder, `marklive.localhost`, Registry-Identitäten, ApplicationUserModelID, Protokollhandler, Update-Kanäle.

### 8.2 Migration statt Datenverlust

- Vorliegende App kann Session-Recovery, Drafts, Einstellungen, zuletzt geöffnete Dateien, Fenstergeometrie und Split-Verhältnis persistieren. Diese Daten dürfen nicht verloren gehen.
- Für Kategorie C entweder **kompatible Legacy-IDs beibehalten** (technische Bezeichner dürfen unsichtbar „MarkLive“ heißen) **oder** eine explizite, getestete Einmalmigration mit Sicherung/Rollback implementieren.
- Migration muss **idempotent** sein (wiederholter Start erzeugt keine Duplikate/Überschreibungen) und Konfliktfälle abdecken (Alt- und Neupfad existieren gleichzeitig).
- Dateizuordnungen und „Open with“-Einträge bei einem EXE-Rename neu prüfen; alte Verknüpfungen nicht ungeprüft zerstören.
- Origin-Änderung (`marklive.localhost`) kann WebView2-Speicher, CSP, CORS, Ressourcenpfade und Berechtigungen betreffen: **nicht ohne eigenständige Migrationsentscheidung ändern**.
- Repo-Ordner, interne Crate-/Package-IDs und bestehende URLs dürfen zunächst bestehen bleiben, falls eine Umbenennung hohe Risiken oder keinen Nutzwert hat.

### 8.3 Build-Ziele

Windows-11-Builds für x86-64 und ARM64 berücksichtigen, soweit in der vorhandenen Pipeline unterstützt. Die konkrete Rust-Zielplattform, Toolchain, WebView2-Verpackung und Signierung nach Ist-Analyse übernehmen; keine Architekturfähigkeit behaupten, die nicht in CI tatsächlich gebaut und getestet wird.

## 9. Umsetzung in Phasen

**Phase 0 — Baseline:** Screenshots/Teststand beider Themes, vorhandene Token- und Dateistruktur, Architektur, Persistenzpfade, Build-Kommandos und Release-Ziele dokumentieren.

**Phase 1 — Branding ohne Datenrisiko:** sichtbare Namen, About-/Help-Texte, README, App-Metadaten und ggf. Fenster-/Installer-Anzeigename ändern; Logos nur nach Asset-Freigabe.

**Phase 2 — Tokens:** semantische Theme-Variablen ergänzen und schrittweise zuweisen; Toolbar, Tabs, Sidebar, Settings, Controls in beiden Themes angleichen. Code-Highlighting zunächst unverändert.

**Phase 3 — Kompatibilität:** kontrolliert EXE-/Installer-Artefakte, Dateizuordnungen, Recovery-/Settings-Migration und WebView2-Risiken bearbeiten. Jeweils Migrationstest vor Umstellung.

**Phase 4 — Abnahme:** beide Themes, Editor-/Split-/Preview, Menüs, Settings, Keyboard Focus, Zoom, Scrolling, Mermaid, Fensterzustand, Sessions, Restore, Installer und beide Zielarchitekturen (wo verfügbar) testen.

## 10. Definition of Done / Abnahmekriterien

- [ ] Alle **sichtbaren** regulären Produktnennungen lauten „Semyra“; Übergangshinweis „ehemals MarkLive“ nur dort, wo beabsichtigt.
- [ ] Beide Themes implementieren die semantischen Tokens; keine sichtbaren Hardcode-Ausreißer in den Kernkomponenten.
- [ ] Light Mode behält weiße Markdown-Vorschau und neutrale Sidebar; Dark Mode bleibt Midnight/Slate.
- [ ] Steel Blue ist primärer Interaktionsakzent; Teal/Beige bleiben sparsam und funktional.
- [ ] Layout, Split-Modi, Shortcuts, Editorverhalten, Mermaid und Export bleiben regressionsfrei.
- [ ] Settings, gespeicherte Sitzungen, Drafts/Recovery und zuletzt geöffnete Dateien gehen durch Update nicht verloren.
- [ ] Theme-System-Option folgt Windows; Dark/Light werden stabil persistiert.
- [ ] Tastaturfokus und relevante Kontraste in beiden Themes überprüft und dokumentiert.
- [ ] Light-/Dark-Screenshots der Kernansichten und Settings wurden verglichen.
- [ ] Erfolgreiche Tests/Lint/Builds dokumentiert; Architekturziel nur als bestanden melden, wenn tatsächlich ausgeführt.
- [ ] Abschlussbericht nennt geänderte Dateien, absichtlich belassene Legacy-IDs, Migrationen, Restrisiken und offene Punkte (insbesondere Logo/Marke).

## 11. Bewusst offene Entscheidungen

1. **Logo-Masterasset:** Bis zur Freigabe liegt nur ein verbindliches Gestaltungsbriefing vor, kein finales SVG/ICO.
2. **Markenrecht:** Der Name ist eine Arbeitsentscheidung für das Projekt, keine Zusicherung freier Markenrechte.
3. **Technische IDs und Dateipfade:** Ergebnis einer Repository-Inventur, nicht im Konzept vorweggenommen.
4. **Kontrastfeinabstimmung:** Hex-Werte sind verbindliche Ausgangswerte, dürfen nach messbarem Accessibility-Befund punktuell angepasst werden; Änderungen dokumentieren.

---

**Verbindlicher Leitsatz für die Implementierung:** *Semyra wird durch eine konsistente Marke und ruhigere Theme-Tokens veredelt — nicht durch ein neues Layout, neue Features oder riskante Änderungen an Daten- und Laufzeitidentitäten.*
