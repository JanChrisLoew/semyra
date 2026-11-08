# Semyra

> **Markdown for the AI era.**  
> *Semyra* ist eine native **Windows 11 x64 Desktop-Anwendung in Rust** (`Semyra.exe`) zum schnellen, fokussierten Bearbeiten und Visualisieren von Markdown-Dateien – entwickelt für Dokumentation, Prompts, Skills und Agentenanweisungen.

## Highlights & Architektur

- **Natives Windows-11-Erlebnis**: Gebaut mit Rust (`tao` + `wry` WebView2 über `https://semyra.localhost`), nativem **Mica-Hintergrundmaterial** (`window-vibrancy`), harmonisiertem Semyra-Farbsystem (Midnight/Slate Dark · Reinweiß/Slate Light), Multi-DPI-App-Icon (`16/32/48/256 px`), Fluent-Scrollbars, nativen Dateidialogen (`rfd`), Multi-Monitor-sicherer Fenstergeometrie-Persistenz und Explorer-Drag-&-Drop.
- **Single-Instance & Multi-Window Support**: Aus dem Windows Explorer geöffnete Dateien werden automatisch als neue Tabs an das laufende Fenster übergeben; über `--new-window` lässt sich jederzeit ein unabhängiges Zweitfenster starten.
- **Schnellauswahl & Befehlspalette (`Strg+E` / `Strg+Umschalt+P`)**: Fuzzy-Suche zum blitzschnellen Wechseln zwischen offenen Tabs, sämtlichen Markdown-Dateien des Arbeitsordners, zuletzt geöffneten Dateien/Ordnern sowie allen Editor-, Ansichts- und Export-Befehlen (`>`).
- **Sitzungs-Wiederherstellung & Crash-Recovery**: Stellt geöffnete Dokumente, aktiven Tab, Split-Verhältnis, Dokument-Zoom (`75 %–175 %`), Zeilenumbruch und Rechtschreibprüfung beim nächsten Start wieder her; ungespeicherte Entwürfe werden zusätzlich laufend unter `%LOCALAPPDATA%\Semyra\drafts\recovery.json` gesichert.
- **Schnelle Rust-Markdown-Engine + Inkrementelles DOM-Morphing**: `pulldown-cmark` + `syntect` rendern GitHub-Flavored Markdown (Tabellen, interaktive Checklisten, GitHub-Alerts `[!NOTE]`..`[!CAUTION]`, Fußnoten, YAML-Frontmatter, Syntax-Highlighting) auf Hintergrund-Threads ohne UI-Blockade; die Live-Vorschau aktualisiert geänderte Blöcke inkrementell und cached **KaTeX**-Formeln sowie **Mermaid**-Diagramme flackerfrei.
- **Smartes Markdown-Editing**:
  - Automatische Fortsetzung (und sauberes Beenden bei leerem Eintrag) von Aufzählungs-, Aufgaben- und nummerierten Listen sowie Zitatblöcken per `Enter`
  - Smartes URL-Einfügen (`Strg+V`): Eine kopierte URL auf markiertem Text erzeugt direkt `[Auswahl](https://…)`
  - **Screenshot- & Bild-Import**: Bilder aus der Zwischenablage (`Strg+V`) oder per Drag & Drop aus dem Explorer werden automatisch unter `./assets/` abgelegt und als Markdown-Bild eingebunden
- **Kodierungs- & Zeilenenden-Komfort**: Verlustfreies Öffnen von `UTF-8`, `UTF-8 BOM`, `UTF-16 LE/BE` sowie `Windows-1252`-Bestandsdateien mit atomarem Speichern und direktem `CRLF`/`LF`-Umschalter in der Statusleiste.
- **Arbeitsordner-Volltextsuche (`Strg+Umschalt+F`) & Explorer-Kontextmenü**: Durchsuche ganze Projektordner in Rust mit direktem Zeilensprung; verwalte Dateien und Unterordner per Rechtsklick (Neu, Umbenennen, Im Explorer zeigen, sicher in den **Windows-Papierkorb** verschieben).
- **Split-View, Aktive Gliederung & Export**: Bidirektionales Sync-Scroll mit Live-Hervorhebung des aktuellen Abschnitts im Inhaltsverzeichnis, Dokument-Zoom (`Strg + Plus/Minus/0`), Editor-/Split-/Lese-Modus (`Alt+1/2/3`), Zen-Modus (`F11`), eigenständiger HTML-Export und Druck/PDF (`Strg+P`).

## Entwicklung & Release-Build (Windows 11 x64)

### Komplett-Build mit Tests per Skript (empfohlen)
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Build-Release.ps1
```
Das Skript führt nacheinander TypeScript-Typprüfung (`tsc --noEmit`), Frontend-Unit-Tests (`vitest`), das Vite-Produktionsbundle (`frontend/dist`), die Rust-Unit-Tests (`cargo test`) sowie `cargo build --release` aus und erzeugt die eigenständige Datei `target\release\Semyra.exe`.

### Manuelle Einzelschritte
```powershell
cd frontend
npm install
npm run typecheck
npm test
npm run build
cd ..

cargo test
cargo build --release
```

## Windows-11-Installation & `.md`-Dateizuordnung (ohne Adminrechte)

```powershell
# Installiert Semyra nach %LOCALAPPDATA%\Programs\Semyra, legt Startmenü-Eintrag an
# und registriert .md / .markdown sowie "Mit Semyra öffnen" im Windows Explorer:
powershell -ExecutionPolicy Bypass -File .\installer\Install-Semyra.ps1

# Saubere Deinstallation:
powershell -ExecutionPolicy Bypass -File .\installer\Uninstall-Semyra.ps1
```

Für ein klassisches Windows-Setup-Paket (`Semyra-Setup-x64.exe`) liegt zusätzlich das Inno-Setup-6-Skript unter `installer\Semyra.iss` bereit. Technische Architektur- und Beitragsrichtlinien für Entwickler und KI-Agenten sind in `AGENTS.md` dokumentiert.
