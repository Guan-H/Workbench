[CmdletBinding()]
param([switch]$IncludeCrypto, [switch]$IncludeSync, [switch]$UsePackagedSync, [string]$FullDiskImage, [string]$ObsidianVault)

$ErrorActionPreference = 'Stop'
if (($UsePackagedSync -or $FullDiskImage -or $ObsidianVault) -and -not $IncludeSync) {
    throw 'UsePackagedSync, FullDiskImage and ObsidianVault require IncludeSync.'
}
if ($FullDiskImage -and $FullDiskImage -notmatch '^eclipse-temurin@sha256:[a-f0-9]{64}$') {
    throw 'FullDiskImage must be a pinned eclipse-temurin digest.'
}
$projectRoot = Split-Path -Parent $PSScriptRoot
if ($UsePackagedSync -and -not (Test-Path -LiteralPath (Join-Path $projectRoot 'sync-client/dist/privatespace-sync-m0/privatespace-sync-m0.exe'))) {
    throw 'Run scripts/build-sync-prototype.ps1 before requesting packaged verification.'
}
$composeFile = Join-Path $projectRoot 'deploy/compose.integration.yml'
$mavenRepository = Join-Path $projectRoot '.m2-cache/repository'
$env:IT_DB_PASSWORD = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
$env:IT_ROOT_PASSWORD = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
$env:IT_DB_USERNAME = 'private_space_it'
$env:IT_INCLUDE_SYNC = if ($IncludeSync) { '1' } else { '0' }
$env:IT_USE_PACKAGED_SYNC = if ($UsePackagedSync) { '1' } else { '0' }
if ($FullDiskImage) { $env:M0_FULL_DISK_IMAGE = $FullDiskImage }
if ($ObsidianVault) { $env:M0_OBSIDIAN_VAULT = $ObsidianVault }

try {
    & docker compose -f $composeFile up -d --wait --wait-timeout 120
    if ($LASTEXITCODE -ne 0) { throw 'Integration MySQL failed to start.' }
    $binding = & docker compose -f $composeFile port mysql 3306
    if ($LASTEXITCODE -ne 0 -or $binding -notmatch '^127\.0\.0\.1:(\d+)$') {
        throw 'Could not resolve the isolated integration database port.'
    }
    $env:IT_DB_URL = "jdbc:mysql://127.0.0.1:$($Matches[1])/private_space_it?useUnicode=true&characterEncoding=utf8&serverTimezone=UTC"
    Push-Location "$projectRoot/backend"
    try {
        $testSelection = if ($IncludeCrypto) { '-Dit.test=RuntimeIT,NotesIT,VaultCryptoIT' } else { '-Dit.test=RuntimeIT,NotesIT' }
        & mvn "-Dmaven.repo.local=$mavenRepository" -P integration $testSelection verify --no-transfer-progress
        if ($LASTEXITCODE -ne 0) { throw 'Real MySQL/HTTP integration verification failed.' }
    } finally {
        Pop-Location
    }
} finally {
    # This project has no persistent volumes and never mounts the development database.
    & docker compose -f $composeFile down
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Integration containers require manual cleanup.' }
    Remove-Item Env:IT_DB_PASSWORD, Env:IT_ROOT_PASSWORD, Env:IT_DB_USERNAME, Env:IT_DB_URL, Env:IT_INCLUDE_SYNC, Env:IT_USE_PACKAGED_SYNC, Env:M0_FULL_DISK_IMAGE, Env:M0_OBSIDIAN_VAULT -ErrorAction SilentlyContinue
}
