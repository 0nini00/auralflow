$ErrorActionPreference = "Continue"
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot"
$env:ANDROID_HOME = "C:\Users\chenle\AppData\Local\Android\Sdk"
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
$env:REACT_NATIVE_ARCHITECTURES = "arm64-v8a"

$projDir = "$PSScriptRoot\android"
$apkDir = "$projDir\app\build\outputs\apk\release"

Write-Host "=== Kill Java + Explorer (releases file locks) ==="
Get-Process java -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process explorer -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 5

Write-Host "=== Remove locked APK dir ==="
if (Test-Path $apkDir) {
    Remove-Item -Recurse -Force $apkDir -ErrorAction SilentlyContinue
    Start-Sleep 2
}
if (Test-Path $apkDir) {
    Write-Host "  Still exists, one more try..."
    Remove-Item -Recurse -Force $apkDir -ErrorAction SilentlyContinue
    Start-Sleep 2
}
Write-Host "  Dir exists: $(Test-Path $apkDir)"

# Restart Explorer
Start-Process explorer.exe

Write-Host "`n=== Build assembleRelease ==="
Push-Location $projDir
try {
    & .\gradlew.bat assembleRelease --no-daemon -x lintVitalRelease -x lintVitalAnalyzeRelease -x createReleaseApkListingFileRedirect
    $exitCode = $LASTEXITCODE
    Write-Host "Gradle exit: $exitCode"
} finally {
    Pop-Location
}

$apk = Get-ChildItem "$apkDir\*.apk" -ErrorAction SilentlyContinue
if ($apk) {
    Write-Host "`n==============================="
    Write-Host "  BUILD SUCCESS!"
    Write-Host "  APK: $($apk.FullName)"
    Write-Host "  Size: $([math]::Round($apk.Length / 1MB, 1)) MB"
    Write-Host "==============================="
} else {
    Write-Host "`nNo APK found. Exit: $exitCode"
    exit 1
}
