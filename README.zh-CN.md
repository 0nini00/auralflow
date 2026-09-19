<div align="center">

<img src="desktop/src/assets/logo.png" alt="AuralFlow Logo" width="96" height="96" />

<h1 align="center">AuralFlow</h1>

<p align="center">跨平台在线与本地音乐播放器，桌面端与 Android 端通过 <code>@lx/core</code> 共享核心领域逻辑。</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.0-blue.svg" alt="版本" />
  <img src="https://img.shields.io/badge/node-%3E%3D22.11.0-brightgreen.svg" alt="Node" />
  <img src="https://img.shields.io/badge/tauri-v2-orange.svg" alt="Tauri" />
  <img src="https://img.shields.io/badge/react--native-0.86-61dafb.svg" alt="React Native" />
  <img src="https://img.shields.io/badge/package-pnpm%20monorepo-yellow.svg" alt="pnpm" />
</p>

</div>

## 概述

AuralFlow 是一款功能完备的跨平台音乐流媒体与本地播放器。项目采用 Monorepo 单一仓库架构，桌面端（Tauri v2 + React 18）与移动端（React Native 0.86 + React 19）通过底层共享核心库（`@lx/core`）复用全部领域模型与平台无关逻辑。

参考 LX Music 的交互与音频体验，AuralFlow 提供了精准的逐字卡拉 OK 歌词、多源聚合搜索、网易云版权缺失自动跨源降级 QQ 音乐、WebDAV 双向云同步，以及针对 Android 国产系统的后台防冻结保活能力。

## 核心亮点

- **共享领域核心（`@lx/core`）**：将音质档位分层、并发竞速、流完整性探活、歌词时钟插值计算统一沉淀在独立核心包中，由 55 项单元测试全面覆盖。
- **网易云无版权自动跨源降级**：当网易云曲目因下架或版权受限返回 403 / 无法取链时，自动直连 QQ 音乐用「歌名 + 首位歌手」检索，执行严格校验（歌名规整相同 + 歌手重叠 + 时长差 <= 5s），平滑接管发声并同步歌词与元数据。
- **全格式动态歌词**：支持 LRC、YRC、QRC、KRC 歌词解析与逐字卡拉 OK 动效渲染，支持译文合并；桌面端提供透明悬停穿透窗口，移动端提供原生悬浮窗歌词。
- **WebDAV 双向数据同步**：支持歌单、收藏、自定义音源与播放历史跨设备同步，提供冷启动自动同步、并集收敛合并、云端版本冲突拦截与本地自动快照。
- **Android 后台深度保活**：引入忽略电池优化白名单引导与前台服务通知机制，解决现代 Android ROM 在锁屏或后台切歌冻结 JS 线程的问题。
- **本地曲库与元数据读写**：支持极速本地歌曲扫描、内嵌封面提取、ID3 标签实时编辑写回以及多档位无损音频下载。

## 系统架构

```text
┌─────────────────────────────────────────────────────────────────┐
│                        AuralFlow 客户端                         │
├───────────────────────────────┬─────────────────────────────────┤
│           桌面端              │             移动端              │
│       Tauri v2 + React        │   React Native 0.86 + React 19  │
│  - HTMLAudio + rAF 播放引擎   │  - react-native-track-player    │
│  - 透明桌面悬浮歌词窗口       │  - WindowManager 原生悬浮歌词   │
│  - Rust 三层媒体缓存与文件 IO │  - 电池优化白名单与保活卫士     │
└───────────────┬───────────────┴─────────────────┬───────────────┘
                │                                 │
                ▼                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                   共享核心领域层 (@lx/core)                     │
│  - 音质档位分层竞速 (128k / 192k / 320k / FLAC / Hi-Res)        │
│  - 严格跨源匹配器 (网易云 ──▶ QQ 音乐版权降级)                  │
│  - 歌词时钟驱动与多格式解析 (LRC / YRC / QRC / KRC)             │
│  - WebDAV 歌单与历史增量合并引擎                                │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                            音源通道                             │
│  - 网易云音乐 (wy): eapi/weapi  - QQ 音乐 (tx): musicu / 自定义 │
│  - 哔哩哔哩 (bili): WBI / DASH  - 自定义音源脚本 (LX 协议)      │
└─────────────────────────────────────────────────────────────────┘
```

## 功能特性矩阵

| 功能模块 | 能力描述 | 桌面端 | 移动端 |
|---|---|---|---|
| 搜索 | 多音源合并搜索、网易云搜索联想、历史记录、结果去重 | 支持 | 支持 |
| 歌单 | 网易云/QQ 官方歌单、本地自建歌单、B站合集、我的喜欢、链接导入 | 支持 | 支持 |
| 推荐与电台 | 每日推荐、私人 FM（预取秒开）、排行榜单 | 支持 | 支持 |
| 播放控制 | 播放队列、下一首播放、4 种循环模式、倍速播放、音质切换 | 支持 | 支持 |
| 跨源降级 | 网易云无版权歌曲自动查找匹配 QQ 音乐版本平滑播放 | 支持 | 支持 |
| 歌词系统 | 滚动跟随、逐字卡拉 OK、双语翻译合并、简繁切换 | 支持 | 支持 |
| 悬浮歌词 | 桌面透明置顶穿透悬浮窗 / Android 系统悬浮窗 | 桌面独立窗 | 系统悬浮窗 |
| 本地曲库 | 本地扫描、ID3 标签编辑写回、内嵌封面提取、无损下载 | Rust 本地读写 | 原生存储读写 |
| WebDAV 同步 | 歌单、收藏、历史与音源跨端同步；启动自动同步 | 支持 | 支持 |
| 后台播放 | 锁屏与多任务连续播放、系统媒体通知控制 | 系统托盘控制 | 前台服务保活 |

## 仓库目录结构

```text
auralflow/
├── apps/mobile/                移动端应用 (React Native 0.86 + Android 原生模块)
├── desktop/                    桌面端应用 (Tauri v2 + React 18 + Rust 原生核心)
│   └── packages/tauri-bridge/  桌面端专属 IPC 通信桥
├── packages/core/              跨端共享领域核心包 (@lx/core, 包含 Vitest 测试套件)
├── dist/                       打包产物输出目录
└── package.json                Monorepo 工作区根配置
```

## 快速开始

### 环境依赖

- **Node.js**: >= 22.11.0（移动端 Metro 编译器的强制要求）
- **pnpm**: >= 9.0.0
- **Rust 工具链**: 桌面端构建必需（`cargo`、`rustc`）
- **Android SDK 与 JDK 17**: 移动端构建必需（minSdk 24，compileSdk 36）

### 安装依赖

克隆代码仓库并安装依赖：

```bash
git clone https://github.com/0nini00/auralflow.git
cd auralflow
pnpm install
```

### 开发调试

启动桌面端：

```bash
pnpm desktop:tauri:dev
# 或者仅启动桌面前端页面调试：
pnpm desktop:dev
```

启动移动端：

```bash
# 终端 1：启动 Metro 打包服务
pnpm mobile:start

# 终端 2：在连接的 Android 设备或模拟器上启动应用
pnpm mobile:android
```

### 检查与测试

执行工作区各包的类型检查与单元测试：

```bash
# 运行核心领域包单元测试
pnpm core:test

# 执行桌面端 TypeScript 类型检查
pnpm desktop:typecheck

# 执行移动端 TypeScript 类型检查
pnpm mobile:typecheck
```

### 生产打包

构建桌面端 Windows 安装包（MSI 与便携版 EXE）：

```bash
pnpm desktop:tauri:build
```

构建移动端 Android 安装包：

```bash
# 构建 Debug APK
pnpm mobile:build:debug

# 构建 Release APK
pnpm mobile:build:release
```
