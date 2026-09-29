#requires -Version 7.0
<#
.SYNOPSIS
    AuralFlow 桌面端发布：构建 → 签名 → 生成 latest.json → 暂存 dist →（可选）上传 Release。

.DESCRIPTION
    把「构建能自动更新的安装包」这件事固化成一条命令，是因为它有几个容易漏的点，
    任何一处漏掉都会让更新通道**静默失效**（应用只会报「检查更新失败」）：

      1. 构建时必须注入 updater 私钥，否则 createUpdaterArtifacts 直接构建失败；
      2. 必须产出并上传 `*-setup.exe.sig`，否则插件验签不过；
      3. 必须上传 `latest.json`，且其中 `windows-x86_64.signature` 是 .sig 的**文件内容本身**
         （Tauri 官方明确：路径或 URL 无效）；清单里任何一个已列出的平台条目不完整，
         整份清单都会判废；
      4. 清单里的 url 必须与 Release 上资产的实际文件名逐字一致。

    私钥与口令存在 F:\auralflow-secrets\updater-signing.properties（与安卓签名库同目录）。
    该私钥一旦丢失，就再也无法向已安装的用户推送更新，务必备份。

.PARAMETER Version
    要发布的版本号。省略时读 desktop/src-tauri/tauri.conf.json 的当前版本。

.PARAMETER Notes
    写进 latest.json 的英文/中文发布说明（会显示在应用的更新弹窗里）。

.PARAMETER Publish
    带上才会真的 `gh release create/upload`。默认只构建并暂存到 dist/。

.EXAMPLE
    .\desktop\build-release.ps1 -Notes "新增应用内一键更新"
    .\desktop\build-release.ps1 -Publish -Notes "新增应用内一键更新"
#>
param(
    [string]$Version,
    [string]$Notes = "",
    [switch]$Publish
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repo = "0nini00/auralflow"
$secretsDir = "F:\auralflow-secrets"
$propsPath = Join-Path $secretsDir "updater-signing.properties"
$taruiConf = Join-Path $PSScriptRoot "src-tauri\tauri.conf.json"

function Read-Properties([string]$path) {
    if (-not (Test-Path $path)) { throw "找不到签名配置文件：$path" }
    $map = @{}
    foreach ($line in Get-Content $path) {
        if ($line -match '^\s*#') { continue }
        if ($line -match '^\s*([\w.]+)\s*=\s*(.*)$') { $map[$matches[1].Trim()] = $matches[2].Trim() }
    }
    return $map
}

# ── 1. 版本号 ──
$conf = Get-Content $taruiConf -Raw | ConvertFrom-Json
if (-not $Version) { $Version = $conf.version }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "版本号不合法：$Version（应为 x.y.z）" }

Write-Host "=== 发布 AuralFlow v$Version ===" -ForegroundColor Cyan

# 版本号必须四处一致，否则会出现「清单说 0.4.0、装上的却是 0.3.0」这种查不出来的怪事
$versionChecks = @(
    @{ Path = "package.json";                    Pattern = '"version":\s*"(?<v>[^"]+)"' },
    @{ Path = "desktop\package.json";            Pattern = '"version":\s*"(?<v>[^"]+)"' },
    @{ Path = "desktop\src-tauri\tauri.conf.json"; Pattern = '"version":\s*"(?<v>[^"]+)"' },
    @{ Path = "desktop\src-tauri\Cargo.toml";    Pattern = '^version\s*=\s*"(?<v>[^"]+)"' }
)
foreach ($check in $versionChecks) {
    $full = Join-Path $repoRoot $check.Path
    $found = $null
    foreach ($line in Get-Content $full) {
        if ($line -match $check.Pattern) { $found = $matches['v']; break }
    }
    if ($found -ne $Version) { throw "版本号不一致：$($check.Path) 是 $found，期望 $Version" }
}
Write-Host "版本号四处一致 ✓"

# ── 2. 签名密钥 ──
$props = Read-Properties $propsPath
$keyPath = $props["keyPath"]
if (-not $keyPath -or -not (Test-Path $keyPath)) { throw "私钥不存在：$keyPath（配置于 $propsPath）" }
# 只设 TAURI_SIGNING_PRIVATE_KEY，且给**内容**而不是路径。这是官方文档写的形式
# （"Path or content of your private key"），两个读取方都接受。踩过的两个坑：
#   1) 给它路径时，CLI 的 signer 子命令会把 "F:" 当 base64 解码，报 `Invalid symbol 58, offset 1`；
#   2) 再补一个 TAURI_SIGNING_PRIVATE_KEY_PATH 也不行——两者互斥，signer 会报
#      `the argument '--private-key' cannot be used with '--private-key-path'`。
# 因此打包阶段（tauri-bundler）与 CLI 子命令共用同一个变量，下面那步预检才有意义。
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $keyPath -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [string]$props["password"]

# 预检：用同一套环境变量先签一个临时文件。密钥 / 口令 / 注入方式任一不对都在几秒内
# 失败，而不是等十几分钟编译完、在打包阶段才炸。
$probe = Join-Path $env:TEMP "auralflow-signer-probe.txt"
Set-Content -Path $probe -Value "signer probe" -Encoding ascii -NoNewline
Remove-Item "$probe.sig" -ErrorAction SilentlyContinue
Push-Location $repoRoot
try {
    $probeOut = & pnpm --filter @auralflow/desktop exec tauri signer sign $probe 2>&1
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$probe.sig")) {
        $probeOut | ForEach-Object { Write-Host "    $_" }
        throw "签名预检失败：私钥 / 口令 / 环境变量注入方式不对"
    }
} finally {
    Pop-Location
    Remove-Item $probe, "$probe.sig" -ErrorAction SilentlyContinue
}
Write-Host "签名密钥预检通过 ✓（路径与口令不回显）"

# ── 3. 构建 ──
Push-Location $repoRoot
try {
    & pnpm desktop:tauri:build
    if ($LASTEXITCODE -ne 0) { throw "Tauri 构建失败，退出码 $LASTEXITCODE" }
} finally {
    Pop-Location
}

# ── 4. 收包 ──
$nsisDir = Join-Path $PSScriptRoot "src-tauri\target\release\bundle\nsis"
$setup = Get-ChildItem -LiteralPath $nsisDir -Filter "*_$($Version)_*-setup.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike "*.sig" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { throw "构建完成但没找到 NSIS 安装包：$nsisDir" }

$sigPath = "$($setup.FullName).sig"
if (-not (Test-Path $sigPath)) { throw "缺少签名文件：$sigPath（检查 createUpdaterArtifacts 与签名环境变量）" }
$signature = (Get-Content $sigPath -Raw).Trim()
if (-not $signature) { throw "签名文件是空的：$sigPath" }

$portable = Join-Path $PSScriptRoot "src-tauri\target\release\auralflow.exe"
if (-not (Test-Path $portable)) { throw "没找到便携版可执行文件：$portable" }

# ── 5. 暂存 dist（资产名即清单里的 url，必须一致）──
$dist = Join-Path $repoRoot "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null

$assetSetup = "AuralFlow-v$Version-windows-x64-setup.exe"
$assetPortable = "AuralFlow-v$Version-windows-x64-portable.exe"
Copy-Item $setup.FullName (Join-Path $dist $assetSetup) -Force
Copy-Item $portable (Join-Path $dist $assetPortable) -Force

$url = "https://github.com/$repo/releases/download/v$Version/$assetSetup"
$manifest = [ordered]@{
    version   = $Version
    notes     = $Notes
    pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = $signature
            url       = $url
        }
    }
}
$manifestPath = Join-Path $dist "latest.json"
$manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath -Encoding utf8NoBOM

# 自检：清单必须是插件能接受的样子（半成品清单会被整份判废，症状是「检查更新失败」）
$check = Get-Content $manifestPath -Raw | ConvertFrom-Json
$entry = $check.platforms.'windows-x86_64'
if (-not $check.version -or -not $entry.signature -or -not $entry.url) {
    throw "latest.json 不完整：version/signature/url 三项都必须有"
}
if ($signature.Length -lt 64) { throw "签名看起来不合法（长度 $($signature.Length)）" }
Write-Host "latest.json 自检通过 ✓"

Write-Host ""
Write-Host "=== 产物 ===" -ForegroundColor Cyan
foreach ($f in @($assetSetup, $assetPortable, "latest.json")) {
    $full = Join-Path $dist $f
    $size = [math]::Round((Get-Item $full).Length / 1MB, 2)
    $hash = (Get-FileHash $full -Algorithm SHA256).Hash
    Write-Host ("  {0,-46} {1,8} MB  sha256={2}" -f $f, $size, $hash.Substring(0, 16))
}

# ── 6. 上传 ──
if ($Publish) {
    Write-Host ""
    Write-Host "=== 上传 Release v$Version ===" -ForegroundColor Cyan
    $tag = "v$Version"
    $existing = & gh release view $tag --repo $repo 2>$null
    if ($LASTEXITCODE -ne 0) {
        $notesFile = Join-Path $env:TEMP "auralflow-release-notes-$Version.md"
        $body = if ($Notes) { $Notes } else { "AuralFlow v$Version" }
        Set-Content -Path $notesFile -Value $body -Encoding utf8NoBOM
        & gh release create $tag --repo $repo --title "AuralFlow v$Version" --notes-file $notesFile
        if ($LASTEXITCODE -ne 0) { throw "创建 Release 失败" }
    } else {
        Write-Host "Release $tag 已存在，直接覆盖上传资产"
    }
    foreach ($f in @($assetSetup, $assetPortable, "latest.json")) {
        & gh release upload $tag (Join-Path $dist $f) --repo $repo --clobber
        if ($LASTEXITCODE -ne 0) { throw "上传 $f 失败" }
    }
    Write-Host "已上传：https://github.com/$repo/releases/tag/$tag" -ForegroundColor Green
    Write-Host "提醒：确认 https://github.com/$repo/releases/latest 返回的是 v$Version" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "（未加 -Publish，只构建并暂存到 dist/。加 -Publish 才会创建并上传 Release。）"
}
