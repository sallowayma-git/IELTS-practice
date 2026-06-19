param(
    [string[]]$Bridge = @(),
    [string]$BridgeFile = (Join-Path $PSScriptRoot '..\tor\bridges.txt'),
    [string]$EnvFile = (Join-Path $PSScriptRoot '..\.env'),
    [string]$Image = 'backend-tor',
    [int]$TimeoutSeconds = 75
)

$ErrorActionPreference = 'Stop'

function Normalize-Bridge {
    param([string]$Line)
    $value = ($Line -replace '#.*$', '').Trim()
    if (-not $value) {
        return $null
    }
    if ($value.StartsWith('TOR_BRIDGES=')) {
        $value = $value.Substring('TOR_BRIDGES='.Length).Trim()
    }
    if ($value.StartsWith('Bridge ')) {
        $value = $value.Substring('Bridge '.Length).Trim()
    }
    if ($value.StartsWith('obfs4:obfs4 ')) {
        $value = $value.Substring('obfs4:'.Length).Trim()
    }
    if ($value.StartsWith('obfs4://obfs4 ')) {
        $value = $value.Substring('obfs4://'.Length).Trim()
    }
    if (-not $value.StartsWith('obfs4 ')) {
        return $null
    }
    if ($value -notmatch '([A-Fa-f0-9]{40})') {
        return $null
    }
    return [ordered]@{
        line = $value
        fingerprint = $Matches[1].ToUpperInvariant()
        endpoint = (($value -split '\s+')[1])
    }
}

function Get-CandidateBridges {
    $items = [System.Collections.Generic.List[object]]::new()
    if (Test-Path $BridgeFile) {
        foreach ($line in Get-Content $BridgeFile) {
            $candidate = Normalize-Bridge -Line $line
            if ($candidate) {
                $items.Add($candidate)
            }
        }
    }
    if (Test-Path $EnvFile) {
        foreach ($line in Get-Content $EnvFile) {
            if ($line -like 'TOR_BRIDGES=*') {
                $candidate = Normalize-Bridge -Line $line
                if ($candidate) {
                    $items.Add($candidate)
                }
            }
        }
    }
    foreach ($line in $Bridge) {
        $candidate = Normalize-Bridge -Line $line
        if ($candidate) {
            $items.Add($candidate)
        }
    }

    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($item in $items) {
        if ($seen.Add($item.fingerprint)) {
            $item
        }
    }
}

function Get-LastBootstrapPercent {
    param([string]$Logs)
    $matches = [regex]::Matches($Logs, 'Bootstrapped\s+(\d+)%')
    if ($matches.Count -eq 0) {
        return 0
    }
    return [int]$matches[$matches.Count - 1].Groups[1].Value
}

function Test-Bridge {
    param([object]$Candidate)
    $suffix = $Candidate.fingerprint.Substring(0, 8).ToLowerInvariant()
    $container = "ielts-bridge-test-$suffix-$([Guid]::NewGuid().ToString('N').Substring(0, 6))"
    $started = $false
    $logs = ''
    try {
        $containerId = & docker run -d --name $container --add-host 'app:127.0.0.1' -e 'TOR_BRIDGES_FILE=/tmp/no-bridges.txt' -e "TOR_BRIDGES=$($Candidate.line)" $Image 2>&1
        if ($LASTEXITCODE -ne 0) {
            return [ordered]@{
                fingerprint = $Candidate.fingerprint
                endpoint = $Candidate.endpoint
                reachable = $false
                bootstrapPercent = 0
                error = ($containerId -join "`n")
            }
        }
        $started = $true
        $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
        do {
            Start-Sleep -Seconds 3
            $logs = (& docker logs $container 2>&1) -join "`n"
            if ($logs -match 'Bootstrapped 100% \(done\): Done') {
                return [ordered]@{
                    fingerprint = $Candidate.fingerprint
                    endpoint = $Candidate.endpoint
                    reachable = $true
                    bootstrapPercent = 100
                    error = $null
                    line = $Candidate.line
                }
            }
            $state = (& docker inspect --format '{{.State.Running}}' $container 2>&1) -join ''
            if ($LASTEXITCODE -ne 0 -or $state.Trim() -ne 'true') {
                break
            }
        } while ((Get-Date) -lt $deadline)

        return [ordered]@{
            fingerprint = $Candidate.fingerprint
            endpoint = $Candidate.endpoint
            reachable = $false
            bootstrapPercent = Get-LastBootstrapPercent -Logs $logs
            error = (($logs -split "`r?`n" | Select-Object -Last 8) -join ' | ')
        }
    } finally {
        if ($started) {
            & docker rm -f $container *> $null
        }
    }
}

$candidates = @(Get-CandidateBridges)
if ($candidates.Count -eq 0) {
    throw 'No obfs4 bridge candidates found.'
}

$results = foreach ($candidate in $candidates) {
    Test-Bridge -Candidate $candidate
}

$results | ConvertTo-Json -Depth 5
