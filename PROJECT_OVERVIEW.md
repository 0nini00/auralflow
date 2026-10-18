---
id: auralflow-architecture
type: architecture-design
status: draft
title: AuralFlow 架构 — 拓扑、模块边界与不变量
parent: auralflow-goal
---

# 项目架构概览

AuralFlow 是基于 TypeScript 与 Rust 构建的双端音乐播放器。桌面端与移动端通过 `@lx/core` 复用平台无关的领域模型与纯逻辑，同时分别维护各自的播放引擎、状态编排、网络适配与系统集成。

> pnpm monorepo · 4 个 workspace 包 · 版本 0.7.6（desktop / mobile 共用同一条发布序列） · 仓库 https://github.com/0nini00/auralflow.git · 本文数字为 0.7.0 时点实测（`(Get-Content <file>).Count`，含空行）

## 架构分层

```mermaid
flowchart TB
    subgraph Core["@lx/core（packages/core · 44 文件 5229 行 TS · 无构建）"]
        C1[sources/ 源注册与领域模型]
        C2[lyrics/ 解析 · 行定位 · 浮窗时钟]
        C3[playback-quality 质量排序唯一真相源]
        C4[stream-integrity 试听检测]
        C5[webdav-merge 加法合并纯函数]
        C6[outbound-host SSRF 守卫]
        C7[mobile-api 网关 / history/ / recommendations/ 等]
    end

    subgraph Desktop["@auralflow/desktop（desktop/）"]
        D1[React 18.3.1 前端<br/>14 路由 BrowserRouter v6<br/>12 Zustand store]
        D2[playerEngine.ts 425 行<br/>HTMLAudio + rAF + 余弦淡入淡出]
        D3[customSourceRuntime.ts 892 行<br/>new Function 参数遮蔽（非沙箱）+ LRU(8) + HTTP 代理]
        D4[Rust 后端 25 文件 7058 行<br/>41 IPC 命令]
        D5["@lx/tauri-bridge IPC 桥 427 行"]
    end

    subgraph Mobile["@auralflow/mobile（apps/mobile/）"]
        M1[React Native 0.86 + React 19.2.3]
        M2[playerStore.ts 1252 行<br/>静音间隙技巧（15s 静音占位轨）]
        M3[playbackService.ts<br/>RNTP 后台 PlaybackActiveTrackChanged]
        M4[16 Zustand store<br/>Drawer > NativeStack > BottomTabs]
        M5[Android 原生 18 Java + 2 Kotlin 3853 行<br/>12 个原生模块 + lx_bridge 脚本沙箱]
    end

    Core --> Desktop
    Core --> Mobile
    D5 --> D4
```

## @lx/core 职责清单

| 模块 | 行数 | 职责 |
|---|---|---|
| `sources/registry.ts` | 28 | 音源注册表 |
| `sources/types.ts` | 134 | `MusicSource` / `MusicInfo` / `Lyric` 等领域模型 |
| `sources/custom-source.ts` | 104 | 自定义音源类型 |
| `sources/tx-meta.ts` | 33 | 腾讯取链元数据（strMediaMid，脚本据此拼 M500/F000 文件名） |
| `custom-source.ts` | 61 | 自定义音源脚本契约（与 `sources/custom-source.ts` 并存） |
| `lyrics/parser.ts` | 529 | lrc / enhanced-lrc / yrc / qrc / krc / vtt 6 格式归一化解析 |
| `lyrics/playbackSync.ts` | 70 | `findCurrentLyricLineIndex` 行定位唯一实现（lead 提前量 + 前进滞后带可配，首行前返回 -1）；移动端 `playerService.getCurrentLyricIndex` 已接入。桌面 `services/lyrics/playbackSync` 仍为其本地超集副本（词级进度、时钟外推），迁移待办 |
| `lyrics/overlay-clock.ts` | 81 | 悬浮歌词时钟调度：由位置算出当前行与到下一行的毫秒延迟（原生浮窗自走，不依赖 JS 每行推词），并判定前台校准时机 |
| `lyrics/annotations.ts` | 59 | 注音 / 罗马音标注解析（`parseRubyText` / `normalizeRubyLine`） |
| `playback-quality.ts` | 186 | 质量排序唯一真相源，`raceForBestQuality` 800ms 升级窗口 |
| `stream-integrity.ts` | 86 | 试听检测 |
| `webdav-merge.ts` | 211 | 纯函数加法合并，删除不传播 |
| `webdav-sync-error.ts` | 38 | WebDAV 同步拒绝的错误层级：`CloudSyncRefusalError`（设置页据此提示强制下载）与派生的 `CloudDataStaleError`（自动同步据此跳过下载、改上传本地收敛） |
| `outbound-host.ts` | 295 | SSRF 守卫，与 Rust 双实现契约；自行按 RFC 3986 取 host（不信 RN 的 `URL` polyfill），并归一化到客户端实际连接的形式后再比对黑名单 |
| `mobile-api.ts` | 267 | gdstudio 网关依赖注入传输；`createRacingBuiltinMusicApiClient` 多网关竞速（空数组不视为成功）已就绪但移动端未接线，当前仅单网关客户端 |
| `history/listen-threshold.ts` | 100 | 入历史 / 打点阈值追踪（默认 120s 或 50%；只累计播放中的连续推进，排除 seek 与暂停造成的虚假进度） |
| `recommendations/heartbeat-queue.ts` | 97 | 心动模式待播缓冲的补充判定与逐曲推进（batch 播尽时从 buffer 取出并追加） |
| `stats/aggregate.ts` | 270 | 听歌统计聚合（`aggregateListeningStats`）：总时长 / 次数 / Top 歌曲与歌手 / 按天趋势；按宿主本地日历日归组，时间未知的条目只进总数与榜单、不进趋势 |
| `cover-image.ts` | 149 | 缩略图处理 |
| `switch-step-queue.ts` | 57 | 连点合并 |
| `playlist-link.ts` | 39 | 歌单分享链接解析 |
| `release-notes.ts` | 94 | 发布说明清洗（降成纯文本摘要，丢表格 / 分隔线 / 代码块） |
| `github-mirror.ts` | 61 | GitHub 加速镜像地址改写（刻意手写解析而不用 `new URL`，RN 的 polyfill 不完整） |
| `removed-source.ts` | 57 | 已下线来源的历史条目清理（`isRemovedSource` / `dropRemovedSourceEntries`） |
| `local-media-match.ts` | 353 | 本地文件与在线候选的择优判定：同一录音档（歌名 / 版本 / 演唱者 / 时长全对得上，可静默采信）与同曲异唱档（原唱不可得时才启用，要求时长差 ≤3s 加证据，且必须在 UI 上标注来源）。两端共用，取代了桌面端那套会把同名不同曲判成匹配的加权打分。**只服务歌词**——2026-10-16 起本地曲封面只取音频文件自身（内嵌 / 旁挂图），这个判定也用于给「选择歌词」的候选排序与标注 |

合计 44 文件 5229 行（25 个模块文件 + 14 个测试文件；另含 5 个 barrel：`index.ts` / `lyrics/index.ts` / `sources/index.ts` / `history/index.ts` / `recommendations/index.ts`）。

`@lx/core` 独立于 UI 框架与平台运行时，**无构建步骤**（`main` / `types` 直接指向 `src/index.ts`）。播放队列、播放状态、缓存 IO、自定义音源运行时（桌面同 WebView 非沙箱执行、移动端隐藏 WebView）、平台网络请求仍由双端分别实现。跨源匹配与搜索结果合并去重曾位于 `sources/resolver.ts`，f91c469 判定其解析链不可达后删除，该职责现由双端各自实现。

带自动化测试的是两侧，而非只有一个包：JS/TS 侧 `pnpm test:core`（vitest 3.2.4，14 个测试文件 163 例——`stats/aggregate` 24 / `outbound-host` 21 / `webdav-merge` 17 / `local-media-match` 16 / `cover-image` 14 / `overlay-clock` 10 / `release-notes` 9 / `netease-rich-lyric` 9 / `removed-source` 8 / `listen-threshold` 8 / `heartbeat-queue` 8 / `annotations` 8 / `github-mirror` 8 / `webdav-sync-error` 3）；Rust 侧 `pnpm test:rust`（70 个 `#[test]`，分布在 11 个文件——`window_state.rs` 13 / `commands/local_audio.rs` 11 / `smtc.rs` 9 / `taskbar.rs` 9 / `secret_store.rs` 6 / `audio_session.rs` 5 / `logging.rs` 5 / `outbound.rs` 5 / `models.rs` 3 / `commands/media_cache.rs` 3 / `main.rs` 1）。其中 `outbound-host.test.ts` 锚定「guard 判定的 host 必须等于真实请求的 host」这一不变量——用 Node 的 WHATWG `URL` 作参照物做差分断言；`outbound-host.test.ts` 与 `outbound.rs` 另外**共读同一份跨端清单** `packages/core/outbound-host.cases.tsv`（49 条 URL，两侧各断言一遍），补上了「同一批 URL 两边结论相同」这条此前缺失的校验；`main.rs` 的 `launch_contract_tests` 钉住 AUMID 与 `tauri.conf.json` 的一致性（identifier 与主窗 `additionalBrowserArgs` 必须逐字相同）；`webdav-sync-error.test.ts` 锚定同步拒绝的类型层级（两个错误类的 instanceof 关系），因为自动同步正是靠它决定吞掉哪一种拒绝。根目录 `pnpm test:all` 串起「双端类型检查 + 移动端 lint + 两侧测试」，`.github/workflows/ci.yml` 在 CI 里跑同一批命令（Rust 任务必须 windows runner：`smtc.rs` / `taskbar.rs` / `audio_session.rs` / `secret_store.rs` 的测试都依赖 Windows API）。**两端另有各自的套件**：桌面前端 `pnpm test:desktop`（vitest，默认 `environment: node`，其中 8 个文件用 `@vitest-environment jsdom` 逐文件覆盖；60 个文件 531 例）、移动端 `pnpm mobile:test`（`node --test`，28 个文件 615 例，其中两个文件会用真 `javac` + jaudiotagger + `ffmpeg` 编译并运行原生源码片段）。真正依赖真机运行时的行为仍只有类型检查、lint 与真机手测。

## 各端职责说明

### 桌面端（`@auralflow/desktop`）

Tauri v2 + React 18.3.1 + Vite 5，提供原生 OS 交互体验。

| 层 | 职责 | 关键实现 |
|---|---|---|
| Rust 后端 | 系统级任务，41 IPC 命令 | `outbound.rs`（SSRF + 每跳验证 ≤10）、`lyric_window.rs`（794 行 独立透明窗口：锁定=鼠标穿透+150ms 光标轮询+悬停解锁小窗，置顶 1.5s 巡检 + token/epoch 防竞态）、`local_audio.rs`（walkdir + audiotags/lofty 双库；`set_audio_cover` 按字节魔数校验图片，与手动封面落盘共用同一张表）、`media_cache.rs`（两层：song-audio 2GiB、song-covers 512MiB，命中刷新 mtime 因此是真 LRU；另有启动时的容量守卫 `sweep_caches`）、`downloads.rs`（流式 + 取消 + 180ms 节流 + 2GiB 上限 + `write_download_text_file` 写旁挂 lrc 文本；**音频标签不在 Rust 侧**——下载完成后由前端另调 `set_audio_metadata` / `set_audio_lyrics` / `set_audio_cover`）、`tray.rs`、`logging.rs`（`tauri-plugin-log` 落盘到 `app_log_dir()`，2 MiB×3 轮转）、`smtc.rs`（Windows 系统媒体控制：媒体键 / 媒体浮层 / 锁屏，封面走内存流）、`taskbar.rs`（任务栏缩略图三按钮——用封面替换预览已于 2026-10-09 退役，`SetWindowSubclass` 子类化，全程 fail-soft） |
| React 前端 | UI 与业务 | `playerEngine.ts`（425 行 HTMLAudio + rAF + 500ms 纠偏 + 余弦淡入淡出 90/140ms fadeToken + 外部暂停 500ms 保护窗；进度经 `stores/playerPersistence.ts` 每 10s 刻度落盘、启动后由 `stores/playerResumeTarget.ts` 交给引擎续播，跨窗口由 `stores/playerSync.ts` 经 BroadcastChannel + Tauri 事件同步）、`customSourceRuntime.ts`（892 行 new Function 参数遮蔽，非沙箱——脚本在本 WebView 全权执行 + LRU(8) + HTTP 代理 Rust；能力白名单只有 `musicUrl`（kg/tx/wy），`local` 另有 `lyric`/`pic`）、`webdavSyncService.ts`（865 行 同步锁 + 冲突检测）、`wyAccountService.ts`（632 行 weapi/eapi——`wyProvider.ts` 内另有一份 eapiEncrypt——+ 扫码/Cookie 登录，Cookie 经 Rust DPAPI 加密落盘） |
| 缓存 | 播放 URL / 歌词持久索引 | `persistentCache.ts`（URL 6h / 本地 365d / 歌词 30d / 空结果 7d，LRU 500/1000 条） |
| 导航 | 14 路由 BrowserRouter v6 | 首页(index) / search / library→收藏歌单重定向 / local / playlists / downloads / history / stats / playlist/:id / artist/:id / album/:id / daily / fm / settings |
| 视觉 | 玻璃拟态 | `--af-*` CSS 变量 + `backdrop-filter`、`ImmersiveLyricsOverlay`（纯 CSS/DOM 逐字卡拉 OK：clip-path/背景渐变） |
| IPC 桥 | `@lx/tauri-bridge` 427 行 | 部分 Tauri 命令的类型化包装，**不是唯一 IPC 路径**：桌面前端另有 43 处（分布于 33 个文件）直接 `import` `@tauri-apps/*`，其中仅 2 处（`services/outboundHttp.ts`、`utils/compression.ts`）直接 `invoke` |

### 移动端（`@auralflow/mobile`）

React Native 0.86 + React 19.2.3，面向 Android（minSdk 24）。

| 层 | 职责 | 关键实现 |
|---|---|---|
| 播放核心 | 前台保活 + 后台推进 | `playerStore.ts`（1252 行 原生恒单曲槽 + 静音间隙技巧：尾部 SILENCE_GAP_TRACK 15s 静音占位轨保持前台服务；播放快照持久化 AsyncStorage）、`playbackService.ts`（RNTP 后台 `PlaybackActiveTrackChanged` 驱动推进，终局失败由 `playbackFailurePolicy` 判定后自动跳歌） |
| 导航 | Drawer > NativeStack > BottomTabs + MaterialTopTabs | `navigation/` |
| 沉浸歌词 | PagerView 2 页 | `ImmersiveLyricsScreen`（useImmersiveController 522 行 + 下拉关闭）、`LyricView`（623 行 动态行高 + 累积偏移；仅行级高亮，逐字渲染为桌面能力） |
| 列表 | 增量挂载（非 FlatList） | — |
| 图片 | CachedImage（Glide） | `cacheService.ts` 2GB LRU（封面/音频 immutable 近似 FIFO，歌词 30 天，AsyncStorage 索引 reconcile；启动时 autoCleanCache 磁盘守卫） |
| Android 原生 | 17 Java + 2 Kotlin 3740 行 | `LocalMusicPackage` 注册 **11 个模块**：`LocalMusicModule`（908 行 MediaStore + jaudiotagger，读写标签与内嵌封面）、`LyricOverlayModule` + `LyricOverlayService`（280 + 737 行 WindowManager 悬浮歌词，配套 `LyricOverlayPreferences` / `LyricNotificationReceiver`）、`SecureStorageModule`（Keystore AES-256-GCM）、`CryptoModule`（原生 weapi：AES-CBC + RSA NoPadding，固定向量会话自校验，失败回退 weapiJs）、`CoverColorModule`、`ApkInstallerModule`、`CustomSourceFilePickerModule`、`OrientationModule`、`WakeLockModule`、`BatteryOptimizationModule`（另有 `LocalAudioAssetsReader` / `LocalTagEditor` 两个未注册的辅助类，被 `LocalMusicModule` 与原生契约测试直接编译使用）；`lx_bridge`（隐藏 WebView 沙箱跑 LX 脚本：lx 注入 + 13 个全局名参数遮蔽 + RN 侧静态扫描拒 eval/Function，vendor.js 2510 行 CryptoJS + pako；RN fetch 不能禁重定向，自定义源能力白名单仅 musicUrl（kg/tx/wy）+ local 的 musicUrl/lyric/pic）；通知栏歌词按钮（`apply-track-player-patch.js` 补丁 RNTP `MusicService`） |
| 权限 | 无 RECORD_AUDIO | INTERNET / SYSTEM_ALERT_WINDOW / WAKE_LOCK / FOREGROUND_SERVICE_MEDIA_PLAYBACK / POST_NOTIFICATIONS / READ_MEDIA_AUDIO |

## 关键设计决策摘要

### 1. 双 React 版本共存

桌面端 React 18.3.1，移动端 React 19.2.3，双端共享同一个 store 与核心。`pnpm-workspace.yaml` 的 `packageExtensions` 将 `@types/react@18.3.31` 钉到 `react@18`、`lucide-react@0.460.0`、`react-router@6`、`react-router-dom@6`，避免桌面端解析到提升的 `@types/react@19` 而触发 TS2786 JSX 组件错误。

### 2. @lx/core 无构建

`@lx/core` 的 `main` 与 `types` 直接指向 `src/index.ts`，无编译产物。双端通过 TypeScript 路径直接消费源码，改完即生效，不引入额外的构建链与产物同步成本。

### 3. SSRF 双实现契约

`outbound-host.ts` 是出站主机判定的书面定义（JS 侧），`desktop/src-tauri/src/outbound.rs` 是 Rust 侧的同一套规则。桌面端请求由 Rust 发出，移动端请求在 JS 侧发出；两份实现**仍有手工维护的成分**，但一致性已由自动校验钉住——两侧测试共读 `packages/core/outbound-host.cases.tsv`（49 条 URL，每个网段都带边界内/边界外样本，另有一批公网放行样本作反向约束），任一侧改规则而另一侧没跟上就会红。显式边界：只允许 http/https；拒绝 localhost / `.local` / 回环 / 私有 / 链路本地 / CGNAT / 未指定 / 多播 / 广播 / 文档示例地址（`192.0.0.0/16` / `198.51.0.0/16` / `203.0.0.0/16`，均按 /16 拦）/ `0.0.0.0/8` / `198.18.0.0/15` / `240.0.0.0/4`；**不做** DNS 解析后校验（DNS rebinding 不在拦截范围）。

**手工同步真的漏过（2026 复盘）**：逐条比对发现 7 处差异，**全部同一方向——JS 侧更严、Rust 侧更宽松**，而文档一直声称两者「契约一致」。根因是 Rust 侧只用标准库判定（`is_loopback` / `is_private` / …），而标准库没有 `0.0.0.0/8`、`192.0.0.0/16`、`198.18.0.0/15`、`240.0.0.0/4` 这四段——JS 侧一直是手写的。四段已补进 `is_blocked_v4`，并由 `outbound.rs` 的测试钉住（含 mapped IPv6 的继承关系）。**不变量：宽松的那份就是实际的攻击面**，所以分歧一律对齐到更严的一侧。另有两处**有意保留**：`http:example.com`（JS 要求字面 `://`，Rust 交给 WHATWG 归一化——两者都会拦下内网 host）；「形似 IPv4 但解析失败」的 fail-closed（Rust 侧该情形经归一化后只可能落到公开 IP）。**同类遗漏又发现一处（2026-10）**：文档示例网段——JS 侧拦的是整个 `198.51.0.0/16` 与 `203.0.0.0/16`（代码里那两行注释还误写成 `/24`），而 Rust 侧靠标准库 `is_documentation()` 只拦 RFC 5737 的三个 `/24`，方向仍是「JS 更严、Rust 更松」。已把 Rust 侧按 `/16` 补齐、订正 JS 侧注释。**跨端一致性从此有自动校验**：`packages/core/outbound-host.cases.tsv` 由两侧测试共读（49 条 URL），各断言一遍，替代了纯人工逐条比对。

守卫要成立，判定的 host 必须与 HTTP 客户端真正连接的 host 是同一个，因此 JS 侧不复用任何 `URL` 实现：RN 的 polyfill 构造函数从不抛错，`hostname` 的 userinfo 分组不排除 `/` `?` `#`，`http://127.0.0.1/@evil.com` 会被读成 `evil.com`。取 host 按 RFC 3986 手写（authority 终止于 `/` `?` `#` `\`，userinfo 取最后一个 `@` 之前），再归一化到客户端实际连接的形式：单次百分号解码、IDNA 句点变体（`。．｡`）折成 ASCII 点、小写、剥尾点；解码出分隔符、畸形百分号序列、形似 IPv4/IPv6 但解析失败，全部按拒绝处理，不 fail-open。inet_aton 写法（`2130706433` / `0177.0.0.1` / `127.1`）先还原再判定。尾点剥离在 Rust 侧同步实现，其余归一化步骤由 `reqwest::Url` 自身完成。移动端补充：RN 的 fetch（whatwg-fetch over XHR）无法禁用重定向，出站校验因此只拦截响应回流（最终 URL），拦不住重定向落点。

### 4. 静音间隙技巧

移动端 `playerStore.ts` 在每首真实歌曲尾部插入 `SILENCE_GAP_TRACK`（15s 静音占位轨，`android.resource://.../raw/silence_2s`——文件名与常量名沿用旧名，音频实际 15s，track 的 `duration` 填 0）。`playbackService.ts` 监听 `PlaybackActiveTrackChanged`，当激活轨为 `SILENCE_GAP_TRACK_ID` 时推进到下一首真实歌曲。播放终局失败由 `playbackFailurePolicy` 判定、同一后台服务自动跳歌（有限连跳，默认关闭）；播放快照（曲目/进度/音量）持久化到 AsyncStorage，启动后恢复。借此在不依赖额外定时器的前提下保持前台服务存活、实现无缝衔接。

### 5. 质量竞速

`playback-quality.ts` 是音质序关系的唯一真相源（收敛此前散落三处的不一致实现）。`raceForBestQuality` 让全部候选并发，首个成功结果开启 800ms 升级窗口，窗口内更高音质翻盘则替换，达到 ceiling 或窗口到期即定稿；两层竞速（通道之间、单通道内音源×音质）共用同一个窗口值，最坏额外等待仍是一个窗口。`buildPlaybackQualityTiers` 生成「不低于用户选定音质」的分轮次表：首轮全部高档并发，失败才逐档下调。

### 6. WebDAV 加法合并

`webdav-merge.ts` 是纯函数、无副作用、可单测。合并规则：收藏按 `source:id` 去重取并集；本地歌单同名 id 按 `updatedAt` 新者胜、歌曲保留并集；云端引用歌单按 id 并集保留较新者；播放历史并集按顺序截断上限。**删除不传播**——本地有而远端无的实体保留本地版本。远端布局：新根 `/AuralFlow/`（读时回退旧根 `/LX_Music/`），`playlists.json`（v3）+ `user_apis.json`（v2），桌面脚本以 `gz_` 前缀压缩互通。

**防「用云端覆盖更新本地」的守卫是 fail-closed 的**：`assertCloudNotStale` 在无法确认云端更新时间（`lastModified` 缺失 / 无法解析）时中止，而不是静默放行；`sources` 因下载是整体替换（`replaceAll`），在本地缺少同步标记时同样中止；`playlists` 因下载是加法合并、不丢本地实体，此时放行以避免每次全新安装都被拦。云端解析出 0 项音源一律中止（否则会用空文件清空本地音源）。其余防线：本地备份 + PUT 成功后才写 meta。

**歌单归类与残留清理**：同步文件 `userList` 里的一条记录是本地歌单还是云端歌单引用，由 `core` 的 `isWebdavLocalPlaylistRef` 判定（纯数字 id ⇒ 云端，即便是被旧版污染成 `source:"local"` 的条目）；历史上已被误物化成「本地歌单」的云端引用由 `scrubSyncedCloudPlaylistRefs` 清理，两端在读盘后与合并后各跑一次——0 首的剔除、有歌曲的保留并告警，且**先备份再丢弃**。

**拒绝分两种，靠错误类型而不是文案区分**：`@lx/core` 的 `CloudSyncRefusalError`（设置页据此提示「强制下载」）与派生的 `CloudDataStaleError`（云端可证明更旧，本地为权威）。只有后者可以被自动同步吞掉并改为上传本地收敛；「无法判定云端新旧」等拒绝必须上抛——吞掉它们就变成覆盖式上传，删掉只存在于云端的实体。双端启动均自动同步（桌面由 `webdavAutoSyncPlaylists` 开关控制，移动端同名开关），自动同步失败只记 console，不呈现给用户。

密码落盘保护两端都已加密：**桌面端**由 `secret_store` 按 DPAPI 处理（`DPAPI:v1:<base64>`，直接读设置 JSON 只拿到密文）；**移动端**的密码经 `secureStorageService` → `SecureStorageModule`（AndroidKeyStore AES/GCM，键 `auralflow.mobile.webdav.password.v1`）落盘，AsyncStorage 里只剩 url / username / autoSync，并带旧明文（`auralflow.mobile.webdavConfig`）的迁移路径。

### 7. 播放地址解析链（双端）

双端共用 `@lx/core` 的 `raceForBestQuality`（800ms 升级窗）与 `buildPlaybackQualityTiers` 分轮。桌面总预算 12s，参赛 backend 仅内置网关（gdstudio）与自定义音源两类，官方直连只剩竞速全败后的最后兜底；移动端 12s 总预算内含 10s 竞速预算，网关内按音质高→低顺序尝试（防 gdstudio 并发限流）。wy 官方直连（`resolveWySongUrl`）为竞速全败后的最后保险。tx 的「同名搜索转译」已移除——gdstudio 搜索结果无 interval，时长校验失效会误配重录/同名曲；tx 取链依赖 `strMediaMid`（脚本拼 `M500{mid}.mp3` / `F000{mid}.flac`）。

**缓存命中不探活（实情，纠正此前「命中均带探活」的说法）**：三级缓存（预取 Map → 本地音频文件 → 持久 URL）的命中路径都**直接返回，不做探活也不做试听判定**——移动端 `playerService` 在磁盘音频文件命中时直接 `return`。这是刻意的（`file://` 命中不探活、离线可播）的代价是「一旦落盘就绕过所有解析期校验」，因此失效责任全在检测方。

**试听片段的判定与失效（跨端契约）**：`isPreviewStream`（解析期，靠探活拿到的 Content-Range 总字节数估算时长）与 `isPreviewDuration`（播放期，靠播放器上报的实际时长）同来自 `@lx/core/stream-integrity`，两条都必须接：

- **解析期覆盖所有竞速胜出路径**，包括网关结果与官方直连兜底——探活的 `totalBytes` 是解析期判定的唯一数据来源，跳过探活就等于放弃这一层。两端 `streamProbe` 同语义分三档：服务端明确拒绝（403/404/410/451）判死换档；超时 / 抖动 / 5xx 下不了结论、放行给播放器错误回调兜底；通过则做试听判定。**两端唯一的尺度差异是自定义音源**：移动端任何探活失败都换档（黑盒代理会 TCP 握手成功后永不返数据，ExoPlayer 表现为无限缓冲、进度永远 00:00 且无错误回调），桌面端只认明确拒绝——差异源自两端播放器行为不同，是有意保留的，不要「统一」掉。
- **播放期兜底命中后必须同时失效三层缓存**：持久 URL 缓存、预取/预读缓存、**磁盘音频文件**。第三层不能省——它正是上面「命中不探活」的那一层，不删就形成死循环（磁盘命中 → 播放试听 → 判定 → 只清 URL → 再命中），用户只能手动清空整个音频缓存才能恢复。移动端用 `deleteCachedAudioForMusic`（按 `source-id-` 前缀扫目录 + 剪索引）；桌面端用 Rust 命令 `remove_cached_media(kind, cache_key)` 逐音质档删除——此前只有整体清空的 `clear_song_cache`，按 key 失效的能力是本次补的。


### 8. 本地曲：封面只取自身，歌词可手动选择（2026-10-16）

**背景**：本地曲缺歌词时会自动联网匹配，但同名不同曲（重名 / 翻唱 / 同名专辑曲）靠歌名、歌手、时长区分不开，匹错之后用户**没有任何纠正手段**；封面同理，缺封面时也会去平台找一张，同样可能找错。

**封面不再「猜」**：本地曲封面只允许来自音频文件自己——**内嵌标签 → 同目录旁挂图**（`folder.jpg` / `cover.jpg` / 同名图片），都没有就显示占位图。删掉的东西：桌面 `services/localCoverMatch.ts` 整文件与其三处触发（播放时 `playerStore.applyLocalCover`、歌词匹配时 `lyricsService.triggerLocalCoverMatch`、预读时）、`LocalSong.coverOverride` 与 `manual-covers` 手动封面落盘（Rust `save_manual_cover`）、移动端 `localMediaSearchService` 的封面分支与 `needs.cover` / `coverUri`、相册选图与封面 URL 输入、原生 `ImagePickerModule`（注册模块 12 → 11）。**保留** `set_audio_cover`：它服务的是下载**在线**曲时把平台封面写进文件标签，与本地曲封面无关；`sniff_image_extension` 也因此保留。后果（已知并接受）：既有的手动封面设置与 `manual-covers` 目录不再被读取，封面回落到文件自身那张。

**歌词仍自动匹配，但可以纠正**：双端都加了按曲的三态 `lyricsMode`（缺省 `auto`）。`auto` 走既有自动链（内嵌 / 旁挂 → LRCLIB → 平台搜索）；`picked` 只用选中的那一份、**永不联网再搜**并显示来源；`local-only`（UI 上叫「不要匹配（只用本地歌词）」）**不联网**，只用内嵌与旁挂 `.lrc`，没有就显示无歌词。判定必须在读自动匹配缓存之前短路，否则旧的自动匹配结果会被读出来。入口两处：本地曲列表的操作菜单与沉浸歌词页的更多菜单；候选来自本地已有、LRCLIB 与平台搜索，按 `local-media-match` 的结论排序标注但**不隐藏候选**——用户自己判断。

**顺带修掉的旧缺陷**：移动端原先靠空串表达「明确不匹配」，而 `normalizeOptionalText` 会把空串变成 `undefined`，于是「不要匹配」在移动端根本表达不出来（会退回自动搜索）。语义现在统一到 `lyricsMode`，空串不再冒充「不匹配」。

**指纹与生效范围**：选择按「文件路径 + 内容指纹」记住，**改名 / 移动后能自动认回**。桌面指纹是 `"<size>:<md5>"` 复合串（`hash_local_file` 只在用户做出选择、以及重绑核对时调用）；记录消失时把选择移进按内容哈希索引的孤儿表（`lyricsChoicesByHash`，与 `localSongs` 同一个 `library` 命名空间，上限 200 条），扫描合并后先比 `size`、只有吻合才哈希确认——**不对整库每个文件哈希**。移动端同构（`auralflow.mobile.localLyricsChoiceOrphans`，上限 200），认领用的是解析本地曲时**已经拿到**的原生 SHA-256 `signature`，不额外读取。内容被替换（size / signature 变）则自动静默失效、回到 `auto`。
## 对齐状态

已对齐：wy / tx + local 源、扫码 / Cookie 登录（扫码仅桌面；移动仅 Cookie 粘贴，网易云剪贴板一键读取 + MUSIC_U 检测）、日推、私人 FM、WebDAV、4 播放模式、淡入淡出、倍速、音效、5 级下载。

差异为平台原生：

| 端 | 差异能力 |
|---|---|
| 桌面 | 浮动歌词窗口 / 托盘 / 系统媒体控制（SMTC：媒体键、系统媒体浮层、锁屏控制）/ 任务栏缩略图三按钮（用封面替换预览已于 2026-10-09 退役）/ 窗口内快捷键（keydown，自定义组合键未做）/ 扫码登录 / Rust 文件操作 / 可变下载目录 / cursor 特效 |
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
