# AuralFlow 桌面端 vs 移动端 — 功能差异全景

> **目的**：以 2026-07-11 双端源码取证后的当前状态为唯一真相源，逐功能模块给出桌面端与移动端的能力归类（🟢 共享 / 💻 桌面独有 / 📱 移动独有 / ⬆️ 移动反超）、实现方式与差异说明，作为架构对齐与差异取舍的权威依据。覆盖搜索 / 歌单 / 日推 / 私人 FM / 播放 / 歌词 / 本地音乐 / 缓存 / 下载 / 历史 / WebDAV / 账号 / 主题 / B 站 / MV / 首页 feed / 通知栏 / 浮窗歌词 / 托盘 / 热键 / 全屏 / 分享 / Deep Link 等全部功能模块。
>
> **方法**：双端源码逐文件取证，已剔除 07-10 `playback-engine-diff.md` 中的误判（移动端实际具备 `playRequestId`+`inflightPlayRequests` 竞态保护与三层缓存），差异归类只标功能状态、不纠缠底层实现差异（实现差异见 `desktop-mobile-code-diff-2026-07-11.md`）。
>
> **基线代码**：桌面端 `desktop/`，移动端 `apps/mobile/`，共享核心 `@lx/core`。

---

## 图例

| 标记 | 含义 |
|---|---|
| 🟢 共享 | 两端共用同一实现或对齐能力，仅形态 / 平台差异 |
| 💻 桌面独有 | 仅桌面端具备，受平台特性支撑 |
| 📱 移动独有 | 仅移动端具备，受移动场景驱动 |
| ⬆️ 移动反超 | 移动端在该功能上强于桌面端 |

---

## 1. 搜索聚合

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 多源搜索 | `searchMergedSources()` 按 type 并发 wy+tx，5 分类 tab（综合/单曲/歌手/专辑/歌单），固定第 1 页 | `searchAll("all",query)` 恒传 all，wy+tx 每源 30 条无分页，再分别搜歌手/专辑/歌单 | 🟢 共享（均 wy+tx，分页/入口形态不同） |
| 跨源去重合并 | `groupSongResults()` 同名+同歌手+时长差≤6s 合并（sourceRank wy>tx），保留多源 variant | 双去重并存：服务层 `mergeDuplicateSongs`（5s）+UI 层 `songGroupModel.groupSongResults`（6s） | 🟢 共享（移动两套并存） |
| 搜索结果缓存 | `searchResultCache` LRU 12 条，无 TTL | `searchResultCache` LRU 24 条+TTL 5min，「来自缓存」徽标仅全量缓存命中才显示 | 🟢 共享（移动多 TTL+徽标） |
| 联想词 | `fetchWySearchSuggestions` 网易云接口 | `getSearchSuggestions` 自实现 | 🟢 共享 |
| 搜索历史 | `searchHistory.ts` get/add/remove/clear | UI 列表+清空 | 🟢 共享 |
| 竞态保护 | `searchRequestSeqRef` 自增序列号 | `searchRequestSeqRef` 自增序列号+`requestId` 早退 | 🟢 共享（07-10 误判已修正） |
| URL/地址栏同步 | `setSearchParams({q})` 写地址栏 | 无地址栏，用 deepLink 初始关键词代替 | 💻 桌面独有（平台差异） |
| 综合视图布局 | 突出最佳歌手/专辑/歌单+歌曲列表 | summaryGrid 数字卡片+分区预览 | 🟢 共享（布局差异合理） |
| bili 视频源 | 无（仅 wy+tx） | 无搜索入口（`searchBiliVideos` 类型存在但 UI 恒传 all） | 🟢 共享（双端均无 bili 搜索） |

---

## 2. 歌单

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 歌单详情 | `/playlist/:id` 路由，支持 `state.playlist` 预填 | `PlaylistDetailScreen` 经 `openPlaylistRoute()` 子路由 | 🟢 共享 |
| 歌单 CRUD | `usePlaylistStore`（desktop） | `usePlaylistStore`（mobile） | 🟢 共享 |
| 操作集 | 播放全部/随机/定位当前/刷新/收藏 | 播放全部/随机/定位当前/刷新/收藏 | 🟢 共享 |
| 歌单收藏导入 | wy→收藏到账号，tx→导入本地歌单 | 同逻辑 `handleImportPlaylist` | 🟢 共享 |
| 本地歌单同步 | 不同步本地歌单 | WebDAV 额外同步 `localPlaylists` | ⬆️ 移动反超 |
| 导入/导出 | `exportPlaylists`/`importPlaylists` | `shareExportedPlaylists`/`importPlaylistsFromJsonInput` | 🟢 共享 |

---

## 3. 每日推荐 / 私人 FM

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 每日推荐 | `discoveryStore`→独立 `/daily` 路由 | `dailyRecommendMetaModel.buildDailyRecommendMeta` | 🟢 共享 |
| 私人 FM | `PersonalFmView`：开始 FM 过渡页+预览列表+不喜欢（`createPersonalFmQueueController`） | `PersonalFmScreen`：进入即 `startPersonalFm`+跳沉浸页（`personalFmMetaModel`） | 🟢 共享（形态差异） |
| FM 红心 | 心形=本地收藏（不调网易云红心） | 同左 | 🟢 共享 |
| 入口形态 | 侧边栏独立项 | 首页发现卡片→内联子页面 | 🟢 共享（形态差异合理） |

---

## 4. 播放

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 播放引擎 | `playerEngine.ts` 388 行 HTMLAudio+rAF+500ms 后备+余弦淡入淡出 90/140ms | RNTP(ExoPlayer)+`playerStore.ts` 1004 行+静音间隙技巧 | 🟢 共享（底层不同，控制对齐） |
| 播放模式 | `list-loop`/`single-loop`/`shuffle`/`sequence`（`playModeControl.ts`） | `list`/`single`/`shuffle`/`sequence`（`mobilePlayModeModel.ts`） | 🟢 共享 |
| 淡入淡出 | `fadeOut()` 90ms+`fadeIn()` 140ms 余弦曲线 rAF 逐帧 | `fadeVolume(target,durationMs)` 后台跳过步进 | 🟢 共享（07-10 误判已修正） |
| 倍速 | `setPlaybackRate` 0.25-3.0 | `setPlaybackRate`+`androidPitchService.setRate(rate,pitchRatio)` 双参保持音高 | 🟢 共享（移动保持音高） |
| 音效/EQ | WebAudio 5 段 BiquadFilter+ConvolverNode 混响+SoundTouch 变调 | 原生 AudioFx 5 段+PresetReverb+ExoPlayer pitch（仅 Android） | 🟢 共享（桌面变调更完整；iOS 不支持独立变调） |
| 播放竞态保护 | `activePlayRequestId` 自增序列号 | `playRequestId`+`inflightPlayRequests` 去重 | 🟢 共享（07-10 误判已修正） |
| 音质切换 | 仅偏好无播放中 UI | `switchCurrentPlaybackQuality()` 播放中实时切 | ⬆️ 移动反超 |
| 播放快照 | `playbackSnapshot` 持久化 | `playbackSnapshot`+shuffleHistory 持久化 | 🟢 共享（移动可离线恢复 shuffle） |
| 外部播放暂停 | `pauseOnExternalPlayback` 设置 | `pauseOnExternalPlayback`+RemoteDuck 音频焦点 permanent 暂停/else duck | 🟢 共享 |
| 睡眠定时 | `sleepTimerStore` 分钟+首数 | `playerStore.startSleepTimer`/`startSongSleepTimer` 分钟+首数 | 🟢 共享 |
| 队列管理 UI | PlayerBar 无队列 UI | 队列弹窗 | ⬆️ 移动反超 |
| 预加载 | `prefetchService` [-1,+1,+2] 随机 [1,+2,-1] 预读 URL+歌词+封面 10min TTL | `prefetchCache` 仅预读下一首 URL | 💻 桌面独有（预读更深） |
| 无缝预加载 | `preload(url)` 隐藏 `<audio>` 预缓存下一首 | 无 | 💻 桌面独有 |

---

## 5. 歌词

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 解析器 | `@lx/core` parser 6 格式归一化 lrc/enhanced-lrc/yrc/qrc/krc/vtt→LyricLine | 同 `@lx/core` | 🟢 共享（共享核心） |
| 译文合并 | `mergeTranslation()`+`mergeMissingLines()` ±150ms | `@lx/core` 翻译合并 ±150ms | 🟢 共享 |
| 行进度估算 | `@lx/core` playbackSync PlaybackProgressClock 二分查找 0.12s 提前 CJK/拉丁加权 | `@lx/core calculateLyricLineProgress` 同算法 | 🟢 共享（共享核心） |
| 逐字卡拉OK | 沉浸层 clip-path 逐字填充（background-clip:text+CSS 变量数据驱动）+桌面歌词窗 KaraokeLine 逐字渐变（LyricWord start/dur 驱动） | 无（`LyricView` 明确只做行级高亮：纯色+切换缩放动画） | 💻 桌面独有 |
| 多源歌词匹配 | `matchScore.ts` 多源择优 | lyricsService 搜索匹配+`scoreLyricContentQuality` | 🟢 共享 |
| 歌词服务链 | 嵌入式→provider→搜索匹配+0.12s 迟滞 | 同链路 | 🟢 共享 |
| 用户滚动暂停 | `useLyricAutoScroll` 用户滚动暂停 3s 恢复 | `LyricView` 587 行 onScrollBeginDrag+3s 暂停 | 🟢 共享 |
| 歌词偏移校准 | `SettingsView` manualOffsetMs 滑块 | `LyricSettingsScreen` 歌词偏移校准滑块 | 🟢 共享 |
| 沉浸歌词形态 | `ImmersiveLyricsOverlay` 全屏 overlay（点封面打开） | `ImmersiveLyricsScreen` 独立全屏页（点封面打开） | 🟢 共享（形态不同） |
| 沉浸控制条 | 播放/暂停/上下首+睡眠+倍速+音效 | 播放/暂停/上下首+睡眠+倍速+音量+音效+音质+海报切换 | ⬆️ 移动反超 |
| 歌词海报 | 无 | 有海报切换 | ⬆️ 移动反超 |
| 旋转封面动画 | 无 | Animated 25s 旋转+Marquee | 📱 移动独有 |
| 下拉关闭 | 无 | 沉浸歌词页下拉关闭 | 📱 移动独有 |
| 捏合缩放歌词 | 无 | `LyricView` 捏合缩放 | 📱 移动独有 |
| 简繁转换 | 无 | `LyricView` 简繁转换 | 📱 移动独有 |
| 视觉化 | `PlayerVisualizerRenderer` 音频可视化 | `PosterWaveVisualizer` 海报波形 | 🟢 共享（形态不同） |

---

## 6. 本地音乐

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 扫描 | Rust `local_audio.rs` walkdir+audiotags/lofty | `LocalMusicModule` 778 行 MediaStore+jaudiotagger | 🟢 共享（平台原生） |
| 网格视图 | 网格卡片视图 | 列表 | 💻 桌面独有 |
| 权限重试 | 无 | RecoverableSecurityException 重试 | 📱 移动独有（Android 沙盒特性） |
| 元数据编辑 | Rust audiotags/lofty 写文件标签（wav/aac/ogg/opus/wma/ape/aiff 拒写） | MediaStore 写回（RecoverableSecurityException→系统授权）+手写 ID3v2.4；下载入库歌（dl- 前缀）无 MediaStore id 跳过写回 | 🟢 共享（平台原生） |
| 添加文件 | Tauri 文件选择 | 系统文档选择器多选 | 📱 移动独有 |

---

## 7. 缓存

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| URL 缓存 | `persistentCache.ts` playbackUrl（其他 6h/bili 30min/local 1y MAX500 条） | AsyncStorage URL 缓存 6h/30min/1yr | 🟢 共享 |
| 歌词缓存 | 内存+持久化 | `cacheLyrics` 磁盘层，30 天过期 | 🟢 共享 |
| 音频文件缓存 | Rust 三层目录：song-audio 2GiB 常量 LRU 按 mtime（经 Rust 桥落盘+`convertFileSrc`） | 磁盘 LRU 100MB（索引 AsyncStorage+对账）+内存 10min | 🟢 共享（07-10 误判已修正） |
| 封面文件缓存 | `mediaCache.ts` `cacheRemoteImage` 落盘（song-covers/bili-audio 不限量） | `cacheCover` `CachedImage`(@d11/react-native-fast-image+Glide) | 🟢 共享（07-10 误判已修正） |
| 缓存统计 | `getSongCacheStats` audioCacheSize/coverCacheSize | 分类统计 | 🟢 共享 |
| 缓存清理 | 分类清理+全部清理 | 分类清理+全部清理 | 🟢 共享 |
| 后台下载音频 | 无 | `playerService` 解析成功后后台下载音频到缓存（仅 wy/tx） | 📱 移动独有 |
| streamProbe | 无 | 1 字节 Range 5s 探测+isPreviewDuration | 📱 移动独有 |

---

## 8. 下载

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 5 级音质 | `@lx/core` playback-quality 128k/192k/320k/flac/flac24bit | 同 `@lx/core` | 🟢 共享（共享核心） |
| 下载实现 | Rust `downloads.rs` `download_file`：并发 2、单文件 2GiB 上限、180ms 进度事件、取消即时中断；无断点续传（重启将在途任务标 failed） | RNFS 串行队列：暂停=删半成品整曲重下、无真断点续传 | 🟢 共享（平台原生，均无断点续传） |
| 目录选择 | `chooseDownloadDir()` 可改+持久化 | 沙盒固定不可改 | 💻 桌面独有（可改目录） |
| ID3 嵌入 | `enhanceDownloadedFile`：audiotags 写标签+lofty 写歌词+内嵌封面 | `id3TagWriter.ts` 手写 ID3v2.4+APIC 封面+USLT 歌词（仅 MP3≤25MB 才嵌入） | 🟢 共享（2026-07-11 补齐） |
| 旁注 .lrc | .lrc 旁注 | sidecar .lrc | 🟢 共享 |
| 下载页 | 独立 `/downloads` 页 | 曲库 downloads section+独立 DownloadScreen | 🟢 共享（形态差异） |

---

## 9. 历史

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 播放历史 | `useHistoryStore` | `historyStore` 234 行 2000 上限 31 天 | 🟢 共享 |
| 历史管理 | 独立 HistoryView 播放全部/随机/清空/删除 | 曲库 history section 播放全部/随机/清空/删除 | 🟢 共享 |
| WebDAV 历史合并 | `@lx/core` webdav-merge 收藏/历史按 source:id 并集 | 同 `@lx/core` | 🟢 共享（删除永不传播） |

---

## 10. WebDAV 同步

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 同步实现 | `webdavSyncService.ts` 629 行 同步锁+lastModified 冲突 | `webdavSyncService` 原生 fetch+lastModified 冲突 | 🟢 共享 |
| 合并语义 | `@lx/core` webdav-merge 纯函数加法合并 | `@lx/core` webdav-merge+自动 download-merge-then-upload-converge | 🟢 共享（共享核心） |
| 写读路径 | /AuralFlow/ 写 / LX_Music/ 读回退 | LX 格式+自动 converge | 🟢 共享 |
| 下载合并/上传覆盖 | 下载合并/上传覆盖 | 下载合并/上传覆盖 | 🟢 共享 |
| 自动同步 | 仅手动 | 启动自动同步（先合并下载再上传，可开关） | ⬆️ 移动反超 |
| 本地歌单同步 | 不同步本地歌单 | 额外同步 `localPlaylists` | ⬆️ 移动反超 |
| 配置 UI | 设置→同步 URL/用户名/密码 | 设置→同步与音源 URL/用户名/密码 | 🟢 共享 |

---

## 11. 账号登录

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 网易云登录 | 扫码+Cookie 粘贴双通道：`qrCode.ts` 自研二维码生成+`wyAccountService.ts` weapi/eapi QR 轮询（800 过期/801 待扫/802 已扫/803 成功）+`WyCookieLoginModal` Cookie 粘贴 | 仅 Cookie 粘贴（`NeteaseAccountCard` 剪贴板一键读取+掩码显示+MUSIC_U 检测；无扫码） | 🟢 共享（登录方式不同：桌面扫码+贴 Cookie/移动仅贴 Cookie） |
| 网易云 Cookie | Cookie | NetEase cookie | 🟢 共享 |
| B 站登录 | `biliAccountService` Cookie+`biliCookieRefreshService` refresh_token 自动续期（4 步 RSA-OAEP correspondPath） | `biliService` Cookie 粘贴（无自动续期） | 🟢 共享（桌面多续期） |
| B 站收藏合集 | `getBiliCollectionSongs` 三路回退：收藏夹→合集→系列 | 同 `getBiliCollectionSongs` 三路回退 | 🟢 共享 |
| B 站独立详情页 | 仅合集收藏 | `BiliCollectionDetailScreen` 独立详情页 | ⬆️ 移动反超 |
| QQ 登录 | Cookie（tx-meta strMediaMid/albumMid/songId） | QQ cookieless | 🟢 共享（移动无 Cookie） |
| 我的歌单 | `wyAccountStore` setSubscribed | `playlistStore.setWyPlaylistSubscribed` | 🟢 共享 |
| 收藏 | `favoritesStore` 喜欢列表 | `favoritesStore`/`playlistStore.likedSongs` | 🟢 共享 |
| 歌单 CRUD | `wyAccountService` 歌单 CRUD | `playlistStore` 歌单 CRUD | 🟢 共享 |

---

## 12. 主题

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 主题/强调色 | `useThemeStore`（desktop） | `useThemeStore`（mobile） | 🟢 共享（不同实现，能力对齐） |
| 背景图 | 有 | 有 | 🟢 共享 |
| 字体 | `immersiveLyricFontFamily`（仅沉浸歌词字体，无全局字体设置） | 无 | 💻 桌面独有 |
| 光标特效 | cursor 特效 | N/A | 💻 桌面独有 |
| 氛围色 | 无 | 根据封面生成背景氛围色 | 📱 移动独有 |

---

## 13. B 站

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| B 站视频搜索 | 无 | 无入口（类型存在但 UI 恒传 all） | 🟢 共享（均无 bili 搜索） |
| 取流播放 | 取链后 `biliCacheAudio` 落盘经 asset 协议播放（音频缓存 bili-audio 目录） | URL+Referer 直放不缓存 | 💻 桌面独有（音频落盘缓存） |
| WBI 签名 | 算法逐字节同源 | 同左（两份独立复制维护） | 🟢 共享（双份复制） |
| 合集收藏同步 | `biliAccountStore` BILI_COLLECTION_VISIBILITY | `biliAccountStore`+`biliCollectionVisibilityModel` | 🟢 共享 |
| 独立详情页 | 无独立详情页 | `BiliCollectionDetailScreen` | ⬆️ 移动反超 |

---

## 14. MV

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| MV 播放 | 无 | `wyMvService` 1080/720/480 降级+react-native-video | 📱 移动独有 |

---

## 15. 首页 Feed

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 首页形态 | `HomeView`=hero+最近播放（推荐/榜单/FM 是独立页面） | `HomeScreen`=快捷入口+推荐歌单+首页迷你排行榜+日推（登录） | 🟢 共享（形态差异大） |
| 首页 feed | 无 | `homeFeedStore` 463 行 600s(10min) TTL 按账号隔离 | 📱 移动独有 |

---

## 16. 通知栏 / 后台播放

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 通知栏歌词 | 无 | 通知栏歌词 `apply-track-player-patch.js` 补丁 MusicService.kt | 📱 移动独有 |
| TrackPlayer 后台 | 无 | `playbackService.ts` RNTP 后台 `PlaybackActiveTrackChanged`→`advanceAfterTrackFinished` | 📱 移动独有 |
| 锁屏控制 | 无 | 锁屏控制 | 📱 移动独有 |
| 前台服务 | 无 | 静音间隙技巧 [真实歌曲,SILENCE_GAP_TRACK 2s] 保持前台服务 | 📱 移动独有 |

---

## 17. 浮窗歌词

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 浮动歌词窗口 | Rust `lyric_window.rs` 753 行 独立透明置顶 webview：锁定=鼠标穿透+150ms 光标轮询+hover 解锁小窗、置顶 1.5s 巡检、几何持久化、暂停隐藏/悬停隐藏+token/epoch 防竞态 | 无 | 💻 桌面独有 |
| 歌词窗口锁定/解锁 | `LyricUnlockView` 窗口可锁定 | 无 | 💻 桌面独有 |
| Android 浮窗歌词 | 无 | `LyricOverlayService` 407 行 WindowManager 浮窗 TYPE_APPLICATION_OVERLAY+拖动+锁定 FLAG_NOT_TOUCHABLE；只显示当前行+下一行整行文本（无逐字） | 📱 移动独有（Android 原生） |
| 浮窗设置 | 无 | 字号 4 档(16/18/22/26)/不透明度 3 档/下一行开关/投影/锁定/通知栏歌词按钮（SharedPreferences 持久化） | 📱 移动独有 |

---

## 18. 托盘 / 热键

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 系统托盘 | Rust `tray.rs` | N/A | 💻 桌面独有 |
| 窗口内快捷键 | keydown：Space/←→ seek 5s/Shift+←→ 切曲/↑↓ 音量/M 静音；沉浸页 Esc/方向键 | 无 | 💻 桌面独有 |

---

## 19. 全屏

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 全屏沉浸歌词 | `ImmersiveLyricsOverlay` 全屏 overlay | `ImmersiveLyricsScreen` Modal fullScreenModal | 🟢 共享（形态不同，功能对齐） |
| KeepAwake | 无 | 沉浸歌词页 KeepAwake | 📱 移动独有 |
| PagerView 双页 | 无 | PagerView 2 页+`useImmersiveController` 558 行 | 📱 移动独有 |

---

## 20. 分享 / Deep Link

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 系统分享 Sheet | 无 | 系统分享 Sheet | 📱 移动独有 |
| 歌词海报分享 | 有 | 有 | 🟢 共享 |
| Deep Link | 无 | `auralflow://`：search/homeMode/详情，重试 4s 上限（`parseMobileDeepLink`→`initialKeyword`） | 📱 移动独有 |
| 自定义源自动检查 | 手动检查 | `customSourceAutoCheck` 启动时检查 | 📱 移动独有 |

---

## 21. 设置系统

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 持久化 | Tauri `loadSettings`/`patchSettings`（Rust library JSON） | AsyncStorage+SecureStorage | 🟢 共享（层不同） |
| 外观 | 主题/强调色/背景图/光标特效（无全局字体设置） | 主题/强调色/背景图/氛围色 | 🟢 共享（桌面多光标特效） |
| 播放 | 音质/外部播放暂停 | 音质/外部播放暂停 | 🟢 共享 |
| 音源 | 自定义音源脚本管理 | 自定义音源 | 🟢 共享 |
| 桌面歌词样式 | `DesktopLyricSettingsSection` 独立分区（20+ 字段：字号滑杆 16-52/字重/颜色/背景等，无字体选择） | 无（用 Android 悬浮窗设置代替：字号 4 档/不透明度/下一行/投影/锁定） | 💻 桌面独有（合理差异；双端歌词窗均无字体选择） |
| 歌词样式 | 沉浸歌词字体（`immersiveLyricFontFamily`） | 独立 `LyricSettingsScreen`+字号捏合缩放 | 🟢 共享 |
| 数据 | 缓存统计/清缓存/清历史 | CacheSettings 组件 | 🟢 共享 |
| 同步 | WebDAV 配置 | WebDAV 配置 | 🟢 共享 |
| 更新 | 仅检查+提示打开 GitHub Release 页 | 应用内 APK 下载+安装（REQUEST_INSTALL_PACKAGES） | ⬆️ 移动反超 |
| WebAudio EQ | WebAudio EQ | 无（用原生 AudioFx） | 💻 桌面独有 |
| 运行态测试 UI | 自定义源运行态测试 | 无 | 💻 桌面独有 |
| 沙盒下载 | 无 | 沙盒固定目录 | 📱 移动独有 |
| SecureStorage | 无 | Keystore AES-256-GCM | 📱 移动独有 |

---

## 22. 自定义音源

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 沙箱运行时 | `customSourceRuntime.ts` 776 行 new Function 沙箱 fakeWindow Object.create(null)+静态正则拒 constructor+HTTP 代理 Rust+LRU(8)+深度测试；跑在主 WebView 同进程，未真正隔离（可逃逸读明文凭据） | 隐藏 WebView 沙箱（参数遮蔽+静态扫描）lx_bridge（Hermes 不能 new Function）+vendor.js 2510 行 CryptoJS+pako+RSA-RAW BigInt modPow | 🟢 共享（机制不同，见代码差异文档） |
| 能力白名单 | 含 search/playlist 等完整能力 | 仅 musicUrl（+local 歌词/封面） | 🟢 共享（白名单范围不同） |
| 音源导入 | 粘贴脚本/导入文件 | 粘贴脚本/原生文件选择 | 🟢 共享 |
| 管理 | 启用/禁用/删除/更新检查 | 启用/禁用/删除 | 🟢 共享 |
| 自动检查 | 手动检查 | `customSourceAutoCheck` 启动时检查 | 📱 移动独有 |
| 深度测试 | 运行态测试 UI | 无 | 💻 桌面独有 |
| HTTP 代理 | Rust outbound.rs SSRF 守卫代理 | global fetch+pako | 🟢 共享（共享 outbound-host.ts 契约） |
| 后端并发 | `customSourceBackend` 多源并发尝试 | 逐个尝试 | 🟢 共享（语义对齐） |

---

## 23. HTTP 层 / SSRF 守卫

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| SSRF 守卫 | `outbound-host.ts`+Rust outbound.rs 双实现 每跳验证 ≤10 | `outbound-host.ts`（JS 侧契约一致） | 🟢 共享（共享核心，显式不做 DNS） |
| 网关 | Tauri plugin-http+Rust proxy | global fetch+pako | 🟢 共享（`@lx/core` mobile-api gdstudio 网关依赖注入 fetchText 搜索竞速空数组不算成功） |

---

## 24. 导航

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 路由 | BrowserRouter v6 12 路由 | React Navigation v7 Drawer>NativeStack>BottomTabs+MaterialTopTabs | 🟢 共享（层不同，见代码差异文档） |
| 常驻侧栏 | Sidebar 常驻 | 移动 Drawer 默认关闭 front overlay | 💻 桌面独有（平台差异） |
| 曲库内嵌 | 独立页面 | Library 内嵌 Local/History/Downloads/Bili 条件登录 | 📱 移动独有 |

---

## 25. 状态管理

| 功能模块 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| Store 框架 | Zustand ~16 store（playerStore 899 行） | Zustand 15 store（playerStore 1004 行/playlistStore 656 行/downloadStore 411 行/customSourceStore 372 行 24h/historyStore 234 行 2000/31 天/biliAccountStore 299 行/homeFeedStore 463 行 600s TTL） | 🟢 共享（框架对齐，store 数量/分布不同） |
| tauri-bridge | 零逻辑全类型桥 | 无 | 💻 桌面独有 |
| 窗口多路复用 | main/lyric/lyric-unlock 多路复用 | 无 | 💻 桌面独有 |

---

## 汇总：状态归类

### 🟢 已对齐（核心功能，两端可完成同样任务）
搜索聚合/去重/竞态保护、歌单 CRUD、每日推荐、私人 FM、4 播放模式、淡入淡出、倍速、音效、5 级下载、ID3 嵌入、歌词解析/译文/行进度/多源匹配/偏移校准、URL+歌词+音频+封面缓存、历史管理、WebDAV 同步/合并、网易云/B 站登录与收藏、主题/强调色/背景图、沉浸歌词、自定义音源运行时、SSRF 守卫。

### ⬆️ 移动端反超桌面端
音质播放中实时切换、队列管理 UI、B 站独立详情页、WebDAV 本地歌单同步+启动自动同步、应用内 APK 更新安装、沉浸控制条更丰富（音量/音质/海报）、歌词海报/旋转封面/下拉关闭/捏合缩放/简繁转换。

### 📱 移动独有（移动场景驱动，不纳入桌面补齐）
通知栏歌词、TrackPlayer 后台、锁屏控制、Deep Link、系统分享、MV、首页 feed、Android 浮窗歌词、自动检查自定义源、沙盒下载、SecureStorage、KeepAwake、PagerView 双页、静音间隙前台服务。

### 💻 桌面独有（平台特性驱动，不纳入移动补齐）
浮动歌词窗口/锁定解锁、系统托盘、窗口内快捷键、Rust 文件操作、可变下载目录、光标特效、WebAudio EQ、无缝预加载（预读 URL+歌词+封面）、逐字卡拉OK 渲染、B 站音频落盘缓存、沉浸歌词字体、运行态测试 UI、常驻侧栏、窗口多路复用。

### 已修正的 07-10 误判（以本表为准）
- ~~移动端无竞态保护~~ → 实际有 `playRequestId`+`inflightPlayRequests` 去重。
- ~~移动端无封面/音频缓存~~ → 实际有三层缓存（内存 10min/磁盘 LRU 100MB/AsyncStorage）。
