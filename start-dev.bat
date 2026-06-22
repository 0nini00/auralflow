@echo off
echo ========================================
echo   AuralFlow 启动脚本
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] 停止旧进程...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/2] 启动应用...
echo.
echo ========================================
echo   应用启动中，请稍候...
echo   窗口会自动打开
echo ========================================
echo.

start /B npm run dev
timeout /t 3 /nobreak >nul
cargo run --manifest-path=src-tauri\Cargo.toml --no-default-features

pause
