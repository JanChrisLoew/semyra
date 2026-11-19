---
name: semyra-release
description: >-
  Use when preparing a Semyra release, bumping version numbers, building
  Semyra.exe, or creating Windows x64/ARM64 Inno Setup installers via
  scripts/Build-Release.ps1 or scripts/Build-Installer.ps1.
---

# Semyra Release & Installer Workflow

## 1. Version Synchronization (if bumping version)

Keep `Cargo.toml`, `frontend/package.json`, `installer/Semyra.iss`, and the PowerShell installer's registry `DisplayVersion` in sync. Update `Cargo.lock` and `frontend/package-lock.json` with the manifest changes.

## 2. Build and verify

Follow the build order in [AGENTS.md](../../../AGENTS.md#build-and-verify). With Semyra closed, run the release script from the repository root. The script forcibly stops running Semyra processes. Use the individual checks in AGENTS.md while a user session is open.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Build-Release.ps1
```

This produces `target\release\Semyra.exe`. Run Playwright separately after the frontend build.

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

- Confirm exit status, test results, artifact timestamps, and product version.
- Use the [Windows CI](../../../.github/workflows/ci.yml) results for x64 installation, upgrade, and deinstallation. The ARM64 CI step checks compilation.
- Record the release and verification in [WORK_LOG.md](../../../WORK_LOG.md).
