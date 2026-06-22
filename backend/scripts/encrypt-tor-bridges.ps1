param(
    [string]$BridgeFile = '',
    [string]$OutputFile = '',
    [string]$AgeIdentityFile = '',
    [string]$AgePath = 'age',
    [string]$AgeKeygenPath = 'age-keygen',
    [switch]$CreateIdentity,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

if (-not $BridgeFile) {
    $BridgeFile = Join-Path $PSScriptRoot '..\tor\bridges.local.txt'
}
if (-not $OutputFile) {
    $OutputFile = Join-Path $PSScriptRoot '..\tor\bridges.age'
}
if (-not $AgeIdentityFile) {
    $AgeIdentityFile = Join-Path $PSScriptRoot '..\tor\bridge-age-identity.txt'
}

function Resolve-PrivatePath {
    param([string]$PathValue)
    $expanded = [Environment]::ExpandEnvironmentVariables($PathValue)
    if ([System.IO.Path]::IsPathRooted($expanded)) {
        return [System.IO.Path]::GetFullPath($expanded)
    }
    return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $expanded))
}

function Protect-PrivateFile {
    param([string]$Path)
    if (-not $Path) {
        throw 'Private file path is required.'
    }

    if ($IsWindows -or $env:OS -eq 'Windows_NT') {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
        if (-not $identity -or -not $identity.User) {
            throw 'Unable to determine current Windows user for private file permissions.'
        }

        $acl = Get-Acl -LiteralPath $Path
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($rule in @($acl.Access)) {
            $acl.RemoveAccessRuleAll($rule)
        }

        foreach ($sidValue in @($identity.User.Value, 'S-1-5-18', 'S-1-5-32-544')) {
            $sid = [System.Security.Principal.SecurityIdentifier]::new($sidValue)
            $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
                $sid,
                [System.Security.AccessControl.FileSystemRights]::FullControl,
                [System.Security.AccessControl.AccessControlType]::Allow
            )
            $acl.AddAccessRule($rule)
        }
        Set-Acl -LiteralPath $Path -AclObject $acl
        return
    }

    if (Get-Command chmod -ErrorAction SilentlyContinue) {
        & chmod 600 $Path *> $null
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to restrict private file permissions.'
        }
    }
}

function Assert-ToolAvailable {
    param(
        [string]$Tool,
        [string]$Purpose
    )
    if (-not (Get-Command $Tool -ErrorAction SilentlyContinue)) {
        throw "$Tool command is required to $Purpose."
    }
}

$BridgeFile = Resolve-PrivatePath $BridgeFile
$OutputFile = Resolve-PrivatePath $OutputFile
$AgeIdentityFile = Resolve-PrivatePath $AgeIdentityFile

Assert-ToolAvailable -Tool $AgePath -Purpose 'encrypt Tor bridge files'
Assert-ToolAvailable -Tool $AgeKeygenPath -Purpose 'create or read age identities'

if (-not (Test-Path $BridgeFile)) {
    throw "Bridge file does not exist: $BridgeFile"
}
if ((Get-Item -LiteralPath $BridgeFile).Length -le 0) {
    throw "Bridge file is empty: $BridgeFile"
}
if ((Test-Path $OutputFile) -and -not $Force) {
    throw "Output file already exists. Pass -Force to overwrite: $OutputFile"
}

$identityDir = Split-Path -Parent $AgeIdentityFile
if ($identityDir -and -not (Test-Path $identityDir)) {
    New-Item -ItemType Directory -Path $identityDir -Force | Out-Null
}

if (-not (Test-Path $AgeIdentityFile)) {
    if (-not $CreateIdentity) {
        throw "Age identity file does not exist. Pass -CreateIdentity to generate it: $AgeIdentityFile"
    }
    & $AgeKeygenPath -o $AgeIdentityFile *> $null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $AgeIdentityFile)) {
        throw 'Failed to create age identity file.'
    }
    Protect-PrivateFile -Path $AgeIdentityFile
}

$recipientLines = @(& $AgeKeygenPath -y $AgeIdentityFile 2>$null)
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to read recipient from age identity file.'
}
$recipient = ($recipientLines | Where-Object { $_ -match '^age1[0-9a-z]+$' } | Select-Object -First 1)
if (-not $recipient) {
    throw 'Age identity did not produce a valid public recipient.'
}

$outputDir = Split-Path -Parent $OutputFile
if ($outputDir -and -not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$temporaryOutput = "$OutputFile.tmp-$([Guid]::NewGuid().ToString('N'))"
try {
    & $AgePath --encrypt --recipient $recipient --output $temporaryOutput $BridgeFile *> $null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $temporaryOutput)) {
        throw 'Failed to encrypt Tor bridge file.'
    }
    Protect-PrivateFile -Path $temporaryOutput
    Move-Item -LiteralPath $temporaryOutput -Destination $OutputFile -Force
    Protect-PrivateFile -Path $OutputFile
} finally {
    if (Test-Path $temporaryOutput) {
        Remove-Item -LiteralPath $temporaryOutput -Force
    }
}

[pscustomobject]@{
    bridgeFile = $BridgeFile
    encryptedBridgeFile = $OutputFile
    ageIdentityFile = $AgeIdentityFile
    recipient = $recipient
    composeOverride = 'backend/docker-compose.bridges-encrypted.yml'
    env = @{
        TOR_BRIDGES_ENCRYPTED_LOCAL_FILE = $OutputFile
        TOR_BRIDGES_AGE_IDENTITY_LOCAL_FILE = $AgeIdentityFile
    }
} | ConvertTo-Json -Depth 3
