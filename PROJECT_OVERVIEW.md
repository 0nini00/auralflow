---
id: auralflow-architecture
type: architecture-design
status: draft
title: AuralFlow 架构 — 拓扑、模块边界与不变量
parent: auralflow-goal
---

# 项目架构概览

AuralFlow 是基于 TypeScript 与 Rust 构建的双端音乐播放器。桌面端与移动端通过 `@lx/core` 复用平台无关的领域模型与纯逻辑，同时分别维护各自的播放引擎、状态编排、网络适配与系统集成。

> pnpm monorepo · 4 个 workspace 包 · 版本 0.4.0（desktop）/ 0.3.0（mobile，本次未改） · 仓库 https://github.com/0nini00/auralflow.git

## 架构分层

```mermaid
flowchart TB
    subgraph Core["@lx/core（packages/core · 30 文件 2701 行 TS · 无构建）"]
        C1[sources/ 源注册与领域模型]
        C2[lyrics/ 解析 · 行定位 · 浮窗时钟]
        C3[playback-quality 质量排序唯一真相源]
        C4[stream-integrity 试听检测]
        C5[webdav-merge 加法合并纯函数]
        C6[outbound-host SSRF 守卫]
        C7[mobile-api 网关 / history/ / recommendations/ 等]
    end

    subgraph Desktop["@auralflow/desktop（desktop/）"]
        D1[React 18.3.1 前端<br/>13 路由 BrowserRouter v6<br/>12 Zustand store]
        D2[playerEngine.ts 388 行<br/>HTMLAudio + rAF + 余弦淡入淡出]
        D3[customSourceRuntime.ts 776 行<br/>new Function 参数遮蔽（非沙箱）+ LRU(8) + HTTP 代理]
        D4[Rust 后端 23 文件 5297 行<br/>39 IPC 命令]
        D5["@lx/tauri-bridge IPC 桥 345 行"]
    end

    subgraph Mobile["@auralflow/mobile（apps/mobile/）"]
        M1[React Native 0.86 + React 19.2.3]
        M2[playerStore.ts 1162 行<br/>静音间隙技巧]
        M3[playbackService.ts<br/>RNTP 后台 PlaybackActiveTrackChanged]
        M4[16 Zustand store<br/>Drawer > NativeStack > BottomTabs]
        M5[Android 原生 15 Java + 2 Kotlin 2825 行<br/>11 个原生模块 + lx_bridge 脚本沙箱]
    end

    Core --> Desktop
    Core --> Mobile
    D5 --> D4
```

## @lx/core 职责清单

| 模块 | 行数 | 职责 |
|---|---|---|
| `sources/registry.ts` | 22 | 音源注册表 |
| `sources/types.ts` | 115 | `MusicSource` / `MusicInfo` / `Lyric` 等领域模型 |
| `sources/custom-source.ts` | 90 | 自定义音源类型 |
| `sources/tx-meta.ts` | 28 | 腾讯取链元数据（strMediaMid，脚本据此拼 M500/F000 文件名） |
| `custom-source.ts` | 52 | 自定义音源脚本契约（与 `sources/custom-source.ts` 并存） |
| `lyrics/parser.ts` | 375 | lrc / enhanced-lrc / yrc / qrc / krc / vtt 6 格式归一化解析 |
| `lyrics/playbackSync.ts` | 61 | `findCurrentLyricLineIndex` 行定位唯一实现（lead 提前量 + 前进滞后带可配，首行前返回 -1）；移动端 `playerService.getCurrentLyricIndex` 已接入。桌面 `services/lyrics/playbackSync` 仍为其本地超集副本（词级进度、时钟外推），迁移待办 |
| `lyrics/overlay-clock.ts` | 72 | 悬浮歌词时钟调度：由位置算出当前行与到下一行的毫秒延迟（原生浮窗自走，不依赖 JS 每行推词），并判定前台校准时机 |
| `playback-quality.ts` | 168 | 质量排序唯一真相源，`raceForBestQuality` 800ms 升级窗口 |
| `stream-integrity.ts` | 79 | 试听检测 |
| `webdav-merge.ts` | 136 | 纯函数加法合并，删除不传播 |
| `webdav-sync-error.ts` | 36 | WebDAV 同步拒绝的错误层级：`CloudSyncRefusalError`（设置页据此提示强制下载）与派生的 `CloudDataStaleError`（自动同步据此跳过下载、改上传本地收敛） |
| `outbound-host.ts` | 267 | SSRF 守卫，与 Rust 双实现契约；自行按 RFC 3986 取 host（不信 RN 的 `URL` polyfill），并归一化到客户端实际连接的形式后再比对黑名单 |
| `mobile-api.ts` | 236 | gdstudio 网关依赖注入传输；`createRacingBuiltinMusicApiClient` 多网关竞速（空数组不视为成功）已就绪但移动端未接线，当前仅单网关客户端 |
| `history/listen-threshold.ts` | 83 | 入历史 / 打点阈值追踪（默认 120s 或 50%；只累计播放中的连续推进，排除 seek 与暂停造成的虚假进度） |
| `recommendations/heartbeat-queue.ts` | 87 | 心动模式待播缓冲的补充判定与逐曲推进（batch 播尽时从 buffer 取出并追加） |
| `cover-image.ts` | 56 | 缩略图处理 |
| `switch-step-queue.ts` | 53 | 连点合并 |
| `playlist-link.ts` | 34 | 歌单分享链接解析 |

合计 32 文件 2770 行（25 个模块文件 + 7 个测试文件；含 5 个 barrel：`index.ts` / `lyrics/index.ts` / `sources/index.ts` / `history/index.ts` / `recommendations/index.ts`）。

`@lx/core` 独立于 UI 框架与平台运行时，**无构建步骤**（`main` / `types` 直接指向 `src/index.ts`）。播放队列、播放状态、缓存 IO、自定义音源运行时（桌面同 WebView 非沙箱执行、移动端隐藏 WebView）、平台网络请求仍由双端分别实现。跨源匹配与搜索结果合并去重曾位于 `sources/resolver.ts`，f91c469 判定其解析链不可达后删除，该职责现由双端各自实现。

带自动化测试的是两侧，而非只有一个包：JS/TS 侧 `pnpm test:core`（vitest 3.2.4，7 个测试文件 74 例——`outbound-host` 20 / `webdav-merge` 17 / `overlay-clock` 10 / `removed-source` 8 / `listen-threshold` 8 / `heartbeat-queue` 8 / `webdav-sync-error` 3）；Rust 侧 `pnpm test:rust`（10 个 `#[test]`：`secret_store.rs` 6 个 + `outbound.rs` 4 个——后者是 SSRF 守卫唯一的测试）。其中 `outbound-host.test.ts` 锚定「guard 判定的 host 必须等于真实请求的 host」这一不变量——用 Node 的 WHATWG `URL` 作参照物做差分断言；`webdav-sync-error.test.ts` 锚定同步拒绝的类型层级（两个错误类的 instanceof 关系），因为自动同步正是靠它决定吞掉哪一种拒绝。根目录 `pnpm test:all` 串起「双端类型检查 + 移动端 lint + 两侧测试」，`.github/workflows/ci.yml` 在 CI 里跑同一批命令（Rust 任务必须 windows runner：`secret_store.rs` 在非 Windows 平台是编译期硬失败）。**桌面端与移动端本身依赖真机运行时，没有任何测试文件**——它们的回归只有类型检查、lint 与真机手测。

## 各端职责说明

### 桌面端（`@auralflow/desktop`）

Tauri v2 + React 18.3.1 + Vite 5，提供原生 OS 交互体验。

| 层 | 职责 | 关键实现 |
|---|---|---|
| Rust 后端 | 系统级任务，39 IPC 命令 | `outbound.rs`（SSRF + 每跳验证 ≤10）、`lyric_window.rs`（792 行 独立透明窗口：锁定=鼠标穿透+150ms 光标轮询+悬停解锁小窗，置顶 1.5s 巡检 + token/epoch 防竞态）、`local_audio.rs`（walkdir + audiotags/lofty 双库）、`media_cache.rs`（两层：song-audio 2GiB 常量 LRU，covers 不限）、`downloads.rs`（流式 + 取消 + 180ms 节流 + 2GiB 上限，完成后 audiotags 写标签、lofty 写词、旁挂 lrc）、`tray.rs`、`logging.rs`（`tauri-plugin-log` 落盘到 `app_log_dir()`，2 MiB×3 轮转）、`smtc.rs`（Windows 系统媒体控制：媒体键 / 媒体浮层 / 锁屏，封面走内存流）、`taskbar.rs`（任务栏缩略图三按钮 + DWM 悬浮预览封面，`SetWindowSubclass` 子类化，全程 fail-soft） |
| React 前端 | UI 与业务 | `playerEngine.ts`（388 行 HTMLAudio + rAF + 500ms 纠偏 + 余弦淡入淡出 90/140ms fadeToken + 外部暂停 500ms 保护窗；进度不跨启动恢复，跨窗口由 `stores/playerSync.ts` 经 BroadcastChannel + Tauri 事件同步）、`customSourceRuntime.ts`（776 行 new Function 参数遮蔽，非沙箱——脚本在本 WebView 全权执行 + LRU(8) + HTTP 代理 Rust；能力白名单含 search/playlist）、`webdavSyncService.ts`（629 行 同步锁 + 冲突检测）、`wyAccountService.ts`（601 行 weapi/eapi——`wyProvider.ts` 内另有一份 eapiEncrypt——+ 扫码/Cookie 登录，Cookie 经 Rust DPAPI 加密落盘） |
| 缓存 | 播放 URL / 歌词持久索引 | `persistentCache.ts`（URL 6h / 本地 365d / 歌词 30d / 空结果 7d，LRU 500/1000 条） |
| 导航 | 13 路由 BrowserRouter v6 | 首页(index) / search / library→收藏歌单重定向 / local / playlists / downloads / history / playlist/:id / artist/:id / album/:id / daily / fm / settings |
| 视觉 | 玻璃拟态 | `--af-*` CSS 变量 + `backdrop-filter`、`ImmersiveLyricsOverlay`（纯 CSS/DOM 逐字卡拉 OK：clip-path/背景渐变） |
| IPC 桥 | `@lx/tauri-bridge` 299 行 | 部分 Tauri 命令的类型化包装，**不是唯一 IPC 路径**：桌面前端另有 31 处直接 `import` `@tauri-apps/*`，其中 4 处（`components/MetadataEditModal.tsx`、`services/appBackground.ts`、`services/outboundHttp.ts`、`utils/compression.ts`）直接 `invoke` |

### 移动端（`@auralflow/mobile`）

React Native 0.86 + React 19.2.3，面向 Android（minSdk 24）。

| 层 | 职责 | 关键实现 |
|---|---|---|
| 播放核心 | 前台保活 + 后台推进 | `playerStore.ts`（1162 行 原生恒单曲槽 + 静音间隙技巧：尾部 SILENCE_GAP_TRACK 2s 静音占位轨保持前台服务；播放快照持久化 AsyncStorage）、`playbackService.ts`（RNTP 后台 `PlaybackActiveTrackChanged` 驱动推进，终局失败由 `playbackFailurePolicy` 判定后自动跳歌） |
| 导航 | Drawer > NativeStack > BottomTabs + MaterialTopTabs | `navigation/` |
| 沉浸歌词 | PagerView 2 页 | `ImmersiveLyricsScreen`（useImmersiveController 539 行 + 下拉关闭）、`LyricView`（587 行 动态行高 + 累积偏移；仅行级高亮，逐字渲染为桌面能力） |
| 列表 | 增量挂载（非 FlatList） | — |
| 图片 | CachedImage（Glide） | `cacheService.ts` 2GB LRU（封面/音频 immutable 近似 FIFO，歌词 30 天，AsyncStorage 索引 reconcile；启动时 autoCleanCache 磁盘守卫） |
| Android 原生 | 15 Java + 2 Kotlin 2825 行 | `LocalMusicPackage` 注册 **11 个模块**：`LocalMusicModule`（712 行 MediaStore + jaudiotagger，读写标签与内嵌封面）、`LyricOverlayModule` + `LyricOverlayService`（248 + 661 行 WindowManager 悬浮歌词，配套 `LyricOverlayPreferences` / `LyricNotificationReceiver`）、`SecureStorageModule`（Keystore AES-256-GCM）、`CryptoModule`（原生 weapi：AES-CBC + RSA NoPadding，固定向量会话自校验，失败回退 weapiJs）、`CoverColorModule`、`ImagePickerModule`、`ApkInstallerModule`、`CustomSourceFilePickerModule`、`OrientationModule`、`WakeLockModule`、`BatteryOptimizationModule`；`lx_bridge`（隐藏 WebView 沙箱跑 LX 脚本：lx 注入 + 13 个全局名参数遮蔽 + RN 侧静态扫描拒 eval/Function，vendor.js 2510 行 CryptoJS + pako；RN fetch 不能禁重定向，自定义源能力白名单仅 musicUrl（kg/tx/wy）+ local 的 musicUrl/lyric/pic）；通知栏歌词按钮（`apply-track-player-patch.js` 补丁 RNTP `MusicService`） |
| 权限 | 无 RECORD_AUDIO | INTERNET / SYSTEM_ALERT_WINDOW / WAKE_LOCK / FOREGROUND_SERVICE_MEDIA_PLAYBACK / POST_NOTIFICATIONS / READ_MEDIA_AUDIO |

## 关键设计决策摘要

### 1. 双 React 版本共存

桌面端 React 18.3.1，移动端 React 19.2.3，双端共享同一个 store 与核心。`pnpm-workspace.yaml` 的 `packageExtensions` 将 `@types/react@18.3.31` 钉到 `react@18`、`lucide-react@0.460.0`、`react-router@6`、`react-router-dom@6`，避免桌面端解析到提升的 `@types/react@19` 而触发 TS2786 JSX 组件错误。

### 2. @lx/core 无构建

`@lx/core` 的 `main` 与 `types` 直接指向 `src/index.ts`，无编译产物。双端通过 TypeScript 路径直接消费源码，改完即生效，不引入额外的构建链与产物同步成本。

### 3. SSRF 双实现契约

`outbound-host.ts` 是出站主机判定的书面定义（JS 侧），`desktop/src-tauri/src/outbound.rs` 是 Rust 侧的同一套规则。桌面端请求由 Rust 发出，移动端请求在 JS 侧发出，两份实现必须手工同步，**没有自动校验两份实现一致性的机制**，规则变更时需人工逐条比对。显式边界：只允许 http/https；拒绝 localhost / `.local` / 回环 / 私有 / 链路本地 / CGNAT / 未指定 / 多播 / 广播 / 文档示例地址 / `0.0.0.0/8` / `192.0.0.0/16` / `198.18.0.0/15` / `240.0.0.0/4`；**不做** DNS 解析后校验（DNS rebinding 不在拦截范围）。

**手工同步真的漏过（2026 复盘）**：逐条比对发现 7 处差异，**全部同一方向——JS 侧更严、Rust 侧更宽松**，而文档一直声称两者「契约一致」。根因是 Rust 侧只用标准库判定（`is_loopback` / `is_private` / …），而标准库没有 `0.0.0.0/8`、`192.0.0.0/16`、`198.18.0.0/15`、`240.0.0.0/4` 这四段——JS 侧一直是手写的。四段已补进 `is_blocked_v4`，并由 `outbound.rs` 的 4 个 `#[test]` 钉住（含 mapped IPv6 的继承关系）。**不变量：宽松的那份就是实际的攻击面**，所以分歧一律对齐到更严的一侧。另有两处**有意保留**：`http:example.com`（JS 要求字面 `://`，Rust 交给 WHATWG 归一化——两者都会拦下内网 host）；「形似 IPv4 但解析失败」的 fail-closed（Rust 侧该情形经归一化后只可能落到公开 IP）。**两端一致性仍无自动化校验**：Rust 侧现在有范围判定测试，但没有跨语言对比测试。

守卫要成立，判定的 host 必须与 HTTP 客户端真正连接的 host 是同一个，因此 JS 侧不复用任何 `URL` 实现：RN 的 polyfill 构造函数从不抛错，`hostname` 的 userinfo 分组不排除 `/` `?` `#`，`http://127.0.0.1/@evil.com` 会被读成 `evil.com`。取 host 按 RFC 3986 手写（authority 终止于 `/` `?` `#` `\`，userinfo 取最后一个 `@` 之前），再归一化到客户端实际连接的形式：单次百分号解码、IDNA 句点变体（`。．｡`）折成 ASCII 点、小写、剥尾点；解码出分隔符、畸形百分号序列、形似 IPv4/IPv6 但解析失败，全部按拒绝处理，不 fail-open。inet_aton 写法（`2130706433` / `0177.0.0.1` / `127.1`）先还原再判定。尾点剥离在 Rust 侧同步实现，其余归一化步骤由 `reqwest::Url` 自身完成。移动端补充：RN 的 fetch（whatwg-fetch over XHR）无法禁用重定向，出站校验因此只拦截响应回流（最终 URL），拦不住重定向落点。

### 4. 静音间隙技巧

移动端 `playerStore.ts` 在每首真实歌曲尾部插入 `SILENCE_GAP_TRACK`（2s 静音占位轨，`android.resource://.../raw/silence_2s`）。`playbackService.ts` 监听 `PlaybackActiveTrackChanged`，当激活轨为 `SILENCE_GAP_TRACK_ID` 时推进到下一首真实歌曲。播放终局失败由 `playbackFailurePolicy` 判定、同一后台服务自动跳歌（有限连跳，默认关闭）；播放快照（曲目/进度/音量）持久化到 AsyncStorage，启动后恢复。借此在不依赖额外定时器的前提下保持前台服务存活、实现无缝衔接。

### 5. 质量竞速

`playback-quality.ts` 是音质序关系的唯一真相源（收敛此前散落三处的不一致实现）。`raceForBestQuality` 让全部候选并发，首个成功结果开启 800ms 升级窗口，窗口内更高音质翻盘则替换，达到 ceiling 或窗口到期即定稿；两层竞速（通道之间、单通道内音源×音质）共用同一个窗口值，最坏额外等待仍是一个窗口。`buildPlaybackQualityTiers` 生成「不低于用户选定音质」的分轮次表：首轮全部高档并发，失败才逐档下调。

### 6. WebDAV 加法合并

`webdav-merge.ts` 是纯函数、无副作用、可单测。合并规则：收藏按 `source:id` 去重取并集；本地歌单同名 id 按 `updatedAt` 新者胜、歌曲保留并集；云端引用歌单按 id 并集保留较新者；播放历史并集按顺序截断上限。**删除不传播**——本地有而远端无的实体保留本地版本。远端布局：新根 `/AuralFlow/`（读时回退旧根 `/LX_Music/`），`playlists.json`（v3）+ `user_apis.json`（v2），桌面脚本以 `gz_` 前缀压缩互通。

**防「用云端覆盖更新本地」的守卫是 fail-closed 的**：`assertCloudNotStale` 在无法确认云端更新时间（`lastModified` 缺失 / 无法解析）时中止，而不是静默放行；`sources` 因下载是整体替换（`replaceAll`），在本地缺少同步标记时同样中止；`playlists` 因下载是加法合并、不丢本地实体，此时放行以避免每次全新安装都被拦。云端解析出 0 项音源一律中止（否则会用空文件清空本地音源）。其余防线：本地备份 + PUT 成功后才写 meta。

**歌单归类与残留清理**：同步文件 `userList` 里的一条记录是本地歌单还是云端歌单引用，由 `core` 的 `isWebdavLocalPlaylistRef` 判定（纯数字 id ⇒ 云端，即便是被旧版污染成 `source:"local"` 的条目）；历史上已被误物化成「本地歌单」的云端引用由 `scrubSyncedCloudPlaylistRefs` 清理，两端在读盘后与合并后各跑一次——0 首的剔除、有歌曲的保留并告警，且**先备份再丢弃**。

**拒绝分两种，靠错误类型而不是文案区分**：`@lx/core` 的 `CloudSyncRefusalError`（设置页据此提示「强制下载」）与派生的 `CloudDataStaleError`（云端可证明更旧，本地为权威）。只有后者可以被自动同步吞掉并改为上传本地收敛；「无法判定云端新旧」等拒绝必须上抛——吞掉它们就变成覆盖式上传，删掉只存在于云端的实体。双端启动均自动同步（桌面由 `webdavAutoSyncPlaylists` 开关控制，移动端同名开关），自动同步失败只记 console，不呈现给用户。

已知风险：WebDAV 密码的落盘保护两端不一致——**桌面端**已由 `secret_store` 按 DPAPI 加密（`DPAPI:v1:<base64>`，直接读设置 JSON 只拿到密文）；**移动端**存在 `auralflow.mobile.webdavConfig`，`apps/mobile/src` 的 `saveWebdavConfig` 一带没有加密层（Android 原生层是否另行接管**未核实**）。

### 7. 播放地址解析链（双端）

双端共用 `@lx/core` 的 `raceForBestQuality`（800ms 升级窗）与 `buildPlaybackQualityTiers` 分轮。桌面总预算 12s，参赛 backend 仅内置网关（gdstudio）与自定义音源两类，官方直连只剩竞速全败后的最后兜底；移动端 12s 总预算内含 10s 竞速预算，网关内按音质高→低顺序尝试（防 gdstudio 并发限流）。wy 官方直连（`resolveWySongUrl`）为竞速全败后的最后保险。tx 的「同名搜索转译」已移除——gdstudio 搜索结果无 interval，时长校验失效会误配重录/同名曲；tx 取链依赖 `strMediaMid`（脚本拼 `M500{mid}.mp3` / `F000{mid}.flac`）。

**缓存命中不探活（实情，纠正此前「命中均带探活」的说法）**：三级缓存（预取 Map → 本地音频文件 → 持久 URL）的命中路径都**直接返回，不做探活也不做试听判定**——移动端 `playerService` 在磁盘音频文件命中时直接 `return`。这是刻意的（`file://` 命中不探活、离线可播）的代价是「一旦落盘就绕过所有解析期校验」，因此失效责任全在检测方。

**试听片段的判定与失效（跨端契约）**：`isPreviewStream`（解析期，靠探活拿到的 Content-Range 总字节数估算时长）与 `isPreviewDuration`（播放期，靠播放器上报的实际时长）同来自 `@lx/core/stream-integrity`，两条都必须接：

- **解析期覆盖所有竞速胜出路径**，包括网关结果与官方直连兜底——探活的 `totalBytes` 是解析期判定的唯一数据来源，跳过探活就等于放弃这一层。两端 `streamProbe` 同语义分三档：服务端明确拒绝（403/404/410/451）判死换档；超时 / 抖动 / 5xx 下不了结论、放行给播放器错误回调兜底；通过则做试听判定。**两端唯一的尺度差异是自定义音源**：移动端任何探活失败都换档（黑盒代理会 TCP 握手成功后永不返数据，ExoPlayer 表现为无限缓冲、进度永远 00:00 且无错误回调），桌面端只认明确拒绝——差异源自两端播放器行为不同，是有意保留的，不要「统一」掉。
- **播放期兜底命中后必须同时失效三层缓存**：持久 URL 缓存、预取/预读缓存、**磁盘音频文件**。第三层不能省——它正是上面「命中不探活」的那一层，不删就形成死循环（磁盘命中 → 播放试听 → 判定 → 只清 URL → 再命中），用户只能手动清空整个音频缓存才能恢复。移动端用 `deleteCachedAudioForMusic`（按 `source-id-` 前缀扫目录 + 剪索引）；桌面端用 Rust 命令 `remove_cached_media(kind, cache_key)` 逐音质档删除——此前只有整体清空的 `clear_song_cache`，按 key 失效的能力是本次补的。


## 对齐状态

已对齐：wy / tx + local 源、扫码 / Cookie 登录（扫码仅桌面；移动仅 Cookie 粘贴，网易云剪贴板一键读取 + MUSIC_U 检测）、日推、私人 FM、WebDAV、4 播放模式、淡入淡出、倍速、音效、5 级下载。

差异为平台原生：

| 端 | 差异能力 |
|---|---|
| 桌面 | 浮动歌词窗口 / 托盘 / 系统媒体控制（SMTC：媒体键、系统媒体浮层、锁屏控制）/ 任务栏缩略图按钮与悬浮预览封面 / 窗口内快捷键（keydown，自定义组合键未做）/ 扫码登录 / Rust 文件操作 / 可变下载目录 / cursor 特效 |
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

# 全量验证（双端类型检查 + 移动端 lint + core 测试 + cargo test）
pnpm test:all

# Rust 检查
cargo check --manifest-path desktop/src-tauri/Cargo.toml

# 构建
pnpm desktop:tauri:build   # 桌面安装包
pnpm mobile:build:debug    # 移动 debug APK
```
