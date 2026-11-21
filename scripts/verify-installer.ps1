#requires -Version 5.1
<#
NSIS installer verification (per-user build).

Installs the shipped NSIS package silently, checks that the expected files and
uninstall entry appear, runs the installed binary, verifies the 15-frame icon
resources, then uninstalls silently and checks that everything is gone.

The user's own installed copy is never touched: the script refuses to run while
an installation is present.

Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-installer.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-installer.ps1 -ReleaseDir <path>

The per-machine MSI is verified by scripts/verify-msi.ps1 on a separate machine.
Never install both packages on the same machine.
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

$version = Get-ReleaseVersion -Root $root
$nsis = Join-Path $ReleaseDir "Detergo-$version-x64-Setup.exe"
$sourceIco = Join-Path $root "src-tauri\icons\icon.ico"

Reset-InstallerResults
if (-not (Assert-NoExistingInstall)) { exit 2 }

try {
    if (-not (Test-Path $nsis)) {
        Record-InstallerResult "I-01" "NSIS silent install" "SKIP" "artifact missing: $nsis"
        Record-InstallerResult "I-02" "installed binary reports $version" "SKIP" "artifact missing"
        Record-InstallerResult "I-05" "NSIS silent uninstall" "SKIP" "artifact missing"
    }
    else {
        $proc = Start-Process -FilePath $nsis -ArgumentList "/S" -Wait -PassThru
        Start-Sleep -Seconds 2
        Stop-InstalledApp
        $exePath = Find-InstalledExe
        $ok = ($proc.ExitCode -eq 0) -and ($null -ne $exePath)
        Record-InstallerResult "I-01" "NSIS silent install" ($(if ($ok) { "PASS" } else { "FAIL" })) `
            ("exit=$($proc.ExitCode) exe=$exePath")

        if ($ok) {
            $out = & $exePath --version 2>&1 | Out-String
            $runs = $out -match [regex]::Escape($version)
            Record-InstallerResult "I-02" "installed binary reports $version" ($(if ($runs) { "PASS" } else { "FAIL" })) $out.Trim()

            # The installed EXE must carry every frame, not just the source ICO.
            $exeIcons = Invoke-ExeIconCheck -Root $root -Paths @($exePath)
            Record-InstallerResult "I-03" "installed EXE carries the 15-frame ICO" `
                ($(if ($exeIcons) { "PASS" } else { "FAIL" })) "scripts/check-exe-icons.mjs"

            $installDir = Split-Path $exePath
            $installedIco = Join-Path $installDir "app.ico"
            if (Test-Path $installedIco) {
                $frames = Get-IcoFrameCount -Path $installedIco
                $hashMatch = (Get-FileSha256 -Path $installedIco) -eq (Get-FileSha256 -Path $sourceIco)
                Record-InstallerResult "I-04" "installed app.ico is the shipped 15-frame file" `
                    ($(if ($frames -eq 15 -and $hashMatch) { "PASS" } else { "FAIL" })) `
                    ("frames=$frames hashMatch=$hashMatch")
            }
            else {
                Record-InstallerResult "I-04" "installed app.ico is the shipped 15-frame file" "FAIL" "app.ico missing"
            }
        }
        else {
            Record-InstallerResult "I-02" "installed binary reports $version" "FAIL" "install did not produce an exe"
            Record-InstallerResult "I-03" "installed EXE carries the 15-frame ICO" "SKIP" "install failed"
            Record-InstallerResult "I-04" "installed app.ico is the shipped 15-frame file" "SKIP" "install failed"
        }

        $uninstaller = $null
        if ($null -ne $exePath) {
            $uninstaller = Get-ChildItem -Path (Split-Path $exePath) -Filter "uninstall*.exe" -ErrorAction SilentlyContinue |
                Select-Object -First 1 -ExpandProperty FullName
        }
        if ($null -ne $uninstaller) {
            $installDir = Split-Path $uninstaller

            $uninstallerIcons = Invoke-ExeIconCheck -Root $root -Paths @($uninstaller)
            Record-InstallerResult "I-05" "uninstaller carries the 15-frame ICO" `
                ($(if ($uninstallerIcons) { "PASS" } else { "FAIL" })) "scripts/check-exe-icons.mjs"

            $up = Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru
            # Files must be gone. The uninstaller cannot delete the folder it is
            # running from, so the NSIS hook queues an empty-only `rmdir` for the
            # next logon; accept either outcome.
            $filesGone = Wait-Until {
                -not (Test-Path $installDir) -or
                ((Get-ChildItem $installDir -Force -ErrorAction SilentlyContinue).Count -eq 0)
            } 60
            $runOnce = Get-QueuedInstallDirCleanup
            $pendingCleanup = (-not (Test-Path $installDir)) -or (-not [string]::IsNullOrEmpty($runOnce))
            $registryGone = @(Get-DetergoUninstallEntries).Count -eq 0
            Record-InstallerResult "I-06" "NSIS silent uninstall" `
                ($(if ($filesGone -and $pendingCleanup -and $registryGone) { "PASS" } else { "FAIL" })) `
                ("exit=$($up.ExitCode) filesGone=$filesGone dirPending=$pendingCleanup registryGone=$registryGone")

            if ($pendingCleanup -and (Test-Path $installDir)) {
                $dirRemoved = Invoke-QueuedInstallDirCleanup
                Record-InstallerResult "I-06b" "queued install-folder cleanup works" `
                    ($(if ($dirRemoved) { "PASS" } else { "FAIL" })) ("dir removed=$dirRemoved")
            }
        }
        else {
            Record-InstallerResult "I-05" "uninstaller carries the 15-frame ICO" "SKIP" "uninstaller not found"
            Record-InstallerResult "I-06" "NSIS silent uninstall" "FAIL" "uninstaller not found"
        }
    }

    $leftDirs = @(Get-DetergoInstallDirs)
    $leftEntries = @(Get-DetergoUninstallEntries)
    $clean = ($leftDirs.Count -eq 0) -and ($leftEntries.Count -eq 0)
    Record-InstallerResult "I-07" "no leftovers after uninstall" ($(if ($clean) { "PASS" } else { "FAIL" })) `
        ("dirs=$($leftDirs -join ',') entries=$($leftEntries.DisplayName -join ',')")
}
finally {
    Stop-InstalledApp
    Remove-DetergoLeftovers
}

exit (Complete-InstallerRun -Title "NSIS installer checks")
