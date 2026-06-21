param(
    [string[]]$Path = @(
        (Join-Path $PSScriptRoot '..\logs\site-health.jsonl'),
        (Join-Path $PSScriptRoot '..\logs\site-health-alerts.log')
    ),
    [switch]$InPlace
)

$REDACTION_PATTERNS = @(
    @{
        Name = 'bridgeLines'
        Pattern = 'obfs4\s+\S+\s+[A-Fa-f0-9]{40}\s+[^|,\r\n]*\bcert=\S+[^|,\r\n]*'
        Replacement = 'obfs4 [bridge-line-hidden]'
    },
    @{
        Name = 'bridgeCerts'
        Pattern = 'cert=\S+'
        Replacement = 'cert=[hidden]'
    },
    @{
        Name = 'onionHostnames'
        Pattern = '\b[a-z2-7]{56}\.onion\b'
        Replacement = '[onion-hostname-hidden]'
    },
    @{
        Name = 'bridgeFingerprints'
        Pattern = '\b[A-Fa-f0-9]{40}\b'
        Replacement = '[bridge-fingerprint-hidden]'
    }
)

function New-CountMap {
    $map = [ordered]@{}
    foreach ($entry in $REDACTION_PATTERNS) {
        $map[$entry.Name] = 0
    }
    return $map
}

function Redact-HealthLogLine {
    param(
        [string]$Line,
        [System.Collections.IDictionary]$Counts
    )

    $safe = $Line
    foreach ($entry in $REDACTION_PATTERNS) {
        $matches = [regex]::Matches($safe, $entry.Pattern)
        if ($matches.Count -gt 0) {
            $Counts[$entry.Name] += $matches.Count
            $safe = [regex]::Replace($safe, $entry.Pattern, $entry.Replacement)
        }
    }
    return $safe
}

function Redact-HealthLogFile {
    param([string]$FilePath)

    $resolved = Resolve-Path -LiteralPath $FilePath -ErrorAction SilentlyContinue
    if (-not $resolved) {
        return [ordered]@{
            path = $FilePath
            exists = $false
            changed = $false
            inPlace = [bool]$InPlace
            counts = New-CountMap
        }
    }

    $fullPath = $resolved.Path
    $counts = New-CountMap
    $changed = $false
    $temporaryPath = "$fullPath.redacted.tmp"
    $writer = if ($InPlace) {
        [System.IO.StreamWriter]::new($temporaryPath, $false, [System.Text.UTF8Encoding]::new($false))
    } else {
        $null
    }

    try {
        foreach ($line in [System.IO.File]::ReadLines($fullPath)) {
            $redacted = Redact-HealthLogLine -Line $line -Counts $counts
            if ($redacted -ne $line) {
                $changed = $true
            }
            if ($writer) {
                $writer.WriteLine($redacted)
            }
        }
    } finally {
        if ($writer) {
            $writer.Dispose()
        }
    }

    if ($InPlace) {
        if ($changed) {
            Move-Item -LiteralPath $temporaryPath -Destination $fullPath -Force
        } elseif (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }

    return [ordered]@{
        path = $fullPath
        exists = $true
        changed = $changed
        inPlace = [bool]$InPlace
        counts = $counts
    }
}

$reports = foreach ($file in $Path) {
    Redact-HealthLogFile -FilePath $file
}

$reports | ConvertTo-Json -Depth 5
