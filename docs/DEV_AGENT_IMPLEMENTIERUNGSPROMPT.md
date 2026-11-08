# Dev-Agent-Anweisung: MarkLive → Semyra

Du arbeitest im bestehenden Repository der Windows-Desktop-Anwendung **MarkLive** (Rust-basierter Kern, WebView2-Oberfläche). Implementiere ein **risikoarmes Rebranding zu Semyra** sowie eine **gezielte Harmonisierung von Dark und Light Mode**.

## Verbindliche Spezifikation

Lies vor allen Änderungen die Datei `SEMYRA_PRODUKTIDENTITAET_UND_REBRANDING.md` **vollständig**. Dieses Konzeptpapier ist die fachliche Grundlage und enthält Produktidentität, exakte Farb-Tokens, UI-Regeln, Namenskonventionen, technische Migrationsrisiken und Abnahmekriterien. Falls diese Datei nicht im Repository liegt, fordere ihren Pfad an bzw. nutze die vom Auftraggeber bereitgestellte Kopie. **Erfinde keine fehlenden Details.**

## Zentrale Ziele

1. Sichtbarer Name **MarkLive → Semyra**; Claim `Markdown for the AI era.` in passenden Produktkontexten (z. B. About), nicht ständig innerhalb der Editor-UI anzeigen.
2. Bestehende Informationsarchitektur, Panelstruktur, Moduswechsel, Shortcut-Logik, Renderer und Editor **bewahren**. Kein Redesign und keine Feature-Entwicklung außerhalb des Umfangs.
3. Dark/Light über semantische Design-Tokens aus Abschnitt 5 des Konzeptpapiers konsistent umsetzen. Dark: Midnight/Slate/Ice White; Light: Weiß/helles Grau/Slate; Steel Blue als primärer Interaktionsakzent, Teal und Beige nur sehr sparsam.
4. **Keine Datenverluste und keine stille Inkompatibilität** mit bisherigen Versionen: Sessions, Recovery, Drafts, Einstellungen, WebView2-Daten, Dateizuordnungen und Installerzustand schützen.
5. **Logo nicht frei improvisieren:** Konzept definiert ein Logo-Briefing, aber noch kein freigegebenes Asset. Bestehendes Icon vorläufig beibehalten oder kennzeichnen; niemals ohne Vorgabe ein vermeintlich finales SVG erzeugen und als verabschiedete Marke behandeln.

## Arbeitsweise — strikt in dieser Reihenfolge

### A. Repository-Audit (vor Codeänderung)

- Prüfe Architektur (Rust, Frontend, CSS/Themes, Build-, Installer- und Packaging-Dateien).
- Suche case-insensitive nach `MarkLive`, `marklive`, `MARKLIVE`, `.exe`, `localhost`, AppData, UserDataFolder, App-IDs, Registry, File Associations und allen Migration-/Settings-Pfaden.
- Klassifiziere Treffer in **A Anzeige**, **B Artefakte** und **C Persistenz/Identität** gemäß Konzeptpapier.
- Bestimme vorhandene Test-/Build-Kommandos, CI-Matrix und tatsächliche Zielarchitekturen.
- Erstelle eine kurze umsetzbare Änderungsplanung. Arbeite anschließend ohne unnötige Rückfragen; stoppe aber vor irreversiblen Migrationen oder Logo-Festlegung, wenn die erforderliche Freigabe fehlt.

### B. Implementierung

- Klasse A konsistent auf **Semyra** umstellen, inklusive DE/EN-Lokalisierungen, About, Fenstertitel, README und sichtbarer Installer-Metadaten, soweit vorhanden.
- Klasse B nur dann umstellen, wenn Build-Skripte, Tests, Installer und Pfadreferenzen in derselben Änderung mit angepasst und überprüft werden können.
- Klasse C grundsätzlich unverändert lassen, solange keine getestete idempotente Migration nötig und möglich ist. Technische Legacy-Bezeichner dürfen absichtlich bestehen bleiben.
- Semantische CSS-/Theme-Tokens aus dem Konzeptpapier an vorhandene Theme-Architektur anbinden. Bestehende Komponenten möglichst minimal anfassen; keine neue UI-Library.
- Syntax-Highlighting und Mermaid-Farben zunächst beibehalten und nur bei messbaren Kontrast-/Theme-Problemen gezielt ändern.
- Hover, Active, Focus, Selected, Disabled in beiden Themes abgleichen; Status nicht nur durch Farbe vermitteln.
- Bisheriges UI-Layout, Settings-Gruppen und Shortcuts beibehalten.

### C. Tests und Verifikation

Mindestens prüfen:

1. Editor, Split und Preview in **Dark und Light**; Theme `System` sowie manueller Wechsel.
2. Toolbar, Tabs, Explorer, Popovers, Settings, Statusleiste, Fokus/Keyboard-Navigation, Hover/Selection.
3. Rendern von Standard-Markdown, Codeblöcken, Tabellen, Mermaid, KaTeX (soweit bestehend), inklusive Theme-Wechsel.
4. Öffnen/Speichern, zuletzt geöffnete Dateien, Session-Restore, Draft-/Crash-Recovery; Migrationstest mit einem vorhandenen MarkLive-Profil.
5. Rust-Tests, Frontend-Tests, TypeScript-/Lint-Prüfung und Builds laut Repository. x86-64 und ARM64 nur als **verifiziert** deklarieren, wenn tatsächlich getestet/gebaut.
6. Sichtbare Namen in Anwendung und Dokumentation auf Vollständigkeit prüfen; technische Altbezeichner separat ausweisen.
7. WCAG-orientierte Kontrastprüfung: Text 4,5:1 (normal), 3:1 (groß), nichttextuelle relevante Grenzen/Fokus 3:1; Befunde dokumentieren.
8. Wenn Screenshot-/Visual-Tests existieren: Dark/Light-Referenzbilder vor und nach Änderung vergleichen. Kleine visuelle Änderungen erlaubt, Layoutsprünge nicht.

## Verbote und Sicherheitsregeln

- **Kein** globales Suchen-und-Ersetzen aller MarkLive-Treffer.
- **Kein** ungeprüfter Wechsel von `marklive.localhost`, WebView2-Origin, AppData-Verzeichnis, Update-ID, Registry-Key oder Windows-App-ID.
- **Keine** Löschung alter Profile, Userdaten, Sessions oder Recovery-Dateien.
- **Keine** Behauptung einer freigegebenen Marke oder eines finalen Logos.
- **Keine** Ausweitung des Scopes auf neue KI-Features oder UI-Architektur.
- **Keine** stillschweigende Änderung von Dateiformaten, Markdown-Parsing oder bestehenden Tastaturbefehlen.

## Abschlusslieferung

Liefere nach Umsetzung:

1. Präzise Zusammenfassung der Änderungen mit Dateipfaden.
2. Tabelle `umbenannt / bewusst belassen / Migration erforderlich` für alle relevanten Legacy-Bezeichner.
3. Dark-/Light-Tokentabelle mit tatsächlich implementierten Werten und begründeten Abweichungen.
4. Resultate der Tests, Builds und Kontrastmessungen; nicht ausführbare Prüfungen deutlich als **nicht verifiziert** markieren.
5. Liste verbleibender Risiken und offener Entscheidungen (insb. finales SVG/ICO, Markensituation, Packaging-Migration).
6. Kurze Anleitung, wie ein bestehender MarkLive-Nutzer ohne Datenverlust auf Semyra wechselt.

**Definition of Done:** Die Anwendung heißt dort, wo Nutzer es sehen, Semyra; beide Themes sind ruhiger und konsistent; bisherige Nutzung, Dokumente, Einstellungen und Wiederherstellung bleiben erhalten; das UI bleibt eindeutig dasselbe Produkt.
