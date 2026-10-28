[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$syncProject = Join-Path (Split-Path -Parent $PSScriptRoot) 'sync-client'
Push-Location $syncProject
try {
    $buildPython = Join-Path $syncProject '.venv/Scripts/python.exe'
    if (-not (Test-Path -LiteralPath $buildPython)) {
        & python -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated Python build environment.' }
    }
    & $buildPython -m pip install -r requirements-build.txt
    if ($LASTEXITCODE -ne 0) { throw 'Could not install pinned prototype build dependencies.' }
    & $buildPython -m PyInstaller --noconfirm --onedir --console --name privatespace-sync-m0 --specpath build prototype_entry.py
    if ($LASTEXITCODE -ne 0) { throw 'Windows prototype packaging failed.' }
    & './dist/privatespace-sync-m0/privatespace-sync-m0.exe' --version
    if ($LASTEXITCODE -ne 0) { throw 'Packaged entry point verification failed.' }
} finally {
    Pop-Location
}
