#requires -Version 5.1
<#
MSI installer verification (per-machine build).

The Tauri WiX package is per-machine. This script therefore refuses to run in a
non-elevated session; installing it per-user would test a configuration that
does not ship. Run it on a clean machine or VM, never next to the NSIS build.

It installs the MSI silently, verifies the per-machine registration, the
installed binary, its 15-frame icon, and the uninstall, then checks leftovers.

Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-msi.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-msi.ps1 -ReleaseDir <path>
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

function Test-MsiSuccess {
    param([int]$Code)
    # 0 = success, 3010 = success/reboot required, 1641 = reboot initiated.
    return ($Code -eq 0) -or ($Code -eq 3010) -or ($Code -eq 1641)
}

$version = Get-ReleaseVersion -Root $root
$msi = Join-Path $ReleaseDir "Detergo-$version-x64.msi"

if (-not (Test-IsElevated)) {
    Write-Host "[ABORT] The MSI is per-machine. Run this script from an elevated PowerShell session."
    exit 2
}

Reset-InstallerResults
if (-not (Assert-NoExistingInstall)) { exit 2 }

try {
    if (-not (Test-Path $msi)) {
        Record-InstallerResult "M-01" "MSI silent install" "SKIP" "artifact missing: $msi"
        Record-InstallerResult "M-02" "per-machine registration" "SKIP" "artifact missing"
        Record-InstallerResult "M-03" "MSI-installed binary reports $version" "SKIP" "artifact missing"
        Record-InstallerResult "M-04" "MSI silent uninstall" "SKIP" "artifact missing"
    }
    else {
        $logPath = Join-Path $env:TEMP "detergo-msi-install.log"
        if (Test-Path $logPath) { Remove-Item $logPath -Force -ErrorAction SilentlyContinue }

        $installArgs = @("/i", "`"$msi`"", "/qn", "/norestart", "/l*v", "`"$logPath`"")
        $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList $installArgs -Wait -PassThru
        Wait-Until { @(Get-DetergoUninstallEntries).Count -gt 0 } 120 | Out-Null
        Stop-InstalledApp

        $entries = @(Get-DetergoUninstallEntries)
        $ok = (Test-MsiSuccess $proc.ExitCode) -and ($entries.Count -gt 0)
        $diag = ""
        if (-not $ok -and (Test-Path $logPath)) {
            $diag = " | " + ((Get-Content $logPath |
                        Select-String -Pattern "Error|returning 1603|Product: " |
                        Select-Object -Last 3 |
                        ForEach-Object { $_.Line.Trim() }) -join " ; ")
        }
        Record-InstallerResult "M-01" "MSI silent install" ($(if ($ok) { "PASS" } else { "FAIL" })) `
            ("exit=$($proc.ExitCode) entries=$($entries.Count)$diag")

        if ($ok) {
            $perMachine = @($entries | Where-Object {
                    $_.PSPath -like "*HKEY_LOCAL_MACHINE*"
                }).Count -eq 1
            $installLocation = $entries[0].InstallLocation
            Record-InstallerResult "M-02" "per-machine registration" `
                ($(if ($perMachine) { "PASS" } else { "FAIL" })) `
                ("hklm=$perMachine installLocation=$installLocation")

            $exePath = Find-InstalledExe
            if ($null -ne $exePath) {
                $out = & $exePath --version 2>&1 | Out-String
                Record-InstallerResult "M-03" "MSI-installed binary reports $version" `
                    ($(if ($out -match [regex]::Escape($version)) { "PASS" } else { "FAIL" })) $out.Trim()

                $exeIcons = Invoke-ExeIconCheck -Root $root -Paths @($exePath)
                Record-InstallerResult "M-03b" "MSI-installed EXE carries the 15-frame ICO" `
                    ($(if ($exeIcons) { "PASS" } else { "FAIL" })) "scripts/check-exe-icons.mjs"
            }
            else {
                Record-InstallerResult "M-03" "MSI-installed binary reports $version" "FAIL" "exe not found"
                Record-InstallerResult "M-03b" "MSI-installed EXE carries the 15-frame ICO" "SKIP" "exe not found"
            }

            $uninstallArgs = @("/x", "`"$msi`"", "/qn", "/norestart", "/l*v", "`"$logPath`"")
            $uninstallProc = Start-Process -FilePath "msiexec.exe" -ArgumentList $uninstallArgs -Wait -PassThru
            $gone = Wait-Until {
                @(Get-DetergoUninstallEntries).Count -eq 0 -and
                @(Get-DetergoInstallDirs).Count -eq 0
            } 120
            Record-InstallerResult "M-04" "MSI silent uninstall" `
                ($(if ((Test-MsiSuccess $uninstallProc.ExitCode) -and $gone) { "PASS" } else { "FAIL" })) `
                ("exit=$($uninstallProc.ExitCode) cleaned=$gone")
        }
        else {
            Record-InstallerResult "M-02" "per-machine registration" "FAIL" "install did not register a product"
            Record-InstallerResult "M-03" "MSI-installed binary reports $version" "FAIL" "install failed"
            Record-InstallerResult "M-03b" "MSI-installed EXE carries the 15-frame ICO" "SKIP" "install failed"
            Record-InstallerResult "M-04" "MSI silent uninstall" "FAIL" "install did not register a product"
        }
    }

    $leftDirs = @(Get-DetergoInstallDirs)
    $leftEntries = @(Get-DetergoUninstallEntries)
    $clean = ($leftDirs.Count -eq 0) -and ($leftEntries.Count -eq 0)
    Record-InstallerResult "M-05" "no leftovers after uninstall" ($(if ($clean) { "PASS" } else { "FAIL" })) `
        ("dirs=$($leftDirs -join ',') entries=$($leftEntries.DisplayName -join ',')")
}
finally {
    Stop-InstalledApp
    Remove-DetergoLeftovers
}

exit (Complete-InstallerRun -Title "MSI installer checks")
