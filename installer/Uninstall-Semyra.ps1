#Requires -Version 5.1
<#
.SYNOPSIS
    Deinstalliert Semyra und entfernt Startmenü-Verknüpfungen sowie Dateizuordnungen.
#>
[CmdletBinding()]
param(
    [switch]$RemoveUserData
)

$ErrorActionPreference = "SilentlyContinue"

Write-Host "==> Entferne Semyra Benutzer-Installation ..." -ForegroundColor Cyan

# Remove Registry entries
$ProgId = "Semyra.Document"
Remove-Item -Path "HKCU:\Software\Classes\$ProgId" -Recurse -Force
Remove-Item -Path "HKCU:\Software\Classes\Directory\shell\Semyra" -Recurse -Force
Remove-Item -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\Semyra.exe" -Recurse -Force

foreach ($ext in @(".md", ".markdown", ".mdown", ".mkd", ".mdx")) {
    Remove-ItemProperty -Path "HKCU:\Software\Classes\$ext\OpenWithProgids" -Name $ProgId -Force
}

# Remove Shortcuts
$StartMenuShortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Semyra.lnk"
$DesktopShortcut   = Join-Path ([Environment]::GetFolderPath("Desktop")) "Semyra.lnk"
Remove-Item -Path $StartMenuShortcut -Force
Remove-Item -Path $DesktopShortcut -Force

# Remove Program Directory
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\Semyra"
if (Test-Path $InstallDir) {
    Remove-Item -Path $InstallDir -Recurse -Force
}

if ($RemoveUserData) {
    $DataDir = Join-Path $env:LOCALAPPDATA "Semyra"
    if (Test-Path $DataDir) {
        Remove-Item -Path $DataDir -Recurse -Force
    }
}

Write-Host "==> Semyra wurde vollständig deinstalliert." -ForegroundColor Green
