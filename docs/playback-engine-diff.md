# AuralFlow 播放引擎 — 桌面端 vs 移动端逐层对比

> 日期：2026-07-10

---

## 1. 播放引擎层

| 维度 | 桌面端 (`playerEngine.ts`) | 移动端 (`playerStore.ts` + TrackPlayer) |
|---|---|---|
| 底层 | `HTMLAudioElement` + WebAudio API | `react-native-track-player` (ExoPlayer / AVPlayer) |
| 架构 | 单例 class `PlayerEngine`，独立于 store，store 通过 subscribe 同步 | Zustand store 直接调用 TrackPlayer 原生 API |
| 淡入淡出 | ✅ `fadeOut()` 切歌前 90ms cosine 曲线淡出，`fadeIn()` 起播后 140ms 淡入，用 `requestAnimationFrame` 逐帧控制 | ❌ 无淡入淡出，切歌直接 reset + add + play |
| 预加载 | ✅ `preload(url)` 用隐藏 `<audio>` 预缓存下一首；`prefetchService` 预读前后 3 首的 URL + 歌词 + 封面 | ✅ `prefetchCache` 预读下一首 URL（纯 URL，不预读歌词/封面） |
| 播放竞态 | ✅ `activePlayRequestId` 自增序列号，快速切歌只保留最新请求 | ❌ 无竞态保护（连续调用 play 可能乱序） |
| 音效图 | ✅ WebAudio 懒构建：`MediaElementSource` → 5 段 EQ → `StereoPanner` → 混响卷积（`ConvolverNode`） → `GainNode` → destination | ✅ 原生 AudioFx：`attachSoundEffects()` 调 Android 原生均衡器/环绕声/混响 |
| 变调 | ✅ `soundtouchjs` + `ScriptProcessorNode`（实验性，WebAudio 管线内） | ✅ ExoPlayer `PlaybackParameters(speed, pitch)` 通过补丁透传（仅 Android） |
| 外部中断 | ✅ `mediaInterruptionPolicy` — 系统音频抢占时可选暂停/降音量 | ✅ TrackPlayer 内置处理 + `pauseOnExternalPlayback` 设置 |
| 音量持久化 | ✅ `patchSettings({ volume })` 400ms 防抖写入 | ❌ 无音量持久化（重启 app 恢复默认） |
| 错误恢复 | 预读缓存命中失败 → 持久化缓存失效 → 重新解析（`invalidatePersistentPlaybackCache`） | 自定义音源逐个尝试 → 全部失败抛错 |

**差距**：
- 🔴 **淡入淡出** — 移动端切歌有爆音风险
- 🔴 **播放竞态** — 移动端快速切歌可能播放非最新请求的歌曲
- 🟡 **音量持久化** — 移动端重启丢失音量设置
- 🟡 **预读深度** — 移动端只预读 URL，桌面端预读 URL+歌词+封面

---

## 2. 播放控制（playerStore）

| 维度 | 桌面端 | 移动端 |
|---|---|---|
| 播放模式 | 4 种：`sequence` / `repeat-all` / `repeat-one` / `shuffle`（`playModeControl.ts`） | 4 种：`list` / `single` / `shuffle` / `sequence`（`mobilePlayModeModel.ts`）|
| 随机播放 | ✅ Fisher-Yates 洗牌 + `playHistory[]` 回退上一首 | ✅ `shuffleHistory[]` 同逻辑 |
| 上一首/下一首 | `prev()` / `next()` — 随机模式用 playHistory 回退 | `playPrevious()` / `playNext()` — 用 `queueNavigationModel` |
| 加队列 | `addToQueue` / `playNext` | `addToQueue` / `playNextInQueue` ✅ |
| 删除队列项 | `removeFromQueue` | `removeFromQueue` ✅ |
| 清空队列 | `clearQueue` | `clearQueue` ✅ |
| FM 模式 | ✅ `fmMode` flag → `discoveryStore.fmNext()` 自动拉推荐 | ✅ `PersonalFmContext` buffer + batch 拉取 |
| 睡眠定时 | 独立 `sleepTimerStore`（按时间 + 按首数） | store 内置（按时间 + 按首数）✅ |
| 倍速 | ✅ `setPlaybackRate` (0.25-3.0) | ✅ `setPlaybackRate` (0.25-3.0) + `SUPPORTED_PLAYBACK_RATES` |
| 音质切换 | ❌ 播放中不可切 | ✅ `switchCurrentPlaybackQuality()` 播放中切当前曲音质 |
| 播放快照 | ✅ `playbackSnapshot` 持久化队列/当前曲/模式 | ✅ `playbackSnapshot` 持久化 ✅ |

**差距**：
- 🟢 **移动端有音质切换** — 桌面端没有
- 🟢 其余控制基本对齐

---

## 3. URL 解析（播放地址获取）

| 维度 | 桌面端 (`playbackResolver.ts`) | 移动端 (`playerService.ts`) |
|---|---|---|
| 解析链 | 1. 持久化缓存 → 2. 内置网易云 → 3. 备用 Provider → 4. 自定义音源 | 1. 预读缓存 → 2. 内置 `parseUrl` → 3. 自定义音源逐个尝试 |
| 音质降级 | ✅ `qualityPreference` 数组逐级尝试 | ✅ `getPlaybackQualityFallbacks()` 逐级降级 |
| 持久化缓存 | ✅ `getCachedPlaybackUrl` / `saveCachedPlaybackUrl` | ❌ 无持久化 URL 缓存（只有内存预读缓存） |
| 媒体缓存 | ✅ `cacheResolvedMedia` 下载到本地文件 | ❌ 无媒体缓存 |
| 多源变体 | ✅ `variants[]` 跨源尝试（搜索结果合并后） | ❌ 单源解析（去重后的 primary） |
| B站特殊处理 | Provider 统一处理 | ✅ `resolveBiliSongUrl` + Referer header |

**差距**：
- 🔴 **持久化缓存** — 移动端每次冷启动重新解析 URL，浪费流量和时间
- 🔴 **媒体缓存** — 移动端只有内存预读，无本地文件缓存
- 🟡 **多源变体回退** — 移动端搜索去重后只用 primary 源解析，失败不会自动切其他源

---

## 4. 歌词系统

| 维度 | 桌面端 | 移动端 |
|---|---|---|
| 解析器 | `lyrics/parserCore.ts` — 支持 LRC / Enhanced-LRC / YRC / QRC / KRC / VTT，逐字歌词 `words[]` | `@lx/core` 的 `parseLyricSource` — 支持 LRC / YRC / QRC / KRC，逐字歌词 ✅ |
| 译文合并 | ✅ `mergeTranslation()` + `mergeMissingLines()` | ✅ `getLyrics` 返回 `translation` 合并 |
| 匹配评分 | ✅ `matchScore.ts` — 多源歌词择优（标题/歌手/时长相似度） | ❌ 直接用主源歌词，不做多源匹配 |
| 歌词缓存 | ✅ 内存缓存 + 持久化缓存 | ✅ `getCachedLyrics` / `cacheLyrics` |
| 滚动渲染 | DOM 滚动 + `scrollIntoView` + 用户滚动暂停 3s 恢复 | `FlatList` + `scrollToIndex` + 动画 |
| 用户滚动暂停 | ✅ `USER_SCROLL_RESUME_DELAY_MS = 3000` | ❌ 自动跟唱，无用户滚动暂停机制 |
| 行进度估算 | ✅ `playbackSync.ts` — 无逐字歌词时按 CJK 字符/拉丁词估算行内进度 | ❌ 无行进度估算 |
| 逐字高亮 | ✅ `LyricWord` start/dur 驱动，Enhanced-LRC / YRC / QRC / KRC | ✅ `KaraokeLyricLine` 组件逐字渲染 |
| 动画强度 | ✅ `animationIntensity` 三级（reduced/normal/enhanced） | ✅ `lyricSettingsStore.animationIntensity` |
| 字体/字号/颜色 | ✅ 持久化设置 + 广播同步 | ✅ `lyricSettingsStore` 持久化 |

**差距**：
- 🟡 **用户滚动暂停** — 移动端没有，用户手动滚动歌词后无法暂停自动跟唱
- 🟡 **行进度估算** — 移动端无逐字歌词时当前行无进度动画
- 🟡 **多源歌词匹配** — 移动端直接用主源歌词，不做择优

---

## 5. 沉浸歌词

| 维度 | 桌面端 (`ImmersiveLyricsOverlay`) | 移动端 (`ImmersiveLyricsScreen`) |
|---|---|---|
| 形态 | 全屏 overlay（点击封面打开） | 独立 Screen（点击封面打开） |
| 歌词显示 | 大字号滚动 + 逐字高亮 + 译文 | 大字号滚动 + 逐字高亮 + 译文 ✅ |
| 控制条 | 播放/暂停/上下首 + 播放模式 + 倍速 + 音量 + 睡眠 + 音效 + 桌面歌词 | 播放/暂停/上下首 + 睡眠 + 倍速 + 音量 + 音效 + 音质 + 歌词海报 |
| 视觉化 | ✅ `PlayerVisualizerRenderer` 音频可视化 | ✅ `PosterWaveVisualizer` 海报波形 |
| 封面背景 | ✅ 封面模糊背景 | ✅ 封面模糊 + 氛围色 |
| 锁定/解锁 | 桌面歌词窗口可锁定 | ❌ 无锁定 |
| 分享 | ✅ 歌词海报分享 | ✅ 歌词海报分享 |
| 字体/字号 | ✅ 可配置 | ✅ 可配置 |
| 译文开关 | ✅ 独立开关 | ✅ 独立开关 |

**差距**：基本对齐 ✅，移动端音质切换是加分项

---

## 6. 音效系统

| 维度 | 桌面端 | 移动端 |
|---|---|---|
| 均衡器 | ✅ WebAudio 5 段 BiquadFilter（60/230/910/3600/14000 Hz） | ✅ 原生 AudioFx 5 段 |
| 预设 | 6 个：原声/流行/摇滚/爵士/重低音/人声 | 6 个同 ✅ |
| 声像 | ✅ `StereoPannerNode` | ✅ `nativeSetPan` |
| 混响 | ✅ `ConvolverNode` 衰减噪声脉冲响应 | ✅ `nativeSetReverbMix` |
| 变调 | ✅ WebAudio `ScriptProcessorNode` + soundtouchjs | ⚠️ ExoPlayer pitch 参数（仅 Android） |
| 持久化 | ✅ Tauri bridge settings | ✅ AsyncStorage |
| 入口 | 设置页 + 沉浸歌词 | 设置页 + 播放页 + 沉浸歌词 ✅ |

**差距**：移动端变调仅限 Android，iOS 不支持独立变调

---

## 7. 歌词滚动对比（关键体验）

### 桌面端歌词滚动机制

```
当前行 → scrollIntoView({ behavior: 'smooth', block: 'center' })
用户手动滚动 → 设置 userScrolled = true → 暂停自动滚动
3 秒后恢复 → userScrolled = false → 重新跟唱
行进度 → 无逐字时用 playbackSync 估算（CJK 0.24s/字，拉丁 0.42s/词）
```

### 移动端歌词滚动机制

```
当前行 → FlatList.scrollToIndex({ index, animated: true })
无用户滚动暂停 → 始终自动跟唱
行进度 → 有逐字用 KaraokeLyricLine，无逐字无进度动画
```

### 差异

| 功能 | 桌面 | 移动 | 影响 |
|---|---|---|---|
| 用户滚动暂停 | ✅ 3s 暂停 | ❌ | 移动端想看前后歌词时会被强制拉回 |
| 行进度估算 | ✅ 无逐字也有进度 | ❌ 无逐字时当前行无高亮进度 | 移动端听外语歌时体验差 |
| 逐字渲染 | ✅ LyricWord 时间戳 | ✅ KaraokeLyricLine | 一致 |
| 滚动动画 | smooth scroll | Animated | 一致 |
| seek to line | ✅ 点击歌词行 seek | ✅ 点击歌词行 seek | 一致 |

---

## 汇总：播放相关需要补齐的差异

| 优先级 | 差异 | 说明 |
|---|---|---|
| **P0** | 淡入淡出 | 移动端切歌无 fade，有爆音风险 |
| **P0** | 播放竞态保护 | 移动端快速切歌可能播放旧请求 |
| **P0** | 音量持久化 | 移动端重启丢失音量设置 |
| **P1** | 歌词用户滚动暂停 | 移动端没有，想看前后歌词会被拉回 |
| **P1** | 无逐字歌词时行进度估算 | 移动端无逐字时当前行无高亮进度 |
| **P1** | 持久化 URL 缓存 | 移动端冷启动重新解析，浪费流量 |
| **P1** | 多源歌词匹配 | 移动端直接用主源，不做择优 |
| **P2** | 预读深度 | 移动端只预读 URL，不预读歌词/封面 |
| **P2** | 多源变体回退 | 移动端搜索去重后只用 primary 源 |
| **P2** | iOS 变调 | 移动端变调仅限 Android |
