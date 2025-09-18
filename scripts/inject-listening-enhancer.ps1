Param(
    [string]$ListeningDir = "ListeningPractice",   # 可传相对或绝对路径
    [string]$EnhancerPath,                           # 可传绝对或相对路径到 practice-page-enhancer.js
    [string]$RepoRoot,                               # 可手动指定仓库根（ListeningDir/JS 相对参照）
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-RelativePath([string]$fromDir, [string]$toPath) {
    $fromUri = New-Object System.Uri((Resolve-Path $fromDir).Path + [IO.Path]::DirectorySeparatorChar)
    $toUri   = New-Object System.Uri((Resolve-Path $toPath).Path)
    $relUri  = $fromUri.MakeRelativeUri($toUri)
    # Use forward slashes for HTML src
    return $relUri.ToString()
}

try {
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if ($RepoRoot) {
    $repoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
} else {
    $repoRoot  = Split-Path -Parent $scriptDir
    if (-not $repoRoot) { $repoRoot = (Get-Location).Path }
}

    if ($EnhancerPath) {
        $enhancerPath = (Resolve-Path -LiteralPath $EnhancerPath).Path
    } else {
        $enhancerDir  = Join-Path $repoRoot 'js'
        $enhancerPath = Join-Path $enhancerDir 'practice-page-enhancer.js'
    }
    if (-not (Test-Path -LiteralPath $enhancerPath)) {
        throw "Enhancer not found: $enhancerPath"
    }

    if ([System.IO.Path]::IsPathRooted($ListeningDir)) {
        $targetRoot = $ListeningDir
    } else {
        $targetRoot = Join-Path $repoRoot $ListeningDir
    }
    if (-not (Test-Path -LiteralPath $targetRoot)) {
        throw "Listening directory not found: $targetRoot"
    }

    $htmlFiles = Get-ChildItem -Path $targetRoot -Filter *.html -Recurse -File

    $total   = 0
    $changed = 0
    $skipped = 0
    $errors  = 0

    foreach ($file in $htmlFiles) {
        $total++
        try {
            $content = Get-Content -Raw -Encoding UTF8 -Path $file.FullName

            # 幂等：已包含外链或已定义增强器则跳过
            if ($content -match 'practice-page-enhancer\.js' -or $content -match 'window\.practicePageEnhancer') {
                $skipped++
                Write-Host "[Skip] Already enhanced: $($file.FullName)" -ForegroundColor Yellow
                continue
            }

            $relative = Get-RelativePath -fromDir (Split-Path -Parent $file.FullName) -toPath $enhancerPath
            $snippet  = '<script src="' + $relative + '"></script>'

            $newContent = $null
            if ($content -match '</body>') {
                $newContent = ($content -replace '</body>', ($snippet + "`r`n</body>"))
            } elseif ($content -match '</html>') {
                $newContent = ($content -replace '</html>', ($snippet + "`r`n</html>"))
            } else {
                $newContent = $content + "`r`n" + $snippet + "`r`n"
            }

            if (-not $DryRun) {
                $bakPath = "$($file.FullName).bak"
                if (-not (Test-Path $bakPath)) {
                    Copy-Item -LiteralPath $file.FullName -Destination $bakPath -Force
                }
                Set-Content -Encoding UTF8 -Path $file.FullName -Value $newContent
            }

            $changed++
            Write-Host "[OK] Injected: $($file.FullName) -> $relative" -ForegroundColor Green
        }
        catch {
            $errors++
            Write-Host "[Err] $($file.FullName): $($_.Exception.Message)" -ForegroundColor Red
        }
    }

    Write-Host "`n=== Summary ===" -ForegroundColor Cyan
    Write-Host "Total:   $total"
    Write-Host "Changed: $changed"
    Write-Host "Skipped: $skipped"
    Write-Host "Errors:  $errors"

    if ($DryRun) { Write-Host "(DryRun) No files were modified." -ForegroundColor Yellow }
}
catch {
    Write-Host "Fatal: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
