[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot 'deploy/.env'

if (-not (Test-Path -LiteralPath $envPath)) {
    # Local credentials are generated once and never printed or committed.
    $password = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
    $rootPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
    $configuration = "MYSQL_DATABASE=private_space`nMYSQL_USER=private_space`nMYSQL_PASSWORD=$password`nMYSQL_ROOT_PASSWORD=$rootPassword`nMYSQL_PORT=3306`n"
    [IO.File]::WriteAllText($envPath, $configuration, [Text.UTF8Encoding]::new($false))
}

& docker compose --env-file $envPath -f "$projectRoot/deploy/compose.dev.yml" up -d --wait --wait-timeout 120
if ($LASTEXITCODE -ne 0) {
    throw 'MySQL did not become ready. Check Docker Desktop, port availability and deploy/.env.'
}
Write-Host 'MySQL is ready. Run scripts/start-backend.ps1 and frontend: npm run dev in separate terminals.'
