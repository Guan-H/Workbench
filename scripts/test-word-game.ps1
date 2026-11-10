[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $projectRoot 'deploy/compose.integration.yml'
$previewProject = "workbench-word-game-it-$PID"
$env:IT_DB_PASSWORD = [Guid]::NewGuid().ToString('N')
$env:IT_ROOT_PASSWORD = [Guid]::NewGuid().ToString('N')
$env:IT_DB_USERNAME = 'private_space_it'
try {
    & docker compose -p $previewProject -f $composeFile up -d --wait --wait-timeout 120
    if ($LASTEXITCODE -ne 0) { throw 'Isolated word-game MySQL failed to start.' }
    $binding = & docker compose -p $previewProject -f $composeFile port mysql 3306
    if ($LASTEXITCODE -ne 0 -or $binding -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'Missing isolated MySQL port.' }
    $env:IT_DB_URL = "jdbc:mysql://127.0.0.1:$($Matches[1])/private_space_it?useUnicode=true&characterEncoding=utf8&serverTimezone=UTC"
    Push-Location (Join-Path $projectRoot 'backend')
    try {
        & mvn "-Dmaven.repo.local=$projectRoot/.m2-cache/repository" -P integration '-Dit.test=WordGameIT' test-compile failsafe:integration-test failsafe:verify --no-transfer-progress
        if ($LASTEXITCODE -ne 0) { throw 'Real word-game verification failed.' }
    } finally { Pop-Location }
} finally {
    # This uniquely named test project has tmpfs storage and never mounts the development database.
    & docker compose -p $previewProject -f $composeFile down
    Remove-Item Env:IT_DB_PASSWORD, Env:IT_ROOT_PASSWORD, Env:IT_DB_USERNAME, Env:IT_DB_URL -ErrorAction SilentlyContinue
}
