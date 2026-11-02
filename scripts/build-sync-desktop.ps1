[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$syncProject = Join-Path (Split-Path -Parent $PSScriptRoot) 'sync-client'
$buildPython = Join-Path $syncProject '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $buildPython)) {
    throw 'Run scripts/build-sync-prototype.ps1 once to prepare the pinned build environment.'
}
Push-Location $syncProject
try {
    & $buildPython -m PyInstaller --noconfirm --onedir --windowed --name privatespace-sync --specpath build desktop_entry.py
    if ($LASTEXITCODE -ne 0) { throw 'Desktop packaging failed.' }
    if (-not (Test-Path -LiteralPath './dist/privatespace-sync/privatespace-sync.exe')) {
        throw 'Desktop executable is missing.'
    }
    Write-Host 'Desktop executable: sync-client/dist/privatespace-sync/privatespace-sync.exe'
} finally {
    Pop-Location
}
