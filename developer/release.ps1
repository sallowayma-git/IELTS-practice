<#
IELTS Practice App - Windows Release Script
Path: developer/release.ps1

Usage:
  powershell -ExecutionPolicy Bypass -File developer/release.ps1
  powershell -ExecutionPolicy Bypass -File developer/release.ps1 1.0.0

Output:
  dist/ielts-practice-{version}.zip

The archive contains runtime files only. Users can extract it and open
index.html directly with the file:// protocol; Node.js is not required after
release packaging.
#>

param(
    [Parameter(Position = 0)]
    [string]$Version
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir '..')).Path
Set-Location $ProjectRoot

function Get-ReleaseVersion {
    param([string]$RequestedVersion)

    if (-not [string]::IsNullOrWhiteSpace($RequestedVersion)) {
        return $RequestedVersion
    }

    if (Get-Command git -ErrorAction SilentlyContinue) {
        & git rev-parse --git-dir *> $null
        if ($LASTEXITCODE -eq 0) {
            $described = & git describe --tags --always --dirty 2>$null
            if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($described)) {
                return $described.Trim()
            }
        }
    }

    return 'snapshot'
}

function ConvertTo-ZipPath {
    param([string]$RelativePath)
    return ($RelativePath -replace '\\', '/').TrimStart('/')
}

function Join-RelativePath {
    param(
        [string]$BasePath,
        [string]$ChildPath
    )

    $baseFullPath = [System.IO.Path]::GetFullPath($BasePath)
    $childFullPath = [System.IO.Path]::GetFullPath($ChildPath)
    if (-not $baseFullPath.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $baseFullPath += [System.IO.Path]::DirectorySeparatorChar
    }

    $baseUri = [System.Uri]::new($baseFullPath)
    $childUri = [System.Uri]::new($childFullPath)
    $relative = [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($childUri).ToString())
    return ConvertTo-ZipPath $relative
}

function Test-ZipExcluded {
    param(
        [string]$EntryName,
        [bool]$IsDirectory,
        [bool]$IncludeLocalListening
    )

    $entry = $EntryName.TrimEnd('/')
    $name = Split-Path -Leaf $entry

    if (-not $IsDirectory) {
        if ($name -eq '.DS_Store') { return $true }
        if ($name -like '~$*') { return $true }

        $extension = [System.IO.Path]::GetExtension($name)
        if ($extension -in @('.MOV', '.mov', '.MP4', '.mp4', '.md', '.py')) { return $true }
    }

    if ($entry -eq '.gitignore') { return $true }
    if ($entry -eq '.git' -or $entry.StartsWith('.git/', [System.StringComparison]::Ordinal)) { return $true }
    if ($entry -eq '.claude' -or $entry.StartsWith('.claude/', [System.StringComparison]::Ordinal)) { return $true }
    if ($entry -eq 'node_modules' -or $entry.StartsWith('node_modules/', [System.StringComparison]::Ordinal)) { return $true }
    if ($entry -eq 'assets/developer' -or $entry.StartsWith('assets/developer/', [System.StringComparison]::Ordinal)) { return $true }

    if (-not $IncludeLocalListening) {
        if ($entry -eq 'assets/generated/listening-exams' -or $entry.StartsWith('assets/generated/listening-exams/', [System.StringComparison]::Ordinal)) { return $true }
        if ($entry -eq 'ListeningPractice' -or $entry.StartsWith('ListeningPractice/', [System.StringComparison]::Ordinal)) { return $true }
    }

    return $false
}

function Add-ZipDirectoryEntry {
    param(
        [System.IO.Compression.ZipArchive]$Archive,
        [string]$EntryName,
        [System.Collections.Generic.HashSet[string]]$SeenEntries
    )

    $directoryEntry = $EntryName.TrimEnd('/') + '/'
    if ($SeenEntries.Add($directoryEntry)) {
        [void]$Archive.CreateEntry($directoryEntry)
    }
}

function Add-ZipFileEntry {
    param(
        [System.IO.Compression.ZipArchive]$Archive,
        [string]$SourcePath,
        [string]$EntryName,
        [System.Collections.Generic.HashSet[string]]$SeenEntries
    )

    if ($SeenEntries.Add($EntryName)) {
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $Archive,
            $SourcePath,
            $EntryName,
            [System.IO.Compression.CompressionLevel]::Optimal
        )
    }
}

function Add-ZipInput {
    param(
        [System.IO.Compression.ZipArchive]$Archive,
        [string]$InputPath,
        [string]$RootPath,
        [bool]$IncludeLocalListening,
        [System.Collections.Generic.HashSet[string]]$SeenEntries
    )

    $fullPath = Join-Path $RootPath $InputPath
    if (-not (Test-Path -LiteralPath $fullPath)) {
        return
    }

    $item = Get-Item -LiteralPath $fullPath
    if (-not $item.PSIsContainer) {
        $entryName = ConvertTo-ZipPath $InputPath
        if (-not (Test-ZipExcluded $entryName $false $IncludeLocalListening)) {
            Add-ZipFileEntry $Archive $item.FullName $entryName $SeenEntries
        }
        return
    }

    $rootEntry = ConvertTo-ZipPath $InputPath
    if (-not (Test-ZipExcluded $rootEntry $true $IncludeLocalListening)) {
        Add-ZipDirectoryEntry $Archive $rootEntry $SeenEntries
    }

    Get-ChildItem -LiteralPath $item.FullName -Recurse -Force | ForEach-Object {
        $entryName = Join-RelativePath $RootPath $_.FullName
        if (Test-ZipExcluded $entryName $_.PSIsContainer $IncludeLocalListening) {
            return
        }

        if ($_.PSIsContainer) {
            Add-ZipDirectoryEntry $Archive $entryName $SeenEntries
        } else {
            Add-ZipFileEntry $Archive $_.FullName $entryName $SeenEntries
        }
    }
}

function Require-ZipEntry {
    param(
        [string[]]$Entries,
        [string]$EntryName
    )

    if ($EntryName -notin $Entries) {
        throw "release zip missing required entry: $EntryName"
    }
}

function Reject-ZipEntryPrefix {
    param(
        [string[]]$Entries,
        [string]$Prefix
    )

    $matches = $Entries | Where-Object { $_.StartsWith($Prefix, [System.StringComparison]::Ordinal) } | Select-Object -First 20
    if ($matches) {
        throw "release zip contains forbidden path prefix: $Prefix`n$($matches -join "`n")"
    }
}

function Reject-ZipEntryPattern {
    param(
        [string[]]$Entries,
        [string]$Pattern
    )

    $matches = $Entries | Where-Object { [regex]::IsMatch($_, $Pattern) } | Select-Object -First 20
    if ($matches) {
        throw "release zip contains forbidden entries matching: $Pattern`n$($matches -join "`n")"
    }
}

function Format-ReleaseSize {
    param([long]$Bytes)

    if ($Bytes -ge 1GB) { return ('{0:N1} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N1} MB' -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ('{0:N1} KB' -f ($Bytes / 1KB)) }
    return "$Bytes B"
}

$Version = Get-ReleaseVersion $Version
$Version = [regex]::Replace($Version, '[^A-Za-z0-9._-]', '-')

$DistDir = Join-Path $ProjectRoot 'dist'
$ZipName = "ielts-practice-$Version.zip"
$ZipPath = Join-Path $DistDir $ZipName
$IncludeLocalListening = $env:INCLUDE_LOCAL_LISTENING -eq '1'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'node is required to build release bundles.'
}

Write-Host '============================================'
Write-Host ' IELTS Practice App - Windows Release Builder'
Write-Host " Version : $Version"
Write-Host " Output  : dist/$ZipName"
Write-Host '============================================'

Write-Host ''
Write-Host '[1/2] Building bundles...'
$BuildScript = Join-Path $ProjectRoot 'scripts/build-bundles.mjs'
if (-not (Test-Path -LiteralPath $BuildScript)) {
    throw 'scripts/build-bundles.mjs not found.'
}

& node $BuildScript
if ($LASTEXITCODE -ne 0) {
    throw "bundle build failed with exit code $LASTEXITCODE"
}
Write-Host '       Bundles generated: js/bundles/'

Write-Host ''
Write-Host '[2/2] Creating distribution zip...'

if (Test-Path -LiteralPath $DistDir) {
    Remove-Item -LiteralPath $DistDir -Recurse -Force
}
[void](New-Item -ItemType Directory -Path $DistDir)

$zipInputs = [System.Collections.Generic.List[string]]::new()
@('index.html', 'css', 'js/bundles', 'assets', 'ReadingPractice') | ForEach-Object {
    $zipInputs.Add($_)
}

if ($IncludeLocalListening) {
    $manifestPath = Join-Path $ProjectRoot 'assets/generated/listening-exams/manifest.js'
    $compatPath = Join-Path $ProjectRoot 'assets/generated/listening-exams/listening-index.compat.js'
    if (-not (Test-Path -LiteralPath $manifestPath) -or -not (Test-Path -LiteralPath $compatPath)) {
        throw 'INCLUDE_LOCAL_LISTENING=1 requires both assets/generated/listening-exams/manifest.js and listening-index.compat.js'
    }

    foreach ($part in @('P1', 'P2', 'P3', 'P4')) {
        $partPath = Join-Path $ProjectRoot "ListeningPractice/$part"
        if (Test-Path -LiteralPath $partPath) {
            $zipInputs.Add("ListeningPractice/$part")
        }
    }
}

$archive = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $seenEntries = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($inputPath in $zipInputs) {
        Add-ZipInput $archive $inputPath $ProjectRoot $IncludeLocalListening $seenEntries
    }
} finally {
    $archive.Dispose()
}

$verifyArchive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
    $zipEntries = @($verifyArchive.Entries | ForEach-Object { $_.FullName })
} finally {
    $verifyArchive.Dispose()
}

Require-ZipEntry $zipEntries 'index.html'
Require-ZipEntry $zipEntries 'css/main.css'
Require-ZipEntry $zipEntries 'css/heroui-bridge.css'
Require-ZipEntry $zipEntries 'css/onboarding.css'
Require-ZipEntry $zipEntries 'assets/vendor/three.min.js'
Require-ZipEntry $zipEntries 'assets/generated/reading-exams/manifest.js'
Require-ZipEntry $zipEntries 'assets/generated/reading-exams/reading-practice-unified.html'
Require-ZipEntry $zipEntries 'js/bundles/runtime-entry.bundle.js'
Require-ZipEntry $zipEntries 'js/bundles/core-foundation.bundle.js'
Require-ZipEntry $zipEntries 'js/bundles/ui-shell.bundle.js'
Require-ZipEntry $zipEntries 'js/bundles/legacy-app.bundle.js'
Require-ZipEntry $zipEntries 'js/bundles/browse.bundle.js'
Require-ZipEntry $zipEntries 'js/bundles/practice.bundle.js'
Require-ZipEntry $zipEntries 'js/bundles/session.bundle.js'
Require-ZipEntry $zipEntries 'js/bundles/settings.bundle.js'
Require-ZipEntry $zipEntries 'js/bundles/diagnostics.bundle.js'
Require-ZipEntry $zipEntries 'js/bundles/more.bundle.js'
Require-ZipEntry $zipEntries 'js/bundles/theme.bundle.js'
Require-ZipEntry $zipEntries 'js/bundles/reading-page.bundle.js'
Require-ZipEntry $zipEntries 'js/bundles/practice-page-enhancer.bundle.js'
Require-ZipEntry $zipEntries 'js/bundles/listening-record-bridge.bundle.js'

if ($IncludeLocalListening -and (Test-Path -LiteralPath (Join-Path $ProjectRoot 'assets/generated/listening-exams/manifest.js'))) {
    Require-ZipEntry $zipEntries 'assets/generated/listening-exams/manifest.js'
    Require-ZipEntry $zipEntries 'assets/generated/listening-exams/listening-index.compat.js'
} else {
    Reject-ZipEntryPrefix $zipEntries 'assets/generated/listening-exams/'
}

if ($IncludeLocalListening -and (Test-Path -LiteralPath (Join-Path $ProjectRoot 'ListeningPractice'))) {
    foreach ($part in @('P1', 'P2', 'P3', 'P4')) {
        if (Test-Path -LiteralPath (Join-Path $ProjectRoot "ListeningPractice/$part")) {
            Require-ZipEntry $zipEntries "ListeningPractice/$part/"
        }
    }
}

Reject-ZipEntryPrefix $zipEntries 'templates/'
Reject-ZipEntryPrefix $zipEntries 'ListeningPractice/vip/'
Reject-ZipEntryPattern $zipEntries '(^|/)~\$[^/]*$'
Reject-ZipEntryPattern $zipEntries '^ListeningPractice/.*\.(MOV|mov|MP4|mp4)$'
Reject-ZipEntryPattern $zipEntries '^assets/scripts/.*\.py$'
Reject-ZipEntryPattern $zipEntries '^js/(app|core|data|runtime|services|utils|components|presentation|views)/'

$zipSize = Format-ReleaseSize (Get-Item -LiteralPath $ZipPath).Length

Write-Host ''
Write-Host '============================================'
Write-Host " Done: dist/$ZipName"
Write-Host " Size : $zipSize"
Write-Host ''
Write-Host ' Extract the archive and open index.html directly.'
Write-Host ' No Node.js or build tools are required after packaging.'
Write-Host '============================================'
