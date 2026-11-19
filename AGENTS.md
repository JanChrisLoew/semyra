# AGENTS.md — Semyra

Semyra is a native Windows 11 Markdown editor. The Rust host embeds the Vite frontend in the standalone `Semyra.exe` and runs it in WebView2. Windows x64 is the primary target. ARM64 has a separate build target.

Read [Product Context](docs/PRODUCT_CONTEXT.md) before changing behavior or UI. Use the matching [project skill](.agents/skills) for release, UI, Markdown/export, or codebase review work.

## Git workflow

- Make small, low-risk changes on `main`. Verify locally before committing.
- Start features and larger refactors on a dedicated `codex/` branch from up-to-date `main`. Test and review the diff locally. Integrate locally when those checks are sufficient.
- Open a GitHub PR for changes to saving, recovery, or the installer, or when the user explicitly requests a PR. Wait for green Windows CI before merging the PR.
- Merge once, then return to `main` and sync it.

## Architecture

- `src/main.rs` owns the Win32 window, WebView2, native PDF export, and event loop. `src/ipc.rs` owns `/api/*` and serves the embedded frontend.
- Keep blocking IPC and native dialogs off the UI thread. Reuse the existing general, live-preview, and draft worker pools in `src/ipc.rs`. Route native window work through `EventLoopProxy<UserEvent>`.
- `src/fs_ops/` handles files, workspace search, assets, and HTML export. Preserve atomic writes, conflict checks, and the shared write lock for saving, renaming, and recycling. Pass search-result file versions when replacing from the workspace UI.
- `src/window_prefs.rs` persists settings in `%LOCALAPPDATA%\Semyra\window_prefs.json`. `src/drafts.rs` uses locked per-window snapshots in `%LOCALAPPDATA%\Semyra\drafts\`. Preserve recovery of legacy `recovery.json` snapshots in that folder.
- `frontend/src/main.ts` wires the UI. Document state, file operations, auto-save, closing, and exports live in `frontend/src/document-*.ts`. Preserve the identity of open tab objects used by async operations. Split modules by responsibility and testability.

## Safety and UI

- Check `state.is_local_asset_allowed(&target)` before reading `/api/local-asset` files. Run canonical paths through `clean_windows_path` before displaying them or passing them to Explorer.
- Send Markdown preview HTML through `safeSetMarkdownHTML`. Keep `content-visibility: auto` off `.markdown-body` to preserve scroll sync.
- Move user files to the Windows Recycle Bin with `trash::delete`.
- Use idiomatic German UI copy and keep runtime DE/EN localization in sync. Write source identifiers and comments in English.
- Keep Markdown typography neutral and both themes readable. Use Steel Blue for interaction and Amber only for unsaved changes. Keep Win32 titlebar and WebView2 themes in sync.
- Follow existing native dialog and invoker patterns. Reset dialog return values on close. Label search fields explicitly and keep tab close buttons as siblings of the tab buttons to preserve keyboard navigation.

## Build and verify

Always rebuild `frontend/dist` before compiling Rust. `rust-embed` uses that directory, and release builds require `frontend/dist/assets`.

```powershell
Push-Location frontend
npm run typecheck
npm test
npm run build
npm run test:e2e
Pop-Location
cargo test --locked
cargo build --release --locked
```

- Run `npm ci` in `frontend` when setting up a checkout. Use `cargo check --locked` for Rust compile checks.
- `scripts/Build-Release.ps1` runs typecheck, unit tests, the frontend build, and the x64 release build. Add `-Installer` for x64 setup. Playwright runs separately.
- **Before running `Build-Release.ps1`, check for running Semyra processes.** The script forcibly stops them. Use the individual steps while a user session is open.
- Use `scripts/Build-Installer.ps1 -Architecture x64` or `-Architecture arm64` after the matching binary builds. [Windows CI](.github/workflows/ci.yml) runs Playwright, checks ARM64 compilation, and verifies x64 installation, upgrade, and uninstallation on a Windows runner.

## Work log

Update [WORK_LOG.md](WORK_LOG.md) for completed features, substantial fixes, releases, or decisions that affect future work. In German, briefly record what changed, how it was verified, and what remains open. For small changes, the commit message is enough.
