#Requires -Version 5.1
<#
.SYNOPSIS
    Kompiliert den nativen Windows 11 Inno-Setup Installer für Semyra (Semyra-Setup-x64.exe).
.DESCRIPTION
    Sucht nach dem Inno Setup Compiler (ISCC.exe) und baut das Setup-Paket
    unter target\installer\Semyra-Setup-x64.exe.
#>
[CmdletBinding()]
param(
    [string]$IssFile = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $IssFile) {
    $IssFile = Join-Path $RepoRoot "installer\Semyra.iss"
}
$ReleaseExe = Join-Path $RepoRoot "target\release\Semyra.exe"

if (-not (Test-Path $ReleaseExe)) {
    Write-Host "Warnung: target\release\Semyra.exe wurde nicht gefunden." -ForegroundColor Yellow
    Write-Host "Baue Release-Binary zuerst..." -ForegroundColor Cyan
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "Build-Release.ps1")
}

# Inno Setup Compiler (ISCC.exe) lokalisieren
$IsccCandidate = $null
$Cmd = Get-Command iscc.exe -ErrorAction SilentlyContinue
if ($Cmd -and $Cmd.Source -and (Test-Path $Cmd.Source)) {
    $IsccCandidate = $Cmd.Source
}

$KnownPaths = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Antigravity IDE\resources\app\node_modules\innosetup\bin\ISCC.exe"
)

if (-not $IsccCandidate) {
    foreach ($p in $KnownPaths) {
        if (Test-Path $p) {
            $IsccCandidate = $p
            break
        }
    }
}

if (-not $IsccCandidate) {
    throw "Inno Setup Compiler (ISCC.exe) wurde nicht gefunden.`nBitte installieren mit: winget install JRSoftware.InnoSetup"
}

Write-Host "==> Verwende Inno Setup Compiler: $IsccCandidate" -ForegroundColor Cyan
Write-Host "==> Kompiliere Installer ($IssFile) ..." -ForegroundColor Cyan

& $IsccCandidate $IssFile
if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup Kompilierung fehlgeschlagen mit Exit-Code $LASTEXITCODE"
}

$SetupExe = Join-Path $RepoRoot "target\installer\Semyra-Setup-x64.exe"
if (Test-Path $SetupExe) {
    $Item = Get-Item $SetupExe
    $Mb = [math]::Round($Item.Length / 1MB, 2)
    Write-Host ""
    Write-Host "==> Installer erfolgreich erstellt!" -ForegroundColor Green
    Write-Host "    Datei: $SetupExe ($Mb MB)" -ForegroundColor Green
    Write-Host "    Kann direkt ausgeführt werden, um Semyra wie gewohnt mit Setup-Wizard zu installieren."
} else {
    throw "Erwartete Installer-Datei nicht gefunden: $SetupExe"
}
