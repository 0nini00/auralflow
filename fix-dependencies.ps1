# 修复 pnpm workspace 问题并安装依赖

Write-Host "正在清理旧的依赖..." -ForegroundColor Yellow

# 删除 node_modules
if (Test-Path "node_modules") {
    Remove-Item -Recurse -Force "node_modules"
    Write-Host "✓ 已删除 node_modules" -ForegroundColor Green
}

# 删除 pnpm-lock.yaml
if (Test-Path "pnpm-lock.yaml") {
    Remove-Item -Force "pnpm-lock.yaml"
    Write-Host "✓ 已删除 pnpm-lock.yaml" -ForegroundColor Green
}

Write-Host "`n正在重新安装依赖..." -ForegroundColor Yellow
pnpm install

Write-Host "`n正在添加新依赖..." -ForegroundColor Yellow
pnpm add @tauri-apps/plugin-dialog @tauri-apps/plugin-fs zustand

Write-Host "`n✅ 完成！" -ForegroundColor Green
