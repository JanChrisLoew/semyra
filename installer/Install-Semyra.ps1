#Requires -Version 5.1
<#
.SYNOPSIS
    Installiert Semyra benutzerbezogen (ohne Administratorrechte) unter Windows 11
    und registriert die Dateizuordnung für Markdown-Dateien (.md, .markdown).
#>
[CmdletBinding()]
param(
    [string]$BinaryPath = (Join-Path $PSScriptRoot "..\target\release\Semyra.exe"),
    [switch]$CreateDesktopShortcut
)

$ErrorActionPreference = "Stop"

$ResolvedBinary = Resolve-Path -Path $BinaryPath -ErrorAction SilentlyContinue
if (-not $ResolvedBinary) {
    throw "Semyra.exe wurde nicht gefunden unter: $BinaryPath`nBitte zuerst 'cargo build --release' ausführen."
}

$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\Semyra"
$TargetExe  = Join-Path $InstallDir "Semyra.exe"

Write-Host "==> Installiere Semyra nach $InstallDir ..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item -Path $ResolvedBinary.Path -Destination $TargetExe -Force

# Start Menu Shortcut
$StartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$ShortcutPath = Join-Path $StartMenuDir "Semyra.lnk"
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetExe
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.Description = "Semyra – Markdown for the AI era"
$Shortcut.IconLocation = "$TargetExe,0"
$Shortcut.Save()

if ($CreateDesktopShortcut) {
    $DesktopPath = [Environment]::GetFolderPath("Desktop")
    $DeskShortcut = $WshShell.CreateShortcut((Join-Path $DesktopPath "Semyra.lnk"))
    $DeskShortcut.TargetPath = $TargetExe
    $DeskShortcut.WorkingDirectory = $InstallDir
    $DeskShortcut.Description = "Semyra Markdown-Editor"
    $DeskShortcut.IconLocation = "$TargetExe,0"
    $DeskShortcut.Save()
}

# Per-User File Association (HKCU\Software\Classes)
$ProgId = "Semyra.Document"
$ProgIdKey = "HKCU:\Software\Classes\$ProgId"

New-Item -Path "$ProgIdKey\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path $ProgIdKey -Name "(Default)" -Value "Markdown-Dokument"
Set-ItemProperty -Path "$ProgIdKey\DefaultIcon" -Name "(Default)" -Value "`"$TargetExe`",0"

New-Item -Path "$ProgIdKey\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$ProgIdKey\shell\open" -Name "FriendlyAppName" -Value "Semyra"
Set-ItemProperty -Path "$ProgIdKey\shell\open\command" -Name "(Default)" -Value "`"$TargetExe`" `"%1`""

# Register "Open folder with Semyra" in Windows Explorer directory context menu
$DirMenuKey = "HKCU:\Software\Classes\Directory\shell\Semyra"
New-Item -Path "$DirMenuKey\command" -Force | Out-Null
Set-ItemProperty -Path $DirMenuKey -Name "(Default)" -Value "Mit Semyra öffnen"
Set-ItemProperty -Path $DirMenuKey -Name "Icon" -Value "`"$TargetExe`",0"
Set-ItemProperty -Path "$DirMenuKey\command" -Name "(Default)" -Value "`"$TargetExe`" `"%V`""

foreach ($ext in @(".md", ".markdown", ".mdown", ".mkd", ".mdx")) {
    $ExtOpenWith = "HKCU:\Software\Classes\$ext\OpenWithProgids"
    New-Item -Path $ExtOpenWith -Force | Out-Null
    New-ItemProperty -Path $ExtOpenWith -Name $ProgId -Value ([byte[]]@()) -PropertyType Binary -Force | Out-Null
}

# Register in HKCU RegisteredApplications / App Paths so Windows 11 "Open with" discovers Semyra cleanly
$AppPathKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\Semyra.exe"
New-Item -Path $AppPathKey -Force | Out-Null
Set-ItemProperty -Path $AppPathKey -Name "(Default)" -Value $TargetExe
Set-ItemProperty -Path $AppPathKey -Name "Path" -Value $InstallDir

# Notify Windows Shell of association update (SHChangeNotify)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ShellNotify {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
}
"@
[ShellNotify]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)

Write-Host "==> Semyra wurde erfolgreich installiert!" -ForegroundColor Green
Write-Host "    Programm:   $TargetExe"
Write-Host "    Startmenü:  $ShortcutPath"
Write-Host "    Tipp:       Rechtsklick auf eine .md-Datei -> 'Öffnen mit' -> 'Semyra' wählen."
