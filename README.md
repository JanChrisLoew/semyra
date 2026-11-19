# Semyra

**Markdown for the AI era.** Semyra ist ein lokaler Markdown-Editor für Windows 11 mit synchronisierter Live-Vorschau. Er hilft dir, Projektdokumentation, Prompts und Agentenanweisungen zu bearbeiten und gezielt als Kontext weiterzugeben.

## Schnell starten

Starte `Semyra.exe` direkt oder verwende das x64-Setup für die Integration in Windows. Semyra benötigt die Microsoft Edge WebView2 Runtime. Die EXE enthält das Frontend. Node.js wird zum Entwickeln und Bauen gebraucht.

Mit Repository-Zugriff findest du die x64-EXE als Artefakt `Semyra-win11-x64` in einem erfolgreichen [GitHub Actions-Lauf](https://github.com/JanChrisLoew/semyra/actions/workflows/ci.yml). EXE und Setup kannst du auch [lokal bauen](#bauen-und-prüfen).

1. **Ordner öffnen** und eine Datei über den Dateibaum oder `Strg+E` auswählen.
2. **Markdown bearbeiten und prüfen.** Die Vorschau läuft beim Schreiben mit. Mit `Alt+2` wechselst du zur geteilten Ansicht.
3. **KI-Kontext zusammenstellen.** Klicke mit der rechten Maustaste auf den Namen des Arbeitsordners und wähle **KI-Kontext bündeln…**. Wähle etwa `AGENTS.md`, eine `SKILL.md`-Datei und Projektdokumentation aus. Auch ungeöffnete Dateien lassen sich mit relativen Pfaden als Markdown oder XML kopieren. Der Befehl steht ebenfalls im Teilen-Menü und in der Befehlspalette.

## Funktionen

- **Editor und Vorschau** mit synchronisiertem Scrollen, Gliederung, GFM-Tabellen, Aufgabenlisten, YAML-Frontmatter, Fußnoten, KaTeX und interaktiven Mermaid-Diagrammen. Bilder lassen sich aus der Zwischenablage oder per Drag-and-drop einfügen.
- **Ordner und Tabs** mit Volltextsuche, gezieltem Ersetzen, Tab-Pinning und Vergleich externer Änderungen. Mit `--new-window` startet Semyra ein separates Fenster.
- **KI-Arbeitsabläufe** mit lokaler KI-Bibliothek, Vorlagen, Markdown-Linting, Formatierung und Vorlagen für Workspace-Skills.
- **Sitzung und Entwürfe** mit optionalem Auto-Save und Wiederherstellung ungespeicherter Änderungen. Entwürfe werden pro Fenster unter `%LOCALAPPDATA%\Semyra\drafts\` gespeichert.
- **Export und Teilen** als eigenständige HTML-Datei, PDF, Ausdruck oder formatierter Text für die Zwischenablage. Die Oberfläche ist auf Deutsch und Englisch sowie in hellen und dunklen Themes verfügbar.

## Wichtige Tastenkürzel

| Tastenkürzel | Aktion |
| --- | --- |
| `Strg+O` | Datei öffnen |
| `Strg+S` / `Strg+Umschalt+S` | Speichern / Speichern unter |
| `Strg+E` | Schnellwahl für Tabs und Dateien |
| `Strg+Umschalt+P` | Befehlspalette öffnen |
| `Strg+Umschalt+F` | Arbeitsordner durchsuchen |
| `Strg+Umschalt+A` | Aktiven Tab als KI-Kontext kopieren |
| `Strg+Umschalt+L` | Markdown formatieren |
| `Strg+Umschalt+H` | Eigenständige HTML-Datei exportieren |
| `Strg+Umschalt+D` | PDF-Datei exportieren |
| `Strg+Umschalt+K` | Formatierten Text kopieren |
| `Strg+P` | Druckdialog öffnen |
| `Alt+1` / `Alt+2` / `Alt+3` | Editor / geteilte Ansicht / Vorschau |

## Installation

- **Direktstart.** Die gebaute x64-Datei liegt unter `target\release\Semyra.exe`. Einstellungen und Entwürfe liegen auch beim Direktstart im Windows-Benutzerprofil.
- **Setup.** `target\installer\Semyra-Setup-x64.exe` installiert Semyra standardmäßig für den aktuellen Benutzer. Das Setup kann Semyra für **Öffnen mit** und im Ordner-Kontextmenü registrieren. Die Standard-App wählst du in den Windows-Einstellungen. Die Deinstallation erhält Einstellungen und Entwürfe.
- **PowerShell-Alternative.** [Install-Semyra.ps1](installer/Install-Semyra.ps1) installiert eine bereits gebaute EXE für den aktuellen Benutzer. [Uninstall-Semyra.ps1](installer/Uninstall-Semyra.ps1) entfernt die Installation. Ausschließlich mit `-RemoveUserData` löscht dieses Skript auch das Semyra-Profil.

Windows 11 x64 ist die primäre Plattform. Die CI baut und prüft das x64-Setup. Für Windows 11 ARM64 gibt es ein separates Build-Ziel. Die CI prüft hierfür die Kompilierung.

## Bauen und prüfen

Voraussetzungen sind Windows 11, die stabile Rust-Toolchain für Windows MSVC, Microsoft Edge WebView2 und eine aktuelle Version der Node.js-22-Reihe mit npm. Für Setup-Builds wird Inno Setup 6 mit `ISCC.exe` benötigt.

**Vor dem Release-Skript Semyra schließen und offene Dokumente speichern.** Das Skript beendet laufende Semyra-Prozesse zwangsweise. Für gezielte lokale Prüfungen nutze die einzelnen Schritte in [AGENTS.md](AGENTS.md#build-and-verify).

```powershell
# Beim Einrichten eines neuen Checkouts
npm --prefix frontend ci

# x64-EXE und x64-Setup bauen
powershell -ExecutionPolicy Bypass -File .\scripts\Build-Release.ps1 -Installer
```

Das Skript prüft TypeScript, führt Frontend- und Rust-Unit-Tests aus und baut das Frontend vor der EXE. Playwright läuft separat mit `npm run test:e2e` im Ordner `frontend` nach dem Frontend-Build. [Windows-CI](.github/workflows/ci.yml) prüft zusätzlich ARM64-Kompilierung, x64-Neuinstallation, Upgrade und Deinstallation.

## Projektdokumentation

- [Produktkontext](docs/PRODUCT_CONTEXT.md) für Produktversprechen, Gestaltung und UI-Regeln.
- [AGENTS.md](AGENTS.md) für Architektur-Einstiege, Entwicklungsablauf und Sicherheitsregeln.
- [Work Log](WORK_LOG.md) für größere Änderungen, Releases und offene Punkte.

## Lizenz

[MIT](LICENSE). Copyright (c) 2026 Semyra Contributors.
