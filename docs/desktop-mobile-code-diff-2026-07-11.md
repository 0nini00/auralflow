# AuralFlow 桌面端 vs 移动端 — 代码层面对比（2026-07-11）

> **目的**：对比双端关键技术点的实现差异，聚焦代码机制而非功能清单。覆盖播放引擎（HTMLAudio+rAF vs RNTP/ExoPlayer）、自定义源沙箱（new Function vs WebView bridge）、HTTP 层（Tauri plugin-http+Rust proxy vs global fetch+pako）、持久化（Rust library JSON vs AsyncStorage+SecureStorage）、导航（react-router v6 vs React Navigation v7）、UI 可视化（CSS background-clip:text vs Animated clip-path）、列表渲染（普通 vs 增量挂载）等核心技术点。
>
> **方法**：逐文件读双端源码核实，不依赖文档猜测。基线：桌面端 `desktop/`，移动端 `apps/mobile/`，共享核心 `@lx/core`。

---

## 1. 播放引擎

| 技术点 | 桌面实现 | 移动实现 | 差异说明 |
|---|---|---|---|
| 底层引擎 | HTML5 `AudioElement`+WebAudio API | `react-native-track-player`(ExoPlayer/AVPlayer) | 平台原生 |
| 架构 | 单例 class `PlayerEngine`，独立于 store，store 通过 subscribe 同步 | Zustand store 直接调用 TrackPlayer 原生 API | 平台原生 |
| 淡入淡出 | ✅ `fadeOut()` 90ms+`fadeIn()` 140ms 余弦曲线，`requestAnimationFrame` 逐帧控制（`:260-311`） | ✅ `fadeVolume(target,durationMs)` 后台 fadeVolume 跳过步进（`:34`） | ✅ 对齐（07-10 误判已修正） |
| 播放竞态 | ✅ `activePlayRequestId` 自增序列号，快速切歌只保留最新请求 | ✅ `playRequestId`+`inflightPlayRequests` 去重 | ✅ 对齐（07-10 误判已修正） |
| 预加载 | ✅ `preload(url)` 隐藏 `<audio>` 预缓存下一首；`prefetchService` 预读 [-1,+1,+2] 随机 [+1,+2,-1] 的 URL+歌词+封面 10min TTL | ✅ `prefetchCache` 预读下一首 URL（纯 URL，不预读歌词/封面） | 💻 桌面预读更深（含歌词/封面） |
| 音效图 | ✅ WebAudio 懒构建：`MediaElementSource`→5 段 BiquadFilter→`StereoPanner`→`ConvolverNode` 混响→`GainNode`→destination | ✅ 原生 AudioFx：`attachSoundEffects()` 调 Android 原生 `Equalizer`/`PresetReverb`（`soundEffectService.ts:6,30`） | 平台原生 |
| 变调 | ✅ `soundtouchjs`+`ScriptProcessorNode`（WebAudio 管线内） | ⚠️ ExoPlayer `PlaybackParameters(speed,pitch)` 经补丁透传（仅 Android），iOS 不支持独立变调 | 🟡 桌面更完整 |
| 倍速 | ✅ `setPlaybackRate`(0.25-3.0) | ✅ `setPlaybackRate`+`androidPitchService.setRate(rate,pitchRatio)` 双参保持音高（`:26`） | 🟢 移动保持音高 |
| 外部中断 | ✅ `mediaInterruptionPolicy` 系统音频抢占可选暂停/降音量 | ✅ TrackPlayer 内置+`pauseOnExternalPlayback` 设置+RemoteDuck 音频焦点 permanent 暂停/else duck | 🟢 平台原生 |
| 前台服务 | ❌ 桌面系统级处理 | ✅ `MusicService` 前台服务+静音间隙技巧 [真实歌曲,SILENCE_GAP_TRACK 2s] 保持前台 | 📱 移动独有 |
| 音量持久化 | ✅ `patchSettings({volume})` 400ms 防抖写入 | ✅ AsyncStorage 音量持久化（400ms 防抖） | ✅ 对齐 |
| 后台播放 | ❌ | ✅ `playbackService.ts` RNTP 后台 `PlaybackActiveTrackChanged`→`advanceAfterTrackFinished` | 📱 移动独有 |
| 错误恢复 | 预读缓存命中失败→持久化缓存失效→重新解析（`invalidatePersistentPlaybackCache`） | 自定义音源逐个尝试→全部失败抛错 | 🟢 语义对齐 |
| 预览检测 | ✅ `isPreviewStream` 解析时/`isPreviewDuration` 播放时 | ✅ `streamProbe` 1 字节 Range 5s+`isPreviewDuration` | 🟢 移动多 streamProbe |
| 共享契约 | `@lx/core` stream-integrity `isPreviewStream`/`isPreviewDuration` min(60s,expected×0.5) | 同 | ✅ 共享核心 |
| 共享契约 | `@lx/core` playback-quality raceForBestQuality 800ms 升级窗口 | 同 | ✅ 共享核心 |

---

## 2. 自定义源沙箱

| 技术点 | 桌面实现 | 移动实现 | 差异说明 |
|---|---|---|---|
| 沙箱机制 | `new Function` 沙箱 fakeWindow `Object.create(null)`+静态正则拒 constructor | WebView lx_bridge（Hermes 不能 `new Function`）+vendor.js 注入 | 平台原生（机制根本不同） |
| 窗口隔离 | fakeWindow 代理全局 | WebView 独立 JS 上下文 | 平台原生 |
| constructor 防护 | ✅ 静态正则拒 constructor | ❌（WebView 沙箱边界） | 🟢 桌面更严 |
| HTTP 代理 | Rust outbound.rs SSRF 守卫+每跳验证 ≤10 | global fetch+pako（JS 侧） | 🟢 平台原生 |
| SSRF 契约 | `@lx/core` outbound-host.ts 阻私有/环回/链路本地/CGNAT/多播 IPv4+IPv6，显式不做 DNS，与 Rust 双实现 | `@lx/core` outbound-host.ts（JS 侧契约一致） | ✅ 共享核心契约 |
| LRU 缓存 | LRU(8) id::djb2a-hash+深度测试 | vendor.js 内实现 | ✅ 对齐 |
| 加密能力 | 无需（Rust 侧处理） | vendor.js CryptoJS+pako+RSA-RAW BigInt modPow | 📱 移动独有（JS 侧补齐 QQ/网易加密） |
| 后端并发 | `customSourceBackend` 多源并发尝试（`:44`） | 逐个尝试 | 🟢 桌面并发 vs 移动串行 |
| CustomSourceContext | `@lx/core` CustomSourceContext 契约 | 同（注释「与桌面端对齐」`:10`） | ✅ 共享核心 |
| 导入方式 | 粘贴脚本/导入文件 | 粘贴脚本/原生文件选择 `pickCustomSourceScriptFile` | ✅ 对齐 |
| 运行态测试 | ✅ 深度测试 UI | ❌ | 💻 桌面独有 |
| 自动检查 | 手动检查 | ✅ `customSourceAutoCheck` 启动时检查+`customSourceUpdateNoticeModel` | 📱 移动独有 |

---

## 3. HTTP 层

| 技术点 | 桌面实现 | 移动实现 | 差异说明 |
|---|---|---|---|
| HTTP 客户端 | Tauri plugin-http+Rust proxy | global fetch | 平台原生 |
| SSRF 守卫 | `@lx/core` outbound-host.ts+Rust outbound.rs 双实现，每跳验证 ≤10 | `@lx/core` outbound-host.ts（JS 侧契约一致） | ✅ 共享核心契约 |
| 私有 IP 阻断 | ✅ 阻私有/环回/链路本地/CGNAT/多播 IPv4+IPv6 | ✅ 同 | ✅ 对齐 |
| DNS 解析 | 显式不做 DNS | 显式不做 DNS | ✅ 对齐 |
| 网关 | Tauri Rust 侧 | `@lx/core` mobile-api gdstudio 网关依赖注入 fetchText 搜索竞速空数组不算成功 | 🟢 平台原生 |
| 压缩 | 无需（Rust 侧） | pako（gzip 解压） | 📱 移动独有 |
| 明文 HTTP | 默认阻断 | 允许（AndroidManifest 明文 HTTP 允许） | 🟢 平台原生 |

---

## 4. 持久化

| 技术点 | 桌面实现 | 移动实现 | 差异说明 |
|---|---|---|---|
| 持久化机制 | Rust library JSON（Tauri `loadSettings`/`patchSettings`） | AsyncStorage+SecureStorage | 平台原生 |
| 敏感数据 | Rust 文件系统 | Keystore AES-256-GCM（`SecureStorageModule`） | 🟢 平台原生 |
| 设置 | `patchSettings` 400ms 防抖 | AsyncStorage via stores | ✅ 对齐（机制不同） |
| 缓存元数据 | Rust `media_cache.ts` 三层 2GiB LRU 落盘 | AsyncStorage URL 缓存 6h/30min/1yr+磁盘 LRU 100MB | ✅ 对齐 |
| 播放快照 | `playbackSnapshot` JSON | `playbackSnapshot`+shuffleHistory 持久化 | ✅ 对齐 |
| 下载目录 | `downloadDir` persist 持久化 | 固定沙盒目录（不可改） | 💻 桌面独有（可改） |

---

## 5. 导航

| 技术点 | 桌面实现 | 移动实现 | 差异说明 |
|---|---|---|---|
| 路由框架 | BrowserRouter v6，12 路由 | React Navigation v7（Drawer > NativeStack > BottomTabs + MaterialTopTabs） | 平台原生 |
| URL 同步 | ✅ `setSearchParams({q})` 写地址栏 | ❌ 无地址栏，用 deepLink 初始关键词代替 | 💻 桌面独有（平台差异） |
| 侧栏 | `Sidebar.tsx` 常驻 | `MainDrawerNavigator.tsx` Drawer 默认关闭 front overlay | 💻 桌面独有 |
| 顶部栏 | `Header.tsx` 搜索/联想/主题切换/前进后退 | `MobileHeader.tsx` 汉堡/搜索/联想/主题切换 | 🟢 平台原生 |
| 沉浸歌词形态 | `ImmersiveLyricsOverlay` 全屏 overlay | `ImmersiveLyricsScreen` Modal fullScreenModal | 🟢 平台原生 |
| 曲库 | 独立页面（PlaylistsView/HistoryView/LocalMusicView/DownloadsView） | `LibraryScreen` 内嵌 Local/History/Downloads/Bili 条件登录 | 📱 移动独有 |
| Deep Link | 无 | `parseMobileDeepLink`→`initialKeyword` | 📱 移动独有 |

---

## 6. UI 可视化

| 技术点 | 桌面实现 | 移动实现 | 差异说明 |
|---|---|---|---|
| 卡拉OK 渲染 | `background-clip:text`+`clip-path` CSS 变量数据驱动（纯 CSS/DOM） | Animated `clip-path`（`ImmersiveLyricsScreen`） | 平台原生（CSS vs Animated） |
| 视觉化 | `PlayerVisualizerRenderer` 音频可视化（WebAudio） | `PosterWaveVisualizer` 海报波形 | 🟢 平台原生 |
| 封面背景 | 封面模糊背景 | 封面模糊+氛围色（根据封面生成） | 📱 移动多氛围色 |
| 旋转封面 | ❌ | ✅ Animated 25s 旋转+Marquee | 📱 移动独有 |
| 下拉关闭 | ❌ | ✅ 沉浸歌词页下拉关闭 | 📱 移动独有 |
| PagerView | ❌ | ✅ PagerView 2 页+`useImmersiveController` 558 行 | 📱 移动独有 |
| KeepAwake | ❌ | ✅ 沉浸歌词页 KeepAwake | 📱 移动独有 |
| 歌词海报 | ❌ | ✅ 歌词海报切换+分享 | 📱 移动独有 |
| 字体/字号/颜色 | ✅ 持久化设置+广播同步 | ✅ `lyricSettingsStore` 持久化 | ✅ 对齐 |

---

## 7. 列表渲染

| 技术点 | 桌面实现 | 移动实现 | 差异说明 |
|---|---|---|---|
| 虚拟列表 | ✅ `VirtualList` 虚拟列表 | ❌ 非 FlatList，用增量挂载列表（初始 60+100/批） | 平台原生 |
| 网格视图 | ✅ `MusicCard` 网格（本地音乐/专辑） | ❌ 列表为主 | 💻 桌面独有 |
| 图片加载 | 浏览器原生 | `CachedImage`(@d11/react-native-fast-image+Glide) | 🟢 平台原生 |
| 歌词滚动 | DOM `scrollIntoView({behavior:'smooth'})`+用户滚动暂停 3s | `LyricView.tsx` 587 行 动态行高+累积偏移+相邻平滑 easeInOutQuad 600ms/跨行即时 scrollToIndex 0.42+3s 用户滚动暂停 | 🟢 平台原生 |
| 歌词行交互 | 点击行 seek | 点击行跳转+捏合缩放+简繁转换 | 📱 移动多交互 |
| 歌曲行操作 | 播放/加队列/加歌单/下载 常驻 | `SongList` 封面+歌名+♥+⋯ 菜单（下一首/加入队列/收藏到歌单/下载/分享/编辑/删除） | 🟢 平台原生 |

---

## 8. 歌词系统代码机制（补充）

| 技术点 | 桌面实现 | 移动实现 | 差异说明 |
|---|---|---|---|
| 解析器 | `@lx/core` lyrics/parser 6 格式归一化 | `@lx/core` lyrics/parser 6 格式归一化 | ✅ 共享核心 |
| 译文合并 | `desktopLyric.ts` `mergeTranslation`+`mergeMissingLines` | `@lx/core` 翻译合并 ±150ms | ✅ 对齐 |
| 行进度估算 | `@lx/core` playbackSync PlaybackProgressClock 二分查找 0.12s 提前 CJK/拉丁加权 | `@lx/core calculateLyricLineProgress` 同算法 | ✅ 共享核心 |
| 多源匹配 | `matchScore.ts` 多源择优（标题/歌手/时长相似度） | lyricsService 搜索匹配+`scoreLyricContentQuality`+0.12s 迟滞 | ✅ 对齐 |
| 歌词服务链 | 嵌入式→provider→搜索匹配 | 嵌入式→provider→搜索匹配 | ✅ 对齐 |
| 偏移校准 | `SettingsView` manualOffsetMs 滑块接进渲染 | `LyricSettingsScreen` 歌词偏移校准滑块 | ✅ 对齐 |
| 歌词缓存 | 内存+持久化 | `cacheLyrics` 磁盘层 | ✅ 对齐 |
| 动画强度 | `animationIntensity` 三级 reduced/normal/enhanced | `lyricSettingsStore.animationIntensity` 三级 | ✅ 对齐 |

---

## 9. WebDAV 同步代码机制（补充）

| 技术点 | 桌面实现（`webdavSyncService.ts` 629 行） | 移动实现（`webdavSyncService.ts`） | 差异说明 |
|---|---|---|---|
| HTTP 实现 | Tauri Rust 侧 | 原生 fetch | 平台原生 |
| 同步锁 | ✅ 同步锁 | ✅ 同步锁 | ✅ 对齐 |
| 冲突解决 | ✅ lastModified 冲突 | ✅ lastModified 冲突 | ✅ 对齐 |
| 合并语义 | `@lx/core` webdav-merge 纯函数加法合并 | `@lx/core` webdav-merge+自动 download-merge-then-upload-converge | ✅ 共享核心 |
| 下载/上传 | 下载合并/上传覆盖 | 下载合并/上传覆盖 | ✅ 对齐 |
| 写读路径 | /AuralFlow/ 写 / LX_Music/ 读回退 | LX 格式+自动 converge | ✅ 对齐 |
| 同步内容 | `user_apis.json`(自定义音源)+`playlists.json`(收藏/歌单/历史) | 同+本地歌单 `localPlaylists`（`:577`） | ⬆️ 移动更全 |
| 删除传播 | `@lx/core` webdav-merge 删除永不传播 | 同 | ✅ 共享核心 |

---

## 10. 账号登录代码机制（补充）

| 技术点 | 桌面实现（`wyAccountService.ts` 601 行） | 移动实现（`wyQrLoginService.ts`） | 差异说明 |
|---|---|---|---|
| API 通道 | weapi/eapi 双通道 | weapi（部分） | 🟡 桌面双通道更全 |
| QR 登录 | type=3+SVG 二维码+`loginStatus` 轮询（`:299-355`） | `getQrCodeKey`/`createWyQrCode`/`pollWyQrLoginStatus`（`:44-188`） | ✅ 对齐 |
| 歌单 CRUD | ✅ | ✅ | ✅ 对齐 |
| 日推/FM | `discoveryStore` `createPersonalFmQueueController` | `dailyRecommendMetaModel`+`personalFmMetaModel` | ✅ 对齐 |
| Cookie | 网易云 Cookie | NetEase cookie | ✅ 对齐 |
| B 站 | `biliAccountService` settings.biliCookie | `biliService` Cookie | ✅ 对齐 |
| QQ | Cookie（tx-meta） | QQ cookieless | 🟢 平台原生 |

---

## 11. 状态管理代码机制（补充）

| 技术点 | 桌面实现 | 移动实现 | 差异说明 |
|---|---|---|---|
| 框架 | Zustand | Zustand | ✅ 对齐 |
| Store 数量 | ~16 store（playerStore 899 行） | 15 store（playerStore 1004 行/playlistStore 656 行/downloadStore 411 行/customSourceStore 372 行 24h/historyStore 234 行 2000 上限 31 天/biliAccountStore 299 行/homeFeedStore 463 行 600s TTL 按账号隔离） | 🟢 分布不同 |
| 桥接 | tauri-bridge 零逻辑全类型 | 无 | 💻 桌面独有 |
| 窗口多路复用 | main/lyric/lyric-unlock | 无 | 💻 桌面独有 |

---

## 12. 最终结论

**平台原生差异（不补齐，机制根本不同）**：播放引擎底层（HTMLAudio+rAF vs RNTP/ExoPlayer）、自定义源沙箱（new Function vs WebView bridge）、HTTP 层（Tauri plugin-http+Rust proxy vs global fetch+pako）、持久化（Rust library JSON vs AsyncStorage+SecureStorage）、导航（react-router v6 vs React Navigation v7）、UI 可视化（CSS background-clip:text vs Animated clip-path）、列表渲染（VirtualList vs 增量挂载）。

**共享核心契约对齐（两端共用 @lx/core）**：源解析（MusicSource/MusicInfo/resolver 0.85 阈值/CustomSourceContext/tx-meta）、歌词（parser 6 格式/playbackSync 二分查找 0.12s CJK 加权）、播放质量（playback-quality 5 级/raceForBestQuality 800ms）、流完整性（isPreviewStream/isPreviewDuration min(60s,expected×0.5)）、WebDAV 合并（webdav-merge 纯函数加法合并 删除永不传播）、SSRF 守卫（outbound-host.ts 双实现契约）、搜索网关（mobile-api gdstudio fetchText 空数组不算成功）。

**已对齐的控制层**：竞态保护（playRequestId+inflightPlayRequests）、淡入淡出（余弦 90/140ms vs fadeVolume）、三层缓存（07-10 误判已修正）、播放模式 4 种、倍速、音效、5 级下载、ID3 嵌入、歌词偏移校准、用户滚动暂停 3s。

**桌面更强**：变调（SoundTouch 全平台 vs Android only）、预加载深度（URL+歌词+封面 vs 仅 URL）、下载目录可改、并发自定义源后端。

**移动更强**：倍速保持音高（双参 setRate）、音质播放中实时切换、队列管理 UI、B 站独立详情页、WebDAV 本地歌单同步、搜索多 bili 源、沉浸控制条丰富度、歌词交互（捏合/简繁/旋转封面/海报）。
