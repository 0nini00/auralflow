# 快速开始

本指南介绍如何在本地开发和构建成熟的双端应用 AuralFlow。

## 1. 环境准备
- Node.js (建议 v20+)
- pnpm
- Rust 工具链 (构建桌面端所需)
- Android Studio + Android SDK (移动端构建所需)

## 2. 安装依赖
在项目根目录执行：
```bash
pnpm install
```

## 3. 开发启动

### 桌面端 (Tauri)
```bash
pnpm desktop:tauri:dev
```

### 移动端 (Android)
```bash
# 启动 Metro Bundler
pnpm mobile:start

# 在另一个终端执行并安装到 Android 设备
pnpm mobile:android
```

## 4. 类型检查与构建

### 类型检查
- 桌面端：`pnpm desktop:typecheck`
- 移动端：`pnpm mobile:typecheck`

### 构建应用
- 桌面端 (生产环境)：`pnpm desktop:tauri:build`
- 移动端 (Debug APK)：`pnpm mobile:build:debug`

## 5. 首次使用验证
1. 启动应用后，通过 `settings` 页面配置账号。
2. 配置音源或扫描本地路径。
3. 执行搜索功能，验证核心聚合逻辑是否返回数据。
