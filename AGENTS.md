# AGENTS.md — MarkLive Engineering & Architecture Guide

MarkLive is a native **Windows 11 x64 Markdown editor with live preview**, compiled into a single standalone binary (`MarkLive.exe`) without Node.js or Electron runtime dependencies.

## 1. Architecture Overview

- **Native Rust Host (`src/`)**:
  - `src/main.rs`: Win32 `tao` event loop, `wry` Edge WebView2 host (`https://marklive.localhost`), direct native PDF export (`ICoreWebView2_7::PrintToPdf`), opaque solid Fluent surfaces with dark/light Win32 titlebar synchronization (`window.set_theme`), multi-monitor window bounds restoration, Explorer file/image/folder drag-and-drop, and `notify` filesystem watcher.
  - `src/ipc.rs`: Asynchronous custom-protocol router (`with_asynchronous_custom_protocol("marklive", ...)`). Serves embedded static assets via `rust-embed` (`#[folder = "frontend/dist"]`) and handles JSON RPC endpoints under `/api/*`. Heavy CPU and disk routes (`render`, `read-file`, `write-file`, `list-tree`, `workspace-files`, `search-workspace`, `drafts/save`, `/api/local-asset`) MUST run off the Win32 UI thread (`std::thread::spawn` + `responder.respond(...)`). Native `rfd` OS dialogs also run off the UI thread while `tao`/WebView2 window operations execute via `EventLoopProxy<UserEvent>`.
  - `src/markdown.rs`: `pulldown-cmark` + `syntect` GFM pipeline (tables, task checkboxes with `data-task-line`, GitHub alerts `[!NOTE]`..`[!CAUTION]`, footnotes, YAML frontmatter cards, inline/display math placeholders, Mermaid placeholders, `data-line` scroll-sync anchors, heading outline & reading-time stats).
  - `src/fs_ops/`: Modular filesystem & export subsystem:
    - `mod.rs`: Path canonicalization (`clean_windows_path`, `normalize_existing_path`), Markdown/image extension filters, and `explorer.exe /select,` integration.
    - `encoding.rs`: Encoding-aware text reader (UTF-8, UTF-8 BOM, UTF-16 LE/BE BOM, Windows-1252 fallback) and atomic temp-file + rename UTF-8 writer preserving `CRLF`/`LF`.
    - `workspace.rs`: Directory tree builder, Quick-Open file indexer, safe file/subfolder creation, rename, and Windows Recycle Bin deletion (`trash`).
    - `search.rs`: Workspace full-text search across Markdown documents.
    - `assets.rs`: Clipboard (`data:image/...;base64`) and dropped image importer into `./assets/`.
    - `html_export.rs`: True 1-file dark/light standalone HTML exporter (preserving rendered MathML & Mermaid SVGs and base64-inlining allowed local images).
  - `src/single_instance.rs`: Named Win32 mutex (`Local\MarkLive_SingleInstance_v1`) + localhost IPC handoff so Explorer file launches open as tabs in the existing window (`--new-window` bypasses single-instance to spawn an independent window with a per-PID WebView2 profile).
  - `src/icon_gen.rs` & `build.rs`: Shared multi-DPI (`16, 32, 48, 256` px) procedural icon generator used for both the PE `.exe` resource (`winres`) and the runtime window icon.

- **Modular TypeScript / Vite Frontend (`frontend/src/`)**:
  - `main.ts`: Application shell orchestrating tab lifecycle, editor/live-preview coordination, HTML/PDF/Rich-Text export actions, polite status toast (`#status-toast`), session & crash-draft persistence, document outline, status bar, split resizer, and global shortcuts.
  - `sidebar-explorer.ts`: Workspace directory tree, empty-state recent folders/files view, context menu popover, file/folder creation & rename dialog, and Recycle Bin confirmation.
  - `workspace-search.ts`: Debounced, sequence-guarded full-text workspace search panel.
  - `palette.ts` & `palette-items.ts`: Fuzzy-matched Quick-Open (`Strg+E`) & Command Palette (`Strg+Umschalt+P` / `>`) controller and decoupled, unit-tested item builders.
  - `editor.ts`, `editor-l10n-de.ts` & `markdown-table.ts`: CodeMirror 6 controller with German UI localization (`phrases`), section/YAML/code folding (`foldGutter` + `foldService`), dynamic `Compartment`s (`wordWrap`, `spellcheck`), smart Markdown list/task/blockquote `Enter` continuation, GFM table `Tab`/`Shift+Tab` cell navigation & pipe alignment, and smart URL / HTML `<table>` / TSV clipboard conversion.
  - `export-utils.ts`: Live-preview HTML serializer and Office/Teams/Outlook-ready Rich-Text clipboard builder (`ClipboardItem` with inline structural styles and base64-inlined local assets).
  - `sanitizer.ts`: Capability-probed HTML sanitization (`setHTML` self-test with `DOMPurify` fallback), LRU-cached KaTeX & lazy-loaded Mermaid rendering, and incremental DOM reconciliation (`reconcileChildren`) that preserves unchanged nodes and `<details>` open state.
  - `sync-scroll.ts`: Bidirectional fractional `[data-line]` scroll synchronization and active TOC section tracking.
  - `theme.ts`, `path-utils.ts`, `polyfills.ts`, `navigation-a11y.ts`: Win32/CSS theme synchronization, Windows/relative Markdown path helpers, progressive-enhancement polyfills, and roving `tabindex` keyboard navigation.
  - `styles.css` & `styles/*.css`: Thematic CSS modules (`tokens.css`, `chrome.css`, `sidebar.css`, `editor.css`, `markdown.css`, `dialogs-print.css`) bundled inline by Vite.

> **Modularity Principle**: Split modules along clear domain responsibilities and unit-testability boundaries so unrelated concerns do not mix — there is intentionally **no rigid maximum line-of-code limit** for cohesive single-purpose modules.

## 2. Mandatory Build & Verification Order

Because `rust-embed` embeds `frontend/dist` into `MarkLive.exe` at Rust compile time (and `build.rs` panics on `--release` if `frontend/dist/assets` is missing), **always build the frontend before compiling Rust**:

```powershell
# Full end-to-end check, test, and release build:
powershell -ExecutionPolicy Bypass -File .\scripts\Build-Release.ps1
```

Or step-by-step during development:

```powershell
cd frontend
npm run typecheck
npm test
npm run build
cd ..
cargo test
cargo build --release
```

> Note: Do not assume `cargo clippy` is installed in local environments; rely on `cargo check`, `cargo test` (zero warnings), `npm run typecheck`, and `npm test` (Vitest).

## 3. Security & Windows Invariants

1. **Scoped Local Asset Access**: `/api/local-asset?path=...` MUST always check `state.is_local_asset_allowed(&target)` before reading disk bytes so untrusted Markdown files cannot exfiltrate arbitrary paths outside opened workspaces/document folders.
2. **Extended-Length Path Stripping**: `fs::canonicalize` on Windows prefixes paths with `\\?\`. Always pass canonicalized user-facing paths through `clean_windows_path` before displaying them in UI or passing them to `explorer.exe /select,`.
3. **XSS-Safe Preview Rendering**: Never assign raw Markdown HTML directly to `innerHTML` on live DOM elements. Route all preview updates through `safeSetMarkdownHTML` in `frontend/src/sanitizer.ts`, and do not apply `content-visibility: auto` to `.markdown-body` blocks (doing so replaces offscreen block heights with estimates and breaks `SyncScrollController` pixel interpolation).
4. **Destructive File Operations**: Never call `fs::remove_file` / `fs::remove_dir_all` on user documents from UI actions; always move user files/folders to the Windows Recycle Bin via `trash::delete`.

## 4. UI, Localization & Modern Web Standards

- **Language**: All user-facing UI labels, tooltips, dialogs, status badges, and backend error messages are written in **idiomatic German** (`<html lang="de">`). Source code identifiers and comments remain in English.
- **Browser Baseline**: MarkLive runs inside Microsoft Edge WebView2 (evergreen Chromium on Windows 11) while keeping progressive-enhancement fallbacks (`@oddbird/popover-polyfill`, `invokers-polyfill`, `DOMPurify`) so components remain standards-compliant and testable in `jsdom`.
- **HTML/CSS Conventions**:
  - Use native `<dialog>` (`closedby="any"` or `closedby="none"` paired with a `cancel` event guard, resetting `dialog.returnValue = ''` on `close`) without redundant `role="dialog"` or `aria-modal`.
  - Use declarative Invoker Commands (`command="show-modal" commandfor="..."`) where static buttons open modal dialogs.
  - Enclose search inputs in `<search>` with explicit `<label class="visually-hidden">` elements.
  - Keep interactive close buttons as siblings of `<button role="tab">` inside `.tab-slot` (never nest `<button>` inside `[role="tab"]`), and maintain roving `tabindex` keyboard support.
  - Maintain dual light/dark theme support via `:root { color-scheme: light dark; }`, `light-dark()` tokens, and `<meta name="color-scheme">` synchronization with the Win32 titlebar (`window.set_theme`).
