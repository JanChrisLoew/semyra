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
Root: HKA; Subkey: "Software\Classes\Semyra.Document"; ValueType: string; ValueName: ""; ValueData: "Markdown-Dokument"; Flags: uninsdeletekey; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\Semyra.Document\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"",0"; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\Semyra.Document\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: binary; ValueName: "Semyra.Document"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: binary; ValueName: "Semyra.Document"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assocmd
Root: HKA; Subkey: "Software\Classes\Directory\shell\Semyra"; ValueType: string; ValueName: ""; ValueData: "Mit {#MyAppName} öffnen"; Flags: uninsdeletekey; Tasks: dirmenu
Root: HKA; Subkey: "Software\Classes\Directory\shell\Semyra"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#MyAppExeName}"",0"; Tasks: dirmenu
Root: HKA; Subkey: "Software\Classes\Directory\shell\Semyra\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%V"""; Tasks: dirmenu

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{#MyAppName} jetzt starten"; Flags: nowait postinstall skipifsilent
