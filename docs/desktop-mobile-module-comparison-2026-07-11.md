# AuralFlow 桌面端 vs 移动端 — 模块级对比（2026-07-11 验证状态）

> **目的**：按模块逐个对比桌面端与移动端的实现文件、共享核心依赖与差异性质，作为验证过的当前状态权威参考。
>
> **方法**：双端源码逐文件取证（file:line 证据优先），已剔除 07-10 误判，差异性质分为「✅ 对齐 / 🟢 平台原生 / 💻 桌面独有 / 📱 移动独有 / ⬆️ 移动更全」。
>
> **基线代码**：桌面端 `desktop/`，移动端 `apps/mobile/`，共享核心 `@lx/core`。

---

## 0. 摘要：差异性质归类

| 模块 | 差异性质 | 说明 |
|---|---|---|
| 源解析 wy/tx/bili/local/custom | ✅ 对齐 | 两端均覆盖 wy/tx/bili+local+custom，走 `@lx/core` resolver 0.85 阈值 |
| 播放引擎 | 🟢 对齐（平台原生） | HTMLAudio+rAF vs RNTP/ExoPlayer，控制层对齐；竞态保护/淡入淡出/三层缓存均已具备 |
| 状态管理 | 🟢 对齐（平台原生） | 均用 Zustand，store 数量/分布因平台调整 |
| 歌词系统 | ✅ 对齐 | 共享 `@lx/core` parser+playbackSync，两端均有偏移校准/滚动暂停 |
| 缓存策略 | ✅ 对齐 | 两端均有三层缓存；移动多后台下载/streamProbe |
| 下载 | 🟢 对齐（平台原生） | 5 级音质+ID3 对齐；目录可改性为桌面平台差异 |
| WebDAV 同步 | ✅ 对齐 | 共享 `@lx/core` webdav-merge；移动额外同步本地歌单 |
| 账号登录 | ✅ 对齐 | QR/Cookie 登录、日推、私人 FM、B 站收藏两端均有 |
| 搜索聚合 | ✅ 对齐 | 去重+竞态保护已对齐；移动多 bili 源 |
| UI 路由 | 🟢 对齐（平台原生） | react-router v6 vs React Navigation v7 |
| 设置系统 | ✅ 对齐 | 外观/播放/音源/数据/同步/更新对齐；桌面多歌词样式分区/字体/光标特效 |

---

## 1. 源解析（wy / tx / bili / local / custom）

| 维度 | 桌面实现文件 | 移动实现文件 | 共享核心依赖 | 差异性质 |
|---|---|---|---|---|
| 源注册 | `sourceService.ts` 注册 wyProvider/txProvider/biliProvider（`:23-25`） | `musicApi.ts`+`txPlaylistService.ts` 支持 wy/tx/bili | `@lx/core` sources/registry Map+SourceTag=wy\|tx\|bili\|local | ✅ 对齐 |
| 跨源模糊匹配 | resolver 源轮转解析 | resolver 源轮转解析 | `@lx/core` resolver 0.85 阈值跨源模糊匹配 | ✅ 对齐 |
| tx 元数据 | txProvider | txPlaylistService | `@lx/core` tx-meta QQ strMediaMid/albumMid/songId | ✅ 对齐 |
| 自定义源契约 | `customSourceRuntime.ts` 776 行 | `customSourceRuntime.ts`（注释「与桌面端对齐」`:10`） | `@lx/core` CustomSourceContext 契约 | ✅ 对齐 |
| local 源 | Rust `local_audio.rs` walkdir+audiotags/lofty | `LocalMusicModule` 778 行 MediaStore+jaudiotagger | `@lx/core` MusicSource/MusicInfo 域模型 | 🟢 平台原生 |
| kg 源 | 无 | customSourceRuntime 额外支持 kg（`:89`） | — | 📱 移动多（自定义源运行时） |

---

## 2. 播放引擎

| 维度 | 桌面实现文件 | 移动实现文件 | 共享核心依赖 | 差异性质 |
|---|---|---|---|---|
| 引擎核心 | `playerEngine.ts` 388 行 HTMLAudio+rAF+500ms 后备 | `playerStore.ts` 1004 行+RNTP(ExoPlayer) | `@lx/core` playback-quality 质量排序唯一真相源 128k\|192k\|320k\|flac\|flac24bit | 🟢 平台原生 |
| 淡入淡出 | `playerEngine.ts` `fadeAudioVolume()` rAF FADE_IN_MS/FADE_OUT_MS 余弦 90/140ms（`:260-311`） | `playerStore.ts` `fadeVolume(target,durationMs)` 后台跳过步进（`:34`） | — | ✅ 对齐（07-10 误判已修正） |
| 倍速 | `playerEngine.ts` `setPlaybackRate`（`:311`） | `androidPitchService.ts` `setRate(rate,pitchRatio)` 双参保持音高（`:26`） | — | 🟢 平台原生 |
| 竞态保护 | `activePlayRequestId` 自增序列号 | `playRequestId`+`inflightPlayRequests` 去重 | — | ✅ 对齐（07-10 误判已修正） |
| 预加载 | `prefetchService` [-1,+1,+2] 随机 [+1,+2,-1] 预读 URL+歌词+封面 10min TTL | `prefetchCache` 仅预读下一首 URL | — | 💻 桌面独有 |
| 无缝预加载 | `playerEngine.ts` `preload(url)` 隐藏 `<audio>` | 无 | — | 💻 桌面独有 |
| 预览检测 | `playerEngine.ts` 预览检测 | `playerService.ts` `isPreviewDuration` | `@lx/core` stream-integrity `isPreviewStream` 解析时/`isPreviewDuration` 播放时 min(60s,expected×0.5) | ✅ 对齐 |
| 外部中断 | `mediaInterruptionPolicy` | RemoteDuck 音频焦点 permanent 暂停/else duck | — | 🟢 平台原生 |
| 音效 | `soundEffectStore.ts` WebAudio 5 段 EQ+ConvolverNode 混响+SoundTouch 变调（`:53,118`） | `soundEffectStore`+`soundEffectService` 原生 AudioFx/Equalizer/PresetReverb（`:6,30`） | — | 🟢 平台原生 |
| raceForBestQuality | `playbackResolver.ts` | `playerService.ts` | `@lx/core` playback-quality raceForBestQuality 800ms 升级窗口 | ✅ 对齐 |
| 播放模式 | `playModeControl.ts` 4 模式 list-loop/single-loop/shuffle/sequence（`:29-32`） | `mobilePlayModeModel.ts` 4 模式 list/single/shuffle/sequence（`:28`） | — | ✅ 对齐 |
| 队列 | `playerStore.ts` addToQueue/playNext/removeFromQueue/clearQueue（`:328,332`） | `playerStore.ts` addToQueue/playNextInQueue/removeFromQueue/clearQueue（`:586,593`） | — | ✅ 对齐 |
| 快照 | `playbackSnapshot` 持久化 | `playbackSnapshot`+shuffleHistory 持久化（`:17`） | — | ✅ 对齐（移动可离线恢复 shuffle） |
| 前台服务 | 无（桌面系统级） | `playbackService.ts` RNTP 后台+MusicService 前台服务+静音间隙 [真实歌曲,SILENCE_GAP_TRACK 2s] | — | 📱 移动独有 |

---

## 3. 状态管理

| 维度 | 桌面实现文件 | 移动实现文件 | 共享核心依赖 | 差异性质 |
|---|---|---|---|---|
| Store 框架 | Zustand ~16 store（playerStore 899 行） | Zustand 15 store（playerStore 1004 行/playlistStore 656 行/downloadStore 411 行/customSourceStore 372 行 24h/historyStore 234 行 2000 上限 31 天/biliAccountStore 299 行/homeFeedStore 463 行 600s TTL） | — | 🟢 平台原生（数量/分布不同） |
| tauri-bridge | tauri-bridge 零逻辑全类型 | 无 | — | 💻 桌面独有 |
| 窗口多路复用 | main/lyric/lyric-unlock 多路复用 | 无 | — | 💻 桌面独有 |

---

## 4. 歌词系统

| 维度 | 桌面实现文件 | 移动实现文件 | 共享核心依赖 | 差异性质 |
|---|---|---|---|---|
| 解析器 | `@lx/core` parser | `@lx/core` parser | `@lx/core` lyrics/parser 6 格式归一化 lrc/enhanced-lrc/yrc/qrc/krc/vtt→LyricLine | ✅ 对齐 |
| 译文合并 | `desktopLyric.ts` mergeTranslation+mergeMissingLines（`:10,66`） | `lyricSettingsModel.translationStyle`（`:43`） | `@lx/core` 翻译合并 ±150ms | ✅ 对齐 |
| 行进度估算 | `@lx/core` playbackSync | `@lx/core calculateLyricLineProgress` | `@lx/core` playbackSync PlaybackProgressClock 二分查找 0.12s 提前 CJK/拉丁加权 | ✅ 对齐 |
| 多源匹配 | `matchScore.ts` 多源择优 | lyricsService 搜索匹配+`scoreLyricContentQuality`+0.12s 迟滞 | — | ✅ 对齐 |
| 自动滚动 | `useLyricAutoScroll.ts` 平滑 scrollTo+用户滚动暂停（`:54-150`） | `LyricView.tsx` 587 行 动态行高+累积偏移+相邻平滑 easeInOutQuad 600ms/跨行即时 scrollToIndex 0.42+3s 暂停（`:112,189`） | — | 🟢 平台原生 |
| 偏移校准 | `SettingsView` manualOffsetMs 滑块 | `LyricSettingsScreen` 歌词偏移校准滑块 | `@lx/core` parser 支持 LRC `[offset:]`（parserCore `:34`） | ✅ 对齐 |
| 用户滚动暂停 | `USER_SCROLL_RESUME_DELAY_MS=3000` | `LyricView` onScrollBeginDrag+3s 暂停+捏合缩放+点击行跳转+简繁转换 | — | ✅ 对齐（移动多捏合/简繁） |
| 逐字高亮 | LyricWord start/dur 驱动 | KaraokeLyricLine+行内进度填充 | `@lx/core` | ✅ 对齐 |
| 卡拉OK 渲染 | `ImmersiveLyricsOverlay` 纯 CSS/DOM background-clip:text+clip-path CSS 变量数据驱动 | `ImmersiveLyricsScreen` Modal fullScreenModal+PagerView 2 页+`useImmersiveController` 558 行 Animated clip-path | — | 🟢 平台原生 |
| 沉浸控制条 | 播放/暂停/上下首+睡眠+倍速+音效 | 播放/暂停/上下首+睡眠+倍速+音量+音效+音质+海报切换 | — | ⬆️ 移动更丰富 |
| 歌词海报 | 无 | 有 | — | 📱 移动独有 |
| 旋转封面 | 无 | Animated 25s 旋转+Marquee | — | 📱 移动独有 |

---

## 5. 缓存策略

| 维度 | 桌面实现文件 | 移动实现文件 | 共享核心依赖 | 差异性质 |
|---|---|---|---|---|
| URL 缓存 | `persistentCache.ts` playbackUrl TTL 其他 6h/bili 30min/local 1y MAX500（`:8-16`） | `playbackUrlCache.ts` 移植桌面 persistentCache（含 variants 双键、TTL、prune）+AsyncStorage URL 缓存 6h/30min/1yr | — | ✅ 对齐 |
| 歌词缓存 | 内存+持久化 | `cacheService.ts` `cacheLyrics`（`:153`） | — | ✅ 对齐 |
| 音频文件缓存 | `mediaCache.ts` 三层 2GiB LRU（`cacheRemoteAudio` 经 Rust 桥落盘+`convertFileSrc`） | `cacheService.ts` `cacheAudioFile`（`:222`）+`isLocalFilePlayable`（`:248`） 三层 内存 10min/磁盘 LRU 100MB | — | ✅ 对齐（07-10 误判已修正） |
| 封面文件缓存 | `mediaCache.ts` `cacheRemoteImage` 落盘 | `cacheService.ts` `cacheCover`（`:106`）+`CachedImage`(@d11/react-native-fast-image+Glide) | — | ✅ 对齐（07-10 误判已修正） |
| 缓存统计 | `getSongCacheStats` audioCacheSize/coverCacheSize | 分类统计 | — | ✅ 对齐 |
| 后台下载音频 | 无 | `playerService.ts`（`:170`） 解析成功后后台下载音频到缓存（仅 wy/tx，`CACHEABLE_AUDIO_SOURCES`） | — | 📱 移动独有 |
| streamProbe | 无 | 1 字节 Range 5s 探测+isPreviewDuration | `@lx/core` stream-integrity | 📱 移动独有 |

---

## 6. 下载

| 维度 | 桌面实现文件 | 移动实现文件 | 共享核心依赖 | 差异性质 |
|---|---|---|---|---|
| 下载实现 | Rust `downloads.rs` 流式+取消+180ms 节流 | `downloadStore` 411 行 串行+`downloadService.ts` | `@lx/core` playback-quality 5 级 128k\|192k\|320k\|flac\|flac24bit | 🟢 平台原生 |
| 目录选择 | `downloadStore.chooseDownloadDir()` Tauri 弹目录选择器+持久化（`:50-66,116`） | `downloadService.ts` 固定 RNFS.DocumentDirectoryPath/auralflow/downloads（`:18-23`） | — | 💻 桌面独有（可改目录） |
| ID3 嵌入 | `enhanceDownloadedFile` ID3+内嵌封面+内嵌歌词 | `id3TagWriter.ts` 纯 JS ID3v2.4 写入器+APIC 封面+USLT 歌词（2026-07-11 补齐） | — | ✅ 对齐 |
| 旁注 .lrc | .lrc 旁注 | sidecar .lrc | — | ✅ 对齐 |
| 下载页 | 独立 `/downloads` 页 | 曲库 downloads section+独立 DownloadScreen | — | 🟢 平台原生 |
| 播放已下载 | `toLocalMusic(task)`→`play()` | `play(song,localPath)` 直接本地路径 | — | ✅ 对齐 |

---

## 7. WebDAV 同步

| 维度 | 桌面实现文件 | 移动实现文件 | 共享核心依赖 | 差异性质 |
|---|---|---|---|---|
| 同步实现 | `webdavSyncService.ts` 629 行 同步锁+lastModified 冲突+下载合并/上传覆盖+探测（`:389-460`） | `webdavSyncService.ts` 原生 fetch+lastModified 冲突（`:527-600`） | `@lx/core` webdav-merge 纯函数加法合并（收藏/历史按 source:id 并集、歌单按 id 合并歌曲恒并集、删除永不传播） | ✅ 对齐 |
| 写读路径 | /AuralFlow/ 写 / LX_Music/ 读回退 | LX 格式+自动 download-merge-then-upload-converge | — | ✅ 对齐 |
| 本地歌单同步 | 不同步本地歌单 | 额外同步 `localPlaylists`（`:577`） | — | ⬆️ 移动更全 |
| 同步内容 | `user_apis.json`(自定义音源)+`playlists.json`(收藏/歌单/历史) | 同+本地歌单 | — | ✅ 对齐 |

---

## 8. 账号登录

| 维度 | 桌面实现文件 | 移动实现文件 | 共享核心依赖 | 差异性质 |
|---|---|---|---|---|
| 网易云 QR 登录 | `wyAccountService.ts` 601 行 weapi/eapi 双通道+QR 登录 type=3+SVG 二维码+`loginStatus` 轮询（`:299-355`） | `wyQrLoginService.ts` getQrCodeKey/createWyQrCode/pollWyQrLoginStatus（`:44-188`） | — | ✅ 对齐 |
| 网易云 Cookie | Cookie | NetEase cookie | — | ✅ 对齐 |
| B 站登录 | `biliAccountService` 用 settings.biliCookie（`:97`） | `biliService` Cookie | — | ✅ 对齐 |
| B 站合集 | `getBiliCollectionSongs` favorite/season/series 三种（`:189-209`）+`biliAccountStore` 可见性（`:42`） | `biliService.getBiliCollectionSongs`（`:396-416`）+`biliCollectionVisibilityModel`+`biliAccountStore` 299 行 | — | ✅ 对齐 |
| B 站独立详情页 | 无独立详情页 | `BiliCollectionDetailScreen` | — | ⬆️ 移动更强 |
| QQ 登录 | Cookie（tx-meta） | QQ cookieless | `@lx/core` tx-meta QQ strMediaMid/albumMid/songId | 🟢 平台原生（移动无 Cookie） |
| 我的歌单 | `wyAccountStore` setSubscribed（`:37,212`） | `playlistStore.setWyPlaylistSubscribed`（`:241`） | — | ✅ 对齐 |
| 收藏 | `favoritesStore` 喜欢列表 | `favoritesStore`/`playlistStore.likedSongs` | — | ✅ 对齐 |
| 歌单 CRUD | `wyAccountService` 歌单 CRUD | `playlistStore` 歌单 CRUD | — | ✅ 对齐 |
| 日推/FM | `discoveryStore` `createPersonalFmQueueController`（`:8`） | `dailyRecommendMetaModel`+`personalFmMetaModel` | — | ✅ 对齐 |

---

## 9. 搜索聚合

| 维度 | 桌面实现文件 | 移动实现文件 | 共享核心依赖 | 差异性质 |
|---|---|---|---|---|
| 搜索函数 | `searchMergedSources()` 按 type 并发 wy+tx | `searchAll("all",query)` 搜 wy+tx songs 再分别搜歌手/专辑/歌单 | `@lx/core` mobile-api gdstudio 网关依赖注入 fetchText 搜索竞速空数组不算成功 | ✅ 对齐 |
| 去重 | `groupSongResults()` 同名+同歌手+时长差≤6s 合并，保留多源 variant | 移植 `songGroupModel.groupSongResults`（`:3,58`）+`mergeDuplicateSongs`（`:98`） | — | ✅ 对齐 |
| 联想词 | `searchSuggestions.ts` 线上+本地合并（`:63-245`） | `searchSuggestionService.getSearchSuggestions`（`:33`） | — | ✅ 对齐 |
| 搜索历史 | `searchHistory.ts` get/add/remove/clear（`:9-34`） | UI 列表+清空 | — | ✅ 对齐 |
| 竞态保护 | `searchRequestSeqRef` 自增序列号 | `searchRequestSeqRef` 自增序列号+`requestId` 早退（`SearchScreen.tsx:137`） | — | ✅ 对齐（07-10 误判已修正） |
| bili 视频源 | 无 | `searchBiliVideos` SearchSource 含 bili | — | ⬆️ 移动多 bili 源 |
| URL 同步 | `setSearchParams({q})` 写地址栏 | 无地址栏，用 deepLink 初始关键词代替 | — | 💻 桌面独有（平台差异） |

---

## 10. UI 路由

| 维度 | 桌面实现文件 | 移动实现文件 | 共享核心依赖 | 差异性质 |
|---|---|---|---|---|
| 路由框架 | BrowserRouter v6 12 路由 | React Navigation v7 Drawer>NativeStack>BottomTabs+MaterialTopTabs | — | 🟢 平台原生 |
| 常驻侧栏 | `Sidebar.tsx` 常驻 | `MainDrawerNavigator.tsx` Drawer 默认关闭 front overlay+`AppSidebar.tsx` 镜像桌面入口 | — | 💻 桌面独有 |
| 顶部栏 | `Header.tsx` 搜索/联想/主题切换/前进后退 | `MobileHeader.tsx` 汉堡/搜索/联想/主题切换 | — | 🟢 平台原生 |
| 曲库内嵌 | 独立页面（PlaylistsView/HistoryView/LocalMusicView/DownloadsView） | `LibraryScreen` 内嵌 Local/History/Downloads/Bili 条件登录 | — | 📱 移动独有 |
| 沉浸歌词形态 | `ImmersiveLyricsOverlay` 全屏 overlay | `ImmersiveLyricsScreen` Modal fullScreenModal | — | 🟢 平台原生 |
| 列表渲染 | 普通/虚拟列表 VirtualList | 增量挂载列表（初始 60+100/批 非 FlatList） | — | 🟢 平台原生 |
| 图片加载 | 浏览器原生 | `CachedImage`(@d11/react-native-fast-image+Glide) | — | 🟢 平台原生 |

---

## 11. 设置系统

| 维度 | 桌面实现文件 | 移动实现文件 | 共享核心依赖 | 差异性质 |
|---|---|---|---|---|
| 持久化 | Tauri `loadSettings`/`patchSettings`（Rust library JSON） | AsyncStorage+SecureStorage | — | 🟢 平台原生 |
| 结构 | 左侧导航+右侧内容区 8 分区 | 垂直滚动单页+子页（`LyricSettingsScreen`、WebDAV 设置） | — | 🟢 平台原生 |
| 外观 | 主题/强调色/背景图/字体/光标特效 | 主题/强调色/背景图 | — | ✅ 对齐（桌面多字体/光标特效） |
| 播放 | 音质/外部播放暂停 | 音质/外部播放暂停 | `@lx/core` playback-quality | ✅ 对齐 |
| 音源 | 自定义音源脚本管理 | 自定义音源 | `@lx/core` CustomSourceContext | ✅ 对齐 |
| 桌面歌词样式 | 独立分区 字号/字体/颜色/背景 | 无（用 Android 悬浮窗设置代替 `LyricSettingsScreen`） | — | 💻 桌面独有（合理差异） |
| 歌词样式 | 沉浸歌词字体/字号 | 独立 `LyricSettingsScreen` | — | ✅ 对齐 |
| 数据 | 缓存统计/清缓存/清历史 | `CacheSettings` 组件 | — | ✅ 对齐 |
| 同步 | WebDAV 配置 | WebDAV 配置 | `@lx/core` webdav-merge | ✅ 对齐 |
| 更新 | 检查更新 | 检查更新 | — | ✅ 对齐 |
| SecureStorage | 无 | Keystore AES-256-GCM（`SecureStorageModule`） | — | 📱 移动独有 |
| 自定义源运行态测试 | 运行态测试 UI | 无 | — | 💻 桌面独有 |
| 自定义源自动检查 | 手动检查 | `customSourceAutoCheck` 启动时检查 | — | 📱 移动独有 |

---

## 12. 自定义音源运行时（代码机制对比，补充）

| 维度 | 桌面实现文件 | 移动实现文件 | 共享核心依赖 | 差异性质 |
|---|---|---|---|---|
| 沙箱机制 | `customSourceRuntime.ts` 776 行 new Function 沙箱 fakeWindow Object.create(null)+静态正则拒 constructor | `lx_bridge` WebView（Hermes 不能 new Function）+`vendor.js` 2510 行 | `@lx/core` CustomSourceContext 契约 | 🟢 平台原生 |
| HTTP 代理 | Rust outbound.rs SSRF+每跳验证 ≤10 | global fetch+pako | `@lx/core` outbound-host.ts SSRF 守卫（阻私有/环回/链路本地/CGNAT/多播 IPv4+IPv6，显式不做 DNS，Rust 双实现契约） | ✅ 对齐（契约一致） |
| 哈希 | LRU(8) id::djb2a-hash+深度测试 | vendor.js 内实现 | — | ✅ 对齐 |
| 加密 | 无需（Rust 侧处理） | vendor.js CryptoJS+pako+RSA-RAW BigInt modPow | — | 📱 移动独有（JS 侧补齐） |
| 后端并发 | `customSourceBackend` 多源并发尝试（`:44`） | 逐个尝试 | — | 🟢 平台原生 |
| 导入 | 粘贴脚本/导入文件 | 粘贴脚本/原生文件选择 `pickCustomSourceScriptFile` | — | ✅ 对齐 |
| 更新提示 | 自动检查+手动检查 | `customSourceUpdateNoticeModel` 更新提示+`customSourceAutoCheck` | — | ✅ 对齐 |

---

## 13. Android 原生模块（移动端专属，补充）

| 模块 | 文件 | 行数 | 能力 |
|---|---|---|---|
| LocalMusicModule | 10 Java+2 Kotlin 2111 行 | 778 | MediaStore+jaudiotagger+RecoverableSecurityException 重试 |
| LyricOverlayService | — | 407 | WindowManager 浮窗 TYPE_APPLICATION_OVERLAY+拖动+锁定 FLAG_NOT_TOUCHABLE+SharedPreferences 唯一源+ResultReceiver 5s 超时 |
| SecureStorageModule | — | — | Keystore AES-256-GCM |
| CryptoModule | — | — | 原生 weapi |
| ImagePicker | — | — | 图片选择 |
| CustomSourceFilePicker | — | — | 自定义源文件选择 |
| lx_bridge | — | — | WebView+vendor.js |
| 通知栏歌词 | `apply-track-player-patch.js`+`MusicService.kt` | — | 补丁式通知栏歌词 |
| 权限 | AndroidManifest | — | INTERNET/SYSTEM_ALERT_WINDOW/WAKE_LOCK/FOREGROUND_SERVICE_MEDIA_PLAYBACK/POST_NOTIFICATIONS/READ_MEDIA_AUDIO（无 RECORD_AUDIO）；明文 HTTP 允许 |

---

## 14. 共享核心 @lx/core（两端共同消费，汇总）

| 模块 | 能力 |
|---|---|
| sources | MusicSource 接口/MusicInfo 域模型/SourceTag=wy\|tx\|bili\|local/registry Map/resolver 源轮转解析跨源模糊匹配 0.85 阈值/CustomSourceContext 契约/tx-meta QQ strMediaMid/albumMid/songId |
| lyrics | parser 6 格式归一化 lrc/enhanced-lrc/yrc/qrc/krc/vtt→LyricLine 翻译合并 ±150ms/playbackSync PlaybackProgressClock 二分查找 0.12s 提前 CJK/拉丁加权 |
| playback-quality | 质量排序唯一真相源 128k\|192k\|320k\|flac\|flac24bit/raceForBestQuality 800ms 升级窗口 |
| stream-integrity | isPreviewStream 解析时/isPreviewDuration 播放时 min(60s,expected×0.5) |
| webdav-merge | 纯函数加法合并 收藏/历史按 source:id 并集/歌单按 id 合并歌曲恒并集/删除永不传播 |
| outbound-host | SSRF 守卫阻私有/环回/链路本地/CGNAT/多播 IPv4+IPv6 显式不做 DNS 与 Rust 双实现契约 |
| mobile-api | gdstudio 网关依赖注入 fetchText 搜索竞速空数组不算成功 |
| cover-image | 封面图像处理 |
| switch-step-queue | 开关步骤队列 |

---

## 15. 最终结论

1. **功能主体已对齐**：源解析（wy/tx/bili+local+custom）、播放引擎（竞态保护+淡入淡出+三层缓存均已具备，07-10 误判已修正）、歌词系统（解析+译文+行进度+多源匹配+偏移校准+滚动暂停）、缓存策略（URL+歌词+音频+封面三层）、下载（5 级+ID3）、WebDAV 同步、账号登录（QR/Cookie+日推+FM+B 站收藏）、搜索聚合（去重+竞态）、设置系统——两端一致。

2. **平台原生差异（不需补齐）**：播放引擎底层（HTMLAudio vs RNTP）、状态管理分布、UI 路由（react-router vs React Navigation）、列表渲染（普通 vs 增量挂载）、持久化（Rust JSON vs AsyncStorage）、自定义源沙箱（new Function vs WebView bridge）、HTTP 层（Tauri plugin-http vs global fetch）——均为平台必然差异。

3. **桌面独有（平台特性）**：浮动歌词窗口/锁定、系统托盘、全局快捷键、Rust 文件操作、可变下载目录、光标特效、WebAudio EQ、无缝预加载、字体设置、运行态测试 UI、常驻侧栏、窗口多路复用。

4. **移动独有（移动场景）**：通知栏歌词、TrackPlayer 后台、锁屏控制、Deep Link、系统分享、MV、首页 feed、Android 浮窗歌词、自动检查自定义源、沙盒下载、SecureStorage、KeepAwake、PagerView 双页、静音间隙前台服务、B 站独立详情页、WebDAV 本地歌单同步、搜索多 bili 源、音质播放中实时切换、队列管理 UI、歌词海报/旋转封面/下拉关闭/捏合缩放/简繁转换。

5. **07-10 误判修正**：~~移动端无竞态保护~~ → 实际有 `playRequestId`+`inflightPlayRequests`；~~移动端无封面/音频缓存~~ → 实际有三层缓存。以本 07-11 模块对比为准。
