# 项目概述

AuralFlow 是一个基于 TypeScript 和 Rust 构建的成熟双端音乐播放器。通过共享核心模块 `@lx/core`，项目实现了桌面端与移动端在逻辑、音源解析、歌词处理上的高度一致与代码复用。

## 基本架构

### 桌面端 (`desktop`)
使用 Tauri v2 构建，提供原生 OS 交互体验。其 `src-tauri` 层利用 Rust 的高性能处理系统级任务：
- IPC 命令通道：处理前端发起的系统操作。
- 文件系统扫描：本地音乐的快速索引。
- 系统集成：透明歌词窗、全局快捷键、托盘菜单。

### 移动端 (`apps/mobile`)
使用 React Native 构建，专注于 Android 平台的交互体验。
- 架构采用与桌面端一致的 Service/Store 模式。
- 后端服务：使用原生模块处理通知栏控制与后台播放保活。
- UI/UX：针对触控设备重新设计了播放界面与导航流。

### 共享核心 (`packages/core`)
`@lx/core` 是项目的逻辑大脑，完全独立于 UI 框架：
- **领域模型**：定义 MusicSource, MusicInfo, Lyric 等基础数据结构。
- **解析策略**：内置多种音源解析逻辑与 `customSourceRuntime` 运行时，确保双端搜索结果一致。
- **播放逻辑**：统一的播放列表调度与状态同步机制。
- **歌词解析**：支持 LRC、YRC 等解析，提供逐字动效渲染引擎。

## 目录结构

```text
auralflow/
├── apps/
│   └── mobile/              # 移动端源码 (React Native)
├── desktop/                 # 桌面端源码 (Tauri v2)
│   ├── src/                 # 前端 UI 与业务组件
│   └── src-tauri/           # Rust 系统级后端
├── packages/
│   └── core/                # 共享核心逻辑包 (@lx/core)
├── package.json             # 根目录工作区定义与构建脚本
└── README.md
```

## 常用开发命令
- `pnpm desktop:typecheck`: 验证桌面端类型安全。
- `pnpm mobile:typecheck`: 验证移动端类型安全。
- `pnpm desktop:tauri:check`: 验证 Rust 后端代码合规性。
