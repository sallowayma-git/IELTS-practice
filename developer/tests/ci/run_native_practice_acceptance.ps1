[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$reports = Join-Path $repository 'developer/tests/e2e/reports/native-diagnostics'
New-Item -ItemType Directory -Path $reports -Force | Out-Null
if (-not $env:TAURI_NATIVE_DRIVER -or -not (Test-Path -LiteralPath $env:TAURI_NATIVE_DRIVER)) {
    throw 'TAURI_NATIVE_DRIVER must point to the matching EdgeDriver executable.'
}

# tauri-driver suppresses native stdout. Preserve EdgeDriver diagnostics in a
# separate file while keeping the same executable, session, and assertions.
$nativeDriver = [IO.Path]::GetFullPath($env:TAURI_NATIVE_DRIVER)
$launcher = Join-Path $reports 'edgedriver-diagnostic.cmd'
$driverLog = Join-Path $reports 'edgedriver.log'
$browserLog = Join-Path $reports 'webview2.log'
$launcherText = "@echo off`r`n" + ('"{0}" --verbose --log-path="{1}" %*' -f
    $nativeDriver.Replace('%', '%%'), $driverLog.Replace('%', '%%')) + "`r`n"
[IO.File]::WriteAllText($launcher, $launcherText)
$env:TAURI_NATIVE_DRIVER = $launcher
$previousArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "$previousArguments --enable-logging --log-file=`"$browserLog`""
$started = Get-Date
$flowExit = 1
try {
    python (Join-Path $repository 'developer/tests/e2e/suite_practice_flow.py')
    $flowExit = $LASTEXITCODE
} finally {
    $env:TAURI_NATIVE_DRIVER = $nativeDriver
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousArguments
    # System events are collected only on the disposable GitHub runner.
    if ($env:GITHUB_ACTIONS -eq 'true') {
        $events = @(Get-WinEvent -FilterHashtable @{LogName = 'Application'; StartTime = $started} -ErrorAction SilentlyContinue |
            Where-Object { $_.Message -match 'ielts-practice-tauri|msedgewebview2|msedgedriver' } |
            Select-Object TimeCreated, Id, ProviderName, Message)
        ConvertTo-Json -InputObject $events -Depth 4 |
            Set-Content (Join-Path $reports 'application-events.json') -Encoding utf8
    }
}
exit $flowExit
