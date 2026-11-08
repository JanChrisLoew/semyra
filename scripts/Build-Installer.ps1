#Requires -Version 5.1
<#
.SYNOPSIS
    Kompiliert den nativen Windows 11 Inno-Setup Installer für Semyra (x64 und/oder ARM64).
.DESCRIPTION
    Sucht nach dem Inno Setup Compiler (ISCC.exe) und baut das Setup-Paket
    unter target\installer\Semyra-Setup-<arch>.exe.
#>
[CmdletBinding()]
param(
    [ValidateSet("x64", "arm64", "all")]
    [string]$Architecture = "x64",
    [string]$IssFile = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $IssFile) {
    $IssFile = Join-Path $RepoRoot "installer\Semyra.iss"
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

$ArchsToBuild = if ($Architecture -eq "all") { @("x64", "arm64") } else { @($Architecture) }

foreach ($arch in $ArchsToBuild) {
    $ExpectedBin = if ($arch -eq "arm64") {
        Join-Path $RepoRoot "target\aarch64-pc-windows-msvc\release\Semyra.exe"
    } else {
        Join-Path $RepoRoot "target\release\Semyra.exe"
    }

    if (-not (Test-Path $ExpectedBin)) {
        Write-Host "Warnung: Binärdatei für $arch nicht gefunden ($ExpectedBin). Baue Release zuerst..." -ForegroundColor Yellow
        if ($arch -eq "arm64") {
            & cargo build --release --target aarch64-pc-windows-msvc
        } else {
            & cargo build --release
        }
        if ($LASTEXITCODE -ne 0) {
            throw "Cargo Build für $arch fehlgeschlagen."
        }
    }

    Write-Host "==> Kompiliere Installer für $arch ($IssFile) ..." -ForegroundColor Cyan
    & $IsccCandidate "/DArch=$arch" $IssFile
    if ($LASTEXITCODE -ne 0) {
        throw "Inno Setup Kompilierung für $arch fehlgeschlagen mit Exit-Code $LASTEXITCODE"
    }

    $SetupExe = Join-Path $RepoRoot "target\installer\Semyra-Setup-$arch.exe"
    if (Test-Path $SetupExe) {
        $Item = Get-Item $SetupExe
        $Mb = [math]::Round($Item.Length / 1MB, 2)
        Write-Host "==> Installer für $arch erfolgreich erstellt: $SetupExe ($Mb MB)" -ForegroundColor Green
    } else {
        throw "Erwartete Installer-Datei nicht gefunden: $SetupExe"
    }
}

Write-Host ""
Write-Host "==> Alle gewählten Installer wurden erfolgreich gebaut!" -ForegroundColor Green
