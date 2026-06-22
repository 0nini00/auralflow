# AuralFlow 项目概览

> 基于 **Tauri v2 + React + TypeScript + Vite** 的多源桌面音乐播放器，风格对标 Apple Music / YouTube Music，主要面向中国音乐流媒体生态。

---

## 1. 项目基本信息

| 属性 | 值 |
|------|-----|
| 项目名称 | AuralFlow |
| 版本 | 0.1.0 |
| 标识符 | `cn.chenle.auralflow` |
| 包管理器 | pnpm (workspace monorepo) |
| 前端框架 | React 18 + TypeScript 5.6 |
| 构建工具 | Vite 5.4 |
| 状态管理 | Zustand 5 |
| 路由 | React Router DOM 6 |
| 桌面框架 | Tauri v2 (Rust) |
| 开发端口 | 1420 |
| 窗口尺寸 | 1200×800（最小 900×600） |

### 环境要求

- Node.js >= 20 / npm >= 10
- Rust 工具链（Tauri 需要）
- 平台依赖（Windows 通常已内置）

### 技术栈一览

**前端依赖：**

| 依赖 | 版本 | 用途 |
|------|------|------|
| `react` / `react-dom` | ^18.3.1 | UI 框架 |
| `react-router-dom` | ^6.28.0 | 路由 |
| `zustand` | ^5.0.1 | 状态管理 |
| `crypto-js` | ^4.2.0 | 前端加密（weapi） |
| `node-forge` | ^1.3.1 | RSA 加密 |
| `soundtouchjs` | ^0.3.0 | 变速变调 |
| `lucide-react` | ^0.460.0 | 图标库 |
| `@tauri-apps/api` | ^2.0.0 | Tauri 前端 API |
| `@lx/core` | workspace:* | 音源抽象层 |
| `@lx/tauri-bridge` | workspace:* | IPC 类型封装 |
| `@lx/ui` | workspace:* | 共享 UI（待开发） |
| `@lx/i18n` | workspace:* | 国际化（待开发） |

**Rust 依赖（后端核心）：**

| 依赖 | 用途 |
|------|------|
| `tauri 2` (protocol-asset, tray-icon) | 桌面框架核心 |
| `reqwest` (json, gzip, cookies) | HTTP 客户端 |
| `aes` + `cbc` + `ecb` + `rsa` | 网易云 API 加密 |
| `audiotags` | 读取/写入音频标签和封面 |
| `lofty` | 读取/写入内嵌歌词（ID3 USLT / Vorbis） |
| `walkdir` | 递归目录扫描 |
| `tokio` | 异步运行时 |
| Tauri 插件: shell, http, fs, dialog, global-shortcut, deep-link | 系统能力 |

---

## 2. 目录结构总览

```
auralflow/
│
├── 📄 根配置
│   ├── package.json              # 主项目配置
│   ├── tsconfig.json             # TypeScript 编译配置 + 路径别名
│   ├── tsconfig.node.json        # Node 环境 TS 配置
│   ├── vite.config.ts            # Vite 构建：代码分割、路径别名、开发服务器
│   ├── pnpm-workspace.yaml       # pnpm 工作区声明
│   ├── pnpm-lock.yaml            # 锁文件
│   ├── .npmrc                    # npm 配置（仅 esbuild 允许构建）
│   ├── .gitignore
│   ├── index.html                # SPA 入口 HTML
│   ├── start.bat                 # Windows 生产启动
│   ├── start-dev.bat             # Windows 开发启动
│   └── fix-dependencies.ps1      # 依赖修复脚本
│
├── 📂 packages/                  # ── Monorepo 子包 ──
│   ├── core/                     # @lx/core — 音源抽象层
│   │   └── src/
│   │       ├── index.ts          # 公共入口
│   │       └── sources/
│   │           ├── types.ts      # MusicSource 接口定义
│   │           ├── registry.ts   # 音源注册表
│   │           ├── resolver.ts   # 多源解析器（轮转/降级/网关）
│   │           ├── gateway.ts    # API 网关 Provider
│   │           ├── custom-source.ts  # 自定义源 Provider
│   │           └── index.ts
│   ├── tauri-bridge/            # @lx/tauri-bridge — IPC 类型安全封装
│   │   └── src/index.ts          # ~30 个 invoke 函数 + Rust 模型类型
│   ├── ui/                       # @lx/ui — 共享 UI 组件（待开发）
│   └── i18n/                     # @lx/i18n — 国际化（待开发）
│
├── 📂 src/                       # ── React 前端源码 ──
│   ├── main.tsx                  # 入口
│   ├── App.tsx                   # 路由配置 + 多角色检测（主窗口/歌词窗口）
│   ├── index.css                 # 全局样式
│   ├── vite-env.d.ts             # Vite 类型声明
│   │
│   ├── components/               # 可复用 UI 组件
│   │   ├── Layout/               # 布局组件
│   │   │   ├── Layout.tsx        # 主布局容器
│   │   │   ├── Header.tsx        # 顶部导航栏
│   │   │   └── Sidebar.tsx       # 侧边导航栏
│   │   ├── PlayerBar.tsx         # 底部播放控制栏（紧凑单行）
│   │   ├── QueuePanel.tsx        # 播放队列面板
│   │   ├── LyricsPanel.tsx       # 主界面歌词面板
│   │   ├── MusicCard.tsx         # 歌曲/歌单卡片
│   │   ├── VirtualList.tsx       # 虚拟列表（大数据量优化）
│   │   ├── IconButton.tsx        # 图标按钮
│   │   ├── SectionHeader.tsx      # 区块标题
│   │   ├── MetadataEditModal.tsx  # 元数据编辑弹窗
│   │   ├── UpdateModal.tsx       # 更新提示弹窗
│   │   ├── PactModal.tsx         # 用户协议弹窗
│   │   ├── CursorEffect.tsx      # 鼠标光标特效
│   │   └── DeepLinkHandler.tsx   # Deep Link 处理
│   │
│   ├── views/                    # 页面视图（16 个）
│   │   ├── HomeView.tsx          # 首页
│   │   ├── SearchView.tsx        # 搜索页
│   │   ├── PlayerView.tsx        # 全屏播放器（独立路由）
│   │   ├── SettingsView.tsx      # 设置页
│   │   ├── FavoritesView.tsx     # 收藏页
│   │   ├── LocalMusicView.tsx    # 本地音乐页
│   │   ├── PlaylistsView.tsx     # 歌单列表页
│   │   ├── PlaylistDetailView.tsx # 歌单详情页
│   │   ├── DownloadsView.tsx    # 下载管理页
│   │   ├── ArtistDetailView.tsx  # 歌手详情页
│   │   ├── AlbumDetailView.tsx   # 专辑详情页
│   │   ├── DailyRecommendView.tsx # 每日推荐页
│   │   ├── PersonalFmView.tsx    # 私人 FM 页
│   │   ├── LyricWindowView.tsx   # 桌面歌词窗口视图
│   │   └── PlaceholderView.tsx  # 占位页
│   │
│   ├── stores/                   # Zustand 状态管理（16 个 Store）
│   │   ├── playerStore.ts        # 播放器核心状态
│   │   ├── playerSync.ts         # 播放器同步（多窗口/角色检测）
│   │   ├── playlistStore.ts      # 播放队列
│   │   ├── favoritesStore.ts     # 收藏管理
│   │   ├── historyStore.ts       # 播放历史
│   │   ├── libraryStore.ts       # 音乐库
│   │   ├── libraryPersistence.ts # 音乐库持久化
│   │   ├── discoveryStore.ts     # 发现页数据
│   │   ├── downloadStore.ts      # 下载管理
│   │   ├── themeStore.ts         # 主题切换
│   │   ├── sleepTimerStore.ts    # 睡眠定时器
│   │   ├── soundEffectStore.ts   # 音效设置
│   │   ├── audioDeviceStore.ts   # 音频设备选择
│   │   ├── customSourceStore.ts  # 自定义音源
│   │   └── wyAccountStore.ts     # 网易云账号
│   │
│   ├── services/                 # 业务逻辑层
│   │   ├── sources/              # 音源 Provider
│   │   │   ├── index.ts          # 音源导出
│   │   │   ├── sourceService.ts  # 音源服务入口
│   │   │   ├── wyProvider.ts     # 网易云音乐 Provider
│   │   │   └── txProvider.ts     # QQ 音乐 Provider
│   │   ├── playback/             # 播放解析后端
│   │   │   ├── types.ts          # 播放后端类型
│   │   │   ├── playbackResolver.ts # 播放解析器（选择后端）
│   │   │   ├── apiGatewayBackend.ts  # API 网关后端
│   │   │   ├── builtinNeteaseBackend.ts # 内置网易云后端
│   │   │   └── customSourceBackend.ts  # 自定义源后端
│   │   ├── playerEngine.ts       # WebAudio 播放引擎
│   │   ├── gatewayService.ts     # API 网关服务
│   │   ├── customSourceRuntime.ts # 自定义源运行时（Web Worker 沙箱）
│   │   ├── lyricsService.ts      # 歌词服务
│   │   ├── downloadService.ts    # 下载服务
│   │   ├── commentsService.ts    # 评论服务
│   │   ├── updateService.ts      # 自动更新服务
│   │   ├── scrobbleService.ts    # 听歌记录服务
│   │   ├── playlistTransferService.ts # 歌单迁移服务
│   │   ├── webdavSyncService.ts  # WebDAV 同步服务
│   │   ├── localMusicService.ts  # 本地音乐服务
│   │   └── wyAccountService.ts   # 网易云账号服务
│   │
│   ├── hooks/                    # 自定义 Hooks
│   │   ├── useKeyboardShortcuts.ts # 全局键盘快捷键
│   │   ├── useLyrics.ts          # 歌词解析 Hook
│   │   └── useNativeControls.ts  # 原生媒体控制（MediaSession API）
│   │
│   ├── lib/                      # 工具库
│   │   ├── crypto/
│   │   │   └── weapi.ts          # 网易云 weapi 加密（前端侧）
│   │   └── utils.ts              # 通用工具函数
│   │
│   ├── styles/                   # CSS 样式模块
│   │   ├── theme.css             # 主题变量（亮色/暗色）
│   │   ├── layout.css            # 布局样式
│   │   ├── home.css              # 首页样式
│   │   ├── search.css            # 搜索页样式
│   │   ├── player.css            # 播放器样式
│   │   ├── playlists.css         # 歌单页样式
│   │   ├── settings.css          # 设置页样式
│   │   └── local-music.css       # 本地音乐页样式
│   │
│   ├── types/
│   │   └── soundtouchjs.d.ts     # SoundTouchJS 类型声明
│   │
│   └── assets/
│       └── logo.png              # 应用 Logo
│
├── 📂 src-tauri/                 # ── Rust 后端 ──
│   ├── Cargo.toml                # Rust 项目配置
│   ├── Cargo.lock                # Rust 锁文件
│   ├── build.rs                  # Tauri 构建脚本
│   ├── tauri.conf.json           # Tauri 窗口/权限/打包配置
│   │
│   ├── capabilities/
│   │   └── default.json          # 权限声明（fs, dialog, shell, http, deep-link, global-shortcut）
│   │
│   ├── icons/                    # 应用图标
│   │   ├── icon.ico
│   │   ├── icon.png
│   │   ├── 32x32.png
│   │   ├── 128x128.png
│   │   └── 128x128@2x.png
│   │
│   └── src/                      # Rust 源码（8 个模块）
│       ├── main.rs               # 入口：插件注册、命令注册、窗口事件
│       ├── commands.rs           # IPC 命令处理（~25 个命令）
│       ├── config.rs             # 配置持久化（JSON 文件）
│       ├── gateway.rs            # 网易云 API 网关（加密 + HTTP 代理）
│       ├── library.rs            # 用户数据持久化（按命名空间 JSON 文件）
│       ├── lyric_window.rs       # 桌面歌词窗口管理
│       ├── shortcuts.rs          # 全局快捷键（媒体键 + 自定义）
│       ├── tray.rs               # 系统托盘菜单
│       └── models.rs             # 数据模型定义
│
├── 📂 docs/                      # 项目文档
│   ├── CUSTOM_SOURCE_AND_GATEWAY_DESIGN.md
│   └── superpowers/
│       ├── plans/
│       │   └── 2026-06-16-auralflow-ui-refactor.md
│       └── specs/
│           └── 2026-06-16-auralflow-ui-design.md
│
├── 📂 dist/                      # 构建产物（Vite 输出）
│
└── 📂 README.md / QUICK_START.md / REFACTOR_SUMMARY.md
```

---

## 3. 架构设计

### 3.1 整体分层

```
┌─────────────────────────────────────────────────────┐
│                   React 前端                         │
│  Views → Components → Stores (Zustand) → Services    │
├──────────────────┬──────────────────────────────────┤
│  @lx/core        │  @lx/tauri-bridge                 │
│  音源抽象层       │  类型安全 IPC 封装                  │
├──────────────────┴──────────────────────────────────┤
│                 Tauri IPC (invoke)                    │
├─────────────────────────────────────────────────────┤
│                   Rust 后端                           │
│  commands → gateway / config / library / ...         │
├─────────────────────────────────────────────────────┤
│              操作系统 / 文件系统 / 网络               │
└─────────────────────────────────────────────────────┘
```

### 3.2 前端架构

| 层级 | 说明 |
|------|------|
| **Views** | 16 个页面级组件，React Router 嵌套路由 |
| **Components** | 可复用 UI 组件（Layout、PlayerBar、VirtualList 等） |
| **Stores** | 16 个 Zustand Store，各管一块状态 |
| **Services** | 业务逻辑，调用 Tauri Bridge 或直接处理前端逻辑 |
| **Hooks** | 封装复用逻辑（快捷键、歌词、媒体控制） |
| **Lib** | 底层工具（加密、通用函数） |

**路由结构：**

```
/ (Layout)
├── / (HomeView)              首页
├── /search (SearchView)      搜索
├── /library (FavoritesView)  收藏
├── /local (LocalMusicView)   本地音乐
├── /playlists (PlaylistsView) 歌单列表
├── /downloads (DownloadsView) 下载管理
├── /playlist/:id             歌单详情
├── /artist/:id               歌手详情
├── /album/:id                专辑详情
├── /daily                    每日推荐
├── /fm                       私人 FM
├── /settings                 设置
└── /player (PlayerView)      全屏播放器（独立路由，无 Layout）
```

应用支持**双角色模式**：通过 URL hash 检测，`hash=lyric` 时渲染桌面歌词窗口视图，否则渲染主应用。

### 3.3 后端架构（Rust）

| 模块 | 职责 |
|------|------|
| `main.rs` | 应用入口，注册 Tauri 插件、IPC 命令处理器、窗口事件（关闭时最小化到托盘） |
| `commands.rs` | IPC 命令实现（~25 个），涵盖配置、搜索、URL 解析、歌词、下载、本地音频、用户数据、歌词窗口 |
| `gateway.rs` | 网易云 API 网关，实现 weapi 加密协议（AES-CBC/ECB + RSA 无填充 + MD5），代理 HTTP 请求 |
| `config.rs` | 应用设置持久化（JSON 文件读写、patch 更新、重置） |
| `library.rs` | 用户数据命名空间持久化（favorites / playlists / library / customSources / recent / soundEffect） |
| `lyric_window.rs` | 桌面歌词窗口管理（创建/销毁、位置/尺寸持久化、置顶控制） |
| `tray.rs` | 系统托盘菜单（播放/暂停、上/下一首、歌词窗口、显示窗口、退出） |
| `shortcuts.rs` | 全局快捷键注册（MediaPlayPause / MediaTrackPrev / MediaTrackNext + 自定义 Ctrl+Alt 组合键） |
| `models.rs` | Rust 数据模型定义，使用 `serde(rename_all = "camelCase")` 与前端对齐 |

### 3.4 Monorepo 子包

| 子包 | 包名 | 状态 | 说明 |
|------|------|------|------|
| `packages/core` | `@lx/core` | ✅ 已实现 | 音源抽象：`MusicSource` 接口、`SourceRegistry` 注册表、`SourceResolver` 多源解析器、`GatewayProvider` 网关、`CustomSourceProvider` 自定义源 |
| `packages/tauri-bridge` | `@lx/tauri-bridge` | ✅ 已实现 | 所有 Tauri `invoke` 调用的类型安全封装，包含 Rust 模型类型定义，与 `models.rs` 严格对齐 |
| `packages/ui` | `@lx/ui` | 🔲 待开发 | 共享 UI 组件（当前空导出） |
| `packages/i18n` | `@lx/i18n` | 🔲 待开发 | 国际化（当前空导出） |

---

## 4. 核心功能详解

### 4.1 多源音乐系统

```
┌──────────────┐    ┌───────────────┐    ┌──────────────────┐
│   wyProvider  │    │  txProvider   │    │ CustomSource     │
│   (网易云)     │    │  (QQ音乐)    │    │ (用户脚本沙箱)    │
└──────┬───────┘    └──────┬────────┘    └────────┬─────────┘
       │                   │                      │
       └───────────────┬───┴──────────────────────┘
                       ▼
              ┌────────────────┐
              │  SourceRegistry │  音源注册表
              └───────┬────────┘
                      ▼
              ┌────────────────┐
              │ SourceResolver  │  多源解析器
              │ (轮转/降级/网关) │
              └────────────────┘
```

**解析策略三种模式：**

| 模式 | 说明 |
|------|------|
| `source-rotation` | 依次尝试音源，支持跨源匹配（按歌名+歌手+时长搜索其他源） |
| `gateway-first` | 优先使用外部 API 网关，失败后降级到内置音源 |
| `gateway-only` | 仅使用外部 API 网关 |

**音质优先级：** FLAC > 320kbps > 128kbps

### 4.2 播放引擎

基于 `HTMLAudioElement` + WebAudio API 的效果处理链：

```
HTMLAudioElement → createMediaElementSource
    → BiquadFilter (均衡器，多频段)
    → StereoPannerNode (声像控制)
    → ConvolverNode (混响，脉冲响应)
    → GainNode (dry/wet 混合)
    → AudioContext.destination
```

额外能力：
- **SoundTouchJS 变速变调**（实验性）
- **歌曲预加载**（无缝播放）
- **setSinkId 输出设备选择**
- **MediaSession API**（系统通知栏媒体控制）

### 4.3 网易云加密协议

完整复现网易云客户端的 weapi 加密流程：

```
请求参数
    │
    ▼
AES-128-CBC 加密 (随机密钥 + 固定 IV)
    │
    ▼
RSA 无填充加密 (公钥，预计算)
    │
    ▼
base64 编码
    │
    ▼
POST https://music.163.com/weapi/...
    params=<AES密文>&encSecKey=<RSA密文>
```

前端 `weapi.ts` 负责加密，Rust `gateway.rs` 负责代理转发（CORS 规避）。

### 4.4 本地音乐管理

Rust 后端负责扫描和元数据读写：

| 操作 | 实现 |
|------|------|
| 目录扫描 | `walkdir` 递归遍历 |
| 标签读取 | `audiotags`（标题/艺术家/专辑/时长/封面） |
| 歌词读取 | `lofty`（ID3v2 USLT / Vorbis LYRICS） |
| 封面提取 | Base64 编码的 data URL |
| 标签写入 | `audiotags`（标题/艺术家/专辑） |
| 封面写入 | `audiotags`（Picture） |
| 歌词写入 | `lofty`（ItemKey::Lyrics） |

### 4.5 桌面歌词窗口

独立 Tauri 窗口特性：
- 无边框、透明背景、置顶显示
- 可拖拽、可调整大小
- 位置和尺寸自动持久化
- 通过 `toggle_lyric_window` IPC 命令控制开关
- 主窗口关闭时最小化到托盘，不退出应用

### 4.6 IPC 命令清单

`commands.rs` 注册的 25 个 IPC 命令：

**配置管理（4 个）：**

| 命令 | 说明 |
|------|------|
| `load_settings` | 加载应用设置 |
| `save_settings` | 保存全部设置 |
| `patch_settings` | 部分更新设置 |
| `reset_settings` | 重置为默认设置 |

**音源网关（5 个）：**

| 命令 | 说明 |
|------|------|
| `search_songs` | 搜索歌曲 |
| `search_playlists` | 搜索歌单 |
| `get_music_url` | 获取播放 URL |
| `get_lyric` | 获取歌词 |
| `get_playlist_detail` | 获取歌单详情 |

**网易云账号（6 个）：**

| 命令 | 说明 |
|------|------|
| `wy_check_account` | 检查账号状态 |
| `wy_get_user_playlists` | 获取用户歌单 |
| `wy_get_liked_ids` | 获取喜欢歌曲 ID |
| `wy_get_daily_recommend` | 获取每日推荐 |
| `wy_get_playlist_detail` | Cookie 获取歌单详情 |
| `wy_proxy_weapi` | 代理 weapi 加密请求 |

**音乐 API 网关（1 个）：**

| 命令 | 说明 |
|------|------|
| `music_api_gateway_get` | 外部网关 GET 代理 |

**下载（1 个）：**

| 命令 | 说明 |
|------|------|
| `download_file` | 下载文件到本地（带进度事件） |

**本地音频（5 个）：**

| 命令 | 说明 |
|------|------|
| `scan_directory` | 递归扫描音频文件 |
| `get_audio_info` | 获取单个文件元数据 |
| `set_audio_metadata` | 写入标签（标题/艺术家/专辑） |
| `set_audio_cover` | 写入封面图片 |
| `set_audio_lyrics` | 写入内嵌歌词 |

**用户数据持久化（4 个）：**

| 命令 | 说明 |
|------|------|
| `library_load` | 读取命名空间数据 |
| `library_save` | 写入命名空间数据 |
| `library_reset` | 重置单个命名空间 |
| `library_reset_all` | 重置所有用户数据 |

**桌面歌词窗口（2 个）：**

| 命令 | 说明 |
|------|------|
| `toggle_lyric_window` | 开关歌词窗口 |
| `set_lyric_window_pinned` | 设置置顶状态 |

---

## 5. 构建与开发

### 常用命令

```bash
# 安装依赖
pnpm install

# 启动开发环境（Vite + Tauri 窗口）
pnpm tauri:dev

# 仅启动前端开发服务器
pnpm dev

# 前端类型检查
pnpm typecheck

# 构建前端
pnpm build

# 构建桌面安装包（需 bundle.active=true + 图标）
pnpm tauri:build

# 生成应用图标
pnpm tauri icon path/to/icon.png
```

### Vite 代码分割策略

| 分块 | 包含内容 |
|------|----------|
| `react-vendor` | react, react-dom, react-router-dom |
| `tauri-vendor` | @tauri-apps/api, @tauri-apps/plugin-* |
| `crypto-vendor` | crypto-js, node-forge |
| `ui-vendor` | lucide-react, zustand |
| `webdavSyncService` | webdavSyncService（动态加载） |
| `index` | 应用主代码 |

### TypeScript 路径别名

```json
{
  "@/*": ["./src/*"],
  "@lx/core": ["./packages/core/src"],
  "@lx/tauri-bridge": ["./packages/tauri-bridge/src"],
  "@lx/ui": ["./packages/ui/src"],
  "@lx/i18n": ["./packages/i18n/src"]
}
```

---

## 6. Zustand Store 清单

| Store | 文件 | 职责 |
|-------|------|------|
| `playerStore` | `playerStore.ts` | 播放器核心状态（当前曲目、播放状态、进度、模式） |
| `playerSync` | `playerSync.ts` | 播放器同步（多窗口状态同步、角色检测） |
| `playlistStore` | `playlistStore.ts` | 播放队列管理 |
| `favoritesStore` | `favoritesStore.ts` | 收藏歌曲管理 |
| `historyStore` | `historyStore.ts` | 播放历史记录 |
| `libraryStore` | `libraryStore.ts` | 音乐库数据 |
| `libraryPersistence` | `libraryPersistence.ts` | 音乐库持久化到 Tauri |
| `discoveryStore` | `discoveryStore.ts` | 发现页数据（推荐、热门等） |
| `downloadStore` | `downloadStore.ts` | 下载任务和进度 |
| `themeStore` | `themeStore.ts` | 主题切换（亮色/暗色/自动） |
| `sleepTimerStore` | `sleepTimerStore.ts` | 睡眠定时器 |
| `soundEffectStore` | `soundEffectStore.ts` | 均衡器、混响等音效设置 |
| `audioDeviceStore` | `audioDeviceStore.ts` | 音频输出设备枚举和选择 |
| `customSourceStore` | `customSourceStore.ts` | 自定义音源脚本管理 |
| `wyAccountStore` | `wyAccountStore.ts` | 网易云账号信息和登录状态 |

---

## 7. 数据持久化方案

| 数据类型 | 存储方式 | 说明 |
|----------|----------|------|
| 应用设置 | Tauri JSON 文件 (`config.rs`) | 全量读写 + patch 更新 |
| 收藏/歌单/音乐库/自定义源/历史/音效 | Tauri 命名空间 JSON (`library.rs`) | 按 namespace 隔离，6 个命名空间 |
| 桌面歌词窗口位置/尺寸 | Tauri JSON (嵌入设置) | `lyricWindowX/Y/Width/Height` |
| 网易云 Cookie | 嵌入应用设置 | `wyCookie` 字段 |

---

## 8. 系统能力集成

| 能力 | 实现方式 |
|------|----------|
| 系统托盘 | `tauri-plugin-tray-icon`（自定义菜单：播放控制、歌词窗口、退出） |
| 全局快捷键 | `tauri-plugin-global-shortcut`（媒体键 + Ctrl+Alt 自定义） |
| Deep Link | `tauri-plugin-deep-link`（Windows 注册表写入 `auralflow://` 协议） |
| 文件对话框 | `tauri-plugin-dialog`（选择文件夹等） |
| 文件系统 | `tauri-plugin-fs` |
| HTTP 请求 | `tauri-plugin-http`（含 `unsafe-headers` 特性） |
| Shell | `tauri-plugin-shell` |
| 窗口关闭行为 | 拦截 CloseRequested → 隐藏窗口（最小化到托盘），退出走托盘菜单 |

---

## 9. 文件统计

| 类别 | 数量 |
|------|------|
| 前端源文件 (.tsx/.ts) | 72 |
| CSS 样式文件 | 8 |
| Rust 源文件 (.rs) | 10（含 build.rs，不含 target/） |
| Monorepo 子包源文件 | 11 |
| IPC 命令 | 25 |
| Zustand Store | 15 |
| 页面视图 | 16 |
| UI 组件 | 14 |
| Service 服务 | 16 |
| 自定义 Hook | 3 |

---

## 10. 待开发 / 待改进

| 项目 | 说明 |
|------|------|
| `@lx/ui` | 共享 UI 组件库，当前为空 |
| `@lx/i18n` | 国际化支持，当前为空 |
| QQ 音乐 Provider | `txProvider.ts` 已有前端实现，Rust 端尚未接入 IPC |
| 自定义源 | `@lx/core` 已有框架，运行时和编辑 UI 待完善 |
| 测试 | 未发现测试文件，建议添加单元测试和集成测试 |
| bundle.active | 当前为 `false`，正式发布需开启并配置图标和签名 |
| 错误处理 | 部分地方使用 `.catch(() => {})` 静默处理，建议统一错误上报 |

---

## 11. Git 历史

```
ba329e7 docs: update project docs for source cleanup
e73b69f chore: cleanup music sources and fix TypeScript errors
ff5449c chore: save work-in-progress snapshot
43c44c3 feat: album search, sleep timer, local music framework
4bf85f3 feat: add singer search with artist detail page
61d0a74 fix: search page not rendering when nav_search is active
41e9b65 Remove unused files
92a8673 Initial commit: merge desktop (Electron + Vue 3) and mobile (React Native) projects
```

项目经历了从 Electron + Vue 3 / React Native 混合项目到 Tauri v2 + React 的完整技术栈迁移，当前以单一代码库统一管理。
