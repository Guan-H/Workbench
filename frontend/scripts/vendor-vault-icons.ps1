[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
# Explicit asset refresh only. Application startup never downloads platform logos.
$iconRevision = 'e451c581fccb01b56f47e1a77292bdd1fd95b1a4'
$iconNames = @('x', 'youtube', 'bilibili', 'sinaweibo', 'tiktok', 'wechat', 'qq', 'zhihu', 'xiaohongshu', 'github', 'google', 'apple', 'facebook', 'instagram', 'telegram', 'discord', 'reddit', 'steam', 'gitlab', 'claude', 'googlegemini', 'deepseek', 'perplexity')
$iconDestination = Join-Path (Split-Path -Parent $PSScriptRoot) 'src/modules/vault/icons'
$iconBase = "https://raw.githubusercontent.com/simple-icons/simple-icons/$iconRevision/"
$iconResources = foreach ($iconName in $iconNames) {
    $svg = (Invoke-WebRequest ($iconBase + "icons/$iconName.svg") -TimeoutSec 30).Content
    if ($svg -is [byte[]]) { $svg = [Text.Encoding]::UTF8.GetString($svg) }
    if ($svg -notmatch '^<svg\b' -or $svg -match '\b(?:href|src|on[a-z]+)\s*=|<(?:script|image|foreignObject|style|use)\b') {
        throw "Unexpected active SVG content: $iconName"
    }
    foreach ($tag in [regex]::Matches($svg, '<\/?([a-zA-Z][\w:-]*)')) {
        if ($tag.Groups[1].Value -notin @('svg', 'title', 'path')) { throw "Unexpected SVG tag: $iconName" }
    }
    @{ name = $iconName; svg = $svg; sha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($svg))).ToLowerInvariant() }
}
# The current upstream removed OpenAI; use the verified, separately attributed CC0 v14 snapshot.
$openaiRevision = '6dcfdc2f58f6150d7b097b5cab158d27413f6366'
$openaiSvg = (Invoke-WebRequest "https://raw.githubusercontent.com/simple-icons/simple-icons/$openaiRevision/icons/openai.svg" -TimeoutSec 30).Content
if ($openaiSvg -is [byte[]]) { $openaiSvg = [Text.Encoding]::UTF8.GetString($openaiSvg) }
if ($openaiSvg -notmatch '^<svg\b' -or $openaiSvg -match '\b(?:href|src|on[a-z]+)\s*=|<(?:script|image|foreignObject|style|use)\b') { throw 'Unexpected OpenAI SVG content' }
foreach ($tag in [regex]::Matches($openaiSvg, '<\/?([a-zA-Z][\w:-]*)')) { if ($tag.Groups[1].Value -notin @('svg', 'title', 'path')) { throw 'Unexpected OpenAI SVG tag' } }
$iconResources += @{ name = 'openai'; svg = $openaiSvg; sha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($openaiSvg))).ToLowerInvariant(); revision = $openaiRevision }
$iconLicense = (Invoke-WebRequest ($iconBase + 'LICENSE.md') -TimeoutSec 30).Content
if (-not $iconLicense.StartsWith('# CC0 1.0 Universal')) { throw 'Unexpected icon license' }
$legacyIconLicense = (Invoke-WebRequest "https://raw.githubusercontent.com/simple-icons/simple-icons/$openaiRevision/LICENSE.md" -TimeoutSec 30).Content
if (-not $legacyIconLicense.StartsWith('# CC0 1.0 Universal')) { throw 'Unexpected legacy icon license' }
New-Item -ItemType Directory -Path $iconDestination -Force | Out-Null
foreach ($resource in $iconResources) {
    [IO.File]::WriteAllText((Join-Path $iconDestination ($resource.name + '.svg')), $resource.svg, [Text.UTF8Encoding]::new($false))
}
[IO.File]::WriteAllText((Join-Path $iconDestination 'LICENSE.simple-icons.md'), $iconLicense, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $iconDestination 'LICENSE.simple-icons-v14.md'), $legacyIconLicense, [Text.UTF8Encoding]::new($false))
$iconManifest = @{ repository = 'https://github.com/simple-icons/simple-icons'; revision = $iconRevision; icons = @($iconResources | ForEach-Object { @{ name = $_.name; sha256 = $_.sha256; revision = $(if ($_.revision) { $_.revision } else { $iconRevision }) } }) }
[IO.File]::WriteAllText((Join-Path $iconDestination 'sources.json'), ($iconManifest | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
Write-Output "Vendored $($iconResources.Count) pinned SVG resources; Douyin and TikTok share a musical-note glyph with separate choices."
