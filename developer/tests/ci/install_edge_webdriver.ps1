[CmdletBinding()]
param(
    [string]$Destination
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$webViewRoots = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application'),
    (Join-Path $env:ProgramFiles 'Microsoft\EdgeWebView\Application'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\EdgeWebView\Application')
) | Select-Object -Unique

$registryRoots = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients'
)
$registrations = foreach ($root in $registryRoots) {
    if (-not (Test-Path -LiteralPath $root)) {
        continue
    }
    foreach ($key in Get-ChildItem -LiteralPath $root) {
        $properties = Get-ItemProperty -LiteralPath $key.PSPath
        $nameProperty = $properties.PSObject.Properties['name']
        $versionProperty = $properties.PSObject.Properties['pv']
        if (-not $nameProperty -or -not $versionProperty) {
            continue
        }
        if ([string]$nameProperty.Value -notmatch 'WebView2 Runtime') {
            continue
        }
        $versionMatch = [regex]::Match([string]$versionProperty.Value, '\d+\.\d+\.\d+\.\d+')
        if ($versionMatch.Success) {
            $locationProperty = $properties.PSObject.Properties['location']
            [pscustomobject]@{
                Version = $versionMatch.Value
                Location = if ($locationProperty) { [string]$locationProperty.Value } else { '' }
                RegistryKey = $key.Name
            }
        }
    }
}

$runtimes = foreach ($registration in $registrations) {
    $candidateRoots = @()
    if ($registration.Location) {
        $candidateRoots += $registration.Location
    }
    $candidateRoots += $webViewRoots
    foreach ($root in $candidateRoots | Select-Object -Unique) {
        $path = Join-Path $root "$($registration.Version)\msedgewebview2.exe"
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            continue
        }
        $actualMatch = [regex]::Match(
            (Get-Item -LiteralPath $path).VersionInfo.ProductVersion,
            '\d+\.\d+\.\d+\.\d+'
        )
        if ($actualMatch.Success -and $actualMatch.Value -eq $registration.Version) {
            [pscustomobject]@{
                Path = $path
                Version = $registration.Version
                RegistryKey = $registration.RegistryKey
            }
        }
    }
}

$runtime = $runtimes |
    Sort-Object -Property @{ Expression = { [version]$_.Version }; Descending = $true } |
    Select-Object -First 1

if (-not $runtime) {
    throw 'The active EdgeUpdate WebView2 Runtime registration could not be resolved to msedgewebview2.exe.'
}

if (-not $Destination) {
    $Destination = Join-Path $env:RUNNER_TEMP "ielts-atlas-edgedriver-$($runtime.Version)"
}
$Destination = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $Destination -Force | Out-Null

$archive = Join-Path $Destination 'edgedriver_win64.zip'
$downloadUrl = "https://msedgedriver.microsoft.com/$($runtime.Version)/edgedriver_win64.zip"
Invoke-WebRequest -Uri $downloadUrl -OutFile $archive
Expand-Archive -LiteralPath $archive -DestinationPath $Destination -Force

$driver = Get-ChildItem -LiteralPath $Destination -Filter msedgedriver.exe -File -Recurse |
    Select-Object -First 1
if (-not $driver) {
    throw "The official EdgeDriver archive did not contain msedgedriver.exe: $downloadUrl"
}

$driverVersionOutput = (& $driver.FullName --version) -join ' '
$driverVersionMatch = [regex]::Match($driverVersionOutput, '\d+\.\d+\.\d+\.\d+')
if (-not $driverVersionMatch.Success -or $driverVersionMatch.Value -ne $runtime.Version) {
    throw "WebView2/Edge version $($runtime.Version) does not match EdgeDriver output: $driverVersionOutput"
}

$signature = Get-AuthenticodeSignature -LiteralPath $driver.FullName
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "EdgeDriver Authenticode signature is not valid: $($signature.Status)"
}

if ($env:GITHUB_OUTPUT) {
    "driver-path=$($driver.FullName)" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
    "driver-version=$($runtime.Version)" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
    "runtime-path=$($runtime.Path)" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
}

Write-Output "WebView2 runtime: $($runtime.Path)"
Write-Output "EdgeUpdate registration: $($runtime.RegistryKey)"
Write-Output "Matched EdgeDriver: $($driver.FullName) ($($runtime.Version))"
