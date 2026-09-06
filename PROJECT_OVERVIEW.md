# 项目架构概览

AuralFlow 是基于 TypeScript 与 Rust 构建的双端音乐播放器。桌面端与移动端通过 `@lx/core` 复用平台无关的领域模型与纯逻辑，同时分别维护各自的播放引擎、状态编排、网络适配与系统集成。

> pnpm monorepo · 4 个 workspace 包 · 版本 0.1.0 · 仓库 https://github.com/0nini00/auralflow.git

## 架构分层

```mermaid
flowchart TB
    subgraph Core["@lx/core（packages/core · 18 文件 1981 行 TS · 无构建）"]
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
        D1[React 18.3.1 前端<br/>13 路由 BrowserRouter v6<br/>12 Zustand store]
        D2[playerEngine.ts 388 行<br/>HTMLAudio + rAF + 余弦淡入淡出]
        D3[customSourceRuntime.ts 776 行<br/>new Function 参数遮蔽（非沙箱）+ LRU(8) + HTTP 代理]
        D4[Rust 后端 18 文件 3311 行<br/>35 IPC 命令]
        D5["@lx/tauri-bridge IPC 桥 345 行"]
    end

    subgraph Mobile["@auralflow/mobile（apps/mobile/）"]
        M1[React Native 0.86 + React 19.2.3]
        M2[playerStore.ts 1162 行<br/>静音间隙技巧]
        M3[playbackService.ts<br/>RNTP 后台 PlaybackActiveTrackChanged]
        M4[17 Zustand store<br/>Drawer > NativeStack > BottomTabs]
        M5[Android 原生 12 Java + 2 Kotlin 2496 行]
    end

    Core --> Desktop
    Core --> Mobile
    D5 --> D4
```

## @lx/core 职责清单

| 模块 | 行数 | 职责 |
|---|---|---|
| `sources/registry.ts` | 28 | 音源注册表 |
| `sources/types.ts` | 126 | `MusicSource` / `MusicInfo` / `Lyric` 等领域模型 |
| `sources/custom-source.ts` | 104 | 自定义音源类型 |
| `sources/tx-meta.ts` | 33 | 腾讯取链元数据（strMediaMid，脚本据此拼 M500/F000 文件名） |
| `custom-source.ts` | 61 | 自定义音源脚本契约（与 `sources/custom-source.ts` 并存） |
| `lyrics/parser.ts` | 300 | lrc / enhanced-lrc / yrc / qrc / krc / vtt 6 格式归一化解析 |
| `lyrics/playbackSync.ts` | 75 | `findCurrentLyricLineIndex` 行定位唯一实现（lead 提前量 + 前进滞后带可配，首行前返回 -1）；移动端 `playerService.getCurrentLyricIndex` 已接入。桌面 `services/lyrics/playbackSync` 仍为其本地超集副本（词级进度、时钟外推），迁移待办 |
| `playback-quality.ts` | 186 | 质量排序唯一真相源，`raceForBestQuality` 800ms 升级窗口 |
| `stream-integrity.ts` | 86 | 试听检测 |
| `webdav-merge.ts` | 122 | 纯函数加法合并，删除不传播 |
| `outbound-host.ts` | 295 | SSRF 守卫，与 Rust 双实现契约；自行按 RFC 3986 取 host（不信 RN 的 `URL` polyfill），并归一化到客户端实际连接的形式后再比对黑名单 |
| `mobile-api.ts` | 267 | gdstudio 网关依赖注入传输；`createRacingBuiltinMusicApiClient` 多网关竞速（空数组不视为成功）已就绪但移动端未接线，当前仅单网关客户端 |
| `cover-image.ts` | 65 | 缩略图处理 |
| `switch-step-queue.ts` | 57 | 连点合并 |
| `playlist-link.ts` | 39 | 歌单分享链接解析 |

合计 18 文件 1981 行（含 3 个 barrel：`index.ts` / `lyrics/index.ts` / `sources/index.ts`）。

`@lx/core` 独立于 UI 框架与平台运行时，**无构建步骤**（`main` / `types` 直接指向 `src/index.ts`）。播放队列、播放状态、缓存 IO、自定义音源运行时（桌面同 WebView 非沙箱执行、移动端隐藏 WebView）、平台网络请求仍由双端分别实现。跨源匹配与搜索结果合并去重曾位于 `sources/resolver.ts`，f91c469 判定其解析链不可达后删除，该职责现由双端各自实现。

唯一带自动化测试的包：`pnpm core:test`（vitest，`outbound-host.test.ts` 17 例，锚定「guard 判定的 host 必须等于真实请求的 host」这一不变量——用 Node 的 WHATWG `URL` 作参照物做差分断言）。其余包依赖真机运行时，只做 `typecheck`。

## 各端职责说明

### 桌面端（`@auralflow/desktop`）

Tauri v2 + React 18.3.1 + Vite 5，提供原生 OS 交互体验。

| 层 | 职责 | 关键实现 |
|---|---|---|
| Rust 后端 | 系统级任务，35 IPC 命令 | `outbound.rs`（SSRF + 每跳验证 ≤10）、`lyric_window.rs`（792 行 独立透明窗口：锁定=鼠标穿透+150ms 光标轮询+悬停解锁小窗，置顶 1.5s 巡检 + token/epoch 防竞态）、`local_audio.rs`（walkdir + audiotags/lofty 双库）、`media_cache.rs`（三层：song-audio 2GiB 常量 LRU，covers/bili 不限）、`downloads.rs`（流式 + 取消 + 180ms 节流 + 2GiB 上限，完成后 audiotags 写标签、lofty 写词、旁挂 lrc）、`tray.rs` |
| React 前端 | UI 与业务 | `playerEngine.ts`（388 行 HTMLAudio + rAF + 500ms 纠偏 + 余弦淡入淡出 90/140ms fadeToken + 外部暂停 500ms 保护窗；进度不跨启动恢复，跨窗口由 `stores/playerSync.ts` 经 BroadcastChannel + Tauri 事件同步）、`customSourceRuntime.ts`（776 行 new Function 参数遮蔽，非沙箱——脚本在本 WebView 全权执行 + LRU(8) + HTTP 代理 Rust；能力白名单含 search/playlist）、`webdavSyncService.ts`（629 行 同步锁 + 冲突检测）、`wyAccountService.ts`（601 行 weapi/eapi——`wyProvider.ts` 内另有一份 eapiEncrypt——+ 扫码/Cookie 登录，Cookie 经 Rust DPAPI 加密落盘） |
| 缓存 | 播放 URL / 歌词持久索引 | `persistentCache.ts`（URL 6h / B站 30min / 本地 365d / 歌词 30d / 空结果 7d，LRU 500/1000 条） |
| 导航 | 13 路由 BrowserRouter v6 | 首页(index) / search / local / playlists / bili-collections / downloads / history / playlist/:id / artist/:id / album/:id / daily / fm / settings（library 仅重定向到收藏歌单） |
| 视觉 | 玻璃拟态 | `--af-*` CSS 变量 + `backdrop-filter`、`ImmersiveLyricsOverlay`（纯 CSS/DOM 逐字卡拉 OK：clip-path/背景渐变） |
| IPC 桥 | `@lx/tauri-bridge` 345 行 | 封装 Tauri invoke |

### 移动端（`@auralflow/mobile`）

React Native 0.86 + React 19.2.3，面向 Android（minSdk 24）。

| 层 | 职责 | 关键实现 |
|---|---|---|
| 播放核心 | 前台保活 + 后台推进 | `playerStore.ts`（1162 行 原生恒单曲槽 + 静音间隙技巧：尾部 SILENCE_GAP_TRACK 2s 静音占位轨保持前台服务；播放快照持久化 AsyncStorage）、`playbackService.ts`（RNTP 后台 `PlaybackActiveTrackChanged` 驱动推进，终局失败由 `playbackFailurePolicy` 判定后自动跳歌） |
| 导航 | Drawer > NativeStack > BottomTabs + MaterialTopTabs | `navigation/` |
| 沉浸歌词 | PagerView 2 页 | `ImmersiveLyricsScreen`（useImmersiveController 539 行 + 下拉关闭）、`LyricView`（587 行 动态行高 + 累积偏移；仅行级高亮，逐字渲染为桌面能力） |
| 列表 | 增量挂载（非 FlatList） | — |
| 图片 | CachedImage（Glide） | `cacheService.ts` 2GB LRU（封面/音频 immutable 近似 FIFO，歌词 30 天，AsyncStorage 索引 reconcile；启动时 autoCleanCache 磁盘守卫） |
| Android 原生 | 12 Java + 2 Kotlin 2496 行 | 8 模块：`LocalMusicModule`（778 行 MediaStore + jaudiotagger）、`LyricOverlayModule` + `LyricOverlayService`（439 行 WindowManager 悬浮歌词）、`SecureStorageModule`（Keystore AES-256-GCM）、`CryptoModule`（原生 weapi：AES-CBC + RSA NoPadding，固定向量会话自校验，失败回退 weapiJs）、`CoverColorModule`、`ImagePickerModule`、`ApkInstallerModule`、`CustomSourceFilePickerModule`；`lx_bridge`（隐藏 WebView 沙箱跑 LX 脚本：lx 注入 + 13 个全局名参数遮蔽 + RN 侧静态扫描拒 eval/Function，vendor.js 2510 行 CryptoJS + pako；RN fetch 不能禁重定向，自定义源能力白名单仅 musicUrl（kg/tx/wy）+ local 的 musicUrl/lyric/pic）；通知栏歌词按钮（`apply-track-player-patch.js` 补丁 RNTP `MusicService`） |
| 权限 | 无 RECORD_AUDIO | INTERNET / SYSTEM_ALERT_WINDOW / WAKE_LOCK / FOREGROUND_SERVICE_MEDIA_PLAYBACK / POST_NOTIFICATIONS / READ_MEDIA_AUDIO |

## 关键设计决策摘要

### 1. 双 React 版本共存

桌面端 React 18.3.1，移动端 React 19.2.3，双端共享同一个 store 与核心。`pnpm-workspace.yaml` 的 `packageExtensions` 将 `@types/react@18.3.31` 钉到 `react@18`、`lucide-react@0.460.0`、`react-router@6`、`react-router-dom@6`，避免桌面端解析到提升的 `@types/react@19` 而触发 TS2786 JSX 组件错误。

### 2. @lx/core 无构建

`@lx/core` 的 `main` 与 `types` 直接指向 `src/index.ts`，无编译产物。双端通过 TypeScript 路径直接消费源码，改完即生效，不引入额外的构建链与产物同步成本。

### 3. SSRF 双实现契约

`outbound-host.ts` 是出站主机判定的书面定义（JS 侧），`desktop/src-tauri/src/outbound.rs` 是 Rust 侧的同一套规则。桌面端请求由 Rust 发出，移动端请求在 JS 侧发出，两份实现必须手工同步，无自动化校验，**规则变更时需人工逐条比对**。显式边界：只允许 http/https；拒绝 localhost / `.local` / 回环 / 私有 / 链路本地 / CGNAT / 未指定 / 多播 / 广播 / 文档示例地址；**不做** DNS 解析后校验（DNS rebinding 不在拦截范围）。

守卫要成立，判定的 host 必须与 HTTP 客户端真正连接的 host 是同一个，因此 JS 侧不复用任何 `URL` 实现：RN 的 polyfill 构造函数从不抛错，`hostname` 的 userinfo 分组不排除 `/` `?` `#`，`http://127.0.0.1/@evil.com` 会被读成 `evil.com`。取 host 按 RFC 3986 手写（authority 终止于 `/` `?` `#` `\`，userinfo 取最后一个 `@` 之前），再归一化到客户端实际连接的形式：单次百分号解码、IDNA 句点变体（`。．｡`）折成 ASCII 点、小写、剥尾点；解码出分隔符、畸形百分号序列、形似 IPv4/IPv6 但解析失败，全部按拒绝处理，不 fail-open。inet_aton 写法（`2130706433` / `0177.0.0.1` / `127.1`）先还原再判定。尾点剥离在 Rust 侧同步实现，其余归一化步骤由 `reqwest::Url` 自身完成。移动端补充：RN 的 fetch（whatwg-fetch over XHR）无法禁用重定向，出站校验因此只拦截响应回流（最终 URL），拦不住重定向落点。

### 4. 静音间隙技巧

移动端 `playerStore.ts` 在每首真实歌曲尾部插入 `SILENCE_GAP_TRACK`（2s 静音占位轨，`android.resource://.../raw/silence_2s`）。`playbackService.ts` 监听 `PlaybackActiveTrackChanged`，当激活轨为 `SILENCE_GAP_TRACK_ID` 时推进到下一首真实歌曲。播放终局失败由 `playbackFailurePolicy` 判定、同一后台服务自动跳歌（有限连跳，默认关闭）；播放快照（曲目/进度/音量）持久化到 AsyncStorage，启动后恢复。借此在不依赖额外定时器的前提下保持前台服务存活、实现无缝衔接。

### 5. 质量竞速

`playback-quality.ts` 是音质序关系的唯一真相源（收敛此前散落三处的不一致实现）。`raceForBestQuality` 让全部候选并发，首个成功结果开启 800ms 升级窗口，窗口内更高音质翻盘则替换，达到 ceiling 或窗口到期即定稿；两层竞速（通道之间、单通道内音源×音质）共用同一个窗口值，最坏额外等待仍是一个窗口。`buildPlaybackQualityTiers` 生成「不低于用户选定音质」的分轮次表：首轮全部高档并发，失败才逐档下调。

### 6. WebDAV 加法合并

`webdav-merge.ts` 是纯函数、无副作用、可单测。合并规则：收藏按 `source:id` 去重取并集；本地歌单同名 id 按 `updatedAt` 新者胜、歌曲保留并集；云端引用歌单按 id 并集保留较新者；播放历史并集按顺序截断上限。**删除不传播**——本地有而远端无的实体保留本地版本。远端布局：新根 `/AuralFlow/`（读时回退旧根 `/LX_Music/`），`playlists.json`（v3）+ `user_apis.json`（v2），桌面脚本以 `gz_` 前缀压缩互通。双端防较旧云端覆盖：lastModified 拦截 + 本地备份 + PUT 成功后才写 meta；移动端启动自动同步，桌面手动触发。已知风险：WebDAV 密码桌面明文存 settings JSON、移动明文存 AsyncStorage（凭据加密目前仅覆盖网易云 Cookie——桌面 DPAPI、移动 Keystore AES-256-GCM）。

### 7. 播放地址解析链（双端）

双端共用 `@lx/core` 的 `raceForBestQuality`（800ms 升级窗）与 `buildPlaybackQualityTiers` 分轮。桌面总预算 12s，参赛 backend 仅内置网关（gdstudio）与自定义音源两类，官方直连只剩 B站独立分支与最后兜底；移动端 12s 总预算内含 10s 竞速预算，网关内按音质高→低顺序尝试（防 gdstudio 并发限流），三级缓存（预取 Map → 本地音频文件 → 持久 URL）命中均带探活，试听判定（`isPreviewStream` / `isPreviewDuration`）命中后降档，wy 官方直连（`resolveWySongUrl`）为竞速全败后的最后保险。tx 的「同名搜索转译」已移除——gdstudio 搜索结果无 interval，时长校验失效会误配重录/同名曲；tx 取链依赖 `strMediaMid`（脚本拼 `M500{mid}.mp3` / `F000{mid}.flac`）。

B站：双端 WBI 签名算法同源（两份复制，需人工同步）；DASH 流按 bandwidth 取最高、无 codec 过滤；桌面取链后经 `bili_cache_audio` 落盘、以 asset 协议播放，移动端 URL + referer 直放不缓存。

## 对齐状态

已对齐：wy / tx / bili + local 源、扫码 / Cookie 登录（扫码仅桌面；移动仅 Cookie 粘贴，网易云剪贴板一键读取 + MUSIC_U 检测）、日推、私人 FM、B站收藏、WebDAV、4 播放模式、淡入淡出、倍速、音效、5 级下载。

差异为平台原生：

| 端 | 差异能力 |
|---|---|
| 桌面 | 浮动歌词窗口 / 托盘 / 窗口内快捷键（keydown，无全局热键插件）/ 扫码登录 / Rust 文件操作 / 可变下载目录 / cursor 特效 |
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
