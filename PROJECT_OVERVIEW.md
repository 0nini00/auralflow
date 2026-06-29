# AuralFlow 项目概览

本文按当前代码结构整理，不以历史计划文档为依据。

## 基本信息

| 项目 | 内容 |
|---|---|
| 应用 | AuralFlow |
| 版本 | 0.1.0 |
| 桌面框架 | Tauri v2 |
| 前端 | React 18 + TypeScript + Vite |
| 状态管理 | Zustand |
| 路由 | React Router 6 |
| 包管理 | pnpm workspace |

## 前端入口和路由

`src/App.tsx` 根据窗口角色渲染主应用、桌面歌词窗口或桌面歌词解锁窗口。

主窗口路由：

| 路由 | 视图 |
|---|---|
| `/` | `HomeView` |
| `/search` | `SearchView` |
| `/library` | 重定向到 `/playlist/favorites` |
| `/local` | `LocalMusicView` |
| `/playlists` | `PlaylistsView` |
| `/downloads` | `DownloadsView` |
| `/playlist/:id` | `PlaylistDetailView` |
| `/artist/:id` | `ArtistDetailView` |
| `/album/:id` | `AlbumDetailView` |
| `/daily` | `DailyRecommendView` |
| `/fm` | `PersonalFmView` |
| `/settings` | `SettingsView` |

特殊窗口：

| 角色 | 视图 |
|---|---|
| `lyric` | `LyricWindowView` |
| `lyric-unlock` | `LyricUnlockView` |

## 目录结构

```text
src/
├── components/                 # PlayerBar、沉浸歌词、弹窗、通用组件
├── hooks/                      # 快捷键、歌词、播放进度、媒体控制
├── lib/crypto/weapi.ts         # 网易云 weapi 加密
├── services/
│   ├── playback/               # 播放 URL 解析、预取、播放模式
│   ├── search/                 # 搜索聚合、缓存、元数据合并
│   ├── sources/                # wy/tx provider
│   ├── builtinMusicApiClient.ts
│   ├── customSourceRuntime.ts
│   ├── downloadService.ts
│   ├── localMusicService.ts
│   ├── lyricsService.ts
│   ├── playerEngine.ts
│   ├── userDataReset.ts
│   ├── webdavSyncService.ts
│   └── wyAccountService.ts
├── stores/                     # player、favorites、playlists、library 等 Zustand store
├── styles/                     # 页面和播放器样式
├── utils/                      # 窗口角色、分享链接、桌面歌词等工具
└── views/                      # 路由页面
```

```text
src-tauri/src/
├── commands.rs                 # Tauri IPC 命令
├── config.rs                   # 应用设置 JSON 持久化
├── library.rs                  # 用户数据命名空间 JSON 持久化
├── lyric_window.rs             # 桌面歌词窗口
├── main.rs                     # 插件、命令、托盘注册
├── models.rs                   # Rust 模型
└── tray.rs                     # 系统托盘
```

## 音源与播放

- UI 展示来源保持为 `wy`、`tx`、`local`。
- `packages/core` 提供 `MusicSource`、`SourceRegistry` 和 `SourceResolver`。
- `src/services/sources` 注册内置 `wyProvider` 和 `txProvider`。
- 搜索聚合在 `src/services/search` 中处理歌曲、歌单、歌手和专辑结果。搜索页展示 `综合 / 单曲 / 歌手 / 专辑 / 歌单` 分类，综合页优先展示歌手、新专辑、一个歌单摘要，再展示单曲列表。
- 搜索联想由 `src/services/search/searchSuggestions.ts` 提供，合并网易云在线联想、最近搜索和当前结果中的歌曲、歌手、专辑、歌单关键词。
- 播放解析在 `src/services/playback/playbackResolver.ts` 中完成：先尝试内置音乐 API 元数据，再尝试自定义音源后端。
- 网易云账号相关请求在前端通过 `wyAccountService.ts`、`weapi.ts` 和 Tauri HTTP plugin 发起。

当前代码没有 Rust 侧网易云网关模块，也没有独立的外部网关模式。

## 沉浸式歌词

`PlayerBar.tsx` 的封面点击会打开 `ImmersiveLyricsOverlay.tsx`，当前没有独立 `/player` 路由。覆盖层使用 `useLyrics`、`useInterpolatedPlaybackProgress` 和 `useLyricAutoScroll` 复用现有歌词加载、进度插值和自动滚动逻辑。

沉浸式歌词使用 `PlayerVisualizerRenderer` 渲染滚动歌词视图。

底栏控制按职责拆成三组：左侧歌词工具包含喜欢/歌单、桌面歌词、译文、倍速和音效；中间播放组只保留播放模式、上一首、播放/暂停和下一首；右侧辅助组包含播放队列、全屏、音量和分享。

## 网易云账号登录

`WyCookieLoginModal.tsx` 提供两种登录方式：

| 方式 | 实现 |
|---|---|
| 扫码登录 | `wyAccountService.ts` 调用 `/login/qrcode/unikey` 生成 key，用 `music.163.com/login?codekey=...` 生成二维码，再轮询 `/login/qrcode/client/login` |
| Cookie 登录 | 用户粘贴网页 Cookie，前端规范化后写入设置 |

二维码轮询状态码：`801` 等待扫码，`802` 等待手机确认，`803` 登录成功并返回 Cookie，`800` 过期并停止轮询。二维码 key 和轮询请求都会附带 `timestamp`，避免缓存旧状态。

两种方式最终都写入 `wyCookie`，再调用 `wyAccountStore.load()` 验证账号和加载歌单。验证失败时，弹窗会回滚旧 Cookie、旧账号状态和持久化设置。

## 用户数据

`src-tauri/src/library.rs` 只做透明 JSON IO，不复刻前端 schema。当前命名空间：

| Namespace | 前端 store |
|---|---|
| `favorites` | `favoritesStore` |
| `playlists` | `playlistStore` |
| `library` | `libraryStore` |
| `customSources` | `customSourceStore` |
| `recent` | `historyStore` |
| `soundEffect` | `soundEffectStore` |

设置页的“清空数据”会调用 `library_reset_all`，并同步清空前端内存 store，避免需要重启才生效。

## Tauri IPC 命令

`src-tauri/src/main.rs` 当前注册的命令：

| 分组 | 命令 |
|---|---|
| 设置 | `load_settings`、`save_settings`、`patch_settings`、`reset_settings` |
| 压缩 | `zlib_inflate`、`zlib_deflate` |
| 下载 | `download_file`、`write_download_text_file` |
| 本地音频 | `scan_directory`、`get_audio_info`、`set_audio_metadata`、`set_audio_cover`、`set_audio_lyrics` |
| 用户数据 | `library_load`、`library_save`、`library_reset`、`library_reset_all` |
| 桌面歌词 | `toggle_lyric_window`、`toggle_lyric_window_from_player`、`unlock_lyric_window_from_player`、`get_lyric_window_state`、`prepare_lyric_window_lock`、`is_lyric_window_open`、`set_lyric_window_pinned`、`set_lyric_window_locked` |

## 当前不存在的功能入口

- 收藏入口统一走 `/playlist/favorites`，没有独立收藏页面组件。
- 没有独立 `/player` 路由，沉浸式歌词由 `PlayerBar` 打开覆盖层。
- 网易云请求不走 Rust 代理模块。

## 常用验证

```bash
pnpm run test:regression
pnpm run typecheck
pnpm run build
cd src-tauri
cargo check
```
