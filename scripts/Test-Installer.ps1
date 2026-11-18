#Requires -Version 5.1
[CmdletBinding(DefaultParameterSetName = 'FreshInstall')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Upgrade')]
    [string]$BaselineInstaller,

    [Parameter(Mandatory, ParameterSetName = 'Upgrade')]
    [string]$BaselineExe
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$installer = Join-Path $repoRoot 'target\installer\Semyra-Setup-x64.exe'
$releaseExe = Join-Path $repoRoot 'target\release\Semyra.exe'
$testRoot = Join-Path $repoRoot 'target\installer-test'
$upgrade = $PSCmdlet.ParameterSetName -eq 'Upgrade'
$installDir = Join-Path $testRoot $(if ($upgrade) { 'Semyra Upgrade Test' } else { 'Semyra Test' })
$installedExe = Join-Path $installDir 'Semyra.exe'
$uninstaller = Join-Path $installDir 'unins000.exe'
$setupLog = Join-Path $testRoot $(if ($upgrade) { 'upgrade-setup.log' } else { 'setup.log' })
$uninstallLog = Join-Path $testRoot $(if ($upgrade) { 'upgrade-uninstall.log' } else { 'uninstall.log' })

$progId = 'Semyra.Document'
$progIdKey = "Software\Classes\$progId"
$applicationKey = 'Software\Classes\Applications\Semyra.exe'
$capabilitiesKey = 'Software\Semyra\Capabilities'
$registeredAppsKey = 'Software\RegisteredApplications'
$appPathsKey = 'Software\Microsoft\Windows\CurrentVersion\App Paths\Semyra.exe'
$directoryMenuKey = 'Software\Classes\Directory\shell\Semyra'
$uninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{8F6A41E9-72C4-4A18-9F53-0D9E8E43B210}_is1'
$productKeys = @($progIdKey, $applicationKey, $capabilitiesKey, $appPathsKey, $directoryMenuKey, $uninstallKey)
$extensions = @('.md', '.markdown', '.mdown', '.mkd', '.mdx')

function Test-RegistryValue {
    param([string]$Path, [string]$Name)

    $key = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
    return $null -ne $key -and $key.GetValueNames() -contains $Name
}

function Assert-RegistryValue {
    param([string]$Path, [string]$Name, [string]$Expected)

    $key = Get-Item -LiteralPath $Path
    if ($key.GetValue($Name) -cne $Expected) {
        throw "Unexpected registry value '$Name' at $Path. Expected '$Expected'."
    }
}

function Assert-NoSemyraRegistration {
    param([string]$Hive)

    foreach ($key in $productKeys) {
        if (Test-Path -LiteralPath "$Hive\$key") {
            throw "Semyra registry key exists at $Hive\$key. Use a clean Windows test environment."
        }
    }
    foreach ($extension in $extensions) {
        if (Test-RegistryValue "$Hive\Software\Classes\$extension\OpenWithProgids" $progId) {
            throw "Semyra is registered for $extension under $Hive. Use a clean Windows test environment."
        }
    }
    if (Test-RegistryValue "$Hive\$registeredAppsKey" 'Semyra') {
        throw "Semyra is listed in RegisteredApplications under $Hive. Use a clean Windows test environment."
    }
}

function Invoke-InstallerProcess {
    param([string]$Path, [string[]]$Arguments, [string]$Log)

    $process = Start-Process -FilePath $Path -ArgumentList $Arguments -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "$(Split-Path -Leaf $Path) exited with code $($process.ExitCode). See $Log."
    }
}

function Assert-InstalledBuild {
    param([string]$ExpectedExe, [string]$ExpectedHash)

    $installedHash = (Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash
    if ($installedHash -ne $ExpectedHash) {
        throw "Installed EXE SHA-256 $installedHash differs from $ExpectedExe ($ExpectedHash)."
    }

    $openCommand = '"{0}" "%1"' -f $installedExe
    Assert-RegistryValue "HKCU:\$progIdKey\shell\open\command" '' $openCommand
    Assert-RegistryValue "HKCU:\$applicationKey\shell\open\command" '' $openCommand
    Assert-RegistryValue "HKCU:\$directoryMenuKey\command" '' ('"{0}" "%V"' -f $installedExe)
    Assert-RegistryValue "HKCU:\$registeredAppsKey" 'Semyra' $capabilitiesKey
    Assert-RegistryValue "HKCU:\$appPathsKey" '' $installedExe
    $expectedVersion = (Get-Item -LiteralPath $ExpectedExe).VersionInfo.ProductVersion
    if (-not $expectedVersion) {
        throw "Missing product version on $ExpectedExe."
    }
    Assert-RegistryValue "HKCU:\$uninstallKey" 'DisplayVersion' $expectedVersion
    foreach ($extension in $extensions) {
        if (-not (Test-RegistryValue "HKCU:\Software\Classes\$extension\OpenWithProgids" $progId)) {
            throw "Semyra is missing from OpenWithProgids for $extension."
        }
        Assert-RegistryValue "HKCU:\$capabilitiesKey\FileAssociations" $extension $progId
    }
    Assert-NoSemyraRegistration 'HKLM:'
    Write-Host "Verified x64 payload ($installedHash) and per-user Explorer registration."
}

function Assert-ProfileFiles {
    param([hashtable]$ExpectedHashes)

    foreach ($path in $ExpectedHashes.Keys) {
        $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        if ($hash -ne $ExpectedHashes[$path]) {
            throw "The installer changed test data at $path."
        }
    }
}

$artifacts = @($installer, $releaseExe)
if ($upgrade) {
    $artifacts += @($BaselineInstaller, $BaselineExe)
}
foreach ($file in $artifacts) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Missing build artifact: $file"
    }
}
if (Test-Path -LiteralPath $installDir) {
    throw "The test install directory already exists: $installDir"
}
Assert-NoSemyraRegistration 'HKCU:'
Assert-NoSemyraRegistration 'HKLM:'
[void](New-Item -ItemType Directory -Path $testRoot -Force)

$releaseHash = (Get-FileHash -LiteralPath $releaseExe -Algorithm SHA256).Hash
if ($upgrade) {
    $baselineHash = (Get-FileHash -LiteralPath $BaselineExe -Algorithm SHA256).Hash
    if ($baselineHash -eq $releaseHash) {
        throw 'The upgrade test requires different baseline and candidate executables.'
    }
    $profileDir = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Semyra'
    if (Test-Path -LiteralPath $profileDir) {
        throw "The Semyra profile already exists at $profileDir. Use a clean Windows test environment."
    }
}

$silentOptions = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART')
$setupOptions = $silentOptions + @('/SP-', '/CURRENTUSER')
$freshOptions = $setupOptions + @('/TASKS=assocmd,dirmenu', ('/DIR="{0}"' -f $installDir))

try {
    if ($upgrade) {
        $baselineLog = Join-Path $testRoot 'upgrade-baseline-setup.log'
        Invoke-InstallerProcess (Resolve-Path -LiteralPath $BaselineInstaller).Path ($freshOptions + ('/LOG="{0}"' -f $baselineLog)) $baselineLog
        Assert-InstalledBuild $BaselineExe $baselineHash

        [void](New-Item -ItemType Directory -Path $profileDir)
        $document = Join-Path $testRoot 'upgrade-notes.md'
        $prefs = Join-Path $profileDir 'window_prefs.json'
        $recovery = Join-Path $profileDir 'recovery.json'
        [IO.File]::WriteAllText($document, '# Saved notes')
        $windowPrefs = @{
            width = 1200
            height = 800
            maximized = $false
            lastWorkspaceFolder = $testRoot
            ui = @{
                language = 'en'
                zoomPercent = 125
                sessionFiles = @($document)
                pinnedSessionFiles = @($document)
                activeSessionFile = $document
            }
        }
        [IO.File]::WriteAllText($prefs, ($windowPrefs | ConvertTo-Json -Depth 4))
        $draft = @{
            name = 'upgrade-notes.md'
            path = $document
            parentDir = $testRoot
            content = "# Saved notes`n`nUnsaved continuation"
            savedContent = '# Saved notes'
            lineEnding = 'LF'
        }
        [IO.File]::WriteAllText($recovery, (@{ entries = @($draft) } | ConvertTo-Json -Depth 4))
        $profileHashes = @{}
        foreach ($path in @($prefs, $recovery, $document)) {
            $profileHashes[$path] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        }

        # Allow Setup to reuse the previous install path and task selections.
        Invoke-InstallerProcess $installer ($setupOptions + ('/LOG="{0}"' -f $setupLog)) $setupLog
        Assert-InstalledBuild $releaseExe $releaseHash
        Assert-ProfileFiles $profileHashes
        Write-Host 'Verified in-place x64 upgrade and preservation of settings, session, and recovery data.'
    } else {
        Invoke-InstallerProcess $installer ($freshOptions + ('/LOG="{0}"' -f $setupLog)) $setupLog
        Assert-InstalledBuild $releaseExe $releaseHash
    }
}
finally {
    if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
        Invoke-InstallerProcess $uninstaller ($silentOptions + ('/LOG="{0}"' -f $uninstallLog)) $uninstallLog
    } else {
        Write-Warning "Test uninstaller not found at $uninstaller. See $setupLog."
    }
}

if ((Test-Path -LiteralPath $installedExe) -or (Test-Path -LiteralPath (Join-Path $installDir 'unins000.dat'))) {
    throw "Semyra program files remain in $installDir after uninstall."
}
Assert-NoSemyraRegistration 'HKCU:'
Assert-NoSemyraRegistration 'HKLM:'
if ($upgrade) {
    Assert-ProfileFiles $profileHashes
    Remove-Item -LiteralPath $prefs, $recovery, $document
    [IO.Directory]::Delete($profileDir)
}
Write-Host 'Verified installation and uninstall cleanup.'
