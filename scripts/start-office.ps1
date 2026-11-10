[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$configuration = Join-Path $project 'deploy/office.local'
if (!(Test-Path -LiteralPath $configuration)) {
    # This digest was verified as ONLYOFFICE Docs 10.0.0-169; upgrades are explicit changes.
    $image = 'onlyoffice/documentserver@sha256:ca17889f10b11141cc6441836aebdd2835cf3e1b49681b2fd6e155c94b7850b3'
    & docker pull $image
    if ($LASTEXITCODE -ne 0) { throw 'Could not obtain the local document server image.' }
    $secret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    [IO.File]::WriteAllText($configuration, "ONLYOFFICE_IMAGE=$image`nONLYOFFICE_JWT_SECRET=$secret`n", [Text.UTF8Encoding]::new($false))
}
& docker compose --env-file $configuration -f (Join-Path $project 'deploy/compose.office.yml') up -d --wait --wait-timeout 480
if ($LASTEXITCODE -ne 0) { throw 'Document service is not ready. Existing files and volumes were not removed.' }
Write-Output 'Local document service ready on http://127.0.0.1:8082. Restart the backend to load its matching local settings.'
