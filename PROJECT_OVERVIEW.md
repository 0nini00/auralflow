# 项目架构概览

AuralFlow 是基于 TypeScript 与 Rust 构建的双端音乐播放器。桌面端与移动端通过 `@lx/core` 复用平台无关的领域模型与纯逻辑，同时分别维护各自的播放引擎、状态编排、网络适配与系统集成。

> pnpm monorepo · 4 个 workspace 包 · 版本 0.1.0 · 仓库 https://github.com/0nini00/auralflow.git

## 架构分层

```mermaid
flowchart TB
    subgraph Core["@lx/core（packages/core · 18 文件 2255 行 TS · 无构建）"]
        C1[sources/ 源注册与解析]
        C2[lyrics/ 歌词解析与同步]
        C3[playback-quality 质量排序唯一真相源]
        C4[stream-integrity 试听检测]
        C5[webdav-merge 加法合并纯函数]
        C6[outbound-host SSRF 守卫]
        C7[mobile-api gdstudio 网关]
        C8[cover-image / switch-step-queue / custom-source]
    end

    subgraph Desktop["@auralflow/desktop（desktop/）"]
        D1[React 18.3.1 前端<br/>12 路由 BrowserRouter v6<br/>~16 Zustand store]
        D2[playerEngine.ts 388 行<br/>HTMLAudio + rAF + 余弦淡入淡出]
        D3[customSourceRuntime.ts 776 行<br/>new Function 沙箱 + LRU(8) + HTTP 代理]
        D4[Rust 后端 17 文件 2747 行<br/>39 IPC 命令]
        D5["@lx/tauri-bridge IPC 桥 345 行"]
    end

    subgraph Mobile["@auralflow/mobile（apps/mobile/）"]
        M1[React Native 0.86 + React 19.2.3]
        M2[playerStore.ts 1004 行<br/>静音间隙技巧]
        M3[playbackService.ts<br/>RNTP 后台 PlaybackActiveTrackChanged]
        M4[15 Zustand store<br/>Drawer > NativeStack > BottomTabs]
        M5[Android 原生 10 Java + 2 Kotlin 2111 行]
    end

    Core --> Desktop
    Core --> Mobile
    D5 --> D4
```

## @lx/core 职责清单

| 模块 | 行数 | 职责 |
|---|---|---|
| `sources/registry.ts` | — | 音源注册表 |
| `sources/resolver.ts` | 250 | 源轮询解析、跨源匹配、搜索结果合并去重 |
| `sources/types.ts` | — | `MusicSource` / `MusicInfo` / `Lyric` 等领域模型 |
| `sources/custom-source.ts` | — | 自定义音源类型 |
| `sources/tx-meta.ts` | — | 腾讯音源元数据 |
| `lyrics/parser.ts` | — | LRC / YRC / QRC / KRC 等 6 格式归一化解析 |
| `lyrics/playbackSync.ts` | — | 二分查找行定位，0.12s 提前量 |
| `playback-quality.ts` | 186 | 质量排序唯一真相源，`raceForBestQuality` 800ms 升级窗口 |
| `stream-integrity.ts` | — | 试听检测 |
| `webdav-merge.ts` | 237 | 纯函数加法合并，删除不传播 |
| `outbound-host.ts` | 143 | SSRF 守卫，与 Rust 双实现契约 |
| `mobile-api.ts` | — | gdstudio 网关依赖注入传输 |
| `cover-image.ts` | — | 缩略图处理 |
| `switch-step-queue.ts` | — | 连点合并 |

`@lx/core` 独立于 UI 框架与平台运行时，**无构建步骤**（`main` / `types` 直接指向 `src/index.ts`）。播放队列、播放状态、缓存 IO、自定义音源运行沙箱、平台网络请求仍由双端分别实现。

## 各端职责说明

### 桌面端（`@auralflow/desktop`）

Tauri v2 + React 18.3.1 + Vite 5，提供原生 OS 交互体验。

| 层 | 职责 | 关键实现 |
|---|---|---|
| Rust 后端 | 系统级任务，39 IPC 命令 | `outbound.rs`（SSRF + 每跳验证 ≤10）、`lyric_window.rs`（753 行 透明置顶 webview + 150ms 轮询穿透悬停 + token/epoch 防竞态）、`local_audio.rs`（walkdir + audiotags/lofty 双库）、`media_cache.rs`（三层 2GiB LRU）、`downloads.rs`（流式 + 取消 + 180ms 节流）、`tray.rs` |
| React 前端 | UI 与业务 | `playerEngine.ts`（388 行 HTMLAudio + rAF + 500ms 后备 + 余弦淡入淡出 90/140ms）、`customSourceRuntime.ts`（776 行 new Function 沙箱 + LRU(8) + HTTP 代理 Rust）、`webdavSyncService.ts`（629 行 同步锁 + 冲突检测）、`wyAccountService.ts`（601 行 weapi/eapi + QR 登录） |
| 导航 | 12 路由 BrowserRouter v6 | search / library / local / playlists / downloads / history / playlist/:id / artist/:id / album/:id / daily / fm / settings |
| 视觉 | 玻璃拟态 | `--af-*` CSS 变量 + `backdrop-filter`、`ImmersiveLyricsOverlay`（纯 CSS/DOM 卡拉 OK） |
| IPC 桥 | `@lx/tauri-bridge` 345 行 | 封装 Tauri invoke |

### 移动端（`@auralflow/mobile`）

React Native 0.86 + React 19.2.3，面向 Android（minSdk 24）。

| 层 | 职责 | 关键实现 |
|---|---|---|
| 播放核心 | 前台保活 + 后台推进 | `playerStore.ts`（1004 行 静音间隙技巧：真实歌曲 + SILENCE_GAP_TRACK 2s 保持前台服务）、`playbackService.ts`（RNTP 后台 `PlaybackActiveTrackChanged` 驱动推进） |
| 导航 | Drawer > NativeStack > BottomTabs + MaterialTopTabs | `navigation/` |
| 沉浸歌词 | PagerView 2 页 | `ImmersiveLyricsScreen`（useImmersiveController 558 行 + 下拉关闭）、`LyricView`（587 行 动态行高 + 累积偏移） |
| 列表 | 增量挂载（非 FlatList） | — |
| 图片 | CachedImage（Glide） | — |
| Android 原生 | 10 Java + 2 Kotlin 2111 行 | 6 模块：`LocalMusicModule`（778 行 MediaStore + jaudiotagger）、`LyricOverlayService`（407 行 WindowManager 浮窗）、`SecureStorageModule`（Keystore AES-256-GCM）、`CryptoModule`（原生 weapi）、`ImagePicker`、`CustomSourceFilePicker`；`lx_bridge`（WebView 跑 LX 脚本 + vendor.js 2510 行 CryptoJS + pako）；通知栏歌词开关（`apply-track-player-patch.js` 补丁） |
| 权限 | 无 RECORD_AUDIO | INTERNET / SYSTEM_ALERT_WINDOW / WAKE_LOCK / FOREGROUND_SERVICE_MEDIA_PLAYBACK / POST_NOTIFICATIONS / READ_MEDIA_AUDIO |

## 关键设计决策摘要

### 1. 双 React 版本共存

桌面端 React 18.3.1，移动端 React 19.2.3，双端共享同一个 store 与核心。`pnpm-workspace.yaml` 的 `packageExtensions` 将 `@types/react@18.3.31` 钉到 `react@18`、`lucide-react@0.460.0`、`react-router@6`、`react-router-dom@6`，避免桌面端解析到提升的 `@types/react@19` 而触发 TS2786 JSX 组件错误。

### 2. @lx/core 无构建

`@lx/core` 的 `main` 与 `types` 直接指向 `src/index.ts`，无编译产物。双端通过 TypeScript 路径直接消费源码，改完即生效，不引入额外的构建链与产物同步成本。

### 3. SSRF 双实现契约

`outbound-host.ts` 是出站主机判定的书面定义（JS 侧），`desktop/src-tauri/src/outbound.rs` 是 Rust 侧的同一套规则。桌面端请求由 Rust 发出，移动端请求在 JS 侧发出，两份实现各自带测试，**规则变更时必须同步**。显式边界：只允许 http/https；拒绝 localhost / `.local` / 回环 / 私有 / 链路本地 / CGNAT / 未指定 / 多播 / 广播 / 文档示例地址；**不做** DNS 解析后校验（DNS rebinding 不在拦截范围）。

### 4. 静音间隙技巧

移动端 `playerStore.ts` 在每首真实歌曲尾部插入 `SILENCE_GAP_TRACK`（2s 静音占位轨，`android.resource://.../raw/silence_2s`）。`playbackService.ts` 监听 `PlaybackActiveTrackChanged`，当激活轨为 `SILENCE_GAP_TRACK_ID` 时推进到下一首真实歌曲。借此在不依赖额外定时器的前提下保持前台服务存活、实现无缝衔接。

### 5. 质量竞速

`playback-quality.ts` 是音质序关系的唯一真相源（收敛此前散落三处的不一致实现）。`raceForBestQuality` 让全部候选并发，首个成功结果开启 800ms 升级窗口，窗口内更高音质翻盘则替换，达到 ceiling 或窗口到期即定稿；两层竞速（通道之间、单通道内音源×音质）共用同一个窗口值，最坏额外等待仍是一个窗口。`buildPlaybackQualityTiers` 生成「不低于用户选定音质」的分轮次表：首轮全部高档并发，失败才逐档下调。

### 6. WebDAV 加法合并

`webdav-merge.ts` 是纯函数、无副作用、可单测。合并规则：收藏按 `source:id` 去重取并集；本地歌单同名 id 按 `updatedAt` 新者胜、歌曲保留并集；云端引用歌单按 id 并集保留较新者；播放历史并集按顺序截断上限。**删除不传播**——本地有而远端无的实体保留本地版本。

## 对齐状态

已对齐：wy / tx / bili + local 源、QR / Cookie 登录、日推、私人 FM、B站收藏、WebDAV、4 播放模式、淡入淡出、倍速、音效、5 级下载。

差异为平台原生：

| 端 | 差异能力 |
|---|---|
| 桌面 | 浮动歌词窗口 / 托盘 / 热键 / Rust 文件操作 / 可变下载目录 / cursor 特效 |
| 移动 | 通知栏 / TrackPlayer 后台 / 锁屏 / deep link / 分享 / MV / 首页 feed / Android 浮窗歌词 / 自动检查自定义源 |

## 常用命令

```bash
# 开发
pnpm desktop:dev          # Vite dev（浏览器）
pnpm desktop:tauri:dev    # Tauri dev（原生窗口）
pnpm mobile:start         # Metro
pnpm mobile:android       # 运行到设备

# 类型检查
pnpm desktop:typecheck
pnpm mobile:typecheck
pnpm mobile:lint

# Rust 检查
cargo check --manifest-path desktop/src-tauri/Cargo.toml

# 构建
pnpm desktop:tauri:build   # 桌面安装包
pnpm mobile:build:debug    # 移动 debug APK
```
