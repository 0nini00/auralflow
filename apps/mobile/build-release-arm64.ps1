param(
    [string]$Abi = "arm64-v8a"
)

$ErrorActionPreference = "Stop"

$projectDir = Join-Path $PSScriptRoot "android"
$apkDir = Join-Path $projectDir "app\build\outputs\apk\release"
$apkAltDir = Join-Path $projectDir "app\build\outputs\apk-alt"

# 构建前清空 ABI 分包输出:四架构分包时间戳相同,按 LastWriteTime 取「最新」会取到
# 别的架构;混着上一次构建的产物也会让 apk-alt 里留下旧包。
foreach ($dir in @($apkDir, $apkAltDir)) {
    if (Test-Path -LiteralPath $dir) {
        Remove-Item -LiteralPath $dir -Recurse -Force
    }
}

Push-Location $projectDir
try {
    & .\gradlew.bat assembleRelease -PreactNativeArchitectures=$Abi --no-daemon --console=plain
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