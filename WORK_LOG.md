# Semyra — Work Log & Sessionshistorie

Dieses Protokoll hält abgeschlossene Features, größere Korrekturen, Releases und Entscheidungen mit Folgen für die weitere Arbeit fest. Einträge nennen kurz, was sich geändert hat, wie es geprüft wurde und was offen ist. Für kleine Änderungen reicht die Commit-Nachricht. Die Regel steht in [AGENTS.md](AGENTS.md#work-log).

---

## 2026-11-21 — Kodierung beim Speichern und Ordner-Ersetzen

Manuelles Speichern, Auto-Save und versionsgebundenes Ordner-Ersetzen erhalten die erkannte Kodierung und BOM. Nicht in Windows-1252 darstellbare Änderungen lassen sich beim manuellen Speichern ausdrücklich in UTF-8 konvertieren. Auto-Save meldet den ausstehenden manuellen Schritt. Sammeländerungen überspringen betroffene Dateien. „Speichern unter“ erzeugt weiterhin UTF-8.

Bytevergleiche prüfen alle fünf unterstützten Varianten einschließlich CRLF. Frontend-Tests prüfen Auto-Save, Abbruch und Zustimmung. Lokal bestanden Typecheck, Frontend- und x64-Release-Build, 214 Frontend-Tests, 28 Edge-Tests und 46 Rust-Tests. Der Edge-Lauf verwendete lokal einen separaten Loopback-Port.

---

## 2026-11-21 — Trefferzahl vor dem Ersetzen im Arbeitsordner

Die Suche zählt für jede durchsuchte Datei alle Vorkommen und Trefferzeilen. Die Vorschau zeigt höchstens 40 Zeilen pro Datei und 300 insgesamt und kennzeichnet eine Kürzung. Die Bestätigung nennt die Vorkommen in der aktuellen Dateiauswahl. Beim Schreiben gelten weiterhin die Versionen der Suchergebnisse.

Ein Rust-Test prüft 100 Vorkommen auf 50 Zeilen je Datei, die globale Vorschaugrenze und die 100 tatsächlichen Ersetzungen in einer ausgewählten Datei. Weitere Fälle prüfen mehrzeilige Regex-Treffer, Unicode und die Bestätigung nach Abwahl einer Datei. Lokal bestanden Typecheck, Frontend-Build, 209 Frontend-Unit-Tests, 28 Playwright-Tests und 45 Rust-Tests.

---

## 2026-11-21 — Inhaltstreue beim Markdown-Formatieren

Der Formatierer übernimmt Codeblöcke und thematische Trennlinien anhand des Markdown-Syntaxbaums des Editors und erhält harte Zeilenumbrüche. Der Befehl steht nur für Markdown-Tabs zur Verfügung. Regressionstests prüfen unter anderem eingerückte Beispiele, Code in Listen und Zitaten sowie einen YAML-Tab über Tastenkürzel und Befehlspalette.

Lokal bestanden Typecheck, Frontend-Build, 209 Frontend-Unit-Tests, 28 Playwright-Tests und 43 Rust-Tests.

---

## 2026-11-21 — Entwurfssicherung bei fortlaufender Eingabe

Semyra fordert bei kontinuierlichen Änderungen alle fünf Sekunden einen Recovery-Snapshot an. Eine Schreibpause von 1,1 Sekunden löst die Sicherung früher aus. Jede sofortige Sicherung setzt beide Zeitgeber zurück.

Der neue Edge-Test prüft zwölf aufeinanderfolgende Sicherungen während einer simulierten Schreibminute und die letzte Fassung nach einer Pause. Lokal bestanden Typecheck, Frontend-Build, 201 Frontend-Unit-Tests, 27 Playwright-Tests und 43 Rust-Tests einschließlich Wiederherstellung nach Prozessabbruch.

---

## 2026-11-19 — Projektdokumentation gestrafft und abgeglichen

- **Änderung**: `README.md` auf Einstieg, KI-Kontext, wichtige Tastenkürzel, Installation und Build konzentriert. WebView2, Benutzerdaten, Recovery-Pfad und Prüfumfang je Architektur präzisiert. `docs/PRODUCT_CONTEXT.md` beschreibt den aktuellen KI-Kontext und ARM64 als separates Build-Ziel. Die vier Projekt-Skills übernehmen gemeinsame Build-Regeln aus `AGENTS.md` und ergänzen ihre jeweiligen Schutz- und Prüfpunkte.
- **Nachtrag**: Das README nennt das x64-Artefakt in GitHub Actions. Der Review-Skill bewertet Modulgrenzen anhand fachlicher Zusammengehörigkeit und Testbarkeit.
- **Verifikation**: Alle vier Skills mit `quick_validate.py` geprüft. Lokale Markdown-Verweise, Abschnittslinks und `git diff --check` geprüft. Typecheck, Tests und Release-Build für die Dokumentationsänderung ausgelassen.

---

## 2026-11-19 — AGENTS.md gekürzt und aktualisiert

- **Änderung**: `AGENTS.md` auf den verbindlichen Git-Ablauf, Architektur-Einstiege, Sicherheits- und UI-Regeln, Build-Prüfungen sowie Sitzungsprotokolle gekürzt. Worker-Pools, Recovery-Snapshots und die Dokumentmodule sind am aktuellen Code ausgerichtet. Die Build-Anleitung nennt die erzwungene Prozessbeendigung und den Prüfumfang der Windows-CI.
- **Entscheidung**: Work-Log-Einträge sind künftig für abgeschlossene Features, größere Korrekturen, Releases und Entscheidungen mit Folgen für die weitere Arbeit vorgesehen. Das Vorwort und das README verweisen auf denselben Umfang.
- **Verifikation**: Verweise und `git diff --check` geprüft. Typecheck, Frontend- und Rust-Tests sowie `Build-Release.ps1` für die reine Dokumentationsänderung nicht ausgeführt.

---

## 2026-11-19 — Aktualitätsprüfung von AGENTS.md

- **Umfang**: `AGENTS.md` gegen Rust-Host, Frontend, Build-Skripte, Produktkontext und Windows-CI abgeglichen. Sicherheitsregeln, Frontend-vor-Rust-Build und der vereinbarte Git-Workflow passen grundsätzlich.
- **Befunde**: Release-Skript beendet laufende Semyra-Prozesse zwangsweise. Die Architekturübersicht beschreibt noch Einzelthreads und eine einzelne Recovery-Datei und nennt die Dokumentmodule nicht. Der Build-Abschnitt sollte lokale Unit-Tests und Release-Build von Playwright, ARM64-Kompiliercheck und x64-Installer-Abnahme in CI unterscheiden.
- **Verifikation**: Quellstand, Skripte und bestehende Build-Ausgabe statisch geprüft. Typecheck, Frontend- und Rust-Tests sowie `Build-Release.ps1` für dieses Review nicht ausgeführt. Die Befunde sind für eine gezielte Dokumentationskorrektur festgehalten.

---

## 2026-11-19 — Git-Workflow festgehalten

- **Änderung**: `AGENTS.md` dokumentiert den vereinbarten Ablauf für kleine Änderungen auf `main`, separate Feature- und Refactoring-Branches sowie gezielte Pull Requests mit Windows-CI.
- **Verifikation**: Markdown-Diff und `git diff --check` geprüft. Typecheck, Frontend- und Rust-Tests sowie `Build-Release.ps1` für diese Dokumentationsänderung nicht ausgeführt.

---

## 2026-11-19 — Fehlermeldungen im KI-Kontext und Installer-Exitcode

- **Dialog**: `frontend/src/ai-dialogs.ts`, `main.ts`, `index.html`, `i18n.ts` und `styles/dialogs-print.css` zeigen DE/EN-Fehlermeldungen direkt im Dialog. Die Ordnerliste kann dort erneut geladen werden. Lese-, Kopier- und Schreibfehler sowie ein abgebrochener Speicherdialog lassen die Auswahl bestehen. Späte Antworten wirken nur auf ihren ursprünglichen Dialogaufruf.
- **Release**: `scripts/Build-Release.ps1` prüft den Exitcode des Installer-Kindprozesses. Ein temporärer Test mit Kind-Exitcode 23 bestätigte einen fehlgeschlagenen Release-Aufruf und die Ausgabe des ursprünglichen Codes.
- **Verifikation**: `Build-Release.ps1 -Installer` mit explizitem ISCC-Verzeichnis im Prozesspfad erfolgreich einschließlich Typecheck, 201 Frontend-Tests, Vite-Build, 43 Rust-Tests, x64-EXE und x64-Installer. Alle 26 Playwright-Tests bestanden. Die vier neuen Tests bestanden jeweils drei weitere Wiederholungen. Die [Windows-CI für `39c5ebd`](https://github.com/JanChrisLoew/semyra/actions/runs/44482775402) bestätigte ARM64-Kompilierung, x64-Neuinstallation, Upgrade und Deinstallation.
- **Merge**: [PR #6](https://github.com/JanChrisLoew/semyra/pull/6) wurde als `11da00a` nach `main` übernommen. Der lokale Branch wurde per Fast-forward synchronisiert. Der gemergte Quellbaum entspricht dem in Windows-CI geprüften PR-Commit.

---

## 2026-11-19 — Sprint-Review zum KI-Kontext

- **Ergebnis**: Der neue Arbeitsordner-Einstieg erfüllt den vereinbarten Ablauf. Der Test prüft zwei ungeöffnete Dateien, die gewählte Teilmenge, relative Pfade und exakte Inhalte. Der lokale Pilot enthält die Produktänderung. Die tatsächliche Auffindbarkeit für neue Nutzer wurde in diesem Sprint nicht gemessen.
- **P2**: Bei einem Fehler beim Lesen einer ausgewählten Datei oder Schreiben in die Zwischenablage bleibt der Bündel-Dialog ohne sichtbare Fehlermeldung offen. `main.ts` blendet globale Toasts bei geöffnetem Dialog aus. Eine simulierte Ablehnung der Zwischenablage bestätigte den Befund. Auch ein fehlgeschlagener Arbeitsordnerindex wird derzeit wie eine leere Dateiliste behandelt. Vor dem Merge Fehlermeldungen im Dialog anzeigen und einen erneuten Versuch ermöglichen.
- **Build-Folgepunkt**: `Build-Release.ps1 -Installer` gab trotz fehlgeschlagenem Inno-Kindprozess Exitcode 0 zurück. Der separate Installer-Build mit explizitem Compilerpfad lief anschließend erfolgreich. Installer-Exitcode künftig im Release-Skript prüfen.
- **Verifikation**: Typecheck, 201 Frontend-Tests, Vite-Build, 22 reguläre Playwright-Tests, `cargo check --locked` und 43 Rust-Tests beim Review erneut erfolgreich. Die grüne Windows-CI gehört zu `5a98d20`. Der Pilot wurde für das Review nicht neu gebaut. Der temporäre Fehlertest wurde entfernt.

---

## 2026-11-19 — KI-Kontext aus dem Arbeitsordner

- **Änderung**: Teilen-Menü und Befehlspalette verwenden „KI-Kontext bündeln…“. Der Arbeitsordner bietet dieselbe Aktion im Kontextmenü seines Namens und der freien Fläche im Dateibaum. Dieser Einstieg zeigt Dateien aus dem Arbeitsordner und übernimmt den aktuellen Inhalt offener Arbeitsordner-Tabs. Willkommen und Tabs aus anderen Ordnern bleiben außerhalb dieser Auswahl.
- **Integration**: `frontend/index.html`, `main.ts`, `sidebar-explorer.ts`, `palette-items.ts`, `i18n.ts` und `styles/sidebar.css` verwenden den bestehenden Dialog und die gemeinsame DE/EN-Beschriftung. Das README nennt die drei Einstiege.
- **Verifikation**: Typecheck, 201 Frontend-Tests, Vite-Build, 22 Playwright-Tests und 43 Rust-Tests erfolgreich. Der neue Headless-Fall in `frontend/e2e/ai-context.spec.ts` kopiert zwei ungeöffnete Dateien als XML und prüft die exakten relativen Pfade und Inhalte.
- **Pilot**: `Build-Release.ps1 -Installer` baute die x64-EXE, der Installer-Schritt fand ISCC im Kindprozess nicht. Mit explizitem Compiler-Verzeichnis im Prozesspfad lief `Build-Installer.ps1 -Architecture x64` erfolgreich. EXE und Setup wurden lokal auf Produktversion `0.2.0`, Zeitstempel und SHA-256 geprüft.
- **Abschluss**: Die [Windows-CI für PR #6](https://github.com/JanChrisLoew/semyra/actions/runs/44479442539) bestätigte `5a98d20` einschließlich 22 Playwright-Tests, 43 Rust-Tests, ARM64-Kompilierung sowie x64-Neuinstallation, Upgrade und Deinstallation. Der lokale ARM64-Kompiliercheck war ebenfalls erfolgreich.

---

## 2026-11-18 — Schnellsuche nach Dateisystemereignissen stabilisiert

- **Änderung**: `frontend/src/main.ts` verwendet denselben Pfadvergleich wie die Ordnersuche. Änderungen außerhalb des aktuellen Arbeitsordners entwerten dessen Index und Baum nicht mehr. `sidebar-explorer.ts` wiederholt eine entwertete Indexanfrage für denselben Ordner. Beim Wechsel oder Schließen des Ordners liefert die frühere Anfrage weiterhin keine Treffer.
- **Verifikation**: Beide neuen Fälle in `frontend/e2e/quick-open.spec.ts` schlugen vor der Korrektur fehl und bestanden danach jeweils fünf weitere Wiederholungen. Typecheck, 201 Frontend-Tests, Vite-Build, 21 Playwright-Tests, 43 Rust-Tests und ARM64-Kompiliercheck waren lokal erfolgreich. Die [Windows-CI](https://github.com/JanChrisLoew/semyra/actions/runs/44358329265) bestätigte zusätzlich x64-Neuinstallation, Upgrade mit Recovery-Entwurf und Deinstallation. `Build-Release.ps1` wurde lokal nicht ausgeführt.
- **Merge**: [PR #5](https://github.com/JanChrisLoew/semyra/pull/5) wurde als `0336733` nach `main` übernommen. Der lokale Stand wurde per Fast-forward aktualisiert und entspricht dem in CI geprüften Quellbaum von `ef3cb81`.

---

## 2026-11-18 — Abschlussreview von PR #5

- **Umfang**: `e3dba32` gegen `e7f71e6` geprüft. Der PR enthält die Korrekturen für alte Schreibantworten, veraltete Ordnerdaten, versionsgebundenes Ersetzen und den tatsächlichen Recovery-Pfad im Installer-Test.
- **P2**: `main.ts` entwertet den Arbeitsordnerindex auch bei einer Änderung einer geöffneten Datei außerhalb des Arbeitsordners. Läuft beim Öffnen der Schnellsuche gerade eine Indexanfrage, liefert `getWorkspaceFiles()` danach `null`. Die Palette zeigt für diesen Aufruf keine Arbeitsordnerdateien und startet keine weitere Anfrage. Im temporären Playwright-Vergleich erschien die erwartete Datei ohne das Ereignis und fehlte mit dem Ereignis.
- **Verifikation**: Typecheck, 201 Frontend-Tests, Vite-Build, 19 reguläre Playwright-Tests, `cargo check --locked` und 43 Rust-Tests lokal erfolgreich. Die [Windows-CI für PR #5](https://github.com/JanChrisLoew/semyra/actions/runs/44354230079) bestätigte zusätzlich ARM64-Kompilierung sowie x64-Installation, Upgrade und Deinstallation. `Build-Release.ps1` wurde für das Review nicht ausgeführt.
- **Entscheidung**: Vor dem Merge Ereignisse auf den aktiven Arbeitsordner begrenzen und entwertete Indexanfragen desselben Ordners für die geöffnete Schnellsuche wiederholen. Der temporäre Test wurde entfernt.

---

## 2026-11-18 — Dateilebenszyklus, Ordnersuche und Upgrade-Test gehärtet

- **Speichern**: `document-file-operations.ts` prüft nach der Antwort, ob der Tab noch offen ist und denselben Pfad hat. Das Backend verwendet beim Umbenennen und Verschieben in den Papierkorb dieselbe Sperre wie beim Schreiben.
- **Dateiindex**: `sidebar-explorer.ts` verwirft verspätete oder inzwischen entwertete Indexantworten. Schnellwahl und Linting berücksichtigen verworfene Antworten.
- **Ordner-Ersetzen**: Dateisystemereignisse entwerten die Treffer sofort. Bei der Aktualisierung bleibt die Dateiauswahl erhalten. Die UI sendet die SHA-256-Prüfsummen der angezeigten Versionen. Rust überspringt geänderte, zu groß gewordene oder verschwundene Dateien und meldet sie im Ergebnis.
- **Installer**: Der Windows-Upgrade-Test prüft einen Entwurf in `%LOCALAPPDATA%/Semyra/drafts/` vor und nach Upgrade und Deinstallation.
- **Verifikation**: Typecheck, 201 Frontend-Tests, Vite-Build, 19 Playwright-Tests, 43 Rust-Tests, ARM64-Kompilierung und PowerShell-Parser-Prüfung erfolgreich. Der korrigierte Installer-Upgrade-Test läuft auf einem frischen Windows-Runner. `Build-Release.ps1` wurde lokal nicht ausgeführt.
- **CI-Nachlauf**: Der Windows-Lauf `44353005003` bestand den neuen Playwright-Fall für die Ordnersuche, stoppte aber im älteren Schließtest. Der Test wartet nun auf die Einstellungsantwort vom Start, bevor er die Einstellungsanfrage beim Schließen gezielt verzögert.
- **Abschluss**: Der Schließtest bestand zehn lokale Wiederholungen. Die [Windows-CI für PR #5](https://github.com/JanChrisLoew/semyra/actions/runs/44354230079) für `e3dba32` war vollständig erfolgreich. Sie bestätigte Neuinstallation und x64-Upgrade mit bytegenauer Prüfung des Entwurfs im echten `drafts`-Ordner sowie Deinstallation.

---

## 2026-11-18 — Code-Review nach den Pilot-Merges

- **Umfang**: `37c1bbd..e7f71e6` auf `main` geprüft. Schwerpunkt auf Dateilebenszyklus, Recovery, Arbeitsordner, Hintergrundaktualisierung und Installer-CI.
- **P1**: Eine Schreibantwort für den alten Pfad setzt den Tab auch dann auf gespeichert, wenn er durch eine Löschung inzwischen pfadlos geworden ist. Der simulierte Fall schlug in Vitest fehl. Speicherbestätigung an die aktuelle Dateizuordnung binden und Dateimutationen mit aktiven Schreibvorgängen abstimmen.
- **P2**: Ein verspäteter Dateiindex kann den Cache des neuen Arbeitsordners füllen. Der simulierte Ordnerwechsel schlug in Vitest fehl. Cache und Antworten an die Arbeitsordnergeneration binden. Nach einem Dateisystemereignis aktualisiert die Explorer-Aktualisierung außerdem keine laufende Ordnersuche mehr. Suchergebnisse bei Dateisystemänderungen gesondert entwerten und neu laden.
- **P2**: Der Installer-Test prüft `Semyra/recovery.json`. Beide getesteten Builds lesen Entwürfe aus `Semyra/drafts/`. Testdatei in den tatsächlichen Profilpfad legen und nach Upgrade sowie Deinstallation prüfen.
- **Verifikation**: Typecheck, 193 Frontend-Tests, Vite-Produktionsbuild, `cargo check --locked`, 42 Rust-Tests und 18 Playwright-Tests erfolgreich. Playwright lief nach dem Timeout am Standardport mit einem separaten Preview-Port. Die zwei temporären Reproduktionstests lieferten die erwarteten Fehler und wurden entfernt. Der lokale Rust-Testbuild meldete einen Kopier-Fallback beim inkrementellen Cache. `Build-Release.ps1` wurde für das Review nicht ausgeführt. Der bestehende Windows-Lauf für `e7f71e6` ist grün.
- **Entscheidung**: Anwendungscode unverändert. Zuerst die falsche Speicherbestätigung korrigieren. Die Modulgrenzen für Dokumentzustand, Speichern, Auto-Save und Schließen bieten bereits geeignete Testpunkte.

---

## 2026-11-18 — Windows-CI für x64-Installer-Upgrades

- **Änderung**: `.github/workflows/ci.yml` baut als Upgrade-Basis den fest gepinnten Pilotstand `8c2cd1e` in einem separaten Checkout. Der bestehende Test für Neuinstallation und Deinstallation bleibt erhalten.
- **Prüfung**: `scripts/Test-Installer.ps1` installiert zuerst die Basis und dann das aktuelle Setup über denselben Eintrag. Der neue Installer übernimmt Zielordner und Explorer-Aufgaben. Unterschiedliche EXE-Hashes belegen den Austausch trotz gleicher Produktversion. Der Test prüft bytegenau, dass Einstellungen, Tabs, Recovery-Entwurf und Markdown-Datei Update und Deinstallation überstehen.
- **Verifikation**: PowerShell-Parser, Workflow-YAML und `git diff --check` erfolgreich. Die [Windows-CI für PR #4](https://github.com/JanChrisLoew/semyra/actions/runs/44336420020) bestätigte Typecheck, 193 Frontend-Tests, Vite-Build, 18 Playwright-Tests, 42 Rust-Tests, ARM64-Kompilierung, Release-Build, x64-Neuinstallation und Upgrade einschließlich Deinstallation. `Build-Release.ps1` wurde lokal nicht aufgerufen. Der geprüfte PR-Commit ist `fe6abb5`.
- **Review und Merge**: Baseline-Pin, isolierter Build, Übernahme des Installationsordners, Explorer-Registrierung, Prüfsummen der Profildaten und Bereinigung geprüft. [PR #4](https://github.com/JanChrisLoew/semyra/pull/4) wurde als `e7f71e6` übernommen. Der Quellbaum von `main` entspricht dem getesteten PR-Commit.
- **Abschluss**: Die [Windows-CI für `e7f71e6` auf `main`](https://github.com/JanChrisLoew/semyra/actions/runs/44339976876) war vollständig erfolgreich, einschließlich Neuinstallation, Upgrade, Prüfung der Profildaten und Deinstallation.

---

## 2026-11-18 — Merge-Review des Dokumentlebenszyklus

- **Recovery**: [PR #2](https://github.com/JanChrisLoew/semyra/pull/2) wurde nach erfolgreicher Windows-CI als `7aa2c0a` nach `main` übernommen.
- **Review-Fix**: Der neue Fall in `frontend/e2e/file-safety.spec.ts` zeigte, dass beim Anheften eines bearbeiteten Tabs dessen Auto-Save ausblieb. `frontend/src/tab-utils.ts` behält beim Anheften und Lösen dieselbe Tab-Instanz, damit laufende Dateioperationen und geplante Timer zugeordnet bleiben. `frontend/src/__tests__/tab-utils.test.ts` prüft diese Objektidentität.
- **Verifikation vor dem Merge**: Der neue Playwright-Test schlug vor der Korrektur fehl und bestand danach. Typecheck, 193 Frontend-Tests, Vite-Build und alle 18 Playwright-Tests erfolgreich. Die [Windows-CI für PR #3](https://github.com/JanChrisLoew/semyra/actions/runs/44323264026) bestätigte zusätzlich 42 Rust-Tests, die ARM64-Kompilierung sowie Installation, Explorer-Registrierung und Deinstallation unter x64. [PR #3](https://github.com/JanChrisLoew/semyra/pull/3) wurde als `45ad425` nach `main` übernommen.
- **Pilot-Build**: Typecheck, Frontend-Tests, Vite-Build, `cargo test --locked` und `cargo build --release --locked` waren auf `main` erfolgreich. `scripts/Build-Installer.ps1 -Architecture x64` erstellte den Installer. Die Release-Schritte liefen einzeln, damit `Build-Release.ps1` keine laufende Semyra-Instanz beendet. `target/release/Semyra.exe` und `target/installer/Semyra-Setup-x64.exe` tragen Produktversion `0.2.0`.
- **Abschluss**: Die [Windows-CI für `45ad425` auf `main`](https://github.com/JanChrisLoew/semyra/actions/runs/44324107687) war ebenfalls vollständig erfolgreich, einschließlich x64-Installation und Deinstallation.

---

## 2026-11-18 — Refactoring des Speicherns und Schließens abgeschlossen

- **Änderung**: `frontend/src/document-file-operations.ts` übernimmt jetzt das Schreiben, „Speichern unter“, den gespeicherten Versionsstand und die Invalidierung laufender Leseantworten nach erfolgreichem Speichern. `frontend/src/document-close.ts` koordiniert das Schließen von Tabs und Fenstern, einschließlich laufender Speicheraufträge, revidierter Dokumente und Wiederaufnahme von Auto-Save nach Abbruch. `frontend/src/document-state.ts` enthält auch die Regeln für Editoränderungen, Zeilenenden, Konfliktstatus und wiederhergestellte Entwürfe. `frontend/src/main.ts` verbindet die Module mit Editor, Dialogen, Navigation, Sitzungsdaten und Fenster-IPC.
- **Verifikation**: Sieben zusätzliche Testfälle decken Abbruch und Erfolg von „Speichern unter“, externe Schreibkonflikte, gespeicherte und abgebrochene Schließabläufe sowie ältere Recovery-Drafts ab. Typecheck, 193 Frontend-Tests, Vite-Build, 17 Playwright-Tests, 42 Rust-Tests und ARM64-Kompiliercheck erfolgreich. `Build-Release.ps1` und Installer-Build wurden für das Refactoring nicht erneut ausgeführt.
- **Stand**: Das Refactoring liegt lokal auf `codex/document-version-refactor`, basierend auf dem grünen Recovery-PR #2.

---

## 2026-11-18 — Auto-Save-Regeln und Timer ausgelagert

- **Änderung**: `frontend/src/document-auto-save.ts` verwaltet Einstellung und 900-ms-Timer pro Dokument. Dieselbe Prüfung für Pfad, ungespeicherte Änderungen, Dateikonflikt und Schließzustand gilt beim Planen und unmittelbar vor dem automatischen Schreiben nach einem laufenden Speicherauftrag.
- **Integration**: `frontend/src/main.ts` übergibt Konflikt-, Editor- und Schließereignisse an den Auto-Save-Controller. Beim Deaktivieren werden ausstehende Timer aller Tabs verworfen. Status, Einstellungen und Befehlspalette lesen den gemeinsamen Zustand. Der Stand liegt lokal auf `codex/document-version-refactor`.
- **Verifikation**: Vier neue Tests in `frontend/src/__tests__/document-auto-save.test.ts` für unabhängige Timer, Deaktivierung, Ausschlussbedingungen und einen Konflikt während eines laufenden Schreibvorgangs. Typecheck, 186 Frontend-Tests, Vite-Build, 17 Playwright-Tests und 42 Rust-Tests erfolgreich. `Build-Release.ps1` wurde in diesem Schritt nicht ausgeführt.

---

## 2026-11-18 — Asynchrone Dokument-Operationen ausgelagert

- **Änderung**: `frontend/src/document-file-operations.ts` verwaltet laufende Speichervorgänge pro Dokument und die Gültigkeit von Festplatten-Leseantworten. Speicheraufträge warten auf laufende Vorgänge, bevor sie den aktuellen Stand erfassen. Eine Leseantwort wird bei einem neueren Leseauftrag, nach erfolgreichem Speichern, beim Schließen oder bei einem Pfadwechsel verworfen. Die Entscheidung zum Umgang mit einer gültigen Antwort kommt aus `document-state.ts`.
- **Integration**: `frontend/src/main.ts` verbindet Dateioperationen mit Editor, Auto-Save, Status und Schließdialogen. Die Zeitpunkte, an denen laufende Speichervorgänge beim Schließen abgewartet werden, bleiben erhalten. Der Refactoring-Stand liegt lokal auf `codex/document-version-refactor`.
- **Verifikation**: Vier gezielte Fälle in `frontend/src/__tests__/document-file-operations.test.ts` prüfen aufeinanderfolgende Speicheraufträge, Lesen nach einem laufenden Speichern, veraltete Antworten nach Invalidierung und einen Pfadwechsel während des Lesens. Typecheck, 182 Frontend-Tests, Vite-Build, 17 Playwright-Tests und 42 Rust-Tests erfolgreich. `Build-Release.ps1` wurde für diesen Refactoring-Schritt nicht erneut ausgeführt.

---

## 2026-11-18 — Pilot-Härtungen zusammengeführt und Dokumentzustand ausgelagert

- **GitHub**: [PR #1](https://github.com/JanChrisLoew/semyra/pull/1) wurde als `8c2cd1e` nach `main` übernommen. [PR #2](https://github.com/JanChrisLoew/semyra/pull/2) enthält den separaten Recovery-Test. [Windows-CI](https://github.com/JanChrisLoew/semyra/actions/runs/44298091024) bestätigte den Test nach hartem Prozessabbruch und die x64-Installer-Abnahme. PR #2 bleibt offen.
- **Refactoring**: Der lokale Folgebranch `codex/document-version-refactor` lagert aus `frontend/src/main.ts` die Versionsfortschreibung, den gespeicherten Stand, den erwarteten Festplattenstand und die Entscheidung bei einem erneuten Lesen aus. `frontend/src/document-state.ts` enthält diese Regeln unabhängig von UI und IPC. `main.ts` steuert weiterhin asynchrone Dateiaufrufe, Editor, Dialoge und Auto-Save-Timer.
- **Verifikation**: Sechs gezielte Fälle in `frontend/src/__tests__/document-state.test.ts`. Typecheck, 178 Frontend-Tests, Vite-Build, 17 Playwright-Tests und 42 Rust-Tests erfolgreich. `Build-Release.ps1` wurde für den lokalen Refactoring-Schritt nicht erneut ausgeführt.

---

## 2026-11-18 — Recovery nach hartem Prozessabbruch automatisiert

- **Änderung**: `src/drafts.rs` enthält einen Rust-Regressionstest mit zwei Kindprozessen und temporärem Profil. Der erste schreibt über `DraftStore` und signalisiert den abgeschlossenen Speichervorgang bei weiterhin gehaltener Dateisperre. Der Elternprozess beendet ihn hart. Ein zweiter Prozess öffnet den Speicher neu und vergleicht den gesamten wiederhergestellten Entwurf einschließlich Unicode-Text, Dateipfad, gespeichertem Stand und Zeilenendungsmetadaten.
- **Verifikation**: Der neue Test bestand einzeln und in zehn Wiederholungen. `cargo test --locked` meldete 42 bestandene Tests. Der als Hilfseinstieg markierte Test wird von den Kindprozessen gezielt aufgerufen. Typecheck, 172 Frontend-Tests und Vite-Build erfolgreich. `Build-Release.ps1` und der Installer-Build wurden für diese reine Teständerung nicht ausgeführt.
- **Integration**: Der bestehende CI-Schritt `cargo test --locked` führt den Test aus, sobald der Patch auf GitHub vorliegt. Der Test nutzt den produktiven Entwurfsspeicher ohne WebView2 oder Desktop-Automation. Der Recovery-Patch liegt lokal vor. PR #1 behält seinen geprüften Stand.

---

## 2026-11-18 — Installer-Abnahme in PR #1 und Open-With-Korrektur

- **Umfang**: Die Härtungen und der Installer-Test wurden auf `codex/x64-pilot-hardening` in [PR #1](https://github.com/JanChrisLoew/semyra/pull/1) zusammengeführt.
- **Erster CI-Lauf**: Frontend-Prüfungen, Playwright, Rust-Tests, ARM64-Kompiliercheck und x64-Build erfolgreich. Der Installer-Test schlug bei `OpenWithProgids` fehl. Inno Setup legte mit `ValueType: none` die Schlüssel an, schrieb aber die ProgID-Werte nicht.
- **Korrektur**: `installer/Semyra.iss` registriert `Semyra.Document` für alle fünf Markdown-Endungen als leeren `REG_SZ`-Wert. `Build-Installer.ps1 -Architecture x64` baute das korrigierte Paket lokal erfolgreich.
- **Erneuter CI-Lauf**: [GitHub Actions](https://github.com/JanChrisLoew/semyra/actions/runs/44286949706) war für `a01d041` vollständig grün. Die Job-Logs bestätigen die identische SHA-256 der installierten x64-EXE, die Explorer-Registrierung im Benutzerprofil und die Bereinigung nach der Deinstallation. Der PR bleibt zur Prüfung offen.

---

## 2026-11-18 — x64-Installerprüfung in GitHub Actions

- **Änderung**: `.github/workflows/ci.yml` baut und prüft den x64-Inno-Installer bei Pull Requests, Pushes auf `main` und Versions-Tags. Der bestehende Installer-Upload bleibt an Versions-Tags gebunden und folgt nach erfolgreicher Prüfung. Bei Fehlern werden vorhandene Setup- und Uninstall-Logs als Artefakt bereitgestellt.
- **Prüfung**: `scripts/Test-Installer.ps1` verlangt einen sauberen Windows-Testkontext, installiert im Benutzermodus in einem separaten Zielordner und vergleicht SHA-256 sowie Produktversion. Es prüft OpenWith, Dateizuordnungen, Ordnerkontextmenü, App Paths und Deinstallationsregistrierung. Anschließend ruft es den Uninstaller auf und prüft die Bereinigung.
- **Verifikation**: Typecheck, 172 Frontend-Tests, Vite-Build, 41 Rust-Tests, 17 Playwright-Tests, x64-Release-Build und `Build-Installer.ps1 -Architecture x64` erfolgreich. Die Schritte von `Build-Release.ps1` wurden einzeln ausgeführt. PowerShell-Parser und Workflow-Reihenfolge geprüft. Ein simulierter Durchlauf bestätigte Erfolgsfall sowie Bereinigung bei einer abweichenden Prüfsumme. Der echte lokale Vorabcheck verweigerte den Test bei vorhandener Installation. Die installierte EXE und ihre Registrierung blieben erhalten.
- **Offen**: Der vollständige Installations- und Deinstallationslauf mit echter Registry steht auf dem frischen GitHub-Runner aus. Die Workflow-Änderung und das neue Skript liegen im lokalen Arbeitsbaum. Die portable x64-EXE und der Installer wurden aus dem aktuellen Arbeitsbaum neu gebaut.

---

## 2026-11-18 — Workspace-Freigabe für lokale Bilder begrenzt

- **Änderung**: `src/state.rs` prüft für lokale Bilder den aktuellen Workspace separat von zusätzlichen Freigaben für Dokumente, Recovery, eingefügte Bilder und die KI-Bibliothek. Beim Wechsel entfällt dadurch die reine Workspace-Freigabe des alten Ordners. Unabhängige Freigaben gelten weiterhin für die laufende Sitzung.
- **Nebenläufigkeit**: `src/ipc.rs` verwirft überholte Ordnerauswahlen. `frontend/src/api.ts` und `frontend/src/sidebar-explorer.ts` behandeln die Aktualisierung des Explorer-Baums als lesenden Aufruf. Verspätete Aktualisierungen können keinen neueren Explorer-Stand überschreiben oder einen Workspace erneut freigeben.
- **Verifikation**: Zwei neue Rust-Tests decken den Entzug der alten Workspace-Freigabe, legitime Bildpfade und überholte Ordnerauswahlen ab. Der Explorer-Test prüft die lesende Aktualisierung und den erhaltenen Aufklappzustand. Typecheck, 172 Frontend-Tests, Vite-Build, 41 Rust-Tests, ARM64-Kompiliercheck und 17 Playwright-Tests erfolgreich. `Build-Release.ps1`, Installer-Build und native WebView2-Abnahme wurden in dieser Sitzung nicht ausgeführt.

---

## 2026-11-18 — Entwurfssicherung und Live-Vorschau unter IPC-Last

- **Befund**: Ein Rust-Test belegt alle allgemeinen IPC-Worker kontrolliert mit simulierten Such- und Dialogaufgaben. Mit dem gemeinsamen Pool blieb der Entwurfsauftrag bis zum Fünf-Sekunden-Timeout in der Warteschlange.
- **Änderung**: `src/ipc.rs` gibt `drafts/save` und der zugehörigen Bereinigung beim Fensterschließen einen gemeinsamen eigenen Worker. Die Live-Vorschau erhält einen zweiten dedizierten Worker, während Export-Rendering über den allgemeinen Pool läuft. Der Test speichert einen Entwurf, liest ihn über `DraftStore` wieder ein und prüft das gerenderte HTML, bevor die belegten Worker freigegeben werden. Die Warteschlangen sind weiterhin unbeschränkt.
- **Verifikation**: Gezielt vor der Änderung fehlgeschlagen, danach bestanden. Typecheck, 172 Frontend-Tests, Vite-Build, 39 Rust-Tests, ARM64-Kompiliercheck und 17 Playwright-Tests erfolgreich. Der Lasttest prüft die Rust-Ausführung ohne native WebView2-Dialoge. `Build-Release.ps1` und Installer-Build wurden für diese Änderung nicht ausgeführt.

---

## 2026-11-18 — Ordner-Ersetzen an aktuelle Suchergebnisse gebunden

- **Änderung**: `frontend/src/workspace-search.ts` bindet den Arbeitsordner, den normalisierten Suchbegriff, die Suchoptionen und die ausgewählten Dateipfade zusammen. Änderungen am Suchstand entwerten laufende Antworten und die alte Auswahl. Ohne aktuelle ausgewählte Treffer bleibt Ersetzen auch per Eingabetaste gesperrt. Vor dem IPC-Aufruf prüft der Controller die bestätigten Parameter erneut und verhindert parallele Ersetzungen.
- **Integration**: `frontend/src/main.ts` aktualisiert die Suche bei einem Ordnerwechsel oder beim Schließen des Arbeitsordners. `frontend/src/i18n.ts` nennt beim Bestätigen in DE/EN die Anzahl der ausgewählten Dateien. Der Rust-Aufruf erhält stets die explizite Dateiliste.
- **Verifikation**: Sieben neue Regressionsfälle in `frontend/src/__tests__/workspace-search.test.ts` für verspätete Antworten, Debounce, leere Trefferlisten und Änderungen während der Bestätigung. Typecheck, 172 Frontend-Tests, Vite-Build, 17 Playwright-Tests und 38 Rust-Tests erfolgreich. `Build-Release.ps1` und Installer-Build wurden für die Härtung nicht ausgeführt.

---

## 2026-11-18 — Codebase-Review zu Dateisicherheit und Modulgrenzen

- **Umfang**: Frontend- und Rust-Struktur, Dateilebenszyklus, Workspace-Suche und Ersetzen, IPC-Worker, Preview-Sanitizing und Asset-Freigaben geprüft. Lediglich dieses Protokoll geändert.
- **P1**: `frontend/src/workspace-search.ts` kann beim Ordner-Ersetzen Suchparameter und Dateiauswahl aus unterschiedlichen Suchständen kombinieren. In einem isolierten jsdom-Check mit simuliertem Backend erschienen verspätete Ergebnisse nach dem Leeren erneut und wurden für eine neue Ersetzung weiterverwendet. Dabei wurden keine Dateien geschrieben. Empfohlen ist eine gemeinsame Momentaufnahme für Vorschau, Auswahl und bestätigte Ersetzung.
- **P2/P3**: Die Dateisystem-, Render-, Dialog- und PDF-Arbeit in `src/ipc.rs` teilt sich einen Pool mit begrenzter Threadzahl und unbeschränkter Warteschlange. Native Dialoge und PDF-Wartezeit können Worker belegen. Die Asset-Freigabeliste in `src/state.rs` wächst über Ordnerwechsel hinweg. Die langlebigen Freigaben sollten nach Herkunft überprüft werden. Für `frontend/src/main.ts` empfiehlt sich nach den Härtungen eine kleine, testgestützte Extraktion der Dokumentzustandslogik; fachlich zusammenhängende Übersetzungen und Markdown-Rendering benötigen keinen Schnitt nach Zeilenzahl.
- **Verifikation**: `cargo check --locked`, `cargo test --locked` (38 Tests), `npm run typecheck`, `npm test` (165 Tests) und `npm run test:e2e` (17 Tests in headless Edge) erfolgreich. `Build-Release.ps1` für das lesende Review nicht erneut ausgeführt. Keine IPC-Lastmessung oder vollständige Sicherheitsprüfung durchgeführt.

---

## 2026-11-18 — Playwright-Abdeckung für KI-Kontext

- **Änderung**: `frontend/e2e/ai-context.spec.ts` prüft den Mehrdatei-Bundler über die Befehlspalette. Der Test wählt einen bearbeiteten Tab und zwei ungeöffnete Arbeitsordnerdateien aus, prüft den deaktivierten Kopierbutton bei leerer Auswahl und vergleicht den kompletten XML-Inhalt mit relativen Pfaden. Ein zweiter Test prüft, dass `Strg+Umschalt+A` ausschließlich den aktiven Tab als Markdown-Kontext kopiert.
- **Verifikation**: `npm run typecheck`, gezielte TypeScript-Prüfung der Spec, `npm test` (165 Tests) und `npm run test:e2e` (17 Tests, inklusive beider neuer Fälle) erfolgreich. Playwright lief in headless Edge gegen das vorhandene Produktionsbundle. Der erste gezielte Lauf zeigte den lokalisierten Dialognamen „Befehle“, danach wurde der Locator korrigiert. `cargo test` und `Build-Release.ps1` für diese reine Teständerung nicht erneut ausgeführt.
- **Testgrenze**: Der Browser führt Befehlspalette, Editor und Bundler aus. Die Tests simulieren die native IPC und erfassen Zwischenablage-Schreibvorgänge im Browser-Kontext.

---

## 2026-11-18 — x64-Pilotbuild und native Stichprobe

- **Stand und Änderungen**: x64-Pilot aus Anwendungsstand `37c1bbd` mit Version `0.2.0` gebaut. `README.md` erklärt jetzt `Strg+Umschalt+A` für den aktiven Tab und nennt Teilen-Menü und Befehlspalette als Einstieg in den Mehrdatei-Bundler.
- **Build und Tests**: `Build-Release.ps1` erfolgreich mit Typecheck, 165 Frontend-Tests, Vite-Produktionsbundle, 38 Rust-Tests und warnungsfreiem x64-Release-Build. `Build-Installer.ps1 -Architecture x64` erfolgreich mit dem vorhandenen Inno Setup 6.4.1 im lokal installierten Antigravity IDE. Artefakte liegen in `target/release/Semyra.exe` und `target/installer/Semyra-Setup-x64.exe`.
- **Native Stichprobe**: Bytegleiche Release-Kopie im isolierten App-Profil gestartet. Eine externe Änderung an der Testdatei blieb nach `Strg+S` bytegleich erhalten, während die lokale Änderung im Editor sichtbar blieb. Der native WebView2-PDF-Export enthält auf einer Seite die erwartete Überschrift und beide Mermaid-Knotenbeschriftungen sowie Vektorzeichnungen. Das Test-PDF liegt unter `target/pilot-x64/mermaid-pilot.pdf`.
- **Offene Abnahme**: Semyra meldete im isolierten Profil, dass der Recovery-Entwurf nicht gespeichert werden konnte. Ein unabhängiger Dateitest bestätigte, dass die Testumgebung das Umbenennen im isolierten App-Datenverzeichnis mit „Zugriff verweigert“ blockiert. Recovery nach Prozessabbruch, Setup und Explorer-Dateizuordnung bleiben auf einem sauberen Windows-Profil zu prüfen. Die vorhandene Host-Installation wurde nicht verwendet oder aktualisiert.
- **KI-Workflow**: Die Bundler-Funktion lieferte mit `AGENTS.md`, `docs/PRODUCT_CONTEXT.md` und `.agents/skills/semyra-release/SKILL.md` jeweils drei Einträge mit relativen Pfaden in Markdown und XML. Die Auffindbarkeit und der vollständige Ablauf durch die Oberfläche bleiben im Test mit einer unabhängigen Person zu prüfen. Bis zur offenen Abnahme wurde kein Testbuild verteilt.

---

## 2026-11-18 — Produktreview und Prioritäten für den nächsten Meilenstein

- **Umfang und Stand**: Produktkontext, README, Commit-Historie, Anwendungs-Einstiegspunkte, Testabdeckung und lokale Release-Artefakte geprüft. GitHub bestätigte `37c1bbd` als aktuellen `main` des privaten Repositories. Die Issue-Suche ergab keine offenen Treffer. Der Remote-Release- und CI-Status blieben unbestätigt.
- **Befunde**: Version `0.2.0` im Quellstand. Der lokale x64-Build vom 14.11. ist neuer als die beiden Installer und die ARM64-EXE vom 08.11. CI prüft ARM64 per `cargo check` und baut den Installer bei Tags für x64. Das README ordnet `Strg+Umschalt+A` dem Mehrdatei-Bundler zu, der Handler kopiert den aktiven Tab. Die Startseite demonstriert Markdown-Funktionen und enthält keinen Einstieg in den KI-Workflow. Anwendungscode und Produktdokumentation wurden im Review nicht geändert.
- **Verifikation**: `npm run typecheck`, `npm test` (165 Tests), `npm run build`, `cargo test --locked` (38 Tests) und `cargo check --locked --target aarch64-pc-windows-msvc` erfolgreich. Rust meldete beim Testlauf einen Fallback von Hardlinks auf Dateikopien im inkrementellen Cache. Playwright listete 15 Tests, der Wiederholungslauf scheiterte am lokalen Preview-Server. Im Work Log sind für den 14.11. 15 bestandene Playwright-Tests dokumentiert. `Build-Release.ps1`, Installer-Build und native Abnahme in dieser Sitzung nicht ausgeführt.
- **Empfohlene Reihenfolge**: Einen x64-Testbuild mit nativer Abnahme der Datei-, Recovery-, Export- und Installer-Wege vorbereiten. Den bestehenden Ablauf von `AGENTS.md`/`SKILL.md` über Prüfung bis Kontextübergabe mit einem echten Repository erproben und die Einstiegspunkte danach schärfen. ARM64 als eigenständig geprüfte Plattform behandeln. Weitere CLI-Funktionen am beobachteten Bedarf priorisieren.

---

## 2026-11-14 — UI/UX-Hüllen-Integration & Token-Bereinigung (Sprints 1–5)

- **Umfang & Ziel**: Schwerpunktmäßiges UI/UX-Review und nahtlose Verankerung der Sprint-1–5-Funktionen in der bestehenden UI-Hülle (Menüs, Kontextmenüs, Dialoge, Tastaturhinweise, CSS-Tokens & Kontraste).
- **Wesentliche Änderungen**:
  - **Nahtlose Einstiegspunkte (`frontend/index.html`, `frontend/src/main.ts`, `frontend/src/sidebar-explorer.ts`)**: `#share-popover` um `HTML (Hell)`, `HTML (Dunkel)` und `Prompt-Variablen ausfüllen…` erweitert; `#tab-context-menu` um `Mit gespeichertem Stand vergleichen` und `Offene Tabs vergleichen…` (inkl. `#compare-tab-picker-dialog` bei >2 Tabs) ergänzt; `#tree-context-menu` um `Relativen @Pfad kopieren`, `AGENTS.md anlegen` und `Workspace-Skill anlegen…` erweitert; `#palette-input`/`.palette-footer` um `#`-Überschriftenhinweis und `#shortcuts-dialog` um `Alt+←/→` & `Strg+Umschalt+L` ergänzt; `cmd:editor-search` im Preview-Modus auf `openPreviewFind()` geroutet.
  - **CSS-Tokens, Amber-Disziplin & Layout (`frontend/src/styles/`)**: Undefinierte CSS-Variablen (`--border-default`, `--bg-canvas`, `--bg-surface-raised`, `--shadow-flyout`, `--bg-backdrop`, `--font-sans`, `--transition-fast`) bereinigt; `.diff-line-row.is-removed` von Amber auf `color-mix(in srgb, var(--danger) 14%, transparent)` umgestellt und `(Amber)`/`(Teal)`-Texte aus `index.html`, `ai-dialogs.ts` und `i18n.ts` entfernt; `.outline-copy-btn` per `display: none` auf `:hover`/`:focus-within` verlegt und `.outline-item-tokens` auf `--fg-secondary` gehoben; `forced-colors: active` und schmale Viewport-Regeln (`<760px`) ergänzt.
  - **Popovers, Fokus & i18n (`frontend/src/ai-dialogs.ts`, `workspace-search.ts`, `main.ts`, `i18n.ts`)**: `aria-haspopup="menu"`, `aria-expanded` und `▾` an Format-Toolbar-Pickern sowie Viewport-Messung für `#format-option-popover`; Fokus-Wiederherstellung bei `closePreviewFind` und `#goto-line-dialog`; `aria-live="polite"` und Anfangsfokus in Diff-/Bundler-/Prompt-Dialogen; `data-i18n-title`/`data-i18n-aria` für `\\b`/`.*` in der Workspace-Suche.
- **Verifikation**: `cd frontend && npm run typecheck` (0 Fehler), `npm test` (22 Dateien, 165/165 Tests bestanden), `npm run build` (erfolgreich), `npm run test:e2e` (15/15 Playwright-Tests inkl. `axe-core` bestanden), `cargo test` (38/38 Tests bestanden, 0 Warnungen), `cargo build --release` (0 Warnungen, `target/release/Semyra.exe` neu gebaut).
- **Nächste Schritte**: Menschliche Abnahme der UI-Hülle in `target/release/Semyra.exe`; bei Bedarf Installer-Build über `scripts/Build-Installer.ps1`.

---

## 2026-11-14 — Release-Review & Stabilisierung Sprints 1–5

- **Umfang & Ziel**: Unabhängiges Schwarm-Code-Review (Rust, Frontend Core/Security, Frontend AI/UX/CSS) über alle Änderungen der Sprints 1–5 inkl. Behebung aller Blocker-, High-, Medium-, Low- und Compiler-Warnungs-Findings sowie anschließender Re-Reviews.
- **Wesentliche Fixes**:
  - **Render-Coalescing (`BLOCKER`)**: `superseded?: boolean` und getrennte `docKey`-Werte (`'live'` vs. `'export'`) in `frontend/src/api.ts`, `frontend/src/main.ts`, `frontend/src/document-export.ts` und `src/ipc.rs` ergänzt; LRU-Eviction statt `map.clear()` bei >256 Keys in `RenderCoalescer`.
  - **Rust-Sicherheit & Release-Warnungen**: UTF-8-sicheres `strip_prefix`/`strip_suffix` in `src/markdown.rs` (`match_prompt_tag_open`); `#[cfg(test)]`-Gating test-exklusiver Suchhelfer in `src/fs_ops/mod.rs` und `src/fs_ops/search.rs` (0 Release-Warnungen); konsistentes `.multi_line(true)` und CRLF-Normalisierung in `search.rs`; relative `IGNORED_DIRS`-Prüfung zum überwachten Root in `src/state.rs` (`is_ignored_watch_path`); Retry-Handling bei `AlreadyExists` in `src/single_instance.rs`.
  - **Frontend-Linting, Cache & UX**: `md.brokenRelativeLink` schließt Bilder/Binärassets aus, unterstützt `//`-URLs, Dateipfade mit Klammern, case-insensitive `#heading`-Anker und mehrzeilige `{{...}}`-Blöcke (`frontend/src/markdown-lint.ts`); `invalidateLintWorkspaceCache()` und Workspace-Guard in `frontend/src/main.ts`; `.mermaid, svg`-Ausschluss in `updatePreviewFindMatches`; `navHistory`-Remap & Guard; Fokus-Erhalt in `frontend/src/ai-dialogs.ts`; `outline: 2px solid var(--color-focus-ring)` in `frontend/src/styles/editor.css`; kanonische Tokens in `frontend/src/styles/markdown.css`; Abbruch-Handling bei `onPickImage` (`frontend/src/editor.ts`) sowie getrennte `rafId`/`timeoutId`-Bereinigung in `frontend/src/sync-scroll.ts`.
- **Verifikation & Re-Review**: Alle 3 unabhängigen Re-Reviews (`review-rust`, `review-fe-core`, `review-fe-ai-css`) auf **APPROVED**; `npm run typecheck` (0 Fehler), `npm test` (22 Dateien, 165/165 Tests bestanden), `npm run build` (erfolgreich), `npm run test:e2e` (15/15 Playwright-Tests bestanden), `cargo test` (38/38 Tests bestanden, 0 Warnungen), `cargo build --release` (0 Warnungen).
- **Nächste Schritte**: Menschliches Review der Änderungen; optionaler Installer-Build (`scripts/Build-Installer.ps1`).

---

## 2026-11-14 — Produkt-Audit & Umsetzung Sprints 1–5 (`vNext` + `vNext+1`)

- **Umfang & Ziel**: Ausgehend von einem Read-Only-Produkt-Audit gegen `docs/PRODUCT_CONTEXT.md` wurden die Sprint-Pakete 1–5 vollständig ausgeplant, umgesetzt und verifiziert:
  - **Sprint 1 (Navigation, Zen & Editor-Ergonomie)**: Zen-`Esc`-Priorisierung vor `.cm-search` / `#preview-find-bar` (`frontend/src/main.ts`), `Strg+G` Go-to-Line über `#goto-line-dialog` und interaktiven `#status-cursor`, `Strg+F` Find-in-Page im Preview-Modus (`#preview-find-bar`), `Alt+Left`/`Alt+Right` Navigationshistorie, Doppelklick-zu-Quellzeile in der Split-Preview, `#` Heading-Jump und `listbox`/`aria-activedescendant`-A11y (`frontend/src/palette.ts`, `frontend/src/palette-items.ts`), `aria-current="location"` im Outline sowie Pfeiltasten-Navigation und „Alle einklappen“ (`#btn-collapse-all`) im Sidebar-Explorer (`frontend/src/sidebar-explorer.ts`).
  - **Sprint 2 (Plattform-Stabilität, Watcher & Performance)**: Begrenzter `WorkerPool` (`4..=8` Threads) + `RenderCoalescer` für `/api/render` sowie Auslagerung synchroner FS-Routen in `src/ipc.rs`; `IGNORED_DIRS`-Filter im `notify`-Callback (`src/state.rs`); vereinheitlichte Dotfile-Allowlist in `src/fs_ops/mod.rs`, `workspace.rs` und `search.rs`; Win32-Named-Mutex (`Local\Semyra_SingleInstance_v1`) in `src/single_instance.rs`; 25-MB-Dateigrößen-Guard in `src/fs_ops/encoding.rs`; `rAF`-Throttling & `[data-line]`-Caching in `frontend/src/sync-scroll.ts`; sichere Inline-Mermaid-Fehlerhinweise in `frontend/src/sanitizer.ts` und `frontend/src/styles/markdown.css`.
  - **Sprint 3 (AI Context Bundler & Prompt-Ergonomie)**: Einheitliche workspace-relative Labels (`toWorkspaceRelativeLabel`), XML-`<file path="...">`-Ausgabe, optionales Strippen von Frontmatter/Kommentaren sowie `extractTemplateVariables`/`interpolateTemplateVariables` in `frontend/src/ai-bundle.ts`; `computeHeadingTokenCounts` & `extractMarkdownSection` in `frontend/src/stats-utils.ts`; erweitertes Bundler-Modal (Live-Filter, Sortierung, Format-Toggle, nicht-Amber Token-Budget-Anzeige, „Als Datei speichern“) und `openPromptVariablesDialogModal` in `frontend/src/ai-dialogs.ts`; Outline-Token-Badges, „Sektion für AI kopieren“ und „Relativen `@pfad` kopieren“ in `frontend/src/main.ts` und `frontend/src/palette-items.ts`.
  - **Sprint 4 (AI-Linting, Frontmatter-Preview & Workspace-Scaffolding)**: Strukturierte `.frontmatter-chips` und sichtbare `.prompt-tag-block`-Sektionen (`role`, `context`, `instructions`, `output_format`, `constraints`, `examples`) in `src/markdown.rs`, `frontend/src/sanitizer.ts`, `frontend/src/styles/markdown.css`, `src/fs_ops/html_export.rs` und `frontend/src/export-utils.ts`; strukturelle AI-/Link-Checks (`ai.unclosedXmlTag`, `ai.malformedPlaceholder`, `md.brokenAnchor`, `md.brokenRelativeLink`) sowie exakte `name:`-Zeilenangabe bei `skill.invalidNameFormat` in `frontend/src/markdown-lint.ts`; Workspace-Scaffolding-Befehle (`cmd:scaffold-workspace-agents`, `cmd:scaffold-workspace-skill`) in `frontend/src/main.ts` und `frontend/src/palette-items.ts`.
  - **Sprint 5 (Diffing, Selektives Replace & Export-Parität)**: Einklappbare unveränderte Diff-Kontextblöcke (`buildCollapsedDiffItems` in `frontend/src/line-diff.ts`), Hunk-Navigation („Vorherige/Nächste Änderung“) und allgemeines `openCompareDiffDialogModal` in `frontend/src/ai-dialogs.ts`; Regex (`.*`), Ganzes-Wort (`\b`) und dateiselektives Replace (`includeFiles`) in `src/fs_ops/search.rs`, `src/ipc.rs` und `frontend/src/workspace-search.ts` (inkl. `regex = "1"` in `Cargo.toml`); Light/Dark-HTML-Export (`exportHtml(themeOverride)` in `frontend/src/document-export.ts`), „Mit gespeichertem Stand vergleichen“ / „Offene Tabs vergleichen“ sowie Toolbar-Picker für Bilder, Codeblock-Sprachen und GitHub-Alerts in `frontend/src/editor.ts` und `frontend/src/main.ts`.
- **Verifikation**: `cd frontend && npm run typecheck` (0 Fehler), `cd frontend && npm test` (22 Testdateien, 161/161 Tests bestanden), `cd frontend && npm run build` (erfolgreich), `cargo test` (0 Warnungen, 34/34 Rust-Tests bestanden).
- **Nächste Schritte**: Optionaler Release-Build (`Build-Release.ps1`) bzw. E2E-Playwright-Lauf sowie Planung der Sprints 6–7 (`vNext+2`: CLI-Flags/Stdin, `Ctrl+Click`-Links, ARM64-Parität).

---

## 2026-11-14 — Mermaid-Diagramme per Maus verschieben

- `frontend/src/mermaid-viewer.ts` verschiebt den vorhandenen Scrollbereich beim Ziehen mit gedrückter linker Maustaste. Pointer Capture hält die Geste außerhalb der Diagrammfläche aktiv. Die Dialogstile zeigen Greifcursor und 14 px breite bzw. hohe Scrollleisten in Chromium.
- Typecheck, 121 Frontend-Tests, Vite-Build, 20 Rust-Tests und alle 15 Playwright-Tests bestanden. Der Mermaid-Test prüft Ziehen auf beiden Achsen, Loslassen außerhalb des Diagramms, Tastaturscrollen und Einpassen.
- Release kompiliert. Die laufende EXE am Standardpfad konnte wegen einer Dateisperre weder ersetzt noch überschrieben werden. Die verifizierte Kopie des neuen Builds liegt unter `target/mermaid-pan/Semyra.exe`. Build-Schritte einzeln ausgeführt.

---

## 2026-11-14 — Mermaid-Dialog kompakter

- Standardgröße in `frontend/src/styles/dialogs-print.css` auf 84 % der Fensterbreite und 72 % der Fensterhöhe reduziert. SVG-Zoom und Einpassen bleiben verfügbar. Der bestehende Playwright-Test prüft zusätzlich beide Dialogmaße.
- Typecheck, 121 Frontend-Tests, Vite-Build, 20 Rust-Tests und gezielter Playwright-Test erfolgreich. `Build-Release.ps1` über die einzelnen Schritte abgedeckt. Die aktualisierte x64-EXE wurde nach `target/release/Semyra.exe` gebaut. Die neue Dialoggröße wurde in Edge geprüft.

---

## 2026-11-14 — Mermaid-Großansicht mit SVG-Zoom

- `frontend/index.html`, `frontend/src/mermaid-viewer.ts`, `main.ts`, `i18n.ts` und die Dialog- und Markdown-Stile erweitert. Die Großansicht nutzt 94 % der Fensterbreite und 90 % der Fensterhöhe. Ein Klick auf das Diagramm oder auf „Vergrößern“ öffnet das eingepasste SVG. Die Bedienelemente skalieren von 50 bis 800 % relativ zur eingepassten Ansicht.
- Typecheck, 121 Frontend-Tests, Vite-Build, 20 Rust-Tests und 15 Playwright-Tests bestanden. Der neue Test in `frontend/e2e/mermaid-viewer.spec.ts` prüft Klick, SVG-Skalierung, Scrollbereich, Einpassen und Tastaturzugriff. Nativ in WebView2 direktes Öffnen, große Darstellung und 125-%-Stufe bestätigt.
- `Build-Release.ps1` konnte die offene bzw. gesperrte `target/release/Semyra.exe` nicht ersetzen. Die frisch kompilierte Release-EXE wurde separat unter `target/mermaid-build/Semyra.exe` bereitgestellt und bytegleich unter eindeutigem Prozessnamen getestet.
- Anschließend den getesteten Build auch nach `target/release/Semyra.exe` kopiert und die identischen SHA-256-Prüfsummen verifiziert. Die installierte EXE hat weiterhin einen älteren Stand.

---

## 2026-11-14 — Mermaid-Großansicht nativ geprüft

- Im Split- und Lesemodus mit einer bytegleichen Kopie des Release-Builds getestet. Der Klick auf das Diagramm öffnet keinen Dialog. Die Schaltfläche „Vergrößern“ am Diagramm öffnet in beiden Modi den Dialog und Escape schließt ihn.
- Anwendungscode unverändert. Typecheck, Frontend- und Rust-Tests sowie Release-Build für diesen gezielten UI-Test nicht erneut ausgeführt.

---

## 2026-11-14 — Refactoring erneut geprüft

- `Build-Release.ps1` mit Typecheck, 121 Frontend-Tests, Vite-Build, 20 Rust-Tests und x64-Build erneut erfolgreich. ARM64-Compile-Check und 14 Playwright-Tests gegen das Produktionsbundle ebenfalls erfolgreich. Die README-Build-Anleitung enthält keine festen Testzahlen mehr.
- Nativer Test mit einer bytegleichen Kopie des x64-Builds unter eindeutigem Prozessnamen, da die Windows-Automation die gleichnamigen Fenster der installierten und der gebauten EXE verwechselte. Die native WebView2-PDF enthält auf einer Seite die erwartete Überschrift und beide Mermaid-Beschriftungen.
- Die Testinstanz ließ sich regulär schließen. `window_prefs.json` enthielt danach Fenstergeometrie und Testsession. Beim erneuten Start ohne Dateiparameter erschien das Testdokument aus der gespeicherten Sitzung. Der Test hat den zuletzt gespeicherten Sitzungsstand auf den Testordner gesetzt.
- Anwendungscode unverändert. Nativer PDF-Export und Sitzungswiederherstellung im Normalfall bestätigt. Der Schreibfehlerfall beim Schließen wurde in Playwright mit simulierter IPC-Antwort geprüft.

---

## 2026-11-14 — Einstellungspersistenz und Exportsteuerung konsolidiert

### 1. Ziel & Scope
- Einstellungsspeicherung und Exportsteuerung nach dem Codebase-Review gezielt überarbeitet und veraltete Testzahlen aus dem README entfernt.

### 2. Änderungen & Entscheidungen
- `src/window_prefs.rs` nutzt den vorhandenen atomaren Dateiaustausch und eine prozessübergreifende Sperre um Lesen, Ändern und Schreiben. `src/ipc.rs` und `src/state.rs` prüfen die Revision der UI-Einstellungen, damit verspätete Antworten keinen neueren UI-Stand zurücksetzen.
- `src/main.rs` speichert Fenstergröße und Position beim Schließen außerhalb des UI-Threads und übernimmt nur die Geometriefelder. Die UI meldet Schreibfehler der Einstellungen und lässt beim Schließen einen erneuten Versuch oder bewusstes Schließen zu.
- `frontend/src/document-export.ts` übernimmt HTML, PDF, Druck und Rich-Text-Kopie. `frontend/src/main.ts` liefert den Dokumentstand und bindet die Aktionen ein.

### 3. Testergebnisse & Build-Status
- `Build-Release.ps1` erfolgreich mit `npm run typecheck`, 121 Frontend-Tests, Vite-Build, 20 Rust-Tests und x64-Release-Build. ARM64-Compile-Check erfolgreich.
- 14 Playwright-Tests bestanden. Die Suite enthält jetzt einen Fehler-und-Wiederholungsfall für die UI-Persistenz. Ausführung gegen das Produktionsbundle mit direktem Vite-Aufruf außerhalb der Sandbox.

### 4. Verbleibende Prüfung
- Die aktuelle EXE wurde nach dem Refactoring gebaut. Der native Fenster-Schließablauf und der PDF-Export wurden für diesen neuen Build nicht erneut manuell geprüft.

---

## 2026-11-14 — Review möglicher kleiner Refactorings nach der Abnahme

- Den abgenommenen Arbeitsbaum geprüft. Der größte konkrete Nutzen liegt in der Konsolidierung der Einstellungspersistenz. `prefs/save` und die Fensterschließlogik schreiben dieselbe Datei über getrennte Abläufe. Ein gemeinsamer, serialisierter Update-Pfad mit atomarem Dateiaustausch und Fehlerweitergabe würde veraltete Snapshots und beschädigte JSON-Dateien vermeiden.
- Als kleines Refactoring bietet sich die Auslagerung der Exportsteuerung aus `frontend/src/main.ts` an. Die vorhandenen Tests für HTML- und PDF-Ausgabe beim Tabwechsel bilden eine Verhaltensgrenze. Die Kopplung von Speichern, Reload, Auto-Save und Schließen bleibt ein eigener, größerer Schritt. Anwendungscode unverändert. Der Nutzer bestätigte zuvor die vier nativen Abnahmetests.
- `npm run typecheck`, 121 Frontend-Tests, `cargo check --locked`, 19 Rust-Tests und 13 Playwright-Tests erfolgreich. Playwright nutzte das vorhandene Produktionsbundle und einen direkten Vite-Aufruf außerhalb der Sandbox. `Build-Release.ps1` für dieses Review nicht erneut ausgeführt.

---

## 2026-11-14 — Grenzfälle aus der Nachprüfung abgesichert

### 1. Ziel & Scope
- Verwerfen, Auto-Save, Export, Dateiwächter und Ordner-Ersetzen gegen die in der Nachprüfung gefundenen Grenzfälle abgesichert.

### 2. Änderungen
- `frontend/src/main.ts` bindet Schließbestätigungen an die geprüften Editorrevisionen, pausiert Auto-Save während des Dialogs und plant ihn bei Abbruch erneut. Nach der letzten Prüfung wird das Dokument bis zur nativen Schließantwort gegen weitere Benutzereingaben gesperrt.
- `frontend/src/main.ts`, `export-utils.ts`, `sanitizer.ts` und die Druckstile verwenden einen festen Dokumentstand für HTML, Rich Text, PDF und Druck. Die Live-Vorschau behält ihren eigenen Renderlauf. Mermaid-Renderläufe wechseln das globale Theme erst nach Abschluss des vorherigen Laufs.
- `src/state.rs` und `src/ipc.rs` leiten Dateiereignisse ohne Zeitfilter weiter. Die Oberfläche vergleicht den gelesenen Stand nach ausstehenden Speicheroperationen. `src/fs_ops/search.rs` sammelt Zugriffsfehler bei der Verzeichnissuche und meldet sie als Teil des Ersetzen-Ergebnisses.

### 3. Testergebnisse & Build-Status
- `Build-Release.ps1` mit Typecheck, 121 Frontend-Tests, Vite-Build, 19 Rust-Tests und x64-Release-Build erfolgreich. Das finale Frontend-Bundle wurde erneut für x64 eingebettet und für ARM64 kompiliert.
- Alle 13 Playwright-Tests gegen das Produktionsbundle bestanden. Fünf neue Fälle prüfen abgebrochenes Schließen, spätere Eingaben, HTML- und PDF-Ausgabe nach Tabwechsel sowie eine externe Änderung direkt nach dem Speichern.

### 4. Verbleibende Grenzen
- Browser-Tests prüfen IPC und die Druckansicht mit simulierten nativen Antworten. Der native WebView2-PDF-Dialog und der tatsächliche Benachrichtigungsablauf in WebView2 wurden nicht manuell geprüft.
- Externe Prozesse können weiterhin im kurzen Zeitfenster zwischen Inhaltsvergleich und atomarem Dateiaustausch schreiben.

---

## 2026-11-14 — Nachprüfung der fünf Review-Korrekturen

### 1. Ziel & Scope
- Die Korrekturen für Speichern, Auto-Save, Entwurfswiederherstellung, Ordner-Ersetzen und Vorschau im aktuellen Arbeitsbaum nachgeprüft.

### 2. Befunde
- Drei Fehler mit temporären Playwright-Prüfungen und nachgestelltem IPC bestätigt. Beim Schließen des Fensters kann die Verwerfen-Bestätigung spätere Eingaben einschließen (`frontend/src/main.ts`). Nach Abbruch eines Tab-Schließens bleibt ein geplanter Auto-Save aus. Der HTML-Export kann beim Tabwechsel Inhalt eines anderen Tabs übernehmen.
- Per Codeanalyse festgestellt, dass der Dateiwächter externe Änderungen kurz nach einem eigenen Schreibzugriff ausfiltern kann (`src/state.rs`). Beim Ordner-Ersetzen werden Fehler in der Dateisuche still übersprungen (`src/fs_ops/search.rs`).
- Anwendungscode nicht geändert. Temporäre Prüfspezifikationen und Konfigurationen entfernt.

### 3. Testergebnisse & Build-Status
- `npm run typecheck`, `npm test` (121 Tests), `cargo check --locked` und `cargo test --locked` (18 Tests) erfolgreich. Die 8 vorhandenen Playwright-Tests bestanden gegen das vorhandene Vite-Bundle mit direktem Vite-Aufruf außerhalb der Sandbox.
- Drei zusätzliche Prüfungen reproduzierten die genannten Fehler. `scripts/Build-Release.ps1` und native WebView2-UI für die Nachprüfung nicht erneut ausgeführt.

### 4. Nächste Schritte
- Verwerfen an konkrete Editorrevisionen binden, Auto-Save bei abgebrochenem Schließen wieder einplanen, Exporte an das Ausgangsdokument binden und Watcher-Ereignisse anhand des Dateistands einordnen.

---

## 2026-11-14 — P1- und P2-Befunde aus dem Review behoben

### 1. Ziel & Scope
- Fünf Befunde zu Speichern, Auto-Save, Entwurfswiederherstellung, Ordner-Ersetzen und Live-Vorschau behoben.

### 2. Änderungen & Entscheidungen
- `frontend/src/main.ts`, `api.ts`, `ai-dialogs.ts`, `src/ipc.rs` und `src/fs_ops/encoding.rs`: Speichern bestätigt den tatsächlich geschriebenen Inhalt und Zeilenumbruch. Rust prüft den erwarteten Dateistand und serialisiert Semyra-Schreibzugriffe fensterübergreifend. Auto-Save wartet bei Konflikten. „Lokal behalten“ erlaubt manuelles Speichern gegen den zuvor verglichenen Dateistand.
- `src/drafts.rs`, `src/state.rs` und `src/main.rs`: Recovery-Dateien pro Sitzung mit Dateisperre und monotonen Revisionen. Das bisherige `recovery.json` bleibt einlesbar. Das Schließen fragt den aktuellen Editorzustand ab.
- `src/fs_ops/search.rs`, `frontend/src/workspace-search.ts` und `i18n.ts`: Ordner-Ersetzen verarbeitet weitere Dateien nach einzelnen Fehlern und meldet Teilresultate. Betroffene Tabs werden aktualisiert oder als Konflikt markiert.
- `frontend/src/sanitizer.ts` und `main.ts`: Vorschau prüft die Rendergeneration direkt vor der DOM-Übernahme und verwirft geplante Renderläufe beim Tabwechsel.

### 3. Testergebnisse & Build-Status
- `scripts/Build-Release.ps1` erfolgreich mit `npm run typecheck`, `npm test` (121 Tests), Vite-Build, `cargo test` (18 Tests) und x64-Release-Build. ARM64-Compile-Check ebenfalls erfolgreich.
- Alle 8 Playwright-Tests bestanden, einschließlich der neuen Tests in `frontend/e2e/file-safety.spec.ts`. Ausführung mit direktem Vite-Aufruf auf einem separaten lokalen Port außerhalb der Sandbox. Weitere Regressionstests decken Recovery, bedingtes Speichern, Teilerfolge und die Übernahme der Vorschau ab.

### 4. Verbleibende Grenzen
- Die Dateiprüfung vor dem atomaren Austausch serialisiert Semyra-Schreibzugriffe. Fremdprogramme können im kurzen Zeitfenster zwischen Prüfung und Austausch weiterhin schreiben.
- Native UI und Installer wurden in dieser Sitzung nicht separat praktisch geprüft.

---

## 2026-11-14 — Review von Produktidee, Codebasis und Release-Stand

### 1. Ziel & Scope
- Produktpositionierung, Dateisicherheit, asynchrone Abläufe, Modulzuschnitt und Release-Stand auf `main` (`25d7bf0`) geprüft.

### 2. Durchgeführte Arbeiten
- Die Kombination aus Prüfung von Agentendateien, externem Änderungsvergleich und lokalem Kontext-Export als stärksten Anwendungsfall eingeordnet. Im Willkommensdokument ist dieser Ablauf bisher kaum sichtbar.
- Per Code-Review Risiken bei Speichervorgängen mit weiteren Änderungen, bei geplantem Auto-Save nach externen Änderungen, bei gemeinsam genutzter Entwurfswiederherstellung, bei teilweise fehlgeschlagenem Ordner-Ersetzen und bei veralteten Vorschau-Renderings identifiziert. Anwendungscode unverändert.

### 3. Testergebnisse & Build-Status
- `npm run typecheck`, `npm test` (120 Tests), `npm run build`, `cargo check --locked`, `cargo test --locked` (15 Tests), `cargo build --release --locked` und `cargo check --locked --target aarch64-pc-windows-msvc` erfolgreich. Rust meldete ein Hardlink-Problem im inkrementellen Cache und nutzte Kopien.
- `npm run test:e2e` lief zunächst in den Vite-Starttimeout. Alle 6 bestehenden Playwright-Tests liefen mit direktem Vite-Aufruf auf einem separaten lokalen Port außerhalb der Sandbox erfolgreich.
- `Build-Release.ps1` durch die einzelnen Befehle abgedeckt. Installer und native Windows-Nutzerabläufe in dieser Sitzung nicht separat geprüft.

### 4. Entscheidungen & Nächste Schritte
- Vor einer breiteren Veröffentlichung Speichern, Entwurfswiederherstellung und Konflikte absichern. Den produktprägenden Ablauf danach im Einstieg zeigen und mit wenigen Testnutzern beobachten.

---

## 2026-11-14 — Einarbeitung in den Projektstand

### 1. Ziel & Scope
- Produktkontext, Repository-Dokumentation und Implementierung am lokalen Stand `25d7bf0` gelesen.

### 2. Durchgeführte Arbeiten
- Den Weg der Live-Vorschau von CodeMirror über `frontend/src/api.ts` und `src/ipc.rs` bis zur Markdown-Engine, HTML-Sanitierung und Scroll-Synchronisierung nachvollzogen.
- Die Zuständigkeiten für Datei-I/O, Sitzungswiederherstellung, KI-Bibliothek, Kontext-Export, externe Dateiänderungen und Windows-Builds eingeordnet. Nur `WORK_LOG.md` geändert.

### 3. Testergebnisse & Build-Status
- `npm run typecheck`, `npm test`, `cargo test` und `scripts/Build-Release.ps1` für die Einarbeitung nicht ausgeführt. Die zuletzt protokollierten Ergebnisse stehen in Session 9.

### 4. Entscheidungen & Nächste Schritte
- Funktionsstand anhand des Quellcodes eingeordnet. Die Testzahlen im README sind älter als die Ergebnisse aus Session 9.

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
