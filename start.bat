@echo off
echo ========================================
echo   AuralFlow 启动脚本
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] 检查依赖...
if not exist "node_modules" (
    echo 首次运行，安装依赖...
    call npm install
)

echo.
echo [2/3] 清理端口...
taskkill /F /IM node.exe >nul 2>&1

echo.
echo [3/3] 启动应用...
echo.
echo ========================================
echo   应用启动中，请稍候...
echo   - Vite 开���服务器: http://localhost:1420
echo   - Tauri 窗口会自动打开
echo ========================================
echo.
echo 提示: 按 Ctrl+C 停止开发服务器
echo.

call npm run tauri:dev
