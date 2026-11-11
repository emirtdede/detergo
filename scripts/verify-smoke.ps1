#requires -Version 5.1
<#
Automated part of the 2.2.1 manual smoke test (E1-03).

A GUI session is still required for Windows toast notifications, recycle-bin
restore and the in-app cancel buttons. Everything that can be driven through the
shipped CLI is checked here against the real release binary.

  S-00  binary starts and reports the expected version
  S-00b scan finds a real cleanup target in a sandbox project
  S-01  webhook returns 200  (payload delivered, success reported)
  S-02  webhook returns 500  (warning, no crash)
  S-03  webhook unreachable  (warning, no crash)
  S-08  language switch is reflected in CLI output (tr -> en)
  S-09  settings persist between processes
  S-10  GUI starts and stays alive
  S-11  settings file stays valid JSON after a GUI run

The run is isolated: APPDATA points at a temp directory, so real user settings
are never touched. The seed config comes from
`scripts/fixtures/default-settings.json`, which a Rust test keeps in sync with
`AppSettings::default()`.

Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-smoke.ps1 [-Exe <path>]
#>
param(
    [string]$Exe = "",
    [int]$GuiSeconds = 8
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Exe)) {
    $Exe = Join-Path $root "src-tauri\target\release\dev-cleaner.exe"
}
if (-not (Test-Path $Exe)) {
    Write-Host "[FAIL] binary not found: $Exe"
    Write-Host "Run 'npm run build:release' first."
    exit 1
}
$Exe = (Resolve-Path $Exe).Path

$expectedVersion = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
$fixturePath = Join-Path $root "scripts\fixtures\default-settings.json"
$utf8 = New-Object System.Text.UTF8Encoding($false)

$script:results = @()
function Record([string]$Id, [string]$Label, [bool]$Ok, [string]$Detail) {
    $script:results += [pscustomobject]@{ Id = $Id; Label = $Label; Ok = $Ok; Detail = $Detail }
    $tag = if ($Ok) { "[PASS]" } else { "[FAIL]" }
    Write-Host "$tag $Id $Label - $Detail"
}

$sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ("nc-smoke-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$appdata = Join-Path $sandbox "appdata"
$configDir = Join-Path $appdata "dev-cleaner"
$configPath = Join-Path $configDir "config.json"
New-Item -ItemType Directory -Path $configDir -Force | Out-Null

# A tiny project the scanner recognises as a cleanup target.
$project = Join-Path $sandbox "demo-app"
New-Item -ItemType Directory -Path (Join-Path $project "node_modules\left-pad") -Force | Out-Null
Set-Content -Path (Join-Path $project "package.json") -Value '{"name":"demo-app","version":"1.0.0"}' -Encoding UTF8
Set-Content -Path (Join-Path $project "node_modules\left-pad\index.js") -Value ("x" * 262144) -Encoding ASCII

$previousAppData = $env:APPDATA
$env:APPDATA = $appdata

function Set-Language([string]$Code) {
    $settings = Get-Content $fixturePath -Raw | ConvertFrom-Json
    $settings.language = $Code
    [System.IO.File]::WriteAllText($configPath, ($settings | ConvertTo-Json -Depth 20), $utf8)
}

function Read-Utf8File([string]$Path) {
    if (-not (Test-Path $Path)) { return "" }
    for ($i = 0; $i -lt 20; $i++) {
        try {
            return [System.IO.File]::ReadAllText($Path, $utf8)
        }
        catch [System.IO.IOException] {
            Start-Sleep -Milliseconds 100
        }
    }
    return [System.IO.File]::ReadAllText($Path, $utf8)
}

function Invoke-Cli([string[]]$Arguments) {
    $stdout = Join-Path $sandbox ("out-" + [guid]::NewGuid().ToString("N") + ".txt")
    $stderr = Join-Path $sandbox ("err-" + [guid]::NewGuid().ToString("N") + ".txt")
    $proc = Start-Process -FilePath $Exe -ArgumentList $Arguments -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $out = Read-Utf8File $stdout
    $err = Read-Utf8File $stderr
    return [pscustomobject]@{
        Status   = $proc.ExitCode
        Stdout   = $out
        Stderr   = $err
        Combined = "$out`n$err"
    }
}

function Start-Cli([string[]]$Arguments) {
    $stdout = Join-Path $sandbox ("out-" + [guid]::NewGuid().ToString("N") + ".txt")
    $stderr = Join-Path $sandbox ("err-" + [guid]::NewGuid().ToString("N") + ".txt")
    $proc = Start-Process -FilePath $Exe -ArgumentList $Arguments -NoNewWindow -PassThru `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    return [pscustomobject]@{ Process = $proc; StdoutPath = $stdout; StderrPath = $stderr }
}

function Complete-Cli($Handle) {
    if (-not $Handle.Process.HasExited) {
        $Handle.Process.WaitForExit(60000) | Out-Null
    }
    $out = Read-Utf8File $Handle.StdoutPath
    $err = Read-Utf8File $Handle.StderrPath
    $status = $Handle.Process.ExitCode
    $Handle.Process.Dispose()
    return [pscustomobject]@{
        Status   = $status
        Stdout   = $out
        Stderr   = $err
        Combined = "$out`n$err"
    }
}

function Start-MockServer([int]$StatusCode) {
    # HttpListener needs a concrete port; ask the OS for a free one first.
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $probe.Start()
    $port = $probe.LocalEndpoint.Port
    $probe.Stop()
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://127.0.0.1:$port/")
    $listener.Start()
    return [pscustomobject]@{ Listener = $listener; Port = $port; Status = $StatusCode }
}

function Complete-MockRequest($Mock, [int]$TimeoutMs = 30000) {
    $task = $Mock.Listener.GetContextAsync()
    if (-not $task.Wait($TimeoutMs)) { return $null }
    $context = $task.Result
    $reader = New-Object System.IO.StreamReader($context.Request.InputStream, [System.Text.Encoding]::UTF8)
    $body = $reader.ReadToEnd()
    $reader.Dispose()
    $context.Response.StatusCode = $Mock.Status
    $payload = [System.Text.Encoding]::UTF8.GetBytes('{"received":true}')
    $context.Response.OutputStream.Write($payload, 0, $payload.Length)
    $context.Response.Close()
    return [pscustomobject]@{ Method = $context.Request.HttpMethod; Body = $body }
}

function Stop-MockServer($Mock) {
    try { $Mock.Listener.Stop(); $Mock.Listener.Close() } catch {}
}

$gui = $null
try {
    Write-Host "[INFO] binary: $Exe"
    Write-Host "[INFO] sandbox: $sandbox"
    Write-Host ""

    # English output keeps the assertions below locale-independent.
    Set-Language "en"

    # S-00 ---------------------------------------------------------------
    $version = Invoke-Cli @("--version")
    Record "S-00" "binary runs and reports $expectedVersion" ($version.Combined -match [regex]::Escape($expectedVersion)) $version.Combined.Trim()

    # S-00b --------------------------------------------------------------
    $scan = Invoke-Cli @("scan", $project, "--scope", "projects", "--json")
    $foundTarget = $scan.Combined -match '"items"\s*:\s*\[\s*\{'
    Record "S-00b" "scan finds the sandbox target" ($scan.Status -eq 0 -and $foundTarget) "exit=$($scan.Status) target=$foundTarget"

    # S-01 / S-02 --------------------------------------------------------
    foreach ($case in @(
            @{ Id = "S-01"; Label = "webhook returns 200"; Status = 200 },
            @{ Id = "S-02"; Label = "webhook returns 500"; Status = 500 }
        )) {
        $mock = Start-MockServer -StatusCode $case.Status
        try {
            $url = "http://127.0.0.1:$($mock.Port)/hook"
            # Start the CLI without waiting: this thread has to answer the HTTP
            # request before the CLI can finish, so waiting here would deadlock.
            $handle = Start-Cli @("scan", $project, "--scope", "projects", "--webhook", $url)
            $request = Complete-MockRequest -Mock $mock
            $cliOut = (Complete-Cli $handle).Combined
            $delivered = ($null -ne $request) -and ($request.Body.Length -gt 0)
            if ($case.Status -eq 200) {
                $handled = $cliOut -match "successfully dispatched"
            }
            else {
                $handled = $cliOut -match "\[WARN\]"
            }
            $bytes = if ($null -ne $request) { $request.Body.Length } else { 0 }
            Record $case.Id $case.Label ($delivered -and $handled) "delivered=$delivered bytes=$bytes"
        }
        finally {
            Stop-MockServer $mock
        }
    }

    # S-03 ---------------------------------------------------------------
    $unreachable = Invoke-Cli @("scan", $project, "--scope", "projects", "--webhook", "http://127.0.0.1:1/hook")
    $graceful = ($unreachable.Status -eq 0) -and ($unreachable.Combined -match "\[WARN\]")
    Record "S-03" "unreachable webhook fails gracefully" $graceful "exit=$($unreachable.Status)"

    # S-08 / S-09 --------------------------------------------------------
    # "Sürüm" is spelled with code points so the assertion does not depend on
    # how Windows PowerShell decodes this script file.
    $trVersionWord = "S" + [char]0x00FC + "r" + [char]0x00FC + "m"
    Set-Language "tr"
    $tr = Invoke-Cli @("--version")
    Record "S-08a" "language=tr localizes CLI output" ($tr.Combined.Contains($trVersionWord)) $tr.Combined.Trim()

    $en = Invoke-Cli @("--version")
    Record "S-09" "settings persist across processes (still tr)" `
        ($en.Combined.Contains($trVersionWord) -and -not $en.Combined.Contains("Version")) $en.Combined.Trim()

    Set-Language "en"
    $enAgain = Invoke-Cli @("--version")
    Record "S-08b" "language=en switches back immediately" `
        ($enAgain.Combined.Contains("Version") -and -not $enAgain.Combined.Contains($trVersionWord)) $enAgain.Combined.Trim()

    # S-10 ---------------------------------------------------------------
    $gui = Start-Process -FilePath $Exe -PassThru
    Start-Sleep -Seconds $GuiSeconds
    if ($gui.HasExited) {
        Record "S-10" "GUI stays alive for $GuiSeconds s" $false "exited with $($gui.ExitCode)"
    }
    else {
        Record "S-10" "GUI stays alive for $GuiSeconds s" $true "running"
    }

    # S-11 ---------------------------------------------------------------
    $valid = $false
    $language = $null
    try {
        $saved = Get-Content $configPath -Raw | ConvertFrom-Json
        $valid = $null -ne $saved.schemaVersion
        $language = $saved.language
    }
    catch {}
    Record "S-11" "settings file is valid JSON after the GUI run" $valid "language=$language"
}
finally {
    if ($null -ne $gui -and -not $gui.HasExited) {
        Stop-Process -Id $gui.Id -Force -ErrorAction SilentlyContinue
    }
    $env:APPDATA = $previousAppData
    Get-Process -Name "dev-cleaner", "node-cleaner" -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $Exe } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Remove-Item $sandbox -Recurse -Force -ErrorAction SilentlyContinue
}

$failures = @($script:results | Where-Object { -not $_.Ok })
Write-Host ""
Write-Host ("{0}/{1} automated checks passed." -f ($script:results.Count - $failures.Count), $script:results.Count)
if ($failures.Count -gt 0) {
    Write-Host "Failing checks:"
    foreach ($f in $failures) { Write-Host "  - $($f.Id) $($f.Label): $($f.Detail)" }
    exit 1
}
Write-Host "Notification routing: npm test (notification-service.test.ts)"
Write-Host "Cancel paths:        cargo test (scanner + cleanup cancellation)"
Write-Host "Recycle-bin restore: npm run verify:trash"
exit 0
