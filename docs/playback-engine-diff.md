# 播放引擎差异 — 桌面端 vs 移动端

本文对比 AuralFlow 桌面端与移动端播放引擎的实现差异。双端共享 `@lx/core` 中的纯逻辑（音质竞速、试听判定、连点合并），但底层播放器、后台保活、淡入淡出、缓存策略因平台能力不同而显著分叉。

> 更新日期：2026-09-02

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
- **错误时显式停循环**：src 加载失败可能发生在 `play()` 之后（`audio.paused` 仍为 false），tick 的 paused 守卫拦不住，rAF 会以 60fps 空转并每帧 patchState；故 `error` 事件里显式 `stopProgressLoop()` 防空转。
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
- `pauseOnExternalPlayback` 控制外部抢占（其它应用开始播放）的处置：默认开启 = 保持暂停；关掉且 `shouldResumeAfterExternalPause` 其余条件通过时自动续放（`play()`）。桌面只有暂停/续放二选一，没有降音量分支（降音量是移动端 duck 语义）。

### 2.5 预览检测

`loadedmetadata` 事件触发时比对 `audio.duration` 与 `music.interval`，经 `@lx/core` 的 `isPreviewDuration` 判定是否为试听片段，是则通知 `previewListeners`。

### 2.6 patchState 单变异路径

- `patchState` 是唯一的状态写入入口：shallow-merge patch 到 state，若 patch 含 `currentTime` 则同帧写入 `currentTimeSampledAt`，然后 fanout 到所有 `stateListeners`。
- 单变异路径保证状态时序确定，避免多处直接改 state 造成竞态。

### 2.7 状态恢复边界

- **播放进度不跨启动恢复**：桌面不持久化播放进度，`resume()` 只对 `paused` 有效；`togglePlay` 对 idle/error/loading 一律重新走 `play()` 重新解析播放（resume 无法从这些状态恢复）。
- 音量等设置经 `patchSettings` 写入 Rust settings 持久化。快照对比见第 9 节 9.3。

---

## 3. 移动端 — RNTP/ExoPlayer

### 3.1 `playerStore.ts`（1004 行）与懒初始化

- Zustand store 直接调用 `TrackPlayer` 原生 API，无独立 engine class。
- **RNTP 4.1.2 + 原生补丁**（`apply-track-player-patch.js`，postinstall 执行）：4.1.2 有 36 个单行表达式体 `@ReactMethod`（`fun x(...) = scope.launch {}`，返回 Job 而非 void），RN 0.86 新架构 TurboModule interop 解析注解时启动即崩（`Unable to parse @ReactMethod annotations`）；补丁把 36 处逐个转成块体 `{ scope.launch {} }`。
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
- 单曲循环：由静音轨事件触发 `skip(0)` + `seekTo(0)` + `play()`（回到队列首位真实曲目重播，index 1 是静音占位）。

### 3.4 inflightPlayRequests 竞态保护

- **`buildMobilePlayRequestKey`（含 quality）**：同 key 的并发 play 复用同一 Promise，避免重复 reset/add 同一 track。
- 不同 key（如切音质后再切）`inflightPlayRequests.clear()` 清除陈旧条目，避免稍后重试复用已判死的 promise（表现为「点了没反应」）。
- **`playRequestId` 令牌**：自增序列号，快速切歌只保留最新请求；reset 与 add 之间有 await 让出点，此处再查一次令牌关死交错窗口。

### 3.5 RemoteDuck 音频焦点

`playbackService.ts` 的 `RemoteDuck`：

- `getAudioInterruptionAction`（`audioInterruptionPolicy.ts`）：`permanent` → 暂停；临时中断且 `pauseOnExternalPlayback` 开启 → 暂停；否则临时 duck → 音量压到 `DUCKED_VOLUME = 0.2`（存 `externalDuckVolume`）；中断结束（`paused=false`）恢复原音量。
- duck 态落库：切歌淡入以该音量为上限（`fadeInTarget = min(volume, externalDuckVolume)`），避免 duck 中自动切歌把音量淡回满格、盖住导航播报；恢复音量时清除标记。

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

## 5. 取链对比（播放地址解析）

双端共用 `@lx/core` 的分轮次表与竞速算法（见 4.1），但解析链的预算、通道与缓存顺序各自实现。

### 5.1 共享分轮与竞速

- **`buildPlaybackQualityTiers(选定音质)`** 生成分轮次表：首轮 = 「不低于选定音质」的全部档位（从高到低）一起竞速；首轮全败才逐档下调，后续每轮单档——更高档已在首轮试过，不重复请求。
- **`raceForBestQuality` 800ms 升级窗口**（`DEFAULT_QUALITY_UPGRADE_WINDOW_MS`）：先成功者暂存为 best，窗口内更高档到达则替换；ceiling 命中或全部 settled 即定稿。

### 5.2 桌面 — `playbackResolver.ts`

- **总预算 12s**（`PLAYBACK_RESOLVE_TOTAL_BUDGET_MS = 12_000`）：竞速已压缩最坏等待，但个别网关/音源脚本卡死仍需兜底；超时抛错走错误分支，不再无限等。
- **参赛通道 = 内置网关 + 自定义音源双 backend**；wy/tx 官方直连 provider 不参与竞速，只在两处出现：B 站歌源的独立解析分支（无音质分层、接口链路慢，提前单独解析不进竞速），以及竞速全败后的最后兜底（wy/tx 官方直连 provider，网关整条挂掉时不至于整首失败）。
- 每轮把该轮全部档位同时交给两个 backend，取音质最高的成功结果；该轮全败才进下一轮。
- **胜出 URL 过 `streamProbe`**：1 字节 Range（`bytes=0-0`）探活，5s 超时；优先从 Content-Range 取完整字节数，分片响应不回退 Content-Length（1 字节分片若被当成完整大小，所有歌曲都会被误判试听）。探活失败或 `isPreviewStream` 判为试听 → 本轮作废，降档重试。

### 5.3 移动 — `playerService.ts`

- **两级预算**：`RESOLVE_RACE_BUDGET_MS = 10_000` 为分轮竞速预算（超时停止降档直接报错）；`RESOLVE_TOTAL_BUDGET_MS = 12_000` 为整条解析链的总预算帽（对齐桌面 `withResolveDeadline`），先到先出、超时统一报「解析超时」。
- **网关通道**：轮内按音质高→低**顺序**尝试，第一个成功的即本轮最高可用档——不对每档并发：gdstudio 是免费网关，同一首歌并发多档易触发限流。
- **自定义源通道**：「启用源 × 音质」全并发，`raceForBestQuality` 择优；两路再经一次 `raceForBestQuality` 择优。
- **三级缓存按序命中，命中均探活**：预读 Map（TTL 10min；条目超龄 60s（`PREFETCH_PROBE_AFTER_MS`）补探，死链就地作废重解析）→ 本地音频文件 → 持久化 URL 缓存（命中同样探活，探不通作废重解析，否则重启 app 后同一首歌永远缓冲）。
- 竞速胜出后同样过 1 字节 Range 探活 + `isPreviewStream` 试听判定，失败降档；全败后 wy 官方直连兜底（tx 无官方直连，兜底是网关同名搜索，已在音乐 API 层处理）。播放期 `isPreviewDuration` 兜底 chunked 流（见 4.2）。

### 5.4 音质切换

- 桌面：切音质 = 失效该曲持久化 URL 缓存 + 重新解析。
- 移动：`switchCurrentPlaybackQuality` 失效缓存后按目标音质重解析，并**携带原进度续播**（避免切音质后从头播放的回跳感）；显式指定音质（`qualityOverride`）时跳过全部缓存（预读/本地文件/持久化），避免旧码率命中。

---

## 6. 播放失败策略对比

| 维度 | 桌面 | 移动 |
|---|---|---|
| 自动跳开关 | `playbackFailedAutoNext`，**默认关闭 = 失败即停** | `autoSkipOnPlaybackError`，默认 false（停住等用户处置） |
| 跳过时机 | 250ms 延迟自动跳 | 先**原地重试一次**（`playbackFailurePolicy`：多数 403 重解析即救回），重试仍失败才判终局、交后台服务跳 |
| 触发条件 | 仅 `playing → error` 自动跳（loading→error 由 `playAndDidFail` 处理）；FM 模式无条件跳，loading→error 也要跳（否则推荐死链卡死） | 重试在途的错误不触发跳过（`retryInFlightKey`），由该次重试自己收口 |
| 连跳上限 | FM 连播 `playNextFmTrack` 最多 5 次 | 后台服务侧 `advancingInBackground` 重入锁 + `MAX_CONSECUTIVE_AUTO_SKIPS = 3`（连续 3 首失败停止自动跳） + 60s（`AUTO_SKIP_CHAIN_RESET_MS`）链条重置 |
| 健康归还 | — | 播放位置推进 ≥ 5s（`PLAYBACK_HEALTHY_POSITION_SECONDS`）视为已恢复，归还该曲重试额度，下次失败可再重试一次 |
| 与连点合并 | 自动跳复用 `next()` 入口 | auto 跳过绕过 switch-step-queue（切换在途时直接放弃，不排补跳） |

连点合并（`@lx/core` switch-step-queue，见 4.3）双端共用；自动跳过不排补跳——补跳语义是「用户连点要多跳一步」，自动跳过若也排进去，会在用户手动切歌完成后凭空多跳一首。

---

## 7. 播放模式对比

| 维度 | 桌面 | 移动 |
|---|---|---|
| 模式枚举 | `list-loop` / `single-loop` / `shuffle` / `sequence`（`playModeControl.ts`） | `list` / `single` / `shuffle` / `sequence`（`mobilePlayModeModel.ts`） |
| 原生 repeatMode 映射 | `repeatMode: off/all/one` + `isShuffle`（`PLAY_MODE_STATES`） | `RepeatMode.Off` 固定，JS 驱动全部切歌 |
| 单曲循环 | 原生 `repeatMode: one` | JS：静音轨事件触发 `skip(0)` + `seekTo(0)` + `play()` |
| 列表循环 | 原生 `repeatMode: all` | JS：静音轨事件 → `playNext`（`PlaybackQueueEnded` 兜底） |
| 随机 | `isShuffle: true` + Fisher-Yates 洗牌 + `playHistory` 回退 | `shuffleHistory` + `playedIndices` 整轮去重 |
| 上一首 | 随机模式从 `playHistory` 弹栈回退 | 进度 > 3s（`RESTART_PREVIOUS_THRESHOLD_SECONDS`）重播当前曲，否则队列回退 |
| 下一首播放 | `playNext(music)` 插入当前曲后，空队列则立即开播 | `tempPlayList` 独立暂存区（不污染主队列顺序），`playNext` 优先消费首曲（FM 上下文同样生效） |
| 顺序 | `repeatMode: off`，播完停止 | `sequence`，播完停止 |

**差异本质**：桌面把循环语义交给原生播放器（`repeatMode` 三态），移动端因后台保活与 JS 状态同步需求，把原生固定为 `Off`，全部循环/切歌由 JS 调度，原生只负责播单曲。上一首语义也不同：桌面随机模式依赖 `playHistory` 栈；移动端先看进度——超过 3s 重播当前曲（对齐主流播放器「上一首先回到曲首」习惯）。

---

## 8. 预取对比

| 维度 | 桌面 | 移动 |
|---|---|---|
| 偏移 | `[-1, +1, +2]`，随机模式 `[+1, +2, -1]`（`prefetchService.ts`） | 同桌面：`[-1, 1, 2]`，随机 `[1, 2, -1]`（`playerService.ts`） |
| 预取内容 | URL + 歌词 + 封面 | URL + 歌词 + 封面（`prefetchSong`，各自内部跳过已命中项；URL 只入内存缓存） |
| 预加载 | `playerEngine.preload(url)` 用隐藏 `<audio>` 暖缓存 | 仅解析入内存预取缓存，**不写原生队列**（原生恒单曲槽） |
| TTL | 10min（`PREFETCH_TTL_MS`） | 10min；命中时条目超龄 60s（`PREFETCH_PROBE_AFTER_MS`）补探活，死链作废重解析 |
| 触发 | 切歌后 `prefetchNearbyTracks` 并行预取邻近曲；FM 模式预取 `fmQueue` 接下来 1-2 首 | 插入「下一首播放/稍后播放」时立即 `prefetchSong`；进度事件驱动曲末预读：剩余 ≤ 10s（`UPCOMING_PREFETCH_LEAD_SECONDS`）预读下一首（稍后播放首曲 → FM 批次下一首/buffer 头部 → 队列下一首，三重去重） |

双端预取内容一致（URL+歌词+封面）；差异在落点与主动性——桌面预载进隐藏 `<audio>`，移动端只写内存缓存且不触碰原生队列，并在曲末 10s 窗口主动预读，把整条解析链提前到当前曲播完之前（FM 补拉推荐保 buffer ≥ 2 首，预读候选永远有货）。

---

## 9. 缓存对比

### 9.1 桌面 — Rust 三层

`desktop/src-tauri/src/commands/media_cache.rs` + `commands.rs`：

| 层 | 目录 | 策略 |
|---|---|---|
| song-audio | `app_cache_dir/song-audio/` | LRU，上限 **2GiB**（`SONG_AUDIO_CACHE_MAX_BYTES`），超限按 mtime 从最旧删 |
| bili-audio | `app_cache_dir/bili-audio/` | 独立目录，无 LRU 上限 |
| song-covers | `app_cache_dir/song-covers/` | 封面缓存，无独立上限 |

- **`lookup_cached_media` 纯探测无网络**：按 key + 扩展名白名单（audio: mp3/flac/m4a/...；cover: jpg/png/webp/...）在目录下找文件，找到返回路径，不发任何网络请求。
- 音频下载经 Rust `reqwest`（挂 SSRF guarded client）。
- `enforce_song_audio_cache_limit` 只管 song-audio，不碰 bili-audio/song-covers。

### 9.2 移动 — 三层

`apps/mobile/src/services/cacheService.ts` + `playbackUrlCache.ts`：

| 层 | 介质 | 容量/TTL |
|---|---|---|
| 内存预取 | JS Map | 10min TTL |
| 磁盘 LRU | `RNFS.CachesDirectoryPath/auralflow/{audio,covers,lyrics}` | 上限 **100MB**，超限按 mtime LRU 删；封面/音频 immutable（URL 不变永不过期），歌词 30 天过期 |
| AsyncStorage URL 缓存 | `auralflow:playback-url-cache:v2` | TTL：普通 6h / B站 30min / 本地 1 年；上限 500 条；带版本号 v2 |

- `getCachedPlaybackUrl` 按音质降级链 + 多源变体（`variants`）查询，命中即返回（含 headers）。
- `saveCachedPlaybackUrl` 双键写入（歌曲主键 + 解析真实源），扩大命中面。
- 写缓存后延迟去抖触发 `enforceCacheSizeLimit`（2s 防抖），避免每次写入都遍历文件系统。

### 9.3 播放快照与跨启动恢复

- **桌面：播放进度不落盘**。跨窗口同步（`playerSync.ts`）里的 playback snapshot 是实时广播的 DTO（BroadcastChannel + Tauri event），只喂给歌词/控制窗口，不持久化；音量等设置经 `patchSettings` 写入 Rust settings。播放进度不跨启动恢复（见 2.7）。
- **移动：AsyncStorage `auralflow:playback-snapshot:v1`**。保存触发：暂停（含快照清空）立即保存；结构性变化（currentSong/queue/currentIndex/shuffleHistory/模式/倍速/音量/FM 上下文）与进度（每跨过 10s 边界记一次）走 1.5s debounce（`SAVE_DEBOUNCE_MS`）；切后台时立即补存一次。
- 恢复只还原队列/当前曲/模式/音量等，不自动播放；FM 上下文（`personalFm` 的 buffer）无法离线恢复，退化为 `queue`；**先恢复完再挂订阅**，避免恢复期间的启动写入（如音量恢复）把未恢复的默认状态覆盖到磁盘快照。

**差异本质**：桌面音频缓存大（2GiB）且有独立 bili-audio 目录，移动端受存储约束只给 100MB；桌面 URL 缓存走 Tauri library（`persistentCache.ts`），移动端用 AsyncStorage；移动端多了内存预取层（10min）作为磁盘与网络之间的快层；移动端还持久化播放快照供重启恢复，桌面则完全没有进度持久化。

---

## 10. 音效与倍速

| 维度 | 桌面 | 移动 |
|---|---|---|
| 均衡器 | WebAudio 5 段 BiquadFilter（60/230/910/3600/14000 Hz） | 原生 AudioFx 5 段（Android） |
| 声像 | `StereoPannerNode` | `nativeSetPan` |
| 混响 | `ConvolverNode` 衰减噪声脉冲响应 | `nativeSetReverbMix` |
| 变调 | WebAudio `ScriptProcessorNode` + soundtouchjs | **无独立变调**：RNTP 4.1.2 原生 `setRate` 只收单参数，v4 的 `PlaybackParameters(speed, pitch)` 链路已被上游移除；变速与变调耦合，原生 AudioFx `setPitch` 返回 false，UI 不提供控件 |
| 倍速 | `setPlaybackRate` 0.25–3.0 | `setRate` 0.25–3.0 + `SUPPORTED_PLAYBACK_RATES` + `syncPlaybackParameters` |
| 持久化 | Tauri bridge settings | AsyncStorage |

桌面音效在 WebAudio 管线内（`MediaElementSource → EQ → Panner → Convolver → Gain → destination`），移动端调原生 AudioFx；移动端无独立变调（见上表，iOS 同样不支持）。倍速移动端经 `syncPlaybackParameters` → `TrackPlayer.setRate(rate)` 同步到原生（速度改变时音高随之改变）。

---

## 11. 差异汇总

| 优先级 | 差异 | 影响 |
|---|---|---|
| — | 淡入淡出 | 桌面 90/140ms 余弦 rAF；移动 80/120ms 步进，后台跳过步进一步设值 |
| — | 后台保活 | 桌面靠 WebView 标签页；移动靠静音间隙 + 前台服务 |
| — | 取链预算 | 桌面 12s 总预算；移动 12s 总帽 + 10s 分轮竞速预算，网关顺序/自定义源并发双路竞速 |
| — | 预取 | 双端均为 URL+歌词+封面；桌面预载隐藏 audio，移动曲末 10s 窗口预读、不写原生队列 |
| — | 失败策略 | 桌面 `playbackFailedAutoNext` 默认关，250ms 延迟跳；移动先重试一次再跳，后台限连跳 3 次 |
| — | 缓存容量 | 桌面 2GiB Rust LRU；移动 100MB 磁盘 + AsyncStorage URL 6h |
| — | 播放快照 | 桌面进度不落盘（跨窗口快照是实时广播 DTO）；移动 AsyncStorage snapshot v1，重启可恢复队列 |
| — | 播放模式 | 桌面原生 repeatMode 三态；移动 RepeatMode.Off 固定 JS 驱动 |
| — | 变调 | 桌面全平台 WebAudio；移动无独立变调（RNTP 4.1.2 `setRate` 变速变调耦合） |
