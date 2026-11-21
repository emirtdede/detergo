#requires -Version 5.1
<#
Installer upgrade verification: baseline 2.2.1 -> current version.

Run only on a clean machine or VM. This is the test that catches a broken
upgrade path, duplicate Apps & Features entries and a stale binary that keeps
reporting the previous version.

The 2.2.1 artifacts are not committed; copy them from the release share before
running:

    New-Item -ItemType Directory release_output\baseline-2.2.1
    Copy-Item <share>\Detergo-2.2.1-x64-Setup.exe release_output\baseline-2.2.1\
    Copy-Item <share>\Detergo-2.2.1-x64.msi        release_output\baseline-2.2.1\

Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-upgrade.ps1 -Kind NSIS
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-upgrade.ps1 -Kind MSI   # elevated

Never install the NSIS and MSI builds on the same machine.
#>
param(
    [ValidateSet("NSIS", "MSI")][string]$Kind = "NSIS",
    [string]$FromReleaseDir = "",
    [string]$ToReleaseDir = "",
    [string]$FromVersion = "2.2.1"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\installer-common.ps1")

$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($FromReleaseDir)) {
    $FromReleaseDir = Join-Path $root "release_output\baseline-$FromVersion"
}
if ([string]::IsNullOrWhiteSpace($ToReleaseDir)) {
    $ToReleaseDir = Join-Path $root "release_output"
}

if (-not (Test-Path $FromReleaseDir)) {
    Write-Host "[FAIL] baseline release directory not found: $FromReleaseDir"
    Write-Host "Copy the $FromVersion artifacts there first (see the header of this script)."
    exit 1
}
if (-not (Test-Path $ToReleaseDir)) {
    Write-Host "[FAIL] target release directory not found: $ToReleaseDir"
    exit 1
}

$toVersion = Get-ReleaseVersion -Root $root
if ($Kind -eq "MSI" -and -not (Test-IsElevated)) {
    Write-Host "[ABORT] The MSI is per-machine. Run this script from an elevated PowerShell session."
    exit 2
}

function Get-OldArtifact {
    param([string]$Directory, [string]$Version, [string]$Type)
    if ($Type -eq "NSIS") {
        return Join-Path $Directory "Detergo-$Version-x64-Setup.exe"
    }
    return Join-Path $Directory "Detergo-$Version-x64.msi"
}

$oldArtifact = Get-OldArtifact -Directory $FromReleaseDir -Version $FromVersion -Type $Kind
$newArtifact = Get-OldArtifact -Directory $ToReleaseDir -Version $toVersion -Type $Kind

Reset-InstallerResults
if (-not (Assert-NoExistingInstall)) { exit 2 }

try {
    if (-not (Test-Path $oldArtifact)) {
        Record-InstallerResult "U-01" "baseline $Kind install" "SKIP" "artifact missing: $oldArtifact"
        Record-InstallerResult "U-02" "baseline reports $FromVersion" "SKIP" "artifact missing"
    }
    elseif (-not (Test-Path $newArtifact)) {
        Record-InstallerResult "U-01" "baseline $Kind install" "SKIP" "target artifact missing: $newArtifact"
        Record-InstallerResult "U-02" "baseline reports $FromVersion" "SKIP" "target artifact missing"
    }
    else {
        # --- 1. Install the baseline -------------------------------------
        if ($Kind -eq "NSIS") {
            $oldProc = Start-Process -FilePath $oldArtifact -ArgumentList "/S" -Wait -PassThru
        }
        else {
            $oldLog = Join-Path $env:TEMP "detergo-upgrade-old.log"
            $oldProc = Start-Process -FilePath "msiexec.exe" `
                -ArgumentList @("/i", "`"$oldArtifact`"", "/qn", "/norestart", "/l*v", "`"$oldLog`"") `
                -Wait -PassThru
        }
        Start-Sleep -Seconds 2
        Stop-InstalledApp
        $oldExe = Find-InstalledExe
        $oldEntries = @(Get-DetergoUninstallEntries)
        $oldOk = ($oldProc.ExitCode -eq 0) -and ($null -ne $oldExe) -and ($oldEntries.Count -eq 1)
        Record-InstallerResult "U-01" "baseline $Kind install" ($(if ($oldOk) { "PASS" } else { "FAIL" })) `
            ("exit=$($oldProc.ExitCode) exe=$oldExe entries=$($oldEntries.Count)")

        if (-not $oldOk) {
            Record-InstallerResult "U-02" "baseline reports $FromVersion" "SKIP" "baseline install failed"
            Record-InstallerResult "U-03" "$Kind upgrade install" "SKIP" "baseline install failed"
            Record-InstallerResult "U-04" "upgraded binary reports $toVersion" "SKIP" "baseline install failed"
            Record-InstallerResult "U-05" "single Apps & Features entry" "SKIP" "baseline install failed"
            Record-InstallerResult "U-06" "upgraded EXE carries the 15-frame ICO" "SKIP" "baseline install failed"
            Record-InstallerResult "U-07" "upgraded product uninstalls cleanly" "SKIP" "baseline install failed"
        }
        else {
            $oldOut = & $oldExe --version 2>&1 | Out-String
            Record-InstallerResult "U-02" "baseline reports $FromVersion" `
                ($(if ($oldOut -match [regex]::Escape($FromVersion)) { "PASS" } else { "FAIL" })) $oldOut.Trim()

            # --- 2. Upgrade in place -------------------------------------
            if ($Kind -eq "NSIS") {
                $newProc = Start-Process -FilePath $newArtifact -ArgumentList "/S" -Wait -PassThru
            }
            else {
                $newLog = Join-Path $env:TEMP "detergo-upgrade-new.log"
                $newProc = Start-Process -FilePath "msiexec.exe" `
                    -ArgumentList @("/i", "`"$newArtifact`"", "/qn", "/norestart", "/l*v", "`"$newLog`"") `
                    -Wait -PassThru
            }
            Start-Sleep -Seconds 2
            Stop-InstalledApp
            $newExe = Find-InstalledExe
            $newEntries = @(Get-DetergoUninstallEntries)
            $upgradeOk = ($newProc.ExitCode -eq 0) -and ($null -ne $newExe) -and ($newEntries.Count -eq 1)
            Record-InstallerResult "U-03" "$Kind upgrade install" ($(if ($upgradeOk) { "PASS" } else { "FAIL" })) `
                ("exit=$($newProc.ExitCode) exe=$newExe entries=$($newEntries.Count)")

            if (-not $upgradeOk) {
                Record-InstallerResult "U-04" "upgraded binary reports $toVersion" "SKIP" "upgrade failed"
                Record-InstallerResult "U-05" "single Apps & Features entry" "SKIP" "upgrade failed"
                Record-InstallerResult "U-06" "upgraded EXE carries the 15-frame ICO" "SKIP" "upgrade failed"
            }
            else {
                $newOut = & $newExe --version 2>&1 | Out-String
                Record-InstallerResult "U-04" "upgraded binary reports $toVersion" `
                    ($(if ($newOut -match [regex]::Escape($toVersion)) { "PASS" } else { "FAIL" })) $newOut.Trim()

                $duplicate = $newEntries.Count -ne 1
                $entryVersion = $newEntries[0].DisplayVersion
                Record-InstallerResult "U-05" "single Apps & Features entry" `
                    ($(if (-not $duplicate) { "PASS" } else { "FAIL" })) `
                    ("entries=$($newEntries.Count) displayVersion=$entryVersion")

                $exeIcons = Invoke-ExeIconCheck -Root $root -Paths @($newExe)
                Record-InstallerResult "U-06" "upgraded EXE carries the 15-frame ICO" `
                    ($(if ($exeIcons) { "PASS" } else { "FAIL" })) "scripts/check-exe-icons.mjs"
            }

            # --- 3. Uninstall the upgraded product -----------------------
            if ($null -eq $newExe) {
                Record-InstallerResult "U-07" "upgraded product uninstalls cleanly" "SKIP" `
                    "no installed executable to uninstall"
            }
            else {
                if ($Kind -eq "NSIS") {
                    $uninstaller = Get-ChildItem -Path (Split-Path $newExe) -Filter "uninstall*.exe" `
                        -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
                    if ($null -ne $uninstaller) {
                        $removeProc = Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru
                        $removeExit = $removeProc.ExitCode
                    }
                    else {
                        $removeExit = -1
                    }
                }
                else {
                    $removeProc = Start-Process -FilePath "msiexec.exe" `
                        -ArgumentList @("/x", "`"$newArtifact`"", "/qn", "/norestart") -Wait -PassThru
                    $removeExit = $removeProc.ExitCode
                }

                # The NSIS uninstaller cannot delete the folder it runs from, so
                # it queues an empty-only removal for the next logon. An empty
                # folder with that RunOnce entry pending is a clean uninstall.
                $removeDir = Split-Path $newExe
                $filesGone = Wait-Until {
                    -not (Test-Path $removeDir) -or
                    ((Get-ChildItem $removeDir -Force -ErrorAction SilentlyContinue).Count -eq 0)
                } 60
                $registryGone = Wait-Until { @(Get-DetergoUninstallEntries).Count -eq 0 } 60
                $pendingCleanup = (-not (Test-Path $removeDir)) -or
                    (-not [string]::IsNullOrEmpty((Get-QueuedInstallDirCleanup)))
                $cleaned = $filesGone -and $registryGone -and $pendingCleanup
                Record-InstallerResult "U-07" "upgraded product uninstalls cleanly" `
                    ($(if ($removeExit -eq 0 -and $cleaned) { "PASS" } else { "FAIL" })) `
                    ("exit=$removeExit filesGone=$filesGone registryGone=$registryGone dirPending=$pendingCleanup")

                # Leave the machine as it was found so U-08 is a real check.
                if ($pendingCleanup) { Invoke-QueuedInstallDirCleanup | Out-Null }
            }
        }
    }

    $leftDirs = @(Get-DetergoInstallDirs)
    $leftEntries = @(Get-DetergoUninstallEntries)
    $clean = ($leftDirs.Count -eq 0) -and ($leftEntries.Count -eq 0)
    Record-InstallerResult "U-08" "no leftovers after upgrade test" `
        ($(if ($clean) { "PASS" } else { "FAIL" })) `
        ("dirs=$($leftDirs -join ',') entries=$($leftEntries.DisplayName -join ',')")
}
finally {
    Stop-InstalledApp
    Remove-DetergoLeftovers
}

exit (Complete-InstallerRun -Title "$Kind upgrade $FromVersion -> $toVersion")
