[CmdletBinding()]
param([ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9-]*$')][string]$Variant)

$ErrorActionPreference = 'Stop'
$syncProject = Join-Path (Split-Path -Parent $PSScriptRoot) 'sync-client'
$buildPython = Join-Path $syncProject '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $buildPython)) {
    throw 'Run scripts/build-sync-prototype.ps1 once to prepare the pinned build environment.'
}
Push-Location $syncProject
try {
    $distDirectory = if ($Variant) { "dist/$Variant" } else { 'dist' }
    $buildDirectory = if ($Variant) { "build/$Variant" } else { 'build' }
    $distAbsolute = [IO.Path]::GetFullPath((Join-Path $syncProject $distDirectory))
    $allowedDist = [IO.Path]::GetFullPath((Join-Path $syncProject 'dist'))
    if ($distAbsolute -ne $allowedDist -and -not $distAbsolute.StartsWith($allowedDist + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Build output must remain inside sync-client/dist.'
    }
    & $buildPython -m PyInstaller --noconfirm --onedir --windowed --name privatespace-sync --specpath $buildDirectory --workpath "$buildDirectory/work" --distpath $distDirectory desktop_entry.py
    if ($LASTEXITCODE -ne 0) { throw 'Desktop packaging failed.' }
    $bundleDirectory = Join-Path $distAbsolute 'privatespace-sync'
    $mainExecutable = Join-Path $bundleDirectory 'privatespace-sync.exe'
    if (-not (Test-Path -LiteralPath $mainExecutable)) {
        throw 'Desktop executable is missing.'
    }
    Copy-Item -LiteralPath $mainExecutable -Destination (Join-Path $bundleDirectory '安装同步助手.exe')
    [IO.File]::WriteAllText((Join-Path $bundleDirectory '安装说明.txt'), "首次使用：双击 安装同步助手.exe，点击安装并创建快捷方式。`r`n以后双击桌面或开始菜单中的 私有空间同步助手。`r`n更新前正常退出旧版；配对、队列和同步文件保留。`r`n程序和 _internal 必须一起保留。", [Text.UTF8Encoding]::new($true))
    Write-Host "Desktop executable: $mainExecutable"
    Write-Host "Installer entry: $(Join-Path $bundleDirectory '安装同步助手.exe')"
} finally {
    Pop-Location
}
