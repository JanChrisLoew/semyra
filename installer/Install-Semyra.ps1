#Requires -Version 5.1
<#
.SYNOPSIS
    Installiert Semyra benutzerbezogen (ohne Administratorrechte) unter Windows 11,
    registriert die Windows "Standard-Apps"-Capabilities für Markdown (.md, .markdown, .mdown, .mkd, .mdx)
    und fügt Semyra zu den "Installierten Apps" in Windows hinzu.
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
$UninstScript = Join-Path $InstallDir "Uninstall-Semyra.ps1"

Write-Host "==> Installiere Semyra nach $InstallDir ..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item -Path $ResolvedBinary.Path -Destination $TargetExe -Force

# Deinstallationsskript in Programmverzeichnis ablegen
$SrcUninst = Join-Path $PSScriptRoot "Uninstall-Semyra.ps1"
if (Test-Path $SrcUninst) {
    Copy-Item -Path $SrcUninst -Destination $UninstScript -Force
}

# 1. Startmenü-Verknüpfung
$StartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$ShortcutPath = Join-Path $StartMenuDir "Semyra.lnk"
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetExe
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.Description = "Semyra – Markdown for the AI era"
$Shortcut.IconLocation = "$TargetExe,0"
$Shortcut.Save()

# 2. Optionale Desktop-Verknüpfung
if ($CreateDesktopShortcut) {
    $DesktopPath = [Environment]::GetFolderPath("Desktop")
    $DeskShortcut = $WshShell.CreateShortcut((Join-Path $DesktopPath "Semyra.lnk"))
    $DeskShortcut.TargetPath = $TargetExe
    $DeskShortcut.WorkingDirectory = $InstallDir
    $DeskShortcut.Description = "Semyra Markdown-Editor"
    $DeskShortcut.IconLocation = "$TargetExe,0"
    $DeskShortcut.Save()
}

# 3. Dateityp-ProgID in HKCU:\Software\Classes
$ProgId = "Semyra.Document"
$ProgIdKey = "HKCU:\Software\Classes\$ProgId"
New-Item -Path "$ProgIdKey\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path $ProgIdKey -Name "(Default)" -Value "Markdown-Dokument"
Set-ItemProperty -Path "$ProgIdKey\DefaultIcon" -Name "(Default)" -Value "`"$TargetExe`",0"

New-Item -Path "$ProgIdKey\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$ProgIdKey\shell\open" -Name "FriendlyAppName" -Value "Semyra"
Set-ItemProperty -Path "$ProgIdKey\shell\open\command" -Name "(Default)" -Value "`"$TargetExe`" `"%1`""

# 4. App-Registrierung für Windows "Öffnen mit"
$AppKey = "HKCU:\Software\Classes\Applications\Semyra.exe"
New-Item -Path "$AppKey\SupportedTypes" -Force | Out-Null
Set-ItemProperty -Path $AppKey -Name "FriendlyAppName" -Value "Semyra"
Set-ItemProperty -Path "$AppKey\SupportedTypes" -Name ".md" -Value ""
Set-ItemProperty -Path "$AppKey\SupportedTypes" -Name ".markdown" -Value ""
Set-ItemProperty -Path "$AppKey\SupportedTypes" -Name ".mdown" -Value ""
Set-ItemProperty -Path "$AppKey\SupportedTypes" -Name ".mkd" -Value ""
Set-ItemProperty -Path "$AppKey\SupportedTypes" -Name ".mdx" -Value ""
New-Item -Path "$AppKey\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$AppKey\shell\open\command" -Name "(Default)" -Value "`"$TargetExe`" `"%1`""

# 5. Explorer Ordner-Kontextmenü ("Mit Semyra öffnen")
$DirMenuKey = "HKCU:\Software\Classes\Directory\shell\Semyra"
New-Item -Path "$DirMenuKey\command" -Force | Out-Null
Set-ItemProperty -Path $DirMenuKey -Name "(Default)" -Value "Mit Semyra öffnen"
Set-ItemProperty -Path $DirMenuKey -Name "Icon" -Value "`"$TargetExe`",0"
Set-ItemProperty -Path "$DirMenuKey\command" -Name "(Default)" -Value "`"$TargetExe`" `"%V`""

# 6. Dateizuordnungen in OpenWithProgids
$Extensions = @(".md", ".markdown", ".mdown", ".mkd", ".mdx")
foreach ($ext in $Extensions) {
    $ExtOpenWith = "HKCU:\Software\Classes\$ext\OpenWithProgids"
    New-Item -Path $ExtOpenWith -Force | Out-Null
    New-ItemProperty -Path $ExtOpenWith -Name $ProgId -Value ([byte[]]@()) -PropertyType Binary -Force | Out-Null
}

# 7. Windows 10/11 "Standard-Apps" Capabilities
$CapKey = "HKCU:\Software\Semyra\Capabilities"
New-Item -Path "$CapKey\FileAssociations" -Force | Out-Null
Set-ItemProperty -Path $CapKey -Name "ApplicationName" -Value "Semyra"
Set-ItemProperty -Path $CapKey -Name "ApplicationDescription" -Value "Nativer Windows 11 Markdown-Editor für das KI-Zeitalter"
foreach ($ext in $Extensions) {
    Set-ItemProperty -Path "$CapKey\FileAssociations" -Name $ext -Value $ProgId
}

$RegAppsKey = "HKCU:\Software\RegisteredApplications"
New-Item -Path $RegAppsKey -Force | Out-Null
Set-ItemProperty -Path $RegAppsKey -Name "Semyra" -Value "Software\Semyra\Capabilities"

# 8. App Paths (ermöglicht Windows 'semyra.exe' bzw. 'semyra' Befehl)
$AppPathKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\Semyra.exe"
New-Item -Path $AppPathKey -Force | Out-Null
Set-ItemProperty -Path $AppPathKey -Name "(Default)" -Value $TargetExe
Set-ItemProperty -Path $AppPathKey -Name "Path" -Value $InstallDir

# 9. Eintrag in "Installierte Apps" (Systemsteuerung / Windows 11 Apps & Features)
$UninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Semyra"
New-Item -Path $UninstallKey -Force | Out-Null
Set-ItemProperty -Path $UninstallKey -Name "DisplayName" -Value "Semyra"
Set-ItemProperty -Path $UninstallKey -Name "DisplayVersion" -Value "0.2.0"
Set-ItemProperty -Path $UninstallKey -Name "DisplayIcon" -Value "`"$TargetExe`",0"
Set-ItemProperty -Path $UninstallKey -Name "Publisher" -Value "Semyra"
Set-ItemProperty -Path $UninstallKey -Name "InstallLocation" -Value $InstallDir
Set-ItemProperty -Path $UninstallKey -Name "UninstallString" -Value "powershell.exe -ExecutionPolicy Bypass -File `"$UninstScript`""
Set-ItemProperty -Path $UninstallKey -Name "QuietUninstallString" -Value "powershell.exe -ExecutionPolicy Bypass -File `"$UninstScript`""
Set-ItemProperty -Path $UninstallKey -Name "HelpLink" -Value "https://github.com/JanChrisLoew/semyra"
Set-ItemProperty -Path $UninstallKey -Name "URLInfoAbout" -Value "https://github.com/JanChrisLoew/semyra"
Set-ItemProperty -Path $UninstallKey -Name "EstimatedSize" -Value ([int]((Get-Item $TargetExe).Length / 1024))
Set-ItemProperty -Path $UninstallKey -Name "NoModify" -Value 1 -PropertyType DWord
Set-ItemProperty -Path $UninstallKey -Name "NoRepair" -Value 1 -PropertyType DWord

# 10. Windows Shell über Zuordnungs-Aktualisierung benachrichtigen (SHChangeNotify)
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
Write-Host "    Programm:        $TargetExe"
Write-Host "    Startmenü:       $ShortcutPath"
Write-Host "    Apps & Features: Als offizielle Software registriert (Deinstallation via Windows-Einstellungen möglich)"
Write-Host "    Standard-Apps:   In Windows 11 unter 'Einstellungen > Apps > Standard-Apps' registriert"
Write-Host ""
Write-Host "Tipp: Um Semyra als Standard für .md festzulegen:" -ForegroundColor Yellow
Write-Host "  1. Rechtsklick auf eine beliebige .md-Datei -> 'Öffnen mit' -> 'Andere App auswählen'"
Write-Host "  2. 'Semyra' markieren und auf 'Immer' klicken."
Write-Host "  ODER: In Windows 11 'Einstellungen > Apps > Standard-Apps' nach 'Semyra' suchen."
