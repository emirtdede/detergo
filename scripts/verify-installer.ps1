# Installer smoke test for the packaged artifacts.
#
# The 2.0.0 audit only launched the portable EXE, so the real installer paths
# were never executed: an NSIS/MSI that fails to install, does not register
# correctly, or cannot be removed is a release blocker for a DIRECT-LIVE desktop
# product.
#
# This script installs, launches, verifies and removes the app again. Nothing
# outside %LOCALAPPDATA% / %APPDATA% / HKCU is touched.
#
# MSI scope note: Tauri's WiX template produces a per-machine package
# (InstallScope="perMachine"). That is the right shape for elevated enterprise
# deployment but fails with error 1925 for a standard user, so the consumer
# channel is the per-user NSIS installer. When this script is not elevated it
# drives the MSI in per-user mode (ALLUSERS=2 + MSIINSTALLPERUSER=1) to prove the
# package payload installs and uninstalls correctly; when it is elevated it uses
# the package's native per-machine mode.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/verify-installer.ps1 [-Kind nsis|msi]

param(
    [ValidateSet("nsis", "msi")]
    [string]$Kind = "nsis"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json).version

$artifact = if ($Kind -eq "nsis") {
    Join-Path $repoRoot "release_output\Node-Cleaner-$version-x64-Setup.exe"
} else {
    Join-Path $repoRoot "release_output\Node-Cleaner-$version-x64.msi"
}

if (-not (Test-Path -LiteralPath $artifact)) {
    Write-Error "Artifact not found: $artifact (run npm run build:release first)"
    exit 1
}

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
$msiScope = if ($isAdmin) { "perMachine" } else { "perUser" }
$msiScopeArgs = if ($isAdmin) { @() } else { @("ALLUSERS=2", "MSIINSTALLPERUSER=1") }

Write-Host "Installer : $artifact"
Write-Host "Kind      : $Kind"
if ($Kind -eq "msi") {
    Write-Host "Elevated  : $isAdmin"
    Write-Host "MSI scope : $msiScope"
}

$installDir = Join-Path $env:LOCALAPPDATA "Node Cleaner"
$uninstallKeys = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

function Get-InstalledEntry {
    foreach ($key in $uninstallKeys) {
        Get-ItemProperty -Path $key -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -like "Node Cleaner*" } |
            Select-Object -First 1
    }
}

function Invoke-Msi {
    param([string]$Arguments, [string]$LogName)
    $log = Join-Path $env:TEMP $LogName
    $proc = Start-Process -FilePath "msiexec.exe" `
        -ArgumentList $Arguments, "/qn", "/norestart", "/L*v", "`"$log`"" `
        -PassThru -Wait
    return @{ ExitCode = $proc.ExitCode; Log = $log }
}

Write-Host "`n[1/5] Installing silently..."
if ($Kind -eq "nsis") {
    $proc = Start-Process -FilePath $artifact -ArgumentList "/S" -PassThru -Wait
    if ($proc.ExitCode -ne 0) {
        Write-Error "NSIS installer exited with $($proc.ExitCode)"
        exit 1
    }
} else {
    $quoted = "`"$artifact`""
    $args = @("/i", $quoted) + $msiScopeArgs
    $run = Invoke-Msi -Arguments ($args -join " ") -LogName "nc-msi-install.log"
    if ($run.ExitCode -ne 0) {
        $hint = (Select-String -Path $run.Log -Pattern "Error 19\d\d\." -ErrorAction SilentlyContinue |
            Select-Object -Last 1).Line
        Write-Error "MSI install exited with $($run.ExitCode) (scope: $msiScope). $hint Log: $($run.Log)"
        exit 1
    }
}

Start-Sleep -Seconds 2
$entry = Get-InstalledEntry
$installedExe = Get-ChildItem -Path $installDir -Filter "*.exe" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike "*uninst*" } |
    Select-Object -First 1

Write-Host "[2/5] Install directory : $installDir"
Write-Host "      Uninstall entry   : $($entry.DisplayName) $($entry.DisplayVersion)"
Write-Host "      Installed EXE     : $($installedExe.FullName)"

if (-not $installedExe) {
    Write-Error "No executable found in the install directory after installation."
    exit 1
}
if (-not $entry) {
    Write-Error "No uninstall registry entry was created."
    exit 1
}
if ($entry.DisplayVersion -ne $version) {
    Write-Error "Uninstall entry version '$($entry.DisplayVersion)' does not match $version."
    exit 1
}
Write-Host "      DisplayIcon       : $($entry.DisplayIcon)"
if (-not $entry.DisplayIcon) {
    Write-Warning "DisplayIcon is not set; Add/Remove Programs will show a generic icon."
}

Write-Host "`n[3/5] Launching the installed binary for 10 s..."
$app = Start-Process -FilePath $installedExe.FullName -PassThru
Start-Sleep -Seconds 10
if ($app.HasExited) {
    Write-Error "Installed app exited during startup (code $($app.ExitCode))."
    exit 1
}
Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Write-Host "      Stayed alive: yes"

Write-Host "`n[4/5] Uninstalling..."
if ($Kind -eq "nsis") {
    $uninstaller = Get-ChildItem -Path $installDir -Filter "uninst*.exe" -File -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $uninstaller) {
        Write-Error "NSIS uninstaller not found."
        exit 1
    }
    $proc = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -PassThru -Wait
    if ($proc.ExitCode -ne 0) {
        Write-Error "NSIS uninstaller exited with $($proc.ExitCode)"
        exit 1
    }
} else {
    $quoted = "`"$artifact`""
    $args = @("/x", $quoted) + $msiScopeArgs
    $run = Invoke-Msi -Arguments ($args -join " ") -LogName "nc-msi-uninstall.log"
    if ($run.ExitCode -ne 0) {
        Write-Error "MSI uninstall exited with $($run.ExitCode) (log: $($run.Log))"
        exit 1
    }
}

Start-Sleep -Seconds 3
$entryAfter = Get-InstalledEntry
$exeAfter = Get-ChildItem -Path $installDir -Filter "*.exe" -File -ErrorAction SilentlyContinue
Write-Host "[5/5] After uninstall: entry=$($null -ne $entryAfter) exe=$($null -ne $exeAfter)"

if ($entryAfter) {
    Write-Error "Uninstall left a registry entry behind."
    exit 1
}
if ($exeAfter) {
    Write-Error "Uninstall left executables behind."
    exit 1
}

Write-Host "`nRESULT: PASS ($Kind, $(if ($Kind -eq 'msi') { $msiScope } else { 'currentUser' }))"
Write-Host "  - Silent install succeeded and created a version-correct uninstall entry"
Write-Host "  - Installed binary launched and stayed alive"
Write-Host "  - Silent uninstall removed both files and registry entry"
exit 0
