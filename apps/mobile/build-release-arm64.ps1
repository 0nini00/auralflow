param(
    [string]$Abi = "arm64-v8a"
)

$ErrorActionPreference = "Stop"

$projectDir = Join-Path $PSScriptRoot "android"
$apkDir = Join-Path $projectDir "app\build\outputs\apk\release"
$apkAltDir = Join-Path $projectDir "app\build\outputs\apk-alt"

# 构建前清空 ABI 分包输出:四架构分包时间戳相同,按 LastWriteTime 取「最新」会取到
# 别的架构;混着上一次构建的产物也会让 apk-alt 里留下旧包。
#
# 由此推出一条硬约束(踩过):**一次调用只构建一个 ABI,并在本次调用内取包**。
# 连着跑两个 ABI 再统一取包,会取到非当前 ABI 那个残缺的分包(见文件末尾的断言)。
foreach ($dir in @($apkDir, $apkAltDir)) {
    if (Test-Path -LiteralPath $dir) {
        Remove-Item -LiteralPath $dir -Recurse -Force
    }
}

Push-Location $projectDir
try {
    # 必须用双引号插值:PSNativeCommandArgumentPassing=Windows 模式下,调用 .bat 时
    # 裸词参数里的 $var 会原样透传不展开(实测 Gradle 收到字面量 "$Abi" 导致 CXX1201),
    # 双引号字符串会在调用前完成插值。
    & .\gradlew.bat assembleRelease "-PreactNativeArchitectures=$Abi" --no-daemon --console=plain
    if ($LASTEXITCODE -ne 0) {
        throw "Gradle release 构建失败,退出码: $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

# 按 ABI 文件名精确取包:app-<abi>-release.apk(universal 为 app-release.apk)。
# build.gradle 已把各 ABI 分包复制到 apk-alt,优先在那里按名字取,避免四个分包时间戳相同
# 导致的选包错误。
$expectedName = "app-$Abi-release.apk"
$candidates = @(
    (Join-Path $apkAltDir $expectedName),
    (Join-Path $apkDir $expectedName)
)
$apk = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $apk) {
    $available = @()
    foreach ($dir in @($apkAltDir, $apkDir)) {
        if (Test-Path -LiteralPath $dir) {
            $available += (Get-ChildItem -LiteralPath $dir -Filter "*.apk" | ForEach-Object { $_.Name })
        }
    }
    throw "未找到 $expectedName;实际产物: $($available -join ', ')"
}

Write-Host "Release APK ($Abi): $apk"
Write-Host "Size: $([math]::Round((Get-Item -LiteralPath $apk).Length / 1MB, 1)) MB"

# ── 原生库完整性断言（防止发布「缺 C++ 库」的包）──
# 背景：`-PreactNativeArchitectures` 只编译当前 ABI 的 C++ 目标，而 build.gradle 的 splits
# 会为四个 ABI 都产出分包 APK——非当前 ABI 的那几个分包里缺少本次刚编译出来的库。
# 实测把两次调用连着跑、事后再去 apk-alt 取「另一个 ABI」的包，会取到这种残缺包：
# arm64 包少了 libgesturehandler/libreanimated/librnscreens/libworklets 四个库（21 → 17），
# 装到对应架构手机上启动即闪退。所以这里就地断言，并把包归档到 dist/，不依赖调用方
# 「事后还记得取」——每次调用只构建一个 ABI。
Add-Type -AssemblyName System.IO.Compression.FileSystem
$requiredLibs = @(
    "libreactnative.so",
    "libhermesvm.so",
    "libgesturehandler.so",
    "libreanimated.so",
    "librnscreens.so",
    "libworklets.so"
)
$archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $apk))
try {
    $libEntries = @($archive.Entries | Where-Object { $_.FullName -like "lib/*" })
    $libNames = @($libEntries | ForEach-Object { $_.Name })
    $libAbis = @($libEntries | ForEach-Object { ($_.FullName -split "/")[1] } | Sort-Object -Unique)
} finally {
    $archive.Dispose()
}
if ($libAbis.Count -ne 1 -or $libAbis[0] -ne $Abi) {
    throw "APK 的原生库 ABI 目录是 [$($libAbis -join ', ')]，期望只有 [$Abi]:$apk"
}
$missing = @($requiredLibs | Where-Object { $_ -notin $libNames })
if ($missing) {
    $msg = @(
        "$Abi 包缺少原生库: $($missing -join ', ')"
        "包: $apk"
        "这类残缺包只在「同一会话里连着构建多个 ABI、事后再统一取包」时出现。"
        "每次调用只构建一个 ABI，并在本次调用内取包（本脚本会自动归档到 dist/）。"
    ) -join "`n"
    throw $msg
}
Write-Host "原生库完整性: $($libNames.Count) 个（含 gesture/reanimated/screens/worklets）✓"

# ── 归档到 dist/，名字即 Release 资产名 ──
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$distDir = Join-Path $repoRoot "dist"
$mobileVersion = (Get-Content (Join-Path $PSScriptRoot "package.json") -Raw | ConvertFrom-Json).version
$assetName = "AuralFlow-v$mobileVersion-$Abi.apk"
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
$target = Join-Path $distDir $assetName
Copy-Item -LiteralPath $apk -Destination $target -Force
$sha = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower()
Write-Host "已归档: dist\$assetName  $([math]::Round((Get-Item -LiteralPath $target).Length / 1MB, 1)) MB  sha256=$($sha.Substring(0, 16))…"