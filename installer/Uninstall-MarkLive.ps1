#Requires -Version 5.1
<#
.SYNOPSIS
    Deinstalliert MarkLive und entfernt Startmenü-Verknüpfungen sowie Dateizuordnungen.
#>
[CmdletBinding()]
param(
    [switch]$RemoveUserData
)

$ErrorActionPreference = "SilentlyContinue"

Write-Host "==> Entferne MarkLive Benutzer-Installation ..." -ForegroundColor Cyan

# Remove Registry entries
$ProgId = "MarkLive.Document"
Remove-Item -Path "HKCU:\Software\Classes\$ProgId" -Recurse -Force
Remove-Item -Path "HKCU:\Software\Classes\Directory\shell\MarkLive" -Recurse -Force
Remove-Item -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\MarkLive.exe" -Recurse -Force

foreach ($ext in @(".md", ".markdown", ".mdown", ".mkd", ".mdx")) {
    Remove-ItemProperty -Path "HKCU:\Software\Classes\$ext\OpenWithProgids" -Name $ProgId -Force
}

# Remove Shortcuts
$StartMenuShortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\MarkLive.lnk"
$DesktopShortcut   = Join-Path ([Environment]::GetFolderPath("Desktop")) "MarkLive.lnk"
Remove-Item -Path $StartMenuShortcut -Force
Remove-Item -Path $DesktopShortcut -Force

# Remove Program Directory
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\MarkLive"
if (Test-Path $InstallDir) {
    Remove-Item -Path $InstallDir -Recurse -Force
}

if ($RemoveUserData) {
    $DataDir = Join-Path $env:LOCALAPPDATA "MarkLive"
    if (Test-Path $DataDir) {
        Remove-Item -Path $DataDir -Recurse -Force
    }
}

Write-Host "==> MarkLive wurde vollständig deinstalliert." -ForegroundColor Green
