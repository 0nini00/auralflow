# AuralFlow 移动端功能对齐状态

> 目的：逐项列移动端已实现对齐桌面的功能，以及移动端独有、桌面端独有的能力。标记 ✅ 已对齐 / 📱 移动独有 / 💻 桌面独有 / ⬆️ 移动反超。
> 基线：桌面端 `desktop/`，移动端 `apps/mobile/`，共享核心 `@lx/core`。以 2026-07-11 双端源码逐文件取证为准，已剔除 07-10 误判。

---

## 一、已对齐功能（✅ 已对齐）

> 列：功能 | 桌面实现 | 移动实现 | 对齐状态

### 搜索

| 功能 | 桌面实现 | 移动实现 | 对齐状态 |
|---|---|---|---|
| 多源搜索 wy/tx | `searchMergedSources()` 按 type 并发 wy+tx | `searchAll("all",query)` 搜 wy+tx songs 再分别搜歌手/专辑/歌单 | ✅（⬆️ 移动多 bili 视频源） |
| 跨源去重合并 | `groupSongResults()` 同名+同歌手+时长差≤6s 合并，保留多源 variant | `songGroupModel.groupSongResults`+`mergeDuplicateSongs` | ✅ |
| 联想词 | `searchSuggestions.ts` 线上+本地合并 | `searchSuggestionService.getSearchSuggestions` | ✅ |
| 搜索历史 | `searchHistory.ts` get/add/remove/clear | UI 列表+清空 | ✅ |
| 竞态保护 | `searchRequestSeqRef` 自增序列号 | `searchRequestSeqRef`+requestId 早退 | ✅（07-10 误判已修正） |
| 5 分类 Tab | 综合/单曲/歌手/专辑/歌单 | `searchAll` type all\|wy\|tx\|bili | ✅ |

### 歌单

| 功能 | 桌面实现 | 移动实现 | 对齐状态 |
|---|---|---|---|
| 歌单详情 | `/playlist/:id` 路由，支持 `state.playlist` 预填 | `PlaylistDetailScreen` 经 `openPlaylistRoute()` 子路由 | ✅ |
| 歌单 CRUD | `usePlaylistStore`（desktop） | `usePlaylistStore`（mobile） | ✅ |
| 操作集 | 播放全部/随机/定位当前/刷新/收藏 | 同 | ✅ |
| 歌单收藏导入 | wy→收藏到账号，tx→导入本地歌单 | `handleImportPlaylist` 同逻辑 | ✅ |
| 导入/导出 | `exportPlaylists`/`importPlaylists` | `shareExportedPlaylists`/`importPlaylistsFromJsonInput` | ✅ |

### 日推 / 私人 FM

| 功能 | 桌面实现 | 移动实现 | 对齐状态 |
|---|---|---|---|
| 每日推荐 | `discoveryStore`→独立 `/daily` 路由 | `dailyRecommendMetaModel.buildDailyRecommendMeta` | ✅ |
| 私人 FM | `createPersonalFmQueueController` 播放卡片+下一首 | `personalFmMetaModel` 播放卡片+下一首 | ✅ |

### 播放

| 功能 | 桌面实现 | 移动实现 | 对齐状态 |
|---|---|---|---|
| 播放控制 play/pause/next/prev/seek | `playerEngine.ts` 388 行 HTMLAudio+rAF+500ms 后备 | `playerStore.ts` 1004 行+RNTP(ExoPlayer) | ✅ |
| 播放竞态保护 | `activePlayRequestId` 自增序列号 | `playRequestId`+`inflightPlayRequests` 去重 | ✅（07-10 误判已修正） |
| 外部播放暂停 | `pauseOnExternalPlayback`+`mediaInterruptionPolicy` | `pauseOnExternalPlayback`+RemoteDuck 音频焦点 permanent 暂停/else duck | ✅ |
| 睡眠定时（分钟+首数） | `sleepTimerStore` | `playerStore.startSleepTimer`/`startSongSleepTimer` | ✅ |
| 队列管理 | `playerStore` addToQueue/playNext/removeFromQueue/clearQueue | 同+队列弹窗 UI | ✅（⬆️ 移动多队列 UI） |
| 播放快照持久化 | `playbackSnapshot` 持久化 | `playbackSnapshot`+shuffleHistory 持久化 | ✅（⬆️ 移动可离线恢复 shuffle） |
| 预览检测 | `isPreviewStream`/`isPreviewDuration` | `streamProbe` 1 字节 Range 5s+`isPreviewDuration` | ✅ |
| raceForBestQuality 800ms 升级窗口 | `playbackResolver.ts` | `playerService.ts` | ✅（共享 `@lx/core` playback-quality） |

### 4 播放模式

| 功能 | 桌面实现 | 移动实现 | 对齐状态 |
|---|---|---|---|
| 4 种播放模式 | `playModeControl.ts` list-loop/single-loop/shuffle/sequence | `mobilePlayModeModel.ts` list/single/shuffle/sequence | ✅ |

### 淡入淡出

| 功能 | 桌面实现 | 移动实现 | 对齐状态 |
|---|---|---|---|
| 淡入淡出 | `fadeOut()` 90ms+`fadeIn()` 140ms 余弦曲线 rAF 逐帧 | `fadeVolume(target,durationMs)` 余弦，后台 fadeVolume 跳过步进 | ✅（07-10 误判已修正） |

### 倍速

| 功能 | 桌面实现 | 移动实现 | 对齐状态 |
|---|---|---|---|
| 倍速 | `setPlaybackRate` 0.25-3.0 | `setPlaybackRate`+`androidPitchService.setRate(rate,pitchRatio)` 双参保持音高 | ✅（⬆️ 移动保持音高） |

### 音效

| 功能 | 桌面实现 | 移动实现 | 对齐状态 |
|---|---|---|---|
| 音效 EQ 5 段/声像/混响 | `soundEffectStore.ts` WebAudio 5 段 BiquadFilter+ConvolverNode 混响 | `soundEffectStore`+`soundEffectService` 原生 AudioFx/Equalizer/PresetReverb | ✅（平台原生，控制对齐） |

### 5 级下载

| 功能 | 桌面实现 | 移动实现 | 对齐状态 |
|---|---|---|---|
| 5 级音质 128k/192k/320k/flac/flac24bit | Rust `downloads.rs` 流式+取消+180ms 节流 | `downloadStore` 411 行串行+`downloadService.ts` | ✅（共享 `@lx/core` playback-quality） |
| ID3 嵌入 | `enhanceDownloadedFile` ID3+内嵌封面+内嵌歌词 | `id3TagWriter.ts` 纯 JS ID3v2.4+APIC 封面+USLT 歌词 | ✅（2026-07-11 补齐） |
| 旁注 .lrc | .lrc 旁注 | sidecar .lrc | ✅ |
| 播放已下载 | `toLocalMusic(task)`→`play()` | `play(song,localPath)` 直接本地路径 | ✅ |

### 歌词

| 功能 | 桌面实现 | 移动实现 | 对齐状态 |
|---|---|---|---|
| 解析器 6 格式归一化 | `@lx/core` parser lrc/enhanced-lrc/yrc/qrc/krc/vtt | 同 | ✅（共享核心） |
| 译文合并 ±150ms | `desktopLyric.ts` mergeTranslation+mergeMissingLines | `@lx/core` 翻译合并 | ✅ |
| 行进度估算 | `@lx/core` playbackSync 二分查找 0.12s 提前 CJK/拉丁加权 | `@lx/core calculateLyricLineProgress` 同算法 | ✅ |
| 逐字高亮 | LyricWord start/dur 驱动 | KaraokeLyricLine+行内进度填充 | ✅ |
| 多源歌词匹配 | `matchScore.ts` 多源择优 | lyricsService 搜索匹配+`scoreLyricContentQuality`+0.12s 迟滞 | ✅ |
| 歌词偏移校准 | `SettingsView` manualOffsetMs 滑块 | `LyricSettingsScreen` 歌词偏移校准滑块 | ✅ |
| 用户滚动暂停 3s | `USER_SCROLL_RESUME_DELAY_MS=3000` | `LyricView` onScrollBeginDrag+3s 暂停 | ✅ |
| 沉浸歌词 | `ImmersiveLyricsOverlay` 全屏 overlay | `ImmersiveLyricsScreen` Modal fullScreenModal | ✅（平台原生） |
| 歌词字体/字号/颜色 | 持久化设置+广播同步 | `lyricSettingsStore` 持久化 | ✅ |
| 动画强度三级 | `animationIntensity` reduced/normal/enhanced | `lyricSettingsStore.animationIntensity` 三级 | ✅ |

### 本地音乐

| 功能 | 桌面实现 | 移动实现 | 对齐状态 |
|---|---|---|---|
| 本地音乐扫描 | Rust `local_audio.rs` walkdir+audiotags/lofty | `LocalMusicModule` 778 行 MediaStore+jaudiotagger | ✅（平台原生） |
| 本地元数据编辑 | audiotags/lofty 写 | jaudiotagger 写 | ✅ |

### 缓存

| 功能 | 桌面实现 | 移动实现 | 对齐状态 |
|---|---|---|---|
| URL 缓存 | `persistentCache.ts` playbackUrl TTL 其他 6h/bili 30min/local 1y MAX500 | `playbackUrlCache.ts`+AsyncStorage URL 缓存 6h/30min/1yr | ✅ |
| 歌词缓存 | 内存+持久化 | `cacheService.cacheLyrics` 磁盘层 | ✅ |
| 音频文件缓存 | `mediaCache.ts` 三层 2GiB LRU | `cacheService.cacheAudioFile`+`isLocalFilePlayable` 三层 内存 10min/磁盘 LRU 100MB | ✅（07-10 误判已修正） |
| 封面文件缓存 | `mediaCache.ts` `cacheRemoteImage` 落盘 | `cacheService.cacheCover`+`CachedImage`(fast-image+Glide) | ✅（07-10 误判已修正） |
| 缓存统计 | `getSongCacheStats` audioCacheSize/coverCacheSize | 分类统计 | ✅ |
| 缓存清理 | 清缓存/清历史 | 分类清理+全部清理 | ✅ |

### 下载

| 功能 | 桌面实现 | 移动实现 | 对齐状态 |
|---|---|---|---|
| 下载进度/重试/清空 | `downloadStore` | `downloadStore` 411 行 | ✅ |

### 历史

| 功能 | 桌面实现 | 移动实现 | 对齐状态 |
|---|---|---|---|
| 播放历史 | `historyStore` | `historyStore` 234 行 2000 上限 31 天 | ✅ |
| 历史管理 播放全部/随机/清空/删除 | 独立 `HistoryView` | 曲库 history section | ✅ |

### WebDAV

| 功能 | 桌面实现 | 移动实现 | 对齐状态 |
|---|---|---|---|
| 同步实现 | `webdavSyncService.ts` 629 行 同步锁+lastModified 冲突 | `webdavSyncService` 原生 fetch+lastModified 冲突 | ✅ |
| 合并语义 | `@lx/core` webdav-merge 纯函数加法合并 | `@lx/core` webdav-merge+自动 download-merge-then-upload-converge | ✅ |
| 下载合并/上传覆盖 | 下载合并/上传覆盖 | 下载合并/上传覆盖 | ✅ |
| 写读路径 | /AuralFlow/ 写 / LX_Music/ 读回退 | LX 格式+自动 converge | ✅ |
| 同步内容 | `user_apis.json`+`playlists.json` | 同+额外同步 `localPlaylists` | ✅（⬆️ 移动多本地歌单） |
| 删除永不传播 | `@lx/core` webdav-merge | 同 | ✅ |

### 账号

| 功能 | 桌面实现 | 移动实现 | 对齐状态 |
|---|---|---|---|
| 网易云 QR 登录 | `wyAccountService.ts` 601 行 weapi/eapi 双通道+QR type=3+SVG 二维码+`loginStatus` 轮询 | `wyQrLoginService` getQrCodeKey/createWyQrCode/pollWyQrLoginStatus | ✅ |
| 网易云 Cookie | 网易云 Cookie | NetEase cookie | ✅ |
| B 站登录 | `biliAccountService` settings.biliCookie | `biliService` Cookie | ✅ |
| 我的歌单 | `wyAccountStore` setSubscribed | `playlistStore.setWyPlaylistSubscribed` | ✅ |
| 收藏 | `favoritesStore` 喜欢列表 | `favoritesStore`/`playlistStore.likedSongs` | ✅ |
| 歌单 CRUD | `wyAccountService` 歌单 CRUD | `playlistStore` 歌单 CRUD | ✅ |

### 主题

| 功能 | 桌面实现 | 移动实现 | 对齐状态 |
|---|---|---|---|
| 主题/强调色/背景图 | `useThemeStore`（desktop） | `useThemeStore`（mobile） | ✅ |
| 检查更新 | 有 | 有 | ✅ |

### B 站

| 功能 | 桌面实现 | 移动实现 | 对齐状态 |
|---|---|---|---|
| B 站收藏合集 | `getBiliCollectionSongs` favorite/season/series+`biliAccountStore` 可见性 | `biliService.getBiliCollectionSongs`+`biliCollectionVisibilityModel` | ✅ |
| B 站合集可见性 | `biliAccountStore` 可见性 | `biliCollectionVisibilityModel` | ✅ |
| B 站独立详情页 | 无独立详情页 | `BiliCollectionDetailScreen` | ✅（⬆️ 移动反超） |

---

## 二、移动端独有功能（📱 移动独有）

> 列：功能 | 实现方式 | 说明

### 后台 / 通知 / 锁屏

| 功能 | 实现方式 | 说明 |
|---|---|---|
| 通知栏控制 | `apply-track-player-patch.js` 补丁 `MusicService.kt` 通知栏歌词+控制 | 📱 移动独有 |
| TrackPlayer 后台播放 | `playbackService.ts` RNTP 后台 `PlaybackActiveTrackChanged`→`advanceAfterTrackFinished` | 📱 移动独有 |
| 锁屏控件 | RNTP 原生锁屏控件 | 📱 移动独有 |
| 静音间隙前台服务 | `MusicService` 前台服务+静音间隙技巧 [真实歌曲,SILENCE_GAP_TRACK 2s] 保持前台 | 📱 移动独有 |

### 交互 / 功能

| 功能 | 实现方式 | 说明 |
|---|---|---|
| Deep Link | `parseMobileDeepLink`→`initialKeyword`（auralflow://） | 📱 移动独有 |
| 分享面板 | `Share.share` 系统分享 Sheet | 📱 移动独有 |
| MV 播放器 | `react-native-video` MV 播放 | 📱 移动独有 |
| 首页 feed | `homeFeedStore` 463 行 600s TTL 按账号隔离 | 📱 移动独有 |
| Android 浮动歌词 | `LyricOverlayService` 407 行 WindowManager TYPE_APPLICATION_OVERLAY+拖动+锁定 FLAG_NOT_TOUCHABLE 穿透 | 📱 移动独有（Android 原生） |
| 自动检查自定义源更新 | `customSourceAutoCheck` 启动时检查（24h）+`customSourceUpdateNoticeModel` | 📱 移动独有 |
| 沙盒下载目录 | `downloadService` 固定 RNFS.DocumentDirectoryPath/auralflow/downloads | 📱 移动独有（平台限制） |

### 列表渲染 / 图片 / 手势

| 功能 | 实现方式 | 说明 |
|---|---|---|
| 增量挂载列表 | 初始 60+100/批（非 FlatList） | 📱 移动独有 |
| CachedImage | `@d11/react-native-fast-image`+Glide | 📱 移动独有 |
| PanResponder 手势 | PanResponder 下拉关闭/捏合缩放 | 📱 移动独有 |

### 歌词交互

| 功能 | 实现方式 | 说明 |
|---|---|---|
| 简繁转换 | `opencc-js`（`LyricView` 简繁转换） | 📱 移动独有 |
| 触觉反馈 | `hapticLight` 触觉反馈 | 📱 移动独有 |
| 旋转封面 | Animated 25s 旋转+Marquee | 📱 移动独有 |
| 下拉关闭 | 沉浸歌词页下拉关闭 | 📱 移动独有 |
| 捏合缩放歌词 | `LyricView` 捏合缩放 | 📱 移动独有 |
| 歌词海报分享 | 沉浸控制条海报切换+分享 | 📱 移动独有 |
| PagerView 双页 | `ImmersiveLyricsScreen` PagerView 2 页+`useImmersiveController` 558 行 | 📱 移动独有 |
| KeepAwake | 沉浸歌词页 KeepAwake | 📱 移动独有 |

### 缓存 / Android 原生增强

| 功能 | 实现方式 | 说明 |
|---|---|---|
| 后台下载音频 | `playerService` 解析成功后后台下载音频到缓存（仅 wy/tx，`CACHEABLE_AUDIO_SOURCES`） | 📱 移动独有 |
| streamProbe | 1 字节 Range 5s 探测+`isPreviewDuration` | 📱 移动独有 |
| 三层缓存 | 内存 10min/磁盘 LRU 100MB/AsyncStorage URL 缓存 6h/30min/1yr | 📱 移动独有（机制，桌面等价 mediaCache） |
| 音质播放中实时切换 | `switchCurrentPlaybackQuality()` | ⬆️ 移动反超 |
| SecureStorage | `SecureStorageModule` Keystore AES-256-GCM | 📱 移动独有 |

---

## 三、桌面端独有功能（💻 桌面独有）

> 列：功能 | 实现方式 | 说明

### 浮窗 / 托盘 / 热键

| 功能 | 实现方式 | 说明 |
|---|---|---|
| 浮动歌词窗口 | Rust `lyric_window.rs` 753 行 透明置顶 webview+150ms 轮询穿透悬停+token/epoch 防竞态 | 💻 桌面独有 |
| 系统托盘 | Rust `tray.rs` | 💻 桌面独有 |
| 全局热键 | 空格/方向键/↑↓/M 全局快捷键 | 💻 桌面独有 |
| 窗口多路复用 | main/lyric/lyric-unlock 多路复用 | 💻 桌面独有 |

### 文件操作 / 下载

| 功能 | 实现方式 | 说明 |
|---|---|---|
| Rust 文件操作 | `local_audio.rs` walkdir+`downloads.rs` 流式+取消+180ms 节流 | 💻 桌面独有 |
| 可变下载目录 | `chooseDownloadDir()` Tauri 弹目录选择器+持久化 | 💻 桌面独有 |

### UI / 音频

| 功能 | 实现方式 | 说明 |
|---|---|---|
| cursor 光标特效 | canvas 光标特效 | 💻 桌面独有 |
| WebAudio EQ | WebAudio 5 段 BiquadFilter+ConvolverNode 混响+SoundTouch 变调 | 💻 桌面独有（移动用原生 AudioFx） |
| 无缝预加载 | `preloadAudio` `playerEngine.preload(url)` 隐藏 `<audio>` 预缓存下一首+`prefetchService` 预读 URL+歌词+封面 10min TTL | 💻 桌面独有 |
| 字体设置 | 字体设置 | 💻 桌面独有 |
| 桌面歌词样式独立分区 | 字号/字体/颜色/背景 | 💻 桌面独有（合理差异） |
| 运行态测试 UI | 自定义源运行态测试 | 💻 桌面独有 |
| 常驻侧栏 | `Sidebar.tsx` 常驻 | 💻 桌面独有 |
| 网格视图 | `MusicCard` 网格 | 💻 桌面独有 |
| 虚拟列表 | `VirtualList` | 💻 桌面独有 |
| URL 地址栏同步 | `setSearchParams({q})` | 💻 桌面独有 |

---

## 四、07-10 误判修正（以本表为准）

| 误判项 | 事实 |
|---|---|
| ~~移动端无竞态保护~~ | 实际有 `playRequestId`+`inflightPlayRequests` 去重（`playerStore.ts`） |
| ~~移动端无封面/音频缓存~~ | 实际有三层缓存：内存 10min/磁盘 LRU 100MB/AsyncStorage URL 缓存 6h/30min/1yr |

---

## 五、对齐总结

- **核心听歌路径（P0）全部对齐**：源解析（wy/tx/bili+local+custom）、播放引擎控制、4 播放模式、淡入淡出、倍速、音效、歌词系统、歌单、搜索、5 级下载+ID3、三层缓存、WebDAV 同步、账号登录（QR/Cookie）、日推、私人 FM、B 站收藏、历史、本地音乐、主题。
- **移动端 P0 无缺口**，且在搜索多 bili 源、音质播放中实时切换、队列 UI、B 站独立详情页、WebDAV 本地歌单同步、沉浸控制条丰富度、倍速保持音高上反超桌面。
- **平台独占能力不强制 1:1**：
  - 💻 桌面独有：浮动歌词窗口、系统托盘、全局热键、Rust 文件操作、可变下载目录、cursor 光标特效、WebAudio EQ、无缝预加载、字体设置、运行态测试 UI、常驻侧栏、网格视图、虚拟列表、URL 地址栏同步。
  - 📱 移动独有：通知栏控制、TrackPlayer 后台播放、锁屏控件、Deep Link、分享面板、MV 播放器、首页 feed、Android 浮动歌词、自动检查自定义源更新、沙盒下载目录、增量挂载列表、CachedImage、PanResponder 手势、简繁转换、触觉反馈、旋转封面、下拉关闭、捏合缩放、歌词海报、PagerView 双页、KeepAwake、SecureStorage、后台下载音频、streamProbe、静音间隙前台服务。
- **结论**：核心功能全对齐，差异均为平台原生特性驱动的独占能力，非功能残缺，不纳入功能补齐范围。
