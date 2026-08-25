# 项目概述

AuralFlow 是一个基于 TypeScript 和 Rust 构建的双端音乐播放器。桌面端与移动端通过 `@lx/core` 复用平台无关的领域模型和纯逻辑，同时分别维护各自的播放引擎、状态编排、网络适配和系统集成。

## 基本架构

### 桌面端 (`desktop`)
使用 Tauri v2 构建，提供原生 OS 交互体验。其 `src-tauri` 层利用 Rust 处理系统级任务：
- IPC 命令通道：处理前端发起的系统操作。
- 文件系统扫描：索引本地音乐并读写音频元数据。
- 系统集成：透明歌词窗、全局快捷键、托盘菜单和媒体缓存。

### 移动端 (`apps/mobile`)
使用 React Native 构建，面向 Android 平台：
- 使用 Zustand Store 与 Service 组织状态和业务编排。
- 通过 TrackPlayer 和 Android 原生模块处理后台播放、通知栏、本地媒体与悬浮歌词。
- 针对触控设备独立实现播放界面与导航流。

### 共享核心 (`packages/core`)
`@lx/core` 完全独立于 UI 框架和平台运行时，当前负责：
- **领域模型**：定义 `MusicSource`、`MusicInfo`、`Lyric` 等基础数据结构。
- **歌词逻辑**：解析 LRC/YRC 等格式，并提供平台无关的行进度计算。
- **共享工具**：封面地址处理、内置音乐 API 工具和出站地址校验。
- **同步规则**：WebDAV 数据合并等可测试的纯逻辑。

播放队列、播放状态、缓存 IO、自定义音源运行沙箱和平台网络请求仍由桌面端与移动端分别实现。

## 目录结构

```text
auralflow/
├── apps/
│   └── mobile/              # 移动端源码 (React Native)
├── desktop/                 # 桌面端源码 (Tauri v2)
│   ├── src/                 # 前端 UI 与业务组件
│   └── src-tauri/           # Rust 系统级后端
├── packages/
│   └── core/                # 共享平台无关逻辑包 (@lx/core)
├── package.json             # 根目录工作区定义与统一脚本
└── README.md
```

## 常用开发命令
- `pnpm test`: 运行 core、desktop、mobile 和 Rust 测试。
- `pnpm desktop:typecheck`: 验证桌面端类型安全。
- `pnpm mobile:typecheck`: 验证移动端类型安全。
- `cargo check --manifest-path desktop/src-tauri/Cargo.toml`: 验证 Rust 后端编译。
