param(
    [ValidateRange(1, 86400)]
    [int]$IntervalSeconds = 60,
    [ValidateRange(0, 1000)]
    [int]$BridgeWarningThreshold = 3,
    [string]$ComposeFile = (Join-Path $PSScriptRoot '..\docker-compose.yml'),
    [string]$HealthUrl = 'http://127.0.0.1:3000/api/health',
    [string]$HomeUrl = 'http://127.0.0.1:3000/',
    [string]$LogPath = (Join-Path $PSScriptRoot '..\logs\site-health.jsonl'),
    [string]$AlertPath = (Join-Path $PSScriptRoot '..\logs\site-health-alerts.log'),
    [ValidateRange(1, 60)]
    [int]$HttpTimeoutSeconds = 5,
    [ValidateRange(1, 5000)]
    [int]$TorLogTail = 300,
    [switch]$IncludeOnionHostname,
    [switch]$IncludeBridgeFingerprints,
    [switch]$Once
)

$ErrorActionPreference = 'Stop'

function Resolve-IntegerInRange {
    param(
        [string]$Name,
        [object]$Value,
        [int]$Min,
        [int]$Max
    )
    if ($Value -notmatch '^\d+$') {
        throw "$Name must be an integer between $Min and $Max."
    }
    $number = [int]$Value
    if ($number -lt $Min -or $number -gt $Max) {
        throw "$Name must be an integer between $Min and $Max."
    }
    return $number
}

if (-not $PSBoundParameters.ContainsKey('BridgeWarningThreshold') -and $env:SITE_HEALTH_BRIDGE_WARNING_THRESHOLD -match '^\d+$') {
    $BridgeWarningThreshold = Resolve-IntegerInRange `
        -Name 'SITE_HEALTH_BRIDGE_WARNING_THRESHOLD' `
        -Value $env:SITE_HEALTH_BRIDGE_WARNING_THRESHOLD `
        -Min 0 `
        -Max 1000
}

function Ensure-ParentDirectory {
    param([string]$Path)
    $directory = Split-Path -Parent $Path
    if ($directory) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
}

function Protect-SiteHealthText {
    param([AllowNull()][object]$Value)
    if ($null -eq $Value) {
        return $null
    }

    $safe = [string]$Value
    $safe = $safe -replace '(?i)https?://[a-z2-7]{56}\.onion(?::\d+)?[^\s''"<>]*', '[onion-url-hidden]'
    $safe = $safe -replace '(?i)([?&#](?:access_token|auth|authorization|bridge|cert|code|csrf|csrfToken|otp|passcode|password|recoveryCode|recovery_code|secret|session|sessionId|sid|state|ticket|totp|totpToken|token)=)[^&#\s''"<>]+', '$1[hidden]'
    $safe = $safe -replace 'obfs4\s+\S+\s+[A-Fa-f0-9]{40}\s+[^|,\r\n]*\bcert=\S+[^|,\r\n]*', 'obfs4 [bridge-line-hidden]'
    $safe = $safe -replace 'webtunnel\s+\S+\s+[A-Fa-f0-9]{40}\s+[^|,\r\n]*\burl=\S+[^|,\r\n]*', 'webtunnel [bridge-line-hidden]'
    $safe = $safe -replace 'cert=\S+', 'cert=[hidden]'
    $safe = $safe -replace '\burl=https?://[^\s|,\r\n''"<>]+', 'url=[bridge-url-hidden]'
    $safe = $safe -replace '\b[a-z2-7]{56}\.onion\b', '[onion-hostname-hidden]'
    $safe = $safe -replace '\b[A-Fa-f0-9]{40}\b', '[bridge-fingerprint-hidden]'
    return $safe
}

function Invoke-Compose {
    param([string[]]$ComposeArgs)
    $output = & docker compose -f $ComposeFile @ComposeArgs 2>&1
    return @{
        exitCode = $LASTEXITCODE
        output = ($output -join "`n")
    }
}

function Get-ContainerState {
    param([string]$Name)
    $output = & docker inspect --format '{{json .State}}' $Name 2>&1
    if ($LASTEXITCODE -ne 0) {
        return [ordered]@{
            name = $Name
            running = $false
            status = 'missing'
            health = 'unknown'
            error = Protect-SiteHealthText ($output -join "`n")
        }
    }

    try {
        $state = ($output -join "`n") | ConvertFrom-Json
        $health = 'none'
        if ($null -ne $state.Health -and $state.Health.Status) {
            $health = $state.Health.Status
        }
        return [ordered]@{
            name = $Name
            running = [bool]$state.Running
            status = [string]$state.Status
            health = [string]$health
            startedAt = [string]$state.StartedAt
            finishedAt = [string]$state.FinishedAt
        }
    } catch {
        return [ordered]@{
            name = $Name
            running = $false
            status = 'invalid'
            health = 'unknown'
            error = Protect-SiteHealthText $_.Exception.Message
        }
    }
}

function Test-HttpEndpoint {
    param([string]$Url)
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $HttpTimeoutSeconds
        $timer.Stop()
        return [ordered]@{
            ok = ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400)
            statusCode = [int]$response.StatusCode
            elapsedMs = [int]$timer.ElapsedMilliseconds
            error = $null
        }
    } catch {
        $timer.Stop()
        $statusCode = $null
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        return [ordered]@{
            ok = $false
            statusCode = $statusCode
            elapsedMs = [int]$timer.ElapsedMilliseconds
            error = Protect-SiteHealthText $_.Exception.Message
        }
    }
}

function Get-BridgeFingerprints {
    param([string[]]$Lines)
    $fingerprints = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($line in $Lines) {
        if ($line -match '([A-Fa-f0-9]{40})') {
            [void]$fingerprints.Add($Matches[1].ToUpperInvariant())
        }
    }
    return @($fingerprints)
}

function Get-TorBridgeConfig {
    $includeFingerprints = if ($IncludeBridgeFingerprints) { '1' } else { '0' }
    $script = @'
config=/run/tor/bridges.conf
legacy_config=/etc/tor/torrc.d/bridges.conf
if [ ! -f "$config" ] && [ -f "$legacy_config" ]; then
    config="$legacy_config"
fi
if [ ! -f "$config" ]; then
    printf 'bridgeLines=0\nconfiguredBridgeCount=0\n'
    exit 0
fi

fingerprints="$(awk '/^[[:space:]]*Bridge[[:space:]]+/ { for (i=1; i<=NF; i++) if ($i ~ /^[A-Fa-f0-9]{40}$/) print toupper($i) }' "$config" | sort -u)"
bridge_lines="$(grep -E '^[[:space:]]*Bridge[[:space:]]+' "$config" | wc -l | tr -d ' ')"
configured_count="$(printf '%s\n' "$fingerprints" | sed '/^$/d' | wc -l | tr -d ' ')"
printf 'bridgeLines=%s\nconfiguredBridgeCount=%s\n' "$bridge_lines" "$configured_count"

if [ "${INCLUDE_BRIDGE_FINGERPRINTS:-0}" = "1" ]; then
    printf '%s\n' "$fingerprints" | sed '/^$/d' | sed 's/^/fingerprint=/'
fi
'@
    $result = Invoke-Compose @('exec', '-T', '-e', "INCLUDE_BRIDGE_FINGERPRINTS=$includeFingerprints", 'tor', 'sh', '-lc', $script)
    $configuredBridgeCount = 0
    $bridgeLines = 0
    $fingerprints = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    if ($result.output) {
        foreach ($line in @($result.output -split "`r?`n")) {
            if ($line -match '^configuredBridgeCount=(\d+)$') {
                $configuredBridgeCount = [int]$Matches[1]
            } elseif ($line -match '^bridgeLines=(\d+)$') {
                $bridgeLines = [int]$Matches[1]
            } elseif ($line -match '^fingerprint=([A-Fa-f0-9]{40})$') {
                [void]$fingerprints.Add($Matches[1].ToUpperInvariant())
            }
        }
    }
    return [ordered]@{
        exitCode = $result.exitCode
        configuredBridgeCount = [int]$configuredBridgeCount
        bridgeLines = [int]$bridgeLines
        fingerprints = if ($IncludeBridgeFingerprints) { @($fingerprints) } else { @() }
    }
}

function Get-TorStatus {
    $logsResult = Invoke-Compose @('logs', "--tail=$TorLogTail", 'tor')
    $logs = $logsResult.output
    $hostnameResult = Invoke-Compose @('exec', '-T', 'tor', 'cat', '/var/lib/tor/hidden_service/hostname')
    $hostname = ''
    if ($hostnameResult.exitCode -eq 0) {
        $hostname = ($hostnameResult.output -split "`r?`n" | Select-Object -First 1).Trim()
    }
    $seenFingerprints = Get-BridgeFingerprints -Lines @($logs -split "`r?`n")
    $bootstrapped = $logs -match 'Bootstrapped 100% \(done\): Done'
    $lastBootstrapIndex = $logs.LastIndexOf('Bootstrapped 100% (done): Done', [System.StringComparison]::Ordinal)
    $lastNoRunningIndex = $logs.LastIndexOf('No running bridges', [System.StringComparison]::Ordinal)
    $lastProxyFailureIndex = $logs.LastIndexOf('unable to connect OR connection', [System.StringComparison]::Ordinal)
    $noRunningBridges = $lastNoRunningIndex -ge 0 -and ($lastBootstrapIndex -lt 0 -or $lastNoRunningIndex -gt $lastBootstrapIndex)
    $proxyFailure = $lastProxyFailureIndex -ge 0 -and ($lastBootstrapIndex -lt 0 -or $lastProxyFailureIndex -gt $lastBootstrapIndex)
    $connectedRelay = $logs -match 'Connected to a relay'
    $usableBridgeEstimate = [int]$seenFingerprints.Count
    if ($bootstrapped -and $usableBridgeEstimate -eq 0) {
        $usableBridgeEstimate = 1
    }

    return [ordered]@{
        logExitCode = $logsResult.exitCode
        hostnameExitCode = $hostnameResult.exitCode
        hostnamePresent = [bool]$hostname
        hostname = if ($IncludeOnionHostname) { $hostname } else { '' }
        bootstrapped100 = [bool]$bootstrapped
        connectedRelay = [bool]$connectedRelay
        recentNoRunningBridges = [bool]$noRunningBridges
        recentProxyFailure = [bool]$proxyFailure
        seenBridgeCount = [int]$seenFingerprints.Count
        usableBridgeEstimate = $usableBridgeEstimate
        seenFingerprints = if ($IncludeBridgeFingerprints) { $seenFingerprints } else { @() }
    }
}

function Invoke-SiteHealthCheck {
    $timestamp = (Get-Date).ToString('o')
    $app = Get-ContainerState -Name 'ielts-practice-app'
    $postgres = Get-ContainerState -Name 'ielts-practice-postgres'
    $tor = Get-ContainerState -Name 'ielts-practice-tor'
    $homeHttp = Test-HttpEndpoint -Url $HomeUrl
    $health = Test-HttpEndpoint -Url $HealthUrl
    $bridgeConfig = Get-TorBridgeConfig
    $torStatus = Get-TorStatus

    $warnings = [System.Collections.Generic.List[string]]::new()
    if (-not $app.running -or ($app.health -ne 'healthy' -and $app.health -ne 'none')) {
        $warnings.Add("app container is not healthy: status=$($app.status), health=$($app.health)")
    }
    if (-not $postgres.running -or ($postgres.health -ne 'healthy' -and $postgres.health -ne 'none')) {
        $warnings.Add("postgres container is not healthy: status=$($postgres.status), health=$($postgres.health)")
    }
    if (-not $tor.running) {
        $warnings.Add("tor container is not running: status=$($tor.status)")
    }
    if (-not $homeHttp.ok) {
        $warnings.Add("home endpoint failed: status=$($homeHttp.statusCode), error=$($homeHttp.error)")
    }
    if (-not $health.ok) {
        $warnings.Add("health endpoint failed: status=$($health.statusCode), error=$($health.error)")
    }
    if (-not $torStatus.bootstrapped100) {
        $warnings.Add('tor is not currently bootstrapped to 100% in recent logs')
    }
    if ($torStatus.recentNoRunningBridges) {
        $warnings.Add('tor logs contain "No running bridges"')
    }
    if ($torStatus.recentProxyFailure) {
        $warnings.Add('tor logs contain bridge proxy connection failures')
    }
    if ($bridgeConfig.configuredBridgeCount -le $BridgeWarningThreshold) {
        $warnings.Add("configured bridge count is $($bridgeConfig.configuredBridgeCount), threshold is <= $BridgeWarningThreshold")
    }
    if ($torStatus.usableBridgeEstimate -le $BridgeWarningThreshold) {
        $warnings.Add("usable bridge estimate is $($torStatus.usableBridgeEstimate), threshold is <= $BridgeWarningThreshold")
    }

    $record = [ordered]@{
        timestamp = $timestamp
        app = $app
        postgres = $postgres
        tor = $tor
        http = [ordered]@{
            home = $homeHttp
            health = $health
        }
        bridges = $bridgeConfig
        torStatus = $torStatus
        warnings = @($warnings)
    }

    Ensure-ParentDirectory -Path $LogPath
    Ensure-ParentDirectory -Path $AlertPath
    ($record | ConvertTo-Json -Depth 8 -Compress) | Add-Content -Encoding utf8 -Path $LogPath

    if ($warnings.Count -gt 0) {
        $line = "[$timestamp] " + ($warnings -join '; ')
        Add-Content -Encoding utf8 -Path $AlertPath -Value $line
        Write-Warning $line
    } else {
        Write-Host "[$timestamp] OK app=$($app.health) torBootstrapped=$($torStatus.bootstrapped100) bridges=$($bridgeConfig.configuredBridgeCount)"
    }
}

do {
    try {
        Invoke-SiteHealthCheck
    } catch {
        $timestamp = (Get-Date).ToString('o')
        Ensure-ParentDirectory -Path $AlertPath
        $line = "[$timestamp] monitor failed: $(Protect-SiteHealthText $_.Exception.Message)"
        Add-Content -Encoding utf8 -Path $AlertPath -Value $line
        Write-Warning $line
    }

    if ($Once) {
        break
    }
    Start-Sleep -Seconds $IntervalSeconds
} while ($true)
