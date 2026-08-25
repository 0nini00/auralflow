# AuralFlow

AuralFlow 是一款跨平台的在线音乐播放器，桌面端与移动端（Android）通过共享核心包复用领域模型和平台无关逻辑，功能保持高度对齐，并参考 **lx-music** 的交互设计打磨了播放器、歌词与歌单等核心体验。

- **桌面端**（`desktop/`）：Tauri v2（Rust 后端）+ React 18 + TypeScript + Vite。
- **移动端**（`apps/mobile/`）：React Native 0.86 + TypeScript，Android 优先。
- **核心包**（`packages/core/`）：共享音源模型、歌词解析、封面处理、出站地址校验、WebDAV 合并和内置音乐 API 工具（`@lx/core`）；播放引擎与状态编排由双端分别实现。

## 音源架构（双端一致）

```
官方直连（网易云 wy + 腾讯 tx） ──► 搜索 + 歌单 / 封面 / 歌曲信息 / 歌词元数据
        ↓
内置音乐 API 网关 ──► 播放 URL 解析 + 下载（gdstudio 免费网关）
        ↓
自定义 lx 音源 ──► 播放兜底（内置网关全部失败时按序尝试已启用的音源脚本）
        ↓
B站（bili）─────► 独立的合集 / 视频搜索 / DASH 音频解析链路
```

- **搜索**：网易云 eapi `cloudsearch` + 腾讯 `musicu` 官方直连，元数据（封面/歌手/专辑）由官方接口直接提供；直连失败回退内置音乐 API 搜索。
- **播放 / 下载**：由内置音乐 API 网关（gdstudio，免 key）统一解析，失败后再尝试自定义音源。

## 功能总览

### 双端共有
- **搜索**：多音源合并搜索、搜索联想（网易云）、最近搜索、结果去重。
- **歌单**：网易云 / QQ 音乐官方歌单、本地歌单、B站合集、我喜欢（收藏）、歌单搜索；歌单内「播放全部 / 收藏」。
- **每日推荐 / 私人 FM / 排行榜**：私人 FM 支持下一首预取，切歌秒开；排行榜展示榜首歌曲。
- **播放**：播放队列、下一首播放 / 稍后播放（独立插播暂存区）、播放模式（顺序 / 列表循环 / 单曲循环 / 随机，随机整轮去重）、倍速、音质切换、进度拖动。
- **全屏沉浸播放器**（移动端按 lx 竖屏播放器风格重构）：封面页 / 歌词页 / 进度 / 控制栏 / 更多菜单 / 评论 / 音质切换 / 睡眠定时。
- **歌词**：滚动跟随（用户手动滚动暂停 3 秒后恢复）、逐字卡拉 OK（YRC / QRC / KRC）、译文合并、简繁转换、字号 / 颜色 / 字体 / 对齐 / 字重 / 行距 / 动效强度自定义。
- **本地音乐**：Android MediaStore 扫描 + 手动选歌；内嵌封面 / 歌词提取，无内嵌时回退同名 `.lrc` 旁挂与 `folder.jpg` sidecar；可写回标题 / 歌手 / 封面 / 歌词标签。
- **缓存**：封面 / 歌词 / 音频三级缓存，URL MD5 命名；封面与音频 immutable（URL 不变不过期，容量上限 LRU 自动回收，默认 100MB），歌词 30 天过期；可缓存音源（wy/tx）播放过的音频落盘，离线即开。
- **下载**：串行队列、音质可选（128 / 192 / 320 / FLAC / Hi-Res）、实时进度与速度、暂停 / 继续 / 取消、下载后嵌入 ID3 标签 + 旁挂 `.lrc`。
- **播放历史**：分时间记录（今天 / 昨天 / 具体日期），同日同曲去重、跨天保留多次播放，31 天滚动、上限 2000 条。
- **WebDAV 同步**：与桌面端 / lx 生态互通（远端 `LX_Music/` 目录，`playlists.json` 歌单收藏历史 + `user_apis.json` 自定义音源），上传 / 下载 / 合并，云端较旧拦截 + 强制下载，移动端可选启动自动同步。
- **账号**：网易云（二维码登录）、B站（Cookie 登录）。
- **主题**：浅色 / 深色 / 跟随系统、强调色、自定义背景、夜间模式沉浸页配色。

### 桌面端特有能力
- 独立悬浮歌词窗口、系统托盘控制、全局快捷键（沉浸式播放页内自动屏蔽避免误触）。
- Rust 后端（Tauri）提供本地文件标签读写、WebDAV、媒体缓存等能力。
- 内置音乐 API 网关（gdstudio）解析播放地址。

### 移动端特有能力
- 通知栏播放控制器、后台保活播放（`react-native-track-player`，ExoPlayer 边播边缓存）。
- Android 悬浮歌词窗（可拖动、可锁定、随播放滚动）、系统媒体键 / 锁屏控制。
- 本地音乐、下载、播放历史 / 收藏的完整移动端管理与抽屉导航（推入页也可直接唤出侧边栏）。
- 首页信息流（推荐歌单 / 新歌 / 新碟 / 排行榜 / MV）、MV 播放器。

## 技术栈

| 层级 | 技术 |
|---|---|
| 桌面端 | Tauri v2 (Rust) + React 18 + Vite |
| 移动端 | React Native 0.86 + TypeScript |
| 状态管理 | Zustand（双端） |
| 播放 | 桌面：Web Audio；移动：react-native-track-player (ExoPlayer) |
| 共享核心 | `@lx/core`（领域模型、歌词、封面、出站校验、WebDAV 合并、音源工具） |
| 包管理 / 构建 | pnpm workspace / Metro + Gradle（移动）、Tauri CLI（桌面） |

## 快速开始

```bash
# 安装依赖（含移动端 track-player 补丁脚本）
pnpm install

# ── 桌面端 ──
pnpm desktop:dev          # Vite dev（浏览器模式）
pnpm desktop:tauri:dev    # Tauri dev（原生窗口）
pnpm desktop:tauri:build  # 打包桌面安装包

# ── 移动端（Android，需 USB 调试 / 模拟器）──
pnpm mobile:start         # 启动 Metro
pnpm mobile:android       # 运行到已连接的设备
pnpm mobile:build:debug   # 生成 debug APK
```

**移动端 release APK**：`cd apps/mobile/android && ./gradlew assembleRelease`
- 签名凭据从仓库外目录读取（环境变量 `AURALFLOW_KEYSTORE_DIR`，缺省本机 `F:/auralflow-secrets`），未配置时回退 debug 签名（仅限本地调试）。

详细指南见 [QUICK_START.md](./QUICK_START.md)。

## 项目结构

```text
auralflow/
├── apps/mobile/            # 移动端（React Native）
│   ├── src/screens/        # 首页 / 搜索 / 我的 / 播放器 / 设置等页面
│   ├── src/services/       # 播放、下载、缓存、WebDAV、本地音乐、音源等
│   ├── src/stores/         # Zustand 状态层
│   └── android/            # Android 原生工程（本地音乐 / 悬浮歌词等模块）
├── desktop/                # 桌面端（Tauri v2）
│   ├── src/                # React 前端（播放引擎、歌词、音源、WebDAV）
│   └── src-tauri/          # Rust 后端
├── packages/core/          # 共享核心 @lx/core
├── docs/                   # 设计文档 / 双端对照 / 实现说明
└── package.json            # workspace 根配置与脚本
```

## 文档索引

| 文档 | 说明 |
|---|---|
| [QUICK_START.md](./QUICK_START.md) | 环境准备与运行指南 |
| [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) | 项目总览 |
| [apps/mobile/README.md](./apps/mobile/README.md) | 移动端说明 |
| [apps/mobile/FEATURE_COMPARISON.md](./apps/mobile/FEATURE_COMPARISON.md) | 双端功能对齐表 |
| [apps/mobile/CACHE_IMPLEMENTATION.md](./apps/mobile/CACHE_IMPLEMENTATION.md) | 移动端缓存实现 |
| [docs/CUSTOM_SOURCE_AND_GATEWAY_DESIGN.md](./docs/CUSTOM_SOURCE_AND_GATEWAY_DESIGN.md) | 音源与网关设计 |

## 远端仓库

```bash
git clone https://github.com/0nini00/auralflow.git
```
