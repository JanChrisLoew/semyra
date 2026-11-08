; Inno Setup 6 Skript für Semyra (Windows 11 x64)
; Kompilieren mit: iscc installer\Semyra.iss

#define MyAppName "Semyra"
#define MyAppVersion "0.2.0"
#define MyAppPublisher "Semyra"
#define MyAppExeName "Semyra.exe"

[Setup]
AppId={{8F6A41E9-72C4-4A18-9F53-0D9E8E43B210}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
ChangesAssociations=yes
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
OutputDir=..\target\installer
OutputBaseFilename=Semyra-Setup-x64

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "assocmd"; Description: "Markdown-Dateien (.md, .markdown) mit {#MyAppName} verknüpfen"; GroupDescription: "Dateizuordnungen:"
Name: "dirmenu"; Description: """Mit {#MyAppName} öffnen"" im Windows Explorer Ordner-Kontextmenü anzeigen"; GroupDescription: "Windows Explorer:"

[Files]
Source: "..\target\release\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
; Dateityp-Definition (ProgID)
Root: HKA; Subkey: "Software\Classes\Semyra.Document"; ValueType: string; ValueName: ""; ValueData: "Markdown-Dokument"; Flags: uninsdeletekey; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\Semyra.Document\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"",0"; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\Semyra.Document\shell\open"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "{#MyAppName}"; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\Semyra.Document\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: assocmd

; Dateierweiterungen in OpenWithProgids registrieren
Root: HKA; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: none; ValueName: "Semyra.Document"; Flags: uninsdeletevalue; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: none; ValueName: "Semyra.Document"; Flags: uninsdeletevalue; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\.mdown\OpenWithProgids"; ValueType: none; ValueName: "Semyra.Document"; Flags: uninsdeletevalue; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\.mkd\OpenWithProgids"; ValueType: none; ValueName: "Semyra.Document"; Flags: uninsdeletevalue; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\.mdx\OpenWithProgids"; ValueType: none; ValueName: "Semyra.Document"; Flags: uninsdeletevalue; Tasks: assocmd

; App-Registrierung für Windows "Öffnen mit"-Dialog
Root: HKA; Subkey: "Software\Classes\Applications\{#MyAppExeName}"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "{#MyAppName}"; Flags: uninsdeletekey; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\Applications\{#MyAppExeName}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"",0"; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\Applications\{#MyAppExeName}\SupportedTypes"; ValueType: string; ValueName: ".md"; ValueData: ""; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\Applications\{#MyAppExeName}\SupportedTypes"; ValueType: string; ValueName: ".markdown"; ValueData: ""; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\Applications\{#MyAppExeName}\SupportedTypes"; ValueType: string; ValueName: ".mdown"; ValueData: ""; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\Applications\{#MyAppExeName}\SupportedTypes"; ValueType: string; ValueName: ".mkd"; ValueData: ""; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\Applications\{#MyAppExeName}\SupportedTypes"; ValueType: string; ValueName: ".mdx"; ValueData: ""; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\Applications\{#MyAppExeName}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: assocmd

; Windows 10/11 "Standard-Apps" Capabilities (Settings > Apps > Default Apps)
Root: HKA; Subkey: "Software\{#MyAppName}\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "{#MyAppName}"; Flags: uninsdeletekey; Tasks: assocmd
Root: HKA; Subkey: "Software\{#MyAppName}\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "Nativer Windows 11 Markdown-Editor für das KI-Zeitalter"; Tasks: assocmd
Root: HKA; Subkey: "Software\{#MyAppName}\Capabilities\FileAssociations"; ValueType: string; ValueName: ".md"; ValueData: "Semyra.Document"; Tasks: assocmd
Root: HKA; Subkey: "Software\{#MyAppName}\Capabilities\FileAssociations"; ValueType: string; ValueName: ".markdown"; ValueData: "Semyra.Document"; Tasks: assocmd
Root: HKA; Subkey: "Software\{#MyAppName}\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mdown"; ValueData: "Semyra.Document"; Tasks: assocmd
Root: HKA; Subkey: "Software\{#MyAppName}\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mkd"; ValueData: "Semyra.Document"; Tasks: assocmd
Root: HKA; Subkey: "Software\{#MyAppName}\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mdx"; ValueData: "Semyra.Document"; Tasks: assocmd
Root: HKA; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "{#MyAppName}"; ValueData: "Software\{#MyAppName}\Capabilities"; Flags: uninsdeletevalue; Tasks: assocmd

; App Paths (ermöglicht z. B. 'semyra' im Ausführen-Dialog)
Root: HKA; Subkey: "Software\Microsoft\Windows\CurrentVersion\App Paths\{#MyAppExeName}"; ValueType: string; ValueName: ""; ValueData: "{app}\{#MyAppExeName}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Microsoft\Windows\CurrentVersion\App Paths\{#MyAppExeName}"; ValueType: string; ValueName: "Path"; ValueData: "{app}"

; Explorer Ordner-Kontextmenü
Root: HKA; Subkey: "Software\Classes\Directory\shell\Semyra"; ValueType: string; ValueName: ""; ValueData: "Mit {#MyAppName} öffnen"; Flags: uninsdeletekey; Tasks: dirmenu
Root: HKA; Subkey: "Software\Classes\Directory\shell\Semyra"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#MyAppExeName}"",0"; Tasks: dirmenu
Root: HKA; Subkey: "Software\Classes\Directory\shell\Semyra\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%V"""; Tasks: dirmenu

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{#MyAppName} jetzt starten"; Flags: nowait postinstall skipifsilent
