# Recycle Bin round-trip verification for Dev Cleaner 2.2.
#
# Proves three things that source review alone cannot:
#   1. The production guard + RecycleBinService really move a folder to the
#      Windows Recycle Bin (not a permanent delete).
#   2. The item is visible to the Windows shell (Shell.Application namespace 10).
#   3. Byte accounting is truthful: the recycled payload's size is reported.
#
# The script only touches a uniquely named throwaway folder it creates itself and
# then removes exactly the one recycled item it produced. It never empties the
# user's Recycle Bin.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts/verify-recycle-bin.ps1

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$marker = "nc-trash-probe-" + ([guid]::NewGuid().ToString("N").Substring(0, 16))

function Get-RecycleBinDir {
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    return (Join-Path "C:\`$Recycle.Bin" $sid)
}

function Get-RecycleEntries {
    param([string]$BinDir, [string[]]$Exclude)
    if (-not (Test-Path -LiteralPath $BinDir)) { return @() }
    $entries = @()
    foreach ($file in Get-ChildItem -LiteralPath $BinDir -Filter '$I*' -File -ErrorAction SilentlyContinue) {
        if ($Exclude -contains $file.Name) { continue }
        $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
        if ($bytes.Length -lt 28) { continue }
        $version = [System.BitConverter]::ToInt64($bytes, 0)
        if ($version -ne 2) { continue }
        $size = [System.BitConverter]::ToInt64($bytes, 8)
        $pathLen = [System.BitConverter]::ToInt32($bytes, 24)
        if ($pathLen -le 0 -or $pathLen -gt 32767) { continue }
        $raw = [System.Text.Encoding]::Unicode.GetString($bytes, 28, [Math]::Min($pathLen * 2, $bytes.Length - 28))
        $original = $raw.TrimEnd([char]0)
        $entries += [pscustomobject]@{
            IndexFile = $file.FullName
            RFile     = (Join-Path $BinDir ([System.IO.Path]::GetFileName($file.FullName) -replace '^\$I', '$R'))
            Original  = $original
            Size      = $size
        }
    }
    return $entries
}

$binDir = Get-RecycleBinDir
Write-Host "Recycle Bin directory: $binDir"
if (-not (Test-Path -LiteralPath $binDir)) {
    Write-Error "Recycle Bin directory not found; cannot verify a round-trip on this volume."
    exit 1
}

$before = Get-RecycleEntries -BinDir $binDir
$beforeNames = @($before | ForEach-Object { Split-Path -Leaf $_.IndexFile })
Write-Host "Existing recycled items: $($before.Count)"

Write-Host "`nRunning the ignored Rust round-trip test (marker: $marker)..."
$env:NC_TRASH_MARKER = $marker
# The old `trash` crate could hang behind a shell dialog. The round-trip is
# bounded by a watchdog so a hang fails the verification instead of blocking
# the terminal forever.
$logOut = Join-Path $env:TEMP ("nc-trash-probe-" + [guid]::NewGuid().ToString("N") + ".out.log")
$logErr = Join-Path $env:TEMP ("nc-trash-probe-" + [guid]::NewGuid().ToString("N") + ".err.log")
$watchdogSeconds = 180
$manifestPath = Join-Path $repoRoot "src-tauri\Cargo.toml"
$process = Start-Process -FilePath "cargo" `
    -ArgumentList @("test", "--manifest-path", "`"$manifestPath`"", "--offline", "--test", "recycle_bin_roundtrip", "--", "--ignored", "--nocapture") `
    -NoNewWindow -PassThru -RedirectStandardOutput $logOut -RedirectStandardError $logErr
# Accessing Handle forces PowerShell to populate ExitCode after the process exits.
$null = $process.Handle

if (-not $process.WaitForExit($watchdogSeconds * 1000)) {
    Write-Warning "Round-trip did not finish within $watchdogSeconds s; terminating the hung process."
    try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch {}
    Get-Content -LiteralPath $logOut -ErrorAction SilentlyContinue
    Get-Content -LiteralPath $logErr -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $logOut, $logErr -Force -ErrorAction SilentlyContinue
    Write-Error "Recycle Bin round-trip hung; a blocking shell operation is a defect."
    exit 1
}

Get-Content -LiteralPath $logOut -ErrorAction SilentlyContinue
Get-Content -LiteralPath $logErr -ErrorAction SilentlyContinue
$process.WaitForExit()
$process.Refresh()
$testExit = $process.ExitCode
if ($null -eq $testExit) { $testExit = 0 }
Remove-Item -LiteralPath $logOut, $logErr -Force -ErrorAction SilentlyContinue
if ($testExit -ne 0) {
    Write-Error "Rust round-trip test failed with exit code $testExit"
    exit $testExit
}

$after = Get-RecycleEntries -BinDir $binDir -Exclude $beforeNames
$match = $after | Where-Object { $_.Original -like "*$marker*" } | Select-Object -First 1

if (-not $match) {
    Write-Error "The trashed folder was NOT found in the Recycle Bin (silent permanent delete or wrong session)."
    exit 1
}

Write-Host "`nRecycled item found:"
Write-Host "  Original location : $($match.Original)"
Write-Host "  Index file        : $(Split-Path -Leaf $match.IndexFile)"
Write-Host "  Recorded size     : $($match.Size) bytes"

# Visibility check through the same shell namespace Explorer uses.
$shell = New-Object -ComObject Shell.Application
$leaf = Split-Path -Leaf $match.Original
$visible = @($shell.Namespace(10).Items() | Where-Object { $_.Name -like "$leaf*" })
if ($visible.Count -eq 0) {
    Write-Error "Item is in `$Recycle.Bin but not visible through the shell namespace; Explorer would not show it."
    exit 1
}
Write-Host "  Shell visible     : yes ($($visible.Count) entry/entries, name: $($visible[0].Name))"

# Byte accounting: the payload was 4096 + 2048 bytes of file content.
$expected = 6144
if (-not (Test-Path -LiteralPath $match.RFile)) {
    Write-Error "Recycled payload file is missing ($($match.RFile))."
    exit 1
}
$payloadBytes = (Get-ChildItem -LiteralPath $match.RFile -Recurse -File -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
Write-Host "  Payload file bytes: $payloadBytes (expected $expected)"
if ($payloadBytes -ne $expected) {
    Write-Error "Payload size mismatch: the item in the bin is not the folder that was trashed."
    exit 1
}

# Remove exactly the item this run produced (never the whole bin).
Remove-Item -LiteralPath $match.IndexFile -Force
if (Test-Path -LiteralPath $match.RFile) {
    Remove-Item -LiteralPath $match.RFile -Recurse -Force
}
Write-Host "`nCleanup: removed only the probe item from the Recycle Bin."

# S-07 restore proof: the app's restore action is the Windows shell "Restore"
# verb, so exercising the same verb here proves the round trip a user performs
# from the UI. Run after the accounting checks so a failed restore cannot hide
# a byte-accounting defect.
$restoreMarker = "nc-restore-probe-" + ([guid]::NewGuid().ToString("N").Substring(0, 16))
$restoreRoot = Join-Path $env:TEMP $restoreMarker

try {
    $env:NC_TRASH_MARKER = $restoreMarker
    $restoreLogOut = Join-Path $env:TEMP ("nc-restore-" + [guid]::NewGuid().ToString("N") + ".out.log")
    $restoreLogErr = Join-Path $env:TEMP ("nc-restore-" + [guid]::NewGuid().ToString("N") + ".err.log")
    $restoreProcess = Start-Process -FilePath "cargo" `
        -ArgumentList @("test", "--manifest-path", "`"$manifestPath`"", "--offline", "--test", "recycle_bin_roundtrip", "--", "--ignored", "--nocapture") `
        -NoNewWindow -PassThru -RedirectStandardOutput $restoreLogOut -RedirectStandardError $restoreLogErr
    $null = $restoreProcess.Handle
    if (-not $restoreProcess.WaitForExit($watchdogSeconds * 1000)) {
        try { Stop-Process -Id $restoreProcess.Id -Force -ErrorAction SilentlyContinue } catch {}
        throw "second round-trip hung"
    }
    $restoreProcess.WaitForExit()
    $restoreProcess.Refresh()
    if ($restoreProcess.ExitCode -ne 0) {
        Get-Content -LiteralPath $restoreLogOut, $restoreLogErr -ErrorAction SilentlyContinue
        throw "second round-trip failed with exit code $($restoreProcess.ExitCode)"
    }
    Remove-Item -LiteralPath $restoreLogOut, $restoreLogErr -Force -ErrorAction SilentlyContinue

    $restoreEntry = @(Get-RecycleEntries -BinDir $binDir | Where-Object { $_.Original -like "*$restoreMarker*" }) |
        Select-Object -First 1
    if (-not $restoreEntry) { throw "restore probe was not recycled" }

    $shellRestore = New-Object -ComObject Shell.Application
    $restoreLeaf = Split-Path -Leaf $restoreEntry.Original
    $restoreItem = @($shellRestore.Namespace(10).Items() | Where-Object {
            $_.Name -like "$restoreLeaf*" -and
            ($_.Path -eq $restoreEntry.RFile -or $_.Path -like "*$restoreMarker*")
        }) | Select-Object -First 1
    if (-not $restoreItem) {
        # Some shells do not expose the $R path; fall back to the unique name.
        $restoreItem = @($shellRestore.Namespace(10).Items() | Where-Object { $_.Name -like "$restoreLeaf*" }) |
            Select-Object -First 1
    }
    if (-not $restoreItem) { throw "restore probe not visible through the shell namespace" }

    # The verb name is localized ("&Restore" / "&Geri Yükle"), so match the
    # stable part instead of hard-coding an English or Turkish label.
    $restoreVerb = @($restoreItem.Verbs() | Where-Object { $_.Name -match "Restore|Geri Y" }) |
        Select-Object -First 1
    if (-not $restoreVerb) {
        $available = @($restoreItem.Verbs() | ForEach-Object { $_.Name }) -join ", "
        throw "no restore verb on the recycled item (verbs: $available)"
    }
    $restoreVerb.DoIt()

    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath $restoreEntry.Original)) {
        Start-Sleep -Milliseconds 250
    }
    if (-not (Test-Path -LiteralPath $restoreEntry.Original)) {
        throw "shell Restore verb did not put the folder back at $($restoreEntry.Original)"
    }
    $restoredFiles = @(Get-ChildItem -LiteralPath $restoreEntry.Original -Recurse -File)
    $restoredBytes = ($restoredFiles | Measure-Object -Property Length -Sum).Sum
    if ($restoredFiles.Count -lt 2 -or $restoredBytes -lt 6144) {
        throw "restored folder is incomplete ($($restoredFiles.Count) files, $restoredBytes bytes)"
    }
    Write-Host "  Restore (S-07)    : PASS ($($restoredFiles.Count) files, $restoredBytes bytes back at original path)"
}
catch {
    $restoreError = $_.Exception.Message
    Write-Host "  Restore (S-07)    : FAIL - $restoreError"
    # Fall back to deleting the probe from the bin so the machine is left clean.
    $stale = @(Get-RecycleEntries -BinDir $binDir | Where-Object { $_.Original -like "*$restoreMarker*" })
    foreach ($entry in $stale) {
        Remove-Item -LiteralPath $entry.IndexFile -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $entry.RFile) {
            Remove-Item -LiteralPath $entry.RFile -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Error "Recycle Bin restore verification failed: $restoreError"
    exit 1
}
finally {
    if (Test-Path -LiteralPath $restoreRoot) {
        Remove-Item -LiteralPath $restoreRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "`nRESULT: PASS"
Write-Host "  - Guard-accepted temp folder moved to the Recycle Bin"
Write-Host "  - Item visible via Shell.Application namespace 10"
Write-Host "  - Source path removed, parent preserved"
Write-Host "  - Shell Restore verb returns the folder to its original path"
Write-Host "  - Probe removed from the bin; no user data touched"
exit 0
