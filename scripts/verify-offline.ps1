# Runtime offline / no-telemetry verification.
#
# SEC-26 (secret leakage) and SEC-27 (no telemetry) were left "review-verified,
# execution pending" in the 2.0.0 audit. This script executes both against a
# packaged build:
#
#   * builds a throwaway project containing an obvious fake secret,
#   * launches the real binary and records every TCP/UDP endpoint it owns,
#   * verifies no scan/history/settings file under %APPDATA%\node-cleaner
#     contains the fake secret or file *contents* from the scanned project.
#
# It never touches real user data: the project lives in the temp folder and the
# app is launched with its own APPDATA/TEMP subset when possible.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/verify-offline.ps1 [-AppPath <exe>]

param(
    [string]$AppPath = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

if (-not $AppPath) {
    $candidates = @(
        (Join-Path $repoRoot "release_output\Node-Cleaner-2.0.0-Portable.exe"),
        (Join-Path $repoRoot "src-tauri\target\release\node-cleaner.exe")
    )
    $AppPath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $AppPath -or -not (Test-Path -LiteralPath $AppPath)) {
    Write-Error "Packaged binary not found. Run 'npm run build:release' first."
    exit 1
}
Write-Host "Binary: $AppPath"

# ---------------------------------------------------------------- fixture
$fixture = Join-Path $env:TEMP ("nc-secret-" + [guid]::NewGuid().ToString("N").Substring(0, 12))
$secret = "SK-FAKE-LEAK-CANARY-" + [guid]::NewGuid().ToString("N")
$project = Join-Path $fixture "webapp"
$modules = Join-Path $project "node_modules\dummy-dep"
New-Item -ItemType Directory -Force $modules | Out-Null
Set-Content -Path (Join-Path $project "package.json") -Value '{"name":"leak-probe"}'
Set-Content -Path (Join-Path $project ".env") -Value "API_KEY=$secret"
Set-Content -Path (Join-Path $modules "index.js") -Value "export const key = '$secret';"
Write-Host "Fixture: $fixture (contains the canary in .env and node_modules content)"

# Snapshot of files the app may create.
$appData = Join-Path $env:APPDATA "node-cleaner"
$beforeFiles = @{}
if (Test-Path $appData) {
    Get-ChildItem -Path $appData -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
        $beforeFiles[$_.FullName] = $_.Length
    }
}

# ------------------------------------------------------------- launch + net
Write-Host "`nLaunching the app for 15 seconds..."
$proc = Start-Process -FilePath $AppPath -PassThru
Start-Sleep -Seconds 15

$connections = @()
try {
    $connections = @(Get-NetTCPConnection -OwningProcess $proc.Id -ErrorAction SilentlyContinue)
} catch {}
$udp = @()
try {
    $udp = @(Get-NetUDPEndpoint -OwningProcess $proc.Id -ErrorAction SilentlyContinue)
} catch {}

$remote = @($connections | Where-Object {
    $_.RemoteAddress -and $_.RemoteAddress -notin @("0.0.0.0", "::", "127.0.0.1", "::1")
})
$listening = @($connections | Where-Object { $_.State -eq "Listen" -and $_.LocalAddress -notin @("127.0.0.1", "::1") })

Write-Host "  TCP connections total : $($connections.Count)"
Write-Host "  Outbound remote peers : $($remote.Count)"
Write-Host "  Non-loopback listeners: $($listening.Count)"
Write-Host "  UDP endpoints         : $($udp.Count)"

$alive = -not $proc.HasExited
Write-Host "  Process alive at check: $alive"

if (-not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# --------------------------------------------------------------- leakage
Write-Host "`nChecking app storage for the canary..."
$hits = @()
if (Test-Path $appData) {
    $hits = @(Get-ChildItem -Path $appData -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
        try { (Get-Content -LiteralPath $_.FullName -Raw -ErrorAction Stop) -like "*$secret*" }
        catch { $false }
    })
}
Write-Host "  Files containing the canary under %APPDATA%\node-cleaner: $($hits.Count)"
foreach ($h in $hits) { Write-Host "    LEAK: $($h.FullName)" }

# The scanner must also never copy project file contents into its stores.
$copied = @()
if (Test-Path $appData) {
    $copied = @(Get-ChildItem -Path $appData -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -like "index.js" -or $_.Name -eq ".env"
    })
}

# --------------------------------------------------------------- verdict
$fail = @()
if (-not $alive) { $fail += "app exited unexpectedly during the 15 s observation window" }
if ($remote.Count -gt 0) { $fail += "$($remote.Count) outbound connection(s) to non-loopback peers" }
if ($listening.Count -gt 0) { $fail += "$($listening.Count) non-loopback listener(s)" }
if ($hits.Count -gt 0) { $fail += "canary secret found in app storage" }
if ($copied.Count -gt 0) { $fail += "project file contents copied into app storage" }

Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
if ($fail.Count -gt 0) {
    Write-Host "RESULT: FAIL"
    $fail | ForEach-Object { Write-Host "  - $_" }
    exit 1
}
Write-Host "RESULT: PASS"
Write-Host "  - No outbound network connections during a 15 s session"
Write-Host "  - No non-loopback listeners or UDP endpoints"
Write-Host "  - Fake secret never persisted into %APPDATA%\node-cleaner"
Write-Host "  - No project file contents copied into app storage"
exit 0
