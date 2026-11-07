<#
.SYNOPSIS
    Deterministic end-to-end verification and release build script for MarkLive (Windows 11 x64).
.DESCRIPTION
    1. Runs TypeScript strict typechecking (tsc --noEmit)
    2. Runs Frontend unit tests (Vitest + jsdom)
    3. Builds optimized production frontend bundle into frontend/dist (Vite)
    4. Runs Rust backend unit tests (cargo test)
    5. Compiles standalone Release executable target\release\MarkLive.exe
#>
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepoRoot

try {
    Write-Host "==> [1/5] Frontend TypeScript-Check (tsc --noEmit)..." -ForegroundColor Cyan
    Push-Location (Join-Path $RepoRoot 'frontend')
    & npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw "TypeScript-Check fehlgeschlagen." }

    Write-Host "==> [2/5] Frontend Unit-Tests (Vitest)..." -ForegroundColor Cyan
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw "Frontend-Tests fehlgeschlagen." }

    Write-Host "==> [3/5] Produktions-Frontend bauen (Vite -> frontend/dist)..." -ForegroundColor Cyan
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Vite-Build fehlgeschlagen." }
    Pop-Location

    Write-Host "==> [4/5] Rust Unit-Tests starten (cargo test)..." -ForegroundColor Cyan
    & cargo test
    if ($LASTEXITCODE -ne 0) { throw "Rust-Tests fehlgeschlagen." }

    Write-Host "==> [5/5] Standalone Windows 11 x64 Release bauen (cargo build --release)..." -ForegroundColor Cyan
    $running = Get-Process -Name MarkLive -ErrorAction SilentlyContinue
    if ($running) {
        Write-Host "Beende laufende MarkLive-Testinstanz ($($running.Count) Prozess(e)) zur Dateifreigabe..." -ForegroundColor Yellow
        $running | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 400
    }
    & cargo build --release
    if ($LASTEXITCODE -ne 0) { throw "Cargo Release-Build fehlgeschlagen." }

    $ExePath = Join-Path $RepoRoot 'target\release\MarkLive.exe'
    if (-not (Test-Path $ExePath)) {
        throw "Erwartete Ausgabedatei nicht gefunden: $ExePath"
    }

    $Item = Get-Item $ExePath
    $SizeMB = [Math]::Round($Item.Length / 1MB, 2)
    Write-Host ""
    Write-Host "Erfolgreich gebaut: $($Item.FullName) ($SizeMB MB)" -ForegroundColor Green
}
finally {
    Pop-Location
}
