# 播放引擎差异 — 桌面端 vs 移动端

本文对比 AuralFlow 桌面端与移动端播放引擎的实现差异。双端共享 `@lx/core` 中的纯逻辑（音质竞速、试听判定、连点合并），但底层播放器、后台保活、淡入淡出、缓存策略因平台能力不同而显著分叉。

> 更新日期：2026-08-27

---

## 1. 设计约束

| 维度 | 桌面 | 移动 |
|---|---|---|
| 运行环境 | Tauri WebView（桌面浏览器内核） | React Native（Hermes 引擎） |
| 底层播放器 | `HTMLAudioElement`（`new Audio()`） | `react-native-track-player`（ExoPlayer / AVPlayer） |
| 后台能力 | WebView 标签页可被系统节流，无前台服务 | Android 前台服务保活；后台 JS 被系统挂起 |
| 音频管线 | WebAudio API（EQ/Panner/Convolver） | 原生 AudioFx（Android 均衡器/环绕/混响） |
| `new Function` | 支持（自定义音源在 WebView 内执行） | Hermes 不支持（脚本移到独立 WebView `lx_bridge`） |

**共享核心只含纯逻辑**：音质竞速窗口、试听片段判定、切歌连点合并等不含 I/O 的算法收敛在 `@lx/core`，双端共用同一份实现；涉及原生播放器、后台服务、文件系统的逻辑则各写各的。

---

## 2. 桌面端 — `playerEngine.ts`（388 行）

单例 class `PlayerEngine`，独立于 store，store 通过 `subscribe` 同步状态。

### 2.1 HTMLAudio 与预加载

- 底层是 `new Audio()`。预加载用独立的隐藏 `<audio>`（`preloadAudio`，`muted` + `preload="auto"`），让浏览器提前缓存下一首 URL，切换时更快起播。
- `preload(url)` 命中已预加载的 URL 则跳过，避免重复请求。

### 2.2 进度推送：rAF + 500ms 后备

- **主路径 rAF tick**：`play` 事件启动 `requestAnimationFrame` 循环，每帧读 `audio.currentTime` 写入 state。
- **500ms setInterval 后备**：rAF 被窗口遮挡/原生全屏/沉浸页重合成节流时，`currentTime` 会落后。后备 interval 仅在 rAF 节流且 drift > 0.15s 时触发校正，避免 store 进度与歌词冻结。
- 两者都写 `currentTimeSampledAt`（采样时刻 `Date.now()`），供 UI 层按真实采样时间外推进度，跨 WebView 同一时间基准。

### 2.3 余弦淡入淡出

`fadeAudioVolume` 用 rAF 逐帧控制，缓动函数为 `0.5 - cos(progress * π) / 2`（余弦 ease）：

- **`FADE_OUT_MS = 90`**：切歌前短淡出，避免爆音。
- **`FADE_IN_MS = 140`**：新歌起播后淡入。
- **`fadeToken` 取消**：每次 `cancelFade` 递增 token，进行中的 tick 发现 token 不匹配立即 resolve 退出，防止旧淡入淡出与新操作叠加。

### 2.4 外部暂停保护窗

系统音频抢占或其它原因触发 `pause` 事件时：

- `shouldResumeAfterExternalPause` 判断是否应自动恢复播放。
- **`markInternalPause` 500ms 保护窗**：内部主动暂停（`pause()`/`load()`）会先 `markInternalPause` 设 `internalPauseGuardUntil = Date.now() + 500`，使后续 500ms 内的 pause 事件被识别为内部触发而非外部抢占，避免自动恢复逻辑误判。
- `pauseOnExternalPlayback` 设置控制外部音频播放时是暂停还是降音量。

### 2.5 预览检测

`loadedmetadata` 事件触发时比对 `audio.duration` 与 `music.interval`，经 `@lx/core` 的 `isPreviewDuration` 判定是否为试听片段，是则通知 `previewListeners`。

### 2.6 patchState 单变异路径

- `patchState` 是唯一的状态写入入口：shallow-merge patch 到 state，若 patch 含 `currentTime` 则同帧写入 `currentTimeSampledAt`，然后 fanout 到所有 `stateListeners`。
- 单变异路径保证状态时序确定，避免多处直接改 state 造成竞态。

---

## 3. 移动端 — RNTP/ExoPlayer

### 3.1 `playerStore.ts`（1004 行）与懒初始化

- Zustand store 直接调用 `TrackPlayer` 原生 API，无独立 engine class。
- **`ensurePlayerSetup` 懒初始化**：带 `playerSetupPromise` 并发守卫（复用同一次 Promise 避免并发重复 setup）。所有触碰原生播放器的方法必须先 `await ensurePlayerSetup()`，否则在未初始化时调用原生会崩溃。
- **ExoPlayer 配置**：`maxCacheSize: 1GB`（SimpleCache 边播边缓存）、`minBuffer: 15`、`progressUpdateEventInterval: 0.25`（4 次/秒，对齐 lx 精确行触发）。
- **`RepeatMode.Off` 固定**：原生重复模式固定为 Off，列表循环/单曲循环/随机/顺序全部由 JS 驱动，避免原生自动循环造成 `currentIndex`/歌词/进度等 JS 状态不同步。

### 3.2 静音间隙保持前台

核心的后台保活机制：

- **每首歌入队双轨**：`[真实歌曲, SILENCE_GAP_TRACK]`，静音轨是 2 秒静音 `android.resource://.../raw/silence_2s`。
- 曲末若队列直接见底，原生播放停止 → Android 失去维持进程的理由 → JS 线程被挂起 → 后台切歌卡住直到用户回前台。
- 补静音尾轨后，原生队列自动推进到它，**播放不停 → 前台服务存活 → JS 在这 2 秒内醒来解析并切下一首**。真正的切歌仍由 JS 决定，原生不参与队列编排。
- 静音轨元数据沿用当前曲（通知栏不闪成空白）。

### 3.3 PlaybackActiveTrackChanged 驱动推进

曲末切歌主路径（`playbackService.ts`，必须跑在 TrackPlayer 后台服务上下文）：

- `PlaybackActiveTrackChanged`：`track.id === SILENCE_GAP_TRACK_ID` 时触发 `advanceAfterTrackFinished`。
- `PlaybackQueueEnded`：静音也播完仍没切走时的兜底。
- **`advancingAfterFinish` 防双火**：两个事件可能在 JS 从挂起中恢复后排队触发，不去重会一次跳两首；标志在首次 `await` 前同步置位，关死交错窗口。
- 单曲循环：`skip(0)` + `seekTo(0)` + `play()`（回到队列首位真实曲目重播，index 1 是静音占位）。

### 3.4 inflightPlayRequests 竞态保护

- **`buildMobilePlayRequestKey`（含 quality）**：同 key 的并发 play 复用同一 Promise，避免重复 reset/add 同一 track。
- 不同 key（如切音质后再切）`inflightPlayRequests.clear()` 清除陈旧条目，避免稍后重试复用已判死的 promise（表现为「点了没反应」）。
- **`playRequestId` 令牌**：自增序列号，快速切歌只保留最新请求；reset 与 add 之间有 await 让出点，此处再查一次令牌关死交错窗口。

### 3.5 RemoteDuck 音频焦点

`playbackService.ts` 的 `RemoteDuck`：

- `getAudioInterruptionAction` 根据 `permanent`/`pauseOnExternalPlayback` 决定动作。
- permanent 或 `pauseOnExternalPlayback` → 暂停；否则 → duck（降音量，存 `externalDuckVolume`）。
- duck 态落库：切歌淡入以该音量为上限，避免 duck 中自动切歌把音量淡回满格、盖住导航播报。中断结束（`paused=false`）恢复音量时清除标记。

### 3.6 后台 fadeVolume 跳过步进

`fadeVolume`（`FADE_OUT_MS = 80` / `FADE_IN_MS = 120`）：

- **App 在后台/锁屏时（`AppState !== 'active'`）直接一步设目标音量**，跳过步进淡入淡出。RN 的 `setTimeout` 在后台被系统严重节流甚至冻结，步进淡出 await 不 resolve → reset/add/play 永远等不到（后台曲终不跳下一首的根因）；淡入音量停在 0 → 静音播放。后台时一步设值绕过该问题。

### 3.7 预览检测 — previewRejectedKeys

`PlaybackProgressUpdated` 事件（0.25s 触发一次）：

- `isPreviewDuration` 判定实际时长明显短于期望时长 → 试听片段。
- 命中后：`pause()` + `invalidateCachedPlaybackUrl`（清持久化 URL 缓存）+ `invalidatePrefetchForSong`（清预取）+ `previewRejectedKeys.add(key)` 防同一首歌重复告警。
- 新播放会话 `previewRejectedKeys.clear()`，允许用户手动重试时再次拦截。

### 3.8 播放模式与睡眠定时

- **`playMode`**：`list` / `single` / `shuffle` / `sequence`（`MobilePlayMode`），`RepeatMode.Off` 固定，JS 驱动切歌。
- **睡眠定时（按分钟）**：`scheduleSleepTimerTick` 每分钟递减，**仅 `isPlaying` 时递减**（暂停期间不倒数，对齐主流语义：只统计实际播放时长）。
- **睡眠定时（按歌曲数）**：`getNextSongSleepTimerState` 在 play 入口评估，到期边界不再加载下一首，保持已播完的当前曲展示并停用定时器（旧实现先加载再暂停会闪现下一首标题并漏出淡入声）。
- **`playbackContext`**：`{ type:"queue" }` 或 `PersonalFmContext`（私人 FM 的 buffer/batch 拉取上下文）。

---

## 4. 共享纯逻辑（`@lx/core`）

以下模块双端共用，不含平台 I/O：

### 4.1 raceForBestQuality — 800ms 升级窗口

`packages/core/src/playback-quality.ts`：

- 全部候选并发，先成功者暂存为 best，启动 800ms `upgradeWindowMs` 定时器。
- 窗口内更高 rank 到达则替换 best；达到 ceiling（默认 flac24bit）或全部 settled 则 settle。
- 双层竞速（通道之间、单通道内音源×音质）共用同一 800ms 值，各层独立计时不叠加。

### 4.2 stream-integrity — 试听判定

`packages/core/src/stream-integrity.ts`：

- **`isPreviewStream`**：解析期判定，由 Content-Range 完整字节数 + 音质码率估算流时长，低于期望时长 50% 且不足 60s 即判试听。
- **`isPreviewDuration`**：播放期兜底，实际流时长 < 期望时长 × 0.5 即判试听，覆盖解析期拿不到 Content-Length/Content-Range 的流式响应。
- 双端在竞速后与播放器加载后共用本模块，避免试听片段进播放器与缓存。

### 4.3 switch-step-queue — 连点合并

`packages/core/src/switch-step-queue.ts`：

- 切换进行中（解析+加载）时用户再点下一首/上一首，合并为一次「补跳」。
- `applySwitchStepRequest`：切换中只更新 `pendingStep`（保留最新），不重复发起解析。
- `finishSwitchStep`：当前切换结束后若有补跳则再跳一步。
- 避免重复解析与无反馈等待（「点了没反应/卡顿」）。

---

## 5. 播放模式对比

| 维度 | 桌面 | 移动 |
|---|---|---|
| 模式枚举 | `list-loop` / `single-loop` / `shuffle` / `sequence`（`playModeControl.ts`） | `list` / `single` / `shuffle` / `sequence`（`mobilePlayModeModel.ts`） |
| 原生 repeatMode 映射 | `repeatMode: off/all/one` + `isShuffle`（`PLAY_MODE_STATES`） | `RepeatMode.Off` 固定，JS 驱动全部切歌 |
| 单曲循环 | 原生 `repeatMode: one` | JS：`skip(0)` + `seekTo(0)` + `play()` |
| 列表循环 | 原生 `repeatMode: all` | JS：`PlaybackQueueEnded` → `playNext` |
| 随机 | `isShuffle: true` + Fisher-Yates 洗牌 + `playHistory` 回退 | `shuffleHistory` + `playedIndices` 整轮去重 |
| 顺序 | `repeatMode: off`，播完停止 | `sequence`，播完停止 |

**差异本质**：桌面把循环语义交给原生播放器（`repeatMode` 三态），移动端因后台保活与 JS 状态同步需求，把原生固定为 `Off`，全部循环/切歌由 JS 调度，原生只负责播单曲。

---

## 6. 预取对比

| 维度 | 桌面 | 移动 |
|---|---|---|
| 偏移 | `[-1, +1, +2]`，随机模式 `[+1, +2, -1]`（`prefetchService.ts`） | 内存预取下一首 |
| 预取内容 | URL + 歌词 + 封面 | URL（纯 URL，不预读歌词/封面） |
| 预加载 | `playerEngine.preload(url)` 用隐藏 `<audio>` 暖缓存 | URL 写入内存预取缓存 |
| TTL | 10min（`PREFETCH_TTL_MS`） | 10min |
| 触发 | 切歌后 `prefetchNearbyTracks` 并行预取邻近曲 | `playNextInQueue` 等触发 `prefetchSong` |

桌面预取更深（URL+歌词+封面三件套），移动端只预读 URL，歌词/封面在播放时即时加载。

---

## 7. 缓存对比

### 7.1 桌面 — Rust 三层

`desktop/src-tauri/src/commands/media_cache.rs` + `commands.rs`：

| 层 | 目录 | 策略 |
|---|---|---|
| song-audio | `app_cache_dir/song-audio/` | LRU，上限 **2GiB**（`SONG_AUDIO_CACHE_MAX_BYTES`），超限按 mtime 从最旧删 |
| bili-audio | `app_cache_dir/bili-audio/` | 独立目录，无 LRU 上限 |
| song-covers | `app_cache_dir/song-covers/` | 封面缓存，无独立上限 |

- **`lookup_cached_media` 纯探测无网络**：按 key + 扩展名白名单（audio: mp3/flac/m4a/...；cover: jpg/png/webp/...）在目录下找文件，找到返回路径，不发任何网络请求。
- 音频下载经 Rust `reqwest`（挂 SSRF guarded client）。
- `enforce_song_audio_cache_limit` 只管 song-audio，不碰 bili-audio/song-covers。

### 7.2 移动 — 三层

`apps/mobile/src/services/cacheService.ts` + `playbackUrlCache.ts`：

| 层 | 介质 | 容量/TTL |
|---|---|---|
| 内存预取 | JS Map | 10min TTL |
| 磁盘 LRU | `RNFS.CachesDirectoryPath/auralflow/{audio,covers,lyrics}` | 上限 **100MB**，超限按 mtime LRU 删；封面/音频 immutable（URL 不变永不过期），歌词 30 天过期 |
| AsyncStorage URL 缓存 | `auralflow:playback-url-cache:v2` | TTL：普通 6h / B站 30min / 本地 1 年；上限 500 条；带版本号 v2 |

- `getCachedPlaybackUrl` 按音质降级链 + 多源变体（`variants`）查询，命中即返回（含 headers）。
- `saveCachedPlaybackUrl` 双键写入（歌曲主键 + 解析真实源），扩大命中面。
- 写缓存后延迟去抖触发 `enforceCacheSizeLimit`（2s 防抖），避免每次写入都遍历文件系统。

**差异本质**：桌面音频缓存大（2GiB）且有独立 bili-audio 目录，移动端受存储约束只给 100MB；桌面 URL 缓存走 Tauri library（`persistentCache.ts`），移动端用 AsyncStorage；移动端多了内存预取层（10min）作为磁盘与网络之间的快层。

---

## 8. 音效与倍速

| 维度 | 桌面 | 移动 |
|---|---|---|
| 均衡器 | WebAudio 5 段 BiquadFilter（60/230/910/3600/14000 Hz） | 原生 AudioFx 5 段（Android） |
| 声像 | `StereoPannerNode` | `nativeSetPan` |
| 混响 | `ConvolverNode` 衰减噪声脉冲响应 | `nativeSetReverbMix` |
| 变调 | WebAudio `ScriptProcessorNode` + soundtouchjs | ExoPlayer `PlaybackParameters(speed, pitch)`（仅 Android） |
| 倍速 | `setPlaybackRate` 0.25–3.0 | `setPlaybackRate` 0.25–3.0 + `SUPPORTED_PLAYBACK_RATES` + `syncPlaybackParameters` |
| 持久化 | Tauri bridge settings | AsyncStorage |

桌面音效在 WebAudio 管线内（`MediaElementSource → EQ → Panner → Convolver → Gain → destination`），移动端调原生 AudioFx；移动端变调仅 Android，iOS 不支持独立变调。倍速移动端经 `syncPlaybackParameters` 透传到 Android 原生 `PlaybackParameters`。

---

## 9. 差异汇总

| 优先级 | 差异 | 影响 |
|---|---|---|
| — | 淡入淡出 | 桌面 90/140ms 余弦 rAF；移动 80/120ms 步进，后台跳过步进一步设值 |
| — | 后台保活 | 桌面靠 WebView 标签页；移动靠静音间隙 + 前台服务 |
| — | 预取深度 | 桌面 URL+歌词+封面；移动仅 URL |
| — | 缓存容量 | 桌面 2GiB Rust LRU；移动 100MB 磁盘 + AsyncStorage URL 6h |
| — | 播放模式 | 桌面原生 repeatMode 三态；移动 RepeatMode.Off 固定 JS 驱动 |
| — | 变调 | 桌面全平台 WebAudio；移动仅 Android |
