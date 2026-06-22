param(
    [string[]]$Bridge = @(),
    [string]$BridgeFile = '',
    [string]$EncryptedBridgeFile = '',
    [string]$AgeIdentityFile = '',
    [string]$Image = 'backend-tor',
    [ValidateRange(10, 600)]
    [int]$TimeoutSeconds = 75,
    [ValidateRange(1, 100)]
    [int]$MaxCandidates = 20,
    [switch]$RevealBridgeMetadata,
    [switch]$RevealBridgeLines
)

$ErrorActionPreference = 'Stop'
$MAX_BRIDGE_LINE_LENGTH = 1200
$OBFS4_BRIDGE_PATTERN = '^obfs4\s+([^\s]+)\s+([A-Fa-f0-9]{40})\s+.*\bcert=[^\s]+'
$decryptedBridgeLines = @()

if ($Bridge.Count -gt 0) {
    Write-Warning 'Inline -Bridge values can be exposed through shell history or process lists. Prefer -BridgeFile or -EncryptedBridgeFile.'
}

if ($EncryptedBridgeFile) {
    if (-not $AgeIdentityFile) {
        throw 'AgeIdentityFile is required when EncryptedBridgeFile is set.'
    }
    if (-not (Get-Command age -ErrorAction SilentlyContinue)) {
        throw 'age command is required to decrypt encrypted bridge files.'
    }
    $decryptedBridgeLines = @(& age --decrypt --identity $AgeIdentityFile $EncryptedBridgeFile 2>$null)
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to decrypt encrypted bridge file.'
    }
} elseif (-not $BridgeFile) {
    $localBridgeFile = Join-Path $PSScriptRoot '..\tor\bridges.local.txt'
    $templateBridgeFile = Join-Path $PSScriptRoot '..\tor\bridges.txt'
    $BridgeFile = if (Test-Path $localBridgeFile) { $localBridgeFile } else { $templateBridgeFile }
}

function Test-BridgeEndpoint {
    param([string]$Endpoint)
    if (-not $Endpoint) {
        return $false
    }

    $match = [regex]::Match($Endpoint, '^\[[0-9A-Fa-f:.]+\]:(?<port>\d{1,5})$')
    if (-not $match.Success) {
        $match = [regex]::Match($Endpoint, '^[A-Za-z0-9.-]+:(?<port>\d{1,5})$')
    }
    if (-not $match.Success) {
        return $false
    }

    $port = [int]$match.Groups['port'].Value
    return $port -ge 1 -and $port -le 65535
}

function Normalize-Bridge {
    param([string]$Line)
    $value = ($Line -replace '#.*$', '').Trim()
    if (-not $value) {
        return $null
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
    if ($value.Length -gt $MAX_BRIDGE_LINE_LENGTH -or $value -match "[`r`n`0]") {
        return $null
    }
    if ($value -notmatch $OBFS4_BRIDGE_PATTERN) {
        return $null
    }
    $endpoint = $Matches[1]
    $fingerprint = $Matches[2].ToUpperInvariant()
    if (-not (Test-BridgeEndpoint -Endpoint $endpoint)) {
        return $null
    }
    return [ordered]@{
        line = $value
        fingerprint = $fingerprint
        endpoint = $endpoint
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
    foreach ($line in $decryptedBridgeLines) {
        $candidate = Normalize-Bridge -Line $line
        if ($candidate) {
            $items.Add($candidate)
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
        if ($seen.Add($item.line)) {
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

function Protect-BridgeDiagnosticText {
    param(
        [string]$Text,
        [object]$Candidate
    )
    if (-not $Text) {
        return $null
    }
    $safe = $Text
    if (-not $RevealBridgeLines) {
        $safe = $safe -replace 'obfs4\s+\S+\s+[A-Fa-f0-9]{40}\s+[^|\r\n]*\bcert=\S+[^|\r\n]*', 'obfs4 [bridge-line-hidden]'
        $safe = $safe -replace 'webtunnel\s+\S+\s+[A-Fa-f0-9]{40}\s+[^|\r\n]*\burl=\S+[^|\r\n]*', 'webtunnel [bridge-line-hidden]'
        $safe = $safe -replace 'cert=\S+', 'cert=[hidden]'
        $safe = $safe -replace '\burl=https?://[^\s|\r\n''"<>]+', 'url=[bridge-url-hidden]'
    }
    if (-not ($RevealBridgeMetadata -or $RevealBridgeLines)) {
        if ($Candidate -and $Candidate.endpoint) {
            $safe = $safe.Replace([string]$Candidate.endpoint, '[bridge-endpoint]')
        }
        if ($Candidate -and $Candidate.fingerprint) {
            $fingerprint = [string]$Candidate.fingerprint
            $safe = $safe.Replace($fingerprint, '[bridge-fingerprint]')
            $safe = $safe.Replace($fingerprint.ToLowerInvariant(), '[bridge-fingerprint]')
        }
        $safe = $safe -replace '\b[A-Fa-f0-9]{40}\b', '[bridge-fingerprint]'
    }
    return $safe
}

function New-BridgeResult {
    param(
        [object]$Candidate,
        [int]$Index,
        [bool]$Reachable,
        [int]$BootstrapPercent,
        [string]$ErrorText
    )
    $result = [ordered]@{
        bridgeIndex = $Index
        reachable = $Reachable
        bootstrapPercent = $BootstrapPercent
        error = Protect-BridgeDiagnosticText -Text $ErrorText -Candidate $Candidate
    }
    if ($RevealBridgeMetadata -or $RevealBridgeLines) {
        $result.fingerprint = $Candidate.fingerprint
        $result.endpoint = $Candidate.endpoint
    }
    if ($RevealBridgeLines) {
        $result.line = $Candidate.line
    }
    return $result
}

function Protect-BridgeCandidateFile {
    param([string]$Path)
    if (-not $Path) {
        throw 'Bridge candidate temporary file path is required.'
    }

    if ($IsWindows -or $env:OS -eq 'Windows_NT') {
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        if (-not $currentUser) {
            throw 'Unable to determine current Windows user for bridge candidate file permissions.'
        }
        & icacls $Path /inheritance:r /grant:r "${currentUser}:F" *> $null
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to restrict temporary bridge candidate file permissions.'
        }
        return
    }

    if (Get-Command chmod -ErrorAction SilentlyContinue) {
        & chmod 600 $Path *> $null
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to restrict temporary bridge candidate file permissions.'
        }
    }
}

function Test-Bridge {
    param(
        [object]$Candidate,
        [int]$Index
    )
    $suffix = "candidate$Index"
    $container = "ielts-bridge-test-$suffix-$([Guid]::NewGuid().ToString('N').Substring(0, 6))"
    $started = $false
    $candidateFile = $null
    $logs = ''
    try {
        $candidateFile = New-TemporaryFile
        Protect-BridgeCandidateFile -Path $candidateFile.FullName
        [System.IO.File]::WriteAllText(
            $candidateFile.FullName,
            ([string]$Candidate.line + [Environment]::NewLine),
            [System.Text.UTF8Encoding]::new($false)
        )
        $bridgeMount = "type=bind,source=$($candidateFile.FullName),target=/tmp/bridge-candidate.txt,readonly"
        $containerId = & docker run -d --name $container --add-host 'app:127.0.0.1' --mount $bridgeMount -e 'TOR_BRIDGES_FILE=/tmp/bridge-candidate.txt' $Image 2>&1
        if ($LASTEXITCODE -ne 0) {
            return New-BridgeResult -Candidate $Candidate -Index $Index -Reachable $false -BootstrapPercent 0 -ErrorText ($containerId -join "`n")
        }
        $started = $true
        $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
        do {
            Start-Sleep -Seconds 3
            $logs = (& docker logs $container 2>&1) -join "`n"
            if ($logs -match 'Bootstrapped 100% \(done\): Done') {
                return New-BridgeResult -Candidate $Candidate -Index $Index -Reachable $true -BootstrapPercent 100 -ErrorText $null
            }
            $state = (& docker inspect --format '{{.State.Running}}' $container 2>&1) -join ''
            if ($LASTEXITCODE -ne 0 -or $state.Trim() -ne 'true') {
                break
            }
        } while ((Get-Date) -lt $deadline)

        return New-BridgeResult `
            -Candidate $Candidate `
            -Index $Index `
            -Reachable $false `
            -BootstrapPercent (Get-LastBootstrapPercent -Logs $logs) `
            -ErrorText (($logs -split "`r?`n" | Select-Object -Last 8) -join ' | ')
    } finally {
        if ($started) {
            & docker rm -f $container *> $null
        }
        if ($candidateFile -and (Test-Path $candidateFile.FullName)) {
            Remove-Item -LiteralPath $candidateFile.FullName -Force
        }
    }
}

$candidates = @(Get-CandidateBridges | Select-Object -First $MaxCandidates)
if ($candidates.Count -eq 0) {
    throw 'No obfs4 bridge candidates found.'
}

$results = for ($index = 0; $index -lt $candidates.Count; $index += 1) {
    Test-Bridge -Candidate $candidates[$index] -Index ($index + 1)
}

$results | ConvertTo-Json -Depth 5
