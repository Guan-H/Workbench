[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot 'deploy/.env'
if (-not (Test-Path -LiteralPath $envPath)) {
    throw 'Run scripts/start-local.ps1 first to prepare local MySQL and credentials.'
}
$settings = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match '^([A-Z_]+)=(.*)$') {
        $settings[$Matches[1]] = $Matches[2]
    }
}
foreach ($name in @('MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_PORT')) {
    if ([string]::IsNullOrWhiteSpace($settings[$name])) { throw "Missing $name in deploy/.env" }
}
if ($settings.MYSQL_PASSWORD -eq 'change-this-local-password') {
    throw 'Replace example passwords in deploy/.env, or use start-local.ps1 to generate a new local configuration.'
}
$env:DB_URL = "jdbc:mysql://127.0.0.1:$($settings.MYSQL_PORT)/$($settings.MYSQL_DATABASE)?useUnicode=true&characterEncoding=utf8&serverTimezone=UTC"
$env:DB_USERNAME = $settings.MYSQL_USER
$env:DB_PASSWORD = $settings.MYSQL_PASSWORD
$env:PRIVATE_SPACE_STORAGE_PATH = Join-Path $projectRoot 'data/objects'
$setupPath = Join-Path $projectRoot 'deploy/setup-token.local'
if (-not (Test-Path -LiteralPath $setupPath)) {
    $setupCredential = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
    [IO.File]::WriteAllText($setupPath, $setupCredential, [Text.UTF8Encoding]::new($false))
}
$env:PRIVATE_SPACE_SETUP_TOKEN = [IO.File]::ReadAllText($setupPath).Trim()
Write-Host 'If this is the first run, open deploy/setup-token.local and enter that one-time credential in the initialization page.'
$mavenRepository = Join-Path $projectRoot '.m2-cache/repository'

Push-Location "$projectRoot/backend"
try {
    & mvn "-Dmaven.repo.local=$mavenRepository" spring-boot:run
    if ($LASTEXITCODE -ne 0) { throw 'Backend exited unsuccessfully.' }
} finally {
    Pop-Location
}
