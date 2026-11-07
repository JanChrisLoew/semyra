# MarkLive

**MarkLive** ist eine native **Windows 11 x64 Desktop-Anwendung in Rust** zum schnellen Bearbeiten von Markdown-Dateien mit sofortiger Live-Vorschau.

## Architektur & Features

- **Natives Windows-11-Erlebnis**: Gebaut mit Rust (`tao` + `wry` WebView2 über `https://marklive.localhost`), nativem **Mica-Hintergrundmaterial** (`window-vibrancy`), Fluent-Overlay-Scrollbars, nativen Windows-11-Dateidialogen (`rfd`), Fensterpositions-Persistenz und Explorer-Drag-&-Drop.
- **Single-Instance & Multi-Window Support**: Weitere aus dem Windows Explorer geöffnete Dateien werden automatisch als neue Tabs an das laufende Fenster übergeben; über `--new-window` lässt sich jederzeit ein unabhängiges Zweitfenster starten.
- **Schnelle Rust-Markdown-Engine + Inkrementelles DOM-Morphing**: `pulldown-cmark` + `syntect` rendern GitHub-Flavored Markdown (Tabellen, interaktive Checklisten, GitHub-Alerts `[!NOTE]`/`[!TIP]`/`[!WARNING]`, Fußnoten, YAML-Frontmatter, Syntax-Highlighting) in Mikrosekunden; die Live-Vorschau aktualisiert geänderte Blöcke inkrementell und cached **KaTeX**-Formeln sowie **Mermaid**-Diagramme flackerfrei.
- **Screenshot-Paste (`Strg+V`)**: Bilder und Screenshots aus der Windows-Zwischenablage werden beim Einfügen direkt unter `./assets/img-<timestamp>.png` gespeichert und als relativer Markdown-Bildlink eingefügt.
- **Crash-Recovery / Entwurfssicherung**: Ungespeicherte Tabs und Entwürfe werden laufend unter `%LOCALAPPDATA%\MarkLive\drafts\recovery.json` gesichert und nach einem unerwarteten Beenden automatisch wiederhergestellt.
- **Arbeitsordner-Volltextsuche (`Strg+Umschalt+F`) & Explorer-Kontextmenü**: Durchsuche ganze Projektordner blitzschnell in Rust mit direktem Zeilensprung; verwalte Dateien und Unterordner per Rechtsklick (Neu, Umbenennen, Im Explorer zeigen, sicher in den **Windows-Papierkorb** verschieben).
- **Export & Druck**: Eigenständiger HTML-Export inkl. Syntax-Highlighting sowie direkte Druck-/PDF-Ausgabe (`Strg+P` via `@media print`).
- **Split-View & Fokus-Modi**:
  - **Split-Vorschau** mit verschiebbarem Teiler und **bidirektionalem Sync-Scroll**
  - **Editor-Modus**, **Lese-Modus** (`Alt+1` / `Alt+2` / `Alt+3`) und **Zen-Modus** (`F11`)

## Entwicklung & Build (Windows 11 x64)

### 1. Frontend-Bundle bauen
```powershell
cd frontend
npm install
npm run build
cd ..
```

### 2. Rust-App starten / Release-`.exe` erstellen
```powershell
# Unit-Tests ausführen
cargo test

# Entwicklungsmodus starten
cargo run

# Einzelne optimierte Windows-11-x64-Programmdatei bauen
cargo build --release
```

Die fertige eigenständige Anwendung liegt anschließend unter `target\release\MarkLive.exe`.

### 3. Windows-11-Installation & `.md`-Dateizuordnung (ohne Adminrechte)
```powershell
# Installiert MarkLive nach %LOCALAPPDATA%\Programs\MarkLive, legt Startmenü-Eintrag an
# und registriert .md / .markdown sowie "Mit MarkLive öffnen" im Windows Explorer:
powershell -ExecutionPolicy Bypass -File .\installer\Install-MarkLive.ps1

# Saubere Deinstallation:
powershell -ExecutionPolicy Bypass -File .\installer\Uninstall-MarkLive.ps1
```
Für ein klassisches Windows-Setup-Paket (`MarkLive-Setup-x64.exe`) liegt zusätzlich das Inno-Setup-6-Skript unter `installer\MarkLive.iss` bereit.
