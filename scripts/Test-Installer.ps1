#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$installer = Join-Path $repoRoot 'target\installer\Semyra-Setup-x64.exe'
$releaseExe = Join-Path $repoRoot 'target\release\Semyra.exe'
$testRoot = Join-Path $repoRoot 'target\installer-test'
$installDir = Join-Path $testRoot 'Semyra Test'
$installedExe = Join-Path $installDir 'Semyra.exe'
$uninstaller = Join-Path $installDir 'unins000.exe'
$setupLog = Join-Path $testRoot 'setup.log'
$uninstallLog = Join-Path $testRoot 'uninstall.log'

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

foreach ($file in @($installer, $releaseExe)) {
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

$silentOptions = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART')
$setupOptions = $silentOptions + @(
    '/SP-', '/CURRENTUSER', '/TASKS=assocmd,dirmenu', ('/DIR="{0}"' -f $installDir), ('/LOG="{0}"' -f $setupLog)
)

try {
    Invoke-InstallerProcess $installer $setupOptions $setupLog

    $releaseHash = (Get-FileHash -LiteralPath $releaseExe -Algorithm SHA256).Hash
    $installedHash = (Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash
    if ($installedHash -ne $releaseHash) {
        throw "Installed EXE SHA-256 $installedHash differs from the release build $releaseHash."
    }

    $openCommand = '"{0}" "%1"' -f $installedExe
    Assert-RegistryValue "HKCU:\$progIdKey\shell\open\command" '' $openCommand
    Assert-RegistryValue "HKCU:\$applicationKey\shell\open\command" '' $openCommand
    Assert-RegistryValue "HKCU:\$directoryMenuKey\command" '' ('"{0}" "%V"' -f $installedExe)
    Assert-RegistryValue "HKCU:\$registeredAppsKey" 'Semyra' $capabilitiesKey
    Assert-RegistryValue "HKCU:\$appPathsKey" '' $installedExe
    $releaseVersion = (Get-Item -LiteralPath $releaseExe).VersionInfo.ProductVersion
    if (-not $releaseVersion) {
        throw "Missing product version on $releaseExe."
    }
    Assert-RegistryValue "HKCU:\$uninstallKey" 'DisplayVersion' $releaseVersion
    foreach ($extension in $extensions) {
        if (-not (Test-RegistryValue "HKCU:\Software\Classes\$extension\OpenWithProgids" $progId)) {
            throw "Semyra is missing from OpenWithProgids for $extension."
        }
        Assert-RegistryValue "HKCU:\$capabilitiesKey\FileAssociations" $extension $progId
    }
    Assert-NoSemyraRegistration 'HKLM:'
    Write-Host "Verified x64 payload ($installedHash) and per-user Explorer registration."
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
Write-Host 'Verified installation and uninstall cleanup.'
