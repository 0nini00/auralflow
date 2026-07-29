# AuralFlow

AuralFlow 是一款成熟的跨平台音乐播放器，完美支持 **桌面端** 与 **移动端 (Android)**，并依托统一的核心层实现功能高度对齐。

- **桌面端** (`desktop/`): 基于 Tauri v2 + React 18 + TypeScript + Vite，提供原生的桌面交互体验与强大的后台能力。
- **移动端** (`apps/mobile/`): 基于 React Native 0.86 + TypeScript，提供针对触摸屏优化的流畅移动体验。
- **核心包** (`packages/core/`): 共享的音源解析、播放逻辑、歌词解析与工具库 (`@lx/core`)，确保双端逻辑一致性。

## 功能亮点

### 双端共有核心体验
- 多音源搜索、歌单同步、本地音乐库管理。
- 播放历史、每日推荐、私人 FM。
- 沉浸式动效歌词、下载管理器。
- 主题定制、WebDAV 用户数据备份。
- 账号体系与授权管理。

### 桌面端特有能力
- 独立悬浮歌词窗口、系统托盘控制、全局快捷键。
- 强大的文件系统访问与 Rust 后端扩展。

### 移动端特有能力
- 通知栏播放控制器、后台保活播放服务。
- 针对手机交互优化的导航与手势系统。

## 技术栈

| 层级 | 技术 |
|---|---|
| 桌面端框架 | Tauri v2 (Rust) + React 18 + Vite |
| 移动端框架 | React Native 0.86 |
| 状态管理 | Zustand |
| 共享核心 | `@lx/core` (TypeScript) |

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动桌面端 (Tauri)
pnpm desktop:tauri:dev

# 启动移动端 (Android)
pnpm mobile:start
# 另开终端运行
pnpm mobile:android
```

详细指南请见 [QUICK_START.md](./QUICK_START.md)。

## 项目结构

```text
auralflow/
├── apps/
│   └── mobile/              # 移动端 (React Native)
├── desktop/                 # 桌面端 (Tauri v2)
│   ├── src/                 # 前端源码
│   └── src-tauri/           # Rust 后端
├── packages/
│   └── core/                # 共享核心包 (@lx/core)
├── package.json             # 工作区根配置与构建脚本
└── README.md
```

## 远端仓库
```bash
git clone https://github.com/0nini00/auralflow.git
```
