#requires -Version 5.1
<#
Shared helpers for the installer verification scripts.

Dot-source it from a verify-*.ps1 entry point:

    . (Join-Path $PSScriptRoot "lib\installer-common.ps1")

Never run this file directly. All functions use the caller's script scope so
results and counters survive across dot-sourcing.
#>

$script:InstallerResults = @()

function Reset-InstallerResults {
    $script:InstallerResults = @()
}

function Record-InstallerResult {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][ValidateSet("PASS", "FAIL", "SKIP", "WARN")][string]$State,
        [string]$Detail = ""
    )
    $script:InstallerResults += [pscustomobject]@{
        Id     = $Id
        Label  = $Label
        State  = $State
        Detail = $Detail
    }
    Write-Host ("[{0}] {1} {2} - {3}" -f $State, $Id, $Label, $Detail)
}

function Get-InstallerResults {
    return @($script:InstallerResults)
}

function Get-DevCleanerInstallDirs {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Dev Cleaner"),
        (Join-Path $env:LOCALAPPDATA "Dev Cleaner"),
        (Join-Path $env:ProgramFiles "Dev Cleaner")
    )
    if (${env:ProgramFiles(x86)}) {
        $candidates += (Join-Path ${env:ProgramFiles(x86)} "Dev Cleaner")
    }
    return @($candidates | Where-Object { $_ -and (Test-Path $_) })
}

function Get-DevCleanerUninstallEntries {
    $roots = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )
    $found = @()
    foreach ($root in $roots) {
        $found += Get-ItemProperty $root -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -like "*Dev Cleaner*" }
    }
    return @($found)
}

function Wait-Until {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Condition,
        [int]$TimeoutSec = 90
    )
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

function Get-ReleaseVersion {
    param([Parameter(Mandatory = $true)][string]$Root)
    return (Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json).version
}

function Test-IsElevated {
    return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
}

function Assert-NoExistingInstall {
    $dirs = @(Get-DevCleanerInstallDirs)
    $entries = @(Get-DevCleanerUninstallEntries)
    if ($dirs.Count -gt 0 -or $entries.Count -gt 0) {
        Write-Host "[ABORT] Dev Cleaner is already installed on this machine."
        Write-Host "  dirs:    $($dirs -join ', ')"
        Write-Host "  entries: $($entries.DisplayName -join ', ')"
        Write-Host "Uninstall it first; these scripts will not overwrite a user installation."
        return $false
    }
    return $true
}

function Find-InstalledExe {
    foreach ($dir in @(Get-DevCleanerInstallDirs)) {
        $candidate = Join-Path $dir "node-cleaner.exe"
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

function Get-IcoFrameCount {
    param([Parameter(Mandatory = $true)][string]$Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 6) { return -1 }
    return [int][System.BitConverter]::ToUInt16($bytes, 4)
}

function Get-FileSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Invoke-ExeIconCheck {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string[]]$Paths
    )
    $checker = Join-Path $Root "scripts\check-exe-icons.mjs"
    & node $checker @Paths
    return ($LASTEXITCODE -eq 0)
}

function Remove-DevCleanerLeftovers {
    foreach ($entry in @(Get-DevCleanerUninstallEntries)) {
        if (-not $entry.UninstallString) { continue }
        try {
            $command = $entry.UninstallString
            if ($command -match "msiexec") {
                $product = Split-Path $entry.PSPath -Leaf
                Start-Process -FilePath "msiexec.exe" `
                    -ArgumentList @("/x", $product, "/qn", "/norestart") -Wait | Out-Null
            }
            elseif (Test-Path $command) {
                Start-Process -FilePath $command -ArgumentList "/S" -Wait | Out-Null
            }
        }
        catch {}
    }
}

function Complete-InstallerRun {
    param([Parameter(Mandatory = $true)][string]$Title)
    $results = @($script:InstallerResults)
    $fails = @($results | Where-Object { $_.State -eq "FAIL" })
    $warns = @($results | Where-Object { $_.State -eq "WARN" })
    $skips = @($results | Where-Object { $_.State -eq "SKIP" })
    Write-Host ""
    Write-Host ("{0}: {1} passed, {2} failed, {3} skipped, {4} warnings." -f `
            $Title, ($results.Count - $fails.Count - $skips.Count - $warns.Count), $fails.Count, $skips.Count, $warns.Count)
    if ($fails.Count -gt 0) { return 1 }
    if ($skips.Count -gt 0) { return 3 }
    return 0
}
