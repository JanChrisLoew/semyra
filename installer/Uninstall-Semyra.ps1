#Requires -Version 5.1
<#
.SYNOPSIS
    Deinstalliert Semyra und entfernt Startmenü-Verknüpfungen, Systemregistrierungen und Dateizuordnungen.
#>
[CmdletBinding()]
param(
    [switch]$RemoveUserData
)

$ErrorActionPreference = "SilentlyContinue"

Write-Host "==> Entferne Semyra Benutzer-Installation ..." -ForegroundColor Cyan

# 1. Registry-Einträge bereinigen
$ProgId = "Semyra.Document"
Remove-Item -Path "HKCU:\Software\Classes\$ProgId" -Recurse -Force
Remove-Item -Path "HKCU:\Software\Classes\Applications\Semyra.exe" -Recurse -Force
Remove-Item -Path "HKCU:\Software\Classes\Directory\shell\Semyra" -Recurse -Force
Remove-Item -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\Semyra.exe" -Recurse -Force
Remove-Item -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Semyra" -Recurse -Force
Remove-Item -Path "HKCU:\Software\Semyra" -Recurse -Force
Remove-ItemProperty -Path "HKCU:\Software\RegisteredApplications" -Name "Semyra" -Force

foreach ($ext in @(".md", ".markdown", ".mdown", ".mkd", ".mdx")) {
    Remove-ItemProperty -Path "HKCU:\Software\Classes\$ext\OpenWithProgids" -Name $ProgId -Force
}

# 2. Verknüpfungen entfernen
$StartMenuShortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Semyra.lnk"
$DesktopShortcut   = Join-Path ([Environment]::GetFolderPath("Desktop")) "Semyra.lnk"
Remove-Item -Path $StartMenuShortcut -Force
Remove-Item -Path $DesktopShortcut -Force

# 3. Programmverzeichnis entfernen
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\Semyra"
if (Test-Path $InstallDir) {
    Remove-Item -Path $InstallDir -Recurse -Force
}

# 4. Optionale Benutzerdaten bereinigen
if ($RemoveUserData) {
    $DataDir = Join-Path $env:LOCALAPPDATA "Semyra"
    if (Test-Path $DataDir) {
        Remove-Item -Path $DataDir -Recurse -Force
    }
}

# 5. Windows Shell über Deinstallation benachrichtigen
try {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ShellNotify {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
}
"@ -ErrorAction SilentlyContinue
    [ShellNotify]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)
} catch {}

Write-Host "==> Semyra wurde vollständig deinstalliert." -ForegroundColor Green
