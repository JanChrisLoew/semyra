---
name: semyra-release
description: >-
  Use when preparing a Semyra release, bumping version numbers, building
  Semyra.exe, or creating Windows x64/ARM64 Inno Setup installers via
  scripts/Build-Release.ps1 or scripts/Build-Installer.ps1.
---

# Semyra Release & Installer Workflow

## 1. Version Synchronization (if bumping version)

Keep the version string identical across all three manifests:
1. `Cargo.toml` (`version = "x.y.z"`)
2. `frontend/package.json` (`"version": "x.y.z"`)
3. `installer/Semyra.iss` (`#define MyAppVersion "x.y.z"`)

## 2. End-to-End Build & Verification

`rust-embed` embeds `frontend/dist` at compile time (`build.rs` fails `--release` if `frontend/dist/assets` is missing). Always run the unified release script from the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Build-Release.ps1
```

This executes in order:
1. `npm run typecheck` (`tsc --noEmit`)
2. `npm test` (`vitest run`)
3. `npm run build` (`vite build` -> `frontend/dist`)
4. `cargo test`
5. `cargo build --release` -> `target\release\Semyra.exe`

## 3. Windows Installer (Inno Setup 6)

- Build x64 installer alongside release:
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\Build-Release.ps1 -Installer
  ```
- Or build specific/all architectures (`x64`, `arm64`, `all`):
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\Build-Installer.ps1 -Architecture x64
  ```
  Output: `target\installer\Semyra-Setup-<arch>.exe`.

## 4. Post-Build Checks

- Confirm zero test failures and zero compiler warnings.
- Confirm `target\release\Semyra.exe` (and `target\installer\Semyra-Setup-*.exe` if built) exists with current timestamp.
- Document the release/build in `WORK_LOG.md`.
