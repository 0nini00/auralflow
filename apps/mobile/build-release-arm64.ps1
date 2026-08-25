$ErrorActionPreference = "Stop"

$projectDir = Join-Path $PSScriptRoot "android"
$apkDir = Join-Path $projectDir "app\build\outputs\apk\release"

Push-Location $projectDir
try {
    & .\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon --console=plain
    if ($LASTEXITCODE -ne 0) {
        throw "Gradle release 构建失败，退出码: $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

$apk = Get-ChildItem -LiteralPath $apkDir -Filter "*.apk" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $apk) {
    throw "Release 构建完成但未找到 APK: $apkDir"
}

Write-Host "Release APK: $($apk.FullName)"
Write-Host "Size: $([math]::Round($apk.Length / 1MB, 1)) MB"
