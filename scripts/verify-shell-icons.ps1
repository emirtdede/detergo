#requires -Version 5.1
<#
Shell surface verification after an NSIS install.

The installer can embed a perfect ICO and still leave Explorer, the desktop or
the Start menu pointing at a stale icon. This script installs the NSIS package
and checks what the shell actually reads:

  - the installed EXE and uninstaller carry 15 icon frames
  - $INSTDIR\app.ico is byte-identical to the shipped source ICO
  - the DisplayIcon registry value resolves
  - the desktop and Start menu shortcuts resolve to an icon inside $INSTDIR

It then uninstalls and checks leftovers. Run on a clean machine; it refuses to
overwrite an existing installation.

Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-shell-icons.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-shell-icons.ps1 -ReleaseDir <path>
#>
param(
    [string]$ReleaseDir = ""
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\installer-common.ps1")

$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ReleaseDir)) {
    $ReleaseDir = Join-Path $root "release_output"
}
if (-not (Test-Path $ReleaseDir)) {
    Write-Host "[FAIL] release directory not found: $ReleaseDir"
    exit 1
}

function Get-ShortcutIconInfo {
    param([Parameter(Mandatory = $true)][string]$Path)
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $location = $shortcut.IconLocation
    $target = [Environment]::ExpandEnvironmentVariables($shortcut.TargetPath)
    if ([string]::IsNullOrWhiteSpace($location) -or $location.StartsWith(",")) {
        # No explicit icon: Windows uses the shortcut target's own icon.
        return [pscustomobject]@{
            IconPath      = $target
            TargetPath    = $target
            FromTarget    = $true
            RawLocation   = $location
        }
    }
    $iconPath = ($location -split ",")[0].Trim().Trim('"')
    return [pscustomobject]@{
        IconPath    = [Environment]::ExpandEnvironmentVariables($iconPath)
        TargetPath  = $target
        FromTarget  = $false
        RawLocation = $location
    }
}

function Test-IconInsideInstallDir {
    param([string]$IconPath, [string]$InstallDir)
    if ([string]::IsNullOrWhiteSpace($IconPath)) { return $false }
    if (-not (Test-Path $IconPath)) { return $false }
    $resolvedIcon = (Resolve-Path $IconPath).Path
    $resolvedDir = (Resolve-Path $InstallDir).Path.TrimEnd("\")
    return $resolvedIcon.StartsWith($resolvedDir + "\", [System.StringComparison]::OrdinalIgnoreCase)
}

$version = Get-ReleaseVersion -Root $root
$nsis = Join-Path $ReleaseDir "Dev-Cleaner-$version-x64-Setup.exe"
$sourceIco = Join-Path $root "src-tauri\icons\icon.ico"

Reset-InstallerResults
if (-not (Assert-NoExistingInstall)) { exit 2 }

try {
    if (-not (Test-Path $nsis)) {
        Record-InstallerResult "S-01" "NSIS install for shell check" "SKIP" "artifact missing: $nsis"
    }
    else {
        $proc = Start-Process -FilePath $nsis -ArgumentList "/S" -Wait -PassThru
        Start-Sleep -Seconds 2
        Stop-InstalledApp
        $exePath = Find-InstalledExe
        if ($proc.ExitCode -ne 0 -or $null -eq $exePath) {
            Record-InstallerResult "S-01" "NSIS install for shell check" "FAIL" `
                ("exit=$($proc.ExitCode) exe=$exePath")
        }
        else {
            $installDir = Split-Path $exePath
            Record-InstallerResult "S-01" "NSIS install for shell check" "PASS" "dir=$installDir"

            $exeIcons = Invoke-ExeIconCheck -Root $root -Paths @($exePath)
            Record-InstallerResult "S-02" "installed EXE carries the 15-frame ICO" `
                ($(if ($exeIcons) { "PASS" } else { "FAIL" })) "scripts/check-exe-icons.mjs"

            $installedIco = Join-Path $installDir "app.ico"
            if (Test-Path $installedIco) {
                $frameCount = Get-IcoFrameCount -Path $installedIco
                $hashMatch = (Get-FileSha256 -Path $installedIco) -eq (Get-FileSha256 -Path $sourceIco)
                Record-InstallerResult "S-03" "app.ico matches the shipped 15-frame source" `
                    ($(if ($frameCount -eq 15 -and $hashMatch) { "PASS" } else { "FAIL" })) `
                    ("frames=$frameCount hashMatch=$hashMatch")
            }
            else {
                Record-InstallerResult "S-03" "app.ico matches the shipped 15-frame source" "FAIL" "app.ico missing"
            }

            $uninstaller = Get-ChildItem -Path $installDir -Filter "uninstall*.exe" `
                -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
            if ($null -ne $uninstaller) {
                $uninstallerIcons = Invoke-ExeIconCheck -Root $root -Paths @($uninstaller)
                Record-InstallerResult "S-04" "uninstaller carries the 15-frame ICO" `
                    ($(if ($uninstallerIcons) { "PASS" } else { "FAIL" })) "scripts/check-exe-icons.mjs"
            }
            else {
                Record-InstallerResult "S-04" "uninstaller carries the 15-frame ICO" "FAIL" "uninstaller not found"
            }

            $entry = @(Get-DevCleanerUninstallEntries) | Select-Object -First 1
            if ($null -ne $entry -and -not [string]::IsNullOrWhiteSpace($entry.DisplayIcon)) {
                $displayIcon = [Environment]::ExpandEnvironmentVariables($entry.DisplayIcon.Trim('"'))
                Record-InstallerResult "S-05" "DisplayIcon resolves" `
                    ($(if (Test-Path $displayIcon) { "PASS" } else { "FAIL" })) $displayIcon
            }
            else {
                Record-InstallerResult "S-05" "DisplayIcon resolves" "FAIL" "registry value missing"
            }

            $desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Dev Cleaner.lnk"
            if (Test-Path $desktopShortcut) {
                $info = Get-ShortcutIconInfo -Path $desktopShortcut
                $inside = Test-IconInsideInstallDir -IconPath $info.IconPath -InstallDir $installDir
                Record-InstallerResult "S-06" "desktop shortcut icon lives in the install dir" `
                    ($(if ($inside) { "PASS" } else { "FAIL" })) `
                    ("icon=$($info.IconPath) fromTarget=$($info.FromTarget)")
            }
            else {
                Record-InstallerResult "S-06" "desktop shortcut icon lives in the install dir" "FAIL" `
                    "shortcut missing: $desktopShortcut"
            }

            $startMenuRoots = @(
                (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"),
                (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs")
            ) | Where-Object { Test-Path $_ }
            $startShortcut = $null
            foreach ($menuRoot in $startMenuRoots) {
                $startShortcut = Get-ChildItem -Path $menuRoot -Filter "Dev Cleaner.lnk" -Recurse `
                    -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
                if ($null -ne $startShortcut) { break }
            }
            if ($null -ne $startShortcut) {
                $info = Get-ShortcutIconInfo -Path $startShortcut
                $inside = Test-IconInsideInstallDir -IconPath $info.IconPath -InstallDir $installDir
                Record-InstallerResult "S-07" "Start menu shortcut icon lives in the install dir" `
                    ($(if ($inside) { "PASS" } else { "FAIL" })) `
                    ("shortcut=$startShortcut icon=$($info.IconPath) fromTarget=$($info.FromTarget)")
            }
            else {
                Record-InstallerResult "S-07" "Start menu shortcut icon lives in the install dir" "FAIL" `
                    "shortcut missing"
            }

            # Uninstall and leave the machine as it was found.
            if ($null -ne $uninstaller) {
                $uninstallProc = Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru
                $filesGone = Wait-Until {
                    -not (Test-Path $installDir) -or
                    ((Get-ChildItem $installDir -Force -ErrorAction SilentlyContinue).Count -eq 0)
                } 60
                $registryGone = Wait-Until { @(Get-DevCleanerUninstallEntries).Count -eq 0 } 60
                Record-InstallerResult "S-08" "shell-check uninstall" `
                    ($(if ($filesGone -and $registryGone) { "PASS" } else { "FAIL" })) `
                    ("exit=$($uninstallProc.ExitCode) filesGone=$filesGone registryGone=$registryGone")
            }
            else {
                Record-InstallerResult "S-08" "shell-check uninstall" "FAIL" "uninstaller not found"
            }
        }
    }
}
finally {
    Stop-InstalledApp
    Remove-DevCleanerLeftovers
    # The NSIS hook queues an empty-only directory removal for the next logon.
    $runOnce = (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce" `
            -ErrorAction SilentlyContinue).DevCleanerRemoveInstallDir
    if (-not [string]::IsNullOrEmpty($runOnce)) {
        cmd /c $runOnce | Out-Null
        Remove-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce" `
            -Name DevCleanerRemoveInstallDir -ErrorAction SilentlyContinue
    }
}

exit (Complete-InstallerRun -Title "Shell icon checks")
