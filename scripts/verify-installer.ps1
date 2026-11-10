#requires -Version 5.1
<#
Installer verification for the 2.2.1 production gate (E1-04).

Installs the shipped NSIS and MSI packages silently, checks that the expected
files and uninstall entries appear, runs the installed binary, then uninstalls
silently and checks that everything is gone. The user's own installed copy is
never touched: the script refuses to run while an installation is present.

Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-installer.ps1
       [-ReleaseDir <path>]
#>
param(
    [string]$ReleaseDir = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ReleaseDir)) {
    $ReleaseDir = Join-Path $root "release_output"
}
if (-not (Test-Path $ReleaseDir)) {
    Write-Host "[FAIL] release directory not found: $ReleaseDir"
    exit 1
}

$version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
$nsis = Join-Path $ReleaseDir "Dev-Cleaner-$version-x64-Setup.exe"
$msi = Join-Path $ReleaseDir "Dev-Cleaner-$version-x64.msi"

$script:results = @()
function Record([string]$Id, [string]$Label, [string]$State, [string]$Detail) {
    $script:results += [pscustomobject]@{ Id = $Id; Label = $Label; State = $State; Detail = $Detail }
    Write-Host "[$State] $Id $Label - $Detail"
}

function Get-InstallDirs {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Dev Cleaner"),
        (Join-Path $env:LOCALAPPDATA "Dev Cleaner"),
        (Join-Path $env:ProgramFiles "Dev Cleaner"),
        (Join-Path ${env:ProgramFiles(x86)} "Dev Cleaner")
    )
    return @($candidates | Where-Object { $_ -and (Test-Path $_) })
}

function Get-UninstallEntries {
    $roots = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )
    $found = @()
    foreach ($r in $roots) {
        $found += Get-ItemProperty $r -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -like "*Dev Cleaner*" }
    }
    return @($found)}

function Wait-Until([scriptblock]$Condition, [int]$TimeoutSec = 90) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (& $Condition) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Stop-InstalledApp {
    Get-Process -Name "node-cleaner" -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path -notlike "*\target\*" } |
        Stop-Process -Force -ErrorAction SilentlyContinue
}

$preDirs = @(Get-InstallDirs)
$preEntries = @(Get-UninstallEntries)
if ($preDirs.Count -gt 0 -or $preEntries.Count -gt 0) {
    Write-Host "[ABORT] Dev Cleaner is already installed on this machine."
    Write-Host "  dirs:    $($preDirs -join ', ')"
    Write-Host "  entries: $($preEntries.DisplayName -join ', ')"
    Write-Host "Uninstall it first; this script will not overwrite a user installation."
    exit 2
}

$elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)

try {
    # --- NSIS -----------------------------------------------------------
    if (-not (Test-Path $nsis)) {
        Record "I-01" "NSIS silent install" "SKIP" "artifact missing: $nsis"
        Record "I-05" "NSIS silent uninstall" "SKIP" "artifact missing"
    }
    else {
        $proc = Start-Process -FilePath $nsis -ArgumentList "/S" -Wait -PassThru
        Start-Sleep -Seconds 2
        Stop-InstalledApp
        $dirs = @(Get-InstallDirs)
        $exePath = $null
        foreach ($d in $dirs) {
            $candidate = Join-Path $d "node-cleaner.exe"
            if (Test-Path $candidate) { $exePath = $candidate; break }
        }
        $ok = ($proc.ExitCode -eq 0) -and ($null -ne $exePath)
        Record "I-01" "NSIS silent install" ($(if ($ok) { "PASS" } else { "FAIL" })) `
            ("exit=$($proc.ExitCode) exe=$exePath")

        if ($ok) {
            $out = & $exePath --version 2>&1 | Out-String
            $runs = $out -match [regex]::Escape($version)
            Record "I-02" "installed binary reports $version" ($(if ($runs) { "PASS" } else { "FAIL" })) $out.Trim()
        }
        else {
            Record "I-02" "installed binary reports $version" "FAIL" "install did not produce an exe"
        }

        $uninstaller = $null
        if ($null -ne $exePath) {
            $uninstaller = Get-ChildItem -Path (Split-Path $exePath) -Filter "uninstall*.exe" -ErrorAction SilentlyContinue |
                Select-Object -First 1 -ExpandProperty FullName
        }
        if ($null -ne $uninstaller) {
            $installDir = Split-Path $uninstaller
            $up = Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru
            # Files must be gone. The uninstaller cannot delete the folder it is
            # running from, so the NSIS hook queues an empty-only `rmdir` for the
            # next logon; accept either outcome.
            $filesGone = Wait-Until {
                -not (Test-Path $installDir) -or
                ((Get-ChildItem $installDir -Force -ErrorAction SilentlyContinue).Count -eq 0)
            } 60
            $runOnce = (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce" -ErrorAction SilentlyContinue).DevCleanerRemoveInstallDir
            $pendingCleanup = (-not (Test-Path $installDir)) -or (-not [string]::IsNullOrEmpty($runOnce))
            $gone = @(Get-UninstallEntries).Count -eq 0
            Record "I-05" "NSIS silent uninstall" ($(if ($filesGone -and $pendingCleanup -and $gone) { "PASS" } else { "FAIL" })) `
                ("exit=$($up.ExitCode) filesGone=$filesGone dirPending=$pendingCleanup registryGone=$gone")

            if ($pendingCleanup -and (Test-Path $installDir) -and -not [string]::IsNullOrEmpty($runOnce)) {
                cmd /c $runOnce | Out-Null
                $dirRemoved = Wait-Until { -not (Test-Path $installDir) } 30
                if ($dirRemoved) {
                    Remove-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce" `
                        -Name DevCleanerRemoveInstallDir -ErrorAction SilentlyContinue
                }
                Record "I-05b" "queued install-folder cleanup works" ($(if ($dirRemoved) { "PASS" } else { "FAIL" })) `
                    ("dir removed=$dirRemoved")
            }
        }
        else {
            Record "I-05" "NSIS silent uninstall" "FAIL" "uninstaller not found"
        }
    }

    # --- MSI ------------------------------------------------------------
    if (-not (Test-Path $msi)) {
        Record "I-03" "MSI silent install" "SKIP" "artifact missing: $msi"
        Record "I-06" "MSI silent uninstall" "SKIP" "artifact missing"
    }
    else {
        # The package is per-machine, but WiX can install it per-user when both
        # properties are supplied, which lets a non-elevated session verify it.
        $installArgs = @("/i", "`"$msi`"", "/qn", "/norestart")
        $scope = "per-machine"
        if (-not $elevated) {
            $installArgs += @("ALLUSERS=2", "MSIINSTALLPERUSER=1")
            $scope = "per-user (ALLUSERS=2)"
        }
        $logPath = Join-Path $env:TEMP "nc-msi-install.log"
        if (Test-Path $logPath) { Remove-Item $logPath -Force -ErrorAction SilentlyContinue }
        $installArgs += @("/l*v", "`"$logPath`"")
        $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList $installArgs -Wait -PassThru
        # Windows Installer can report success before the registration is
        # visible in the registry, so wait for the entry instead of sleeping.
        Wait-Until { @(Get-UninstallEntries).Count -gt 0 } 120 | Out-Null
        Stop-InstalledApp
        $entries = @(Get-UninstallEntries)
        $dirs = @(Get-InstallDirs)
        $ok = ($proc.ExitCode -eq 0) -and ($entries.Count -gt 0)
        $diag = ""
        if (-not $ok -and (Test-Path $logPath)) {
            $diag = " | " + ((Get-Content $logPath | Select-String -Pattern "Error|returning 1603|Product: " |
                    Select-Object -Last 3 | ForEach-Object { $_.Line.Trim() }) -join " ; ")
        }
        Record "I-03" "MSI silent install" ($(if ($ok) { "PASS" } else { "FAIL" })) `
            ("exit=$($proc.ExitCode) scope=$scope entries=$($entries.Count)$diag")

        if ($ok) {
            $exePath = $null
            foreach ($d in $dirs) {
                $candidate = Join-Path $d "node-cleaner.exe"
                if (Test-Path $candidate) { $exePath = $candidate; break }
            }
            if ($null -ne $exePath) {
                $out = & $exePath --version 2>&1 | Out-String
                Record "I-04" "MSI-installed binary reports $version" `
                    ($(if ($out -match [regex]::Escape($version)) { "PASS" } else { "FAIL" })) $out.Trim()
            }
            else {
                Record "I-04" "MSI-installed binary reports $version" "FAIL" "exe not found"
            }

            $uninstallProc = Start-Process -FilePath "msiexec.exe" `
                -ArgumentList @("/x", "`"$msi`"", "/qn", "/norestart") -Wait -PassThru
            $gone = Wait-Until { @(Get-UninstallEntries).Count -eq 0 -and @(Get-InstallDirs).Count -eq 0 } 120
            Record "I-06" "MSI silent uninstall" ($(if ($gone) { "PASS" } else { "FAIL" })) `
                ("exit=$($uninstallProc.ExitCode) cleaned=$gone")
        }
        else {
            Record "I-06" "MSI silent uninstall" "FAIL" "install did not register a product"
        }
    }

    # --- leftover check -------------------------------------------------
    $leftDirs = @(Get-InstallDirs)
    $leftEntries = @(Get-UninstallEntries)
    $clean = ($leftDirs.Count -eq 0) -and ($leftEntries.Count -eq 0)
    Record "I-07" "no leftovers after uninstall" ($(if ($clean) { "PASS" } else { "FAIL" })) `
        ("dirs=$($leftDirs -join ',') entries=$($leftEntries.DisplayName -join ',')")
}
finally {
    Stop-InstalledApp
    # Safety net: if anything is still installed, remove it so the developer's
    # machine is left as it was found.
    foreach ($entry in @(Get-UninstallEntries)) {
        if ($entry.UninstallString) {
            try {
                $cmd = $entry.UninstallString
                if ($cmd -match "msiexec") {
                    $product = Split-Path $entry.PSPath -Leaf
                    Start-Process -FilePath "msiexec.exe" -ArgumentList @("/x", $product, "/qn", "/norestart") -Wait | Out-Null
                }
                elseif (Test-Path $cmd) {
                    Start-Process -FilePath $cmd -ArgumentList "/S" -Wait | Out-Null
                }
            }
            catch {}
        }
    }
}

$fails = @($script:results | Where-Object { $_.State -eq "FAIL" })
$skips = @($script:results | Where-Object { $_.State -eq "SKIP" })
Write-Host ""
Write-Host ("Installer checks: {0} passed, {1} failed, {2} skipped." -f `
    ($script:results.Count - $fails.Count - $skips.Count), $fails.Count, $skips.Count)
if ($fails.Count -gt 0) { exit 1 }
if ($skips.Count -gt 0) { exit 3 }
exit 0
