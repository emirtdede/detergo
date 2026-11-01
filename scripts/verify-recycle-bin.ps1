# Recycle Bin round-trip verification for Node Cleaner 2.0.
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
& cargo test --manifest-path (Join-Path $repoRoot "src-tauri\Cargo.toml") --offline --test recycle_bin_roundtrip -- --ignored --nocapture
$testExit = $LASTEXITCODE
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

Write-Host "`nRESULT: PASS"
Write-Host "  - Guard-accepted temp folder moved to the Recycle Bin"
Write-Host "  - Item visible via Shell.Application namespace 10"
Write-Host "  - Source path removed, parent preserved"
Write-Host "  - Probe removed from the bin; no user data touched"
exit 0
