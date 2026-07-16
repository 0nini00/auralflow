# auralflow 桌面端 vs 移动端 功能完整度对比（基于真实代码核实）

> 日期：2026-07-11
> 方法：逐文件读桌面端（desktop/）与移动端（apps/mobile/）代码核实，不依赖文档猜测。
> 基线：桌面端功能完备，作为基线检查移动端覆盖度。

## 一、功能对比总表

图例：✅ 对齐/已实现 ｜ 🟡 部分实现 ｜ ❌ 缺失 ｜ ⬆️ 移动端超桌面

| # | 功能 | 桌面端 | 移动端 | 差距 | 证据文件 |
|---|------|--------|--------|------|---------|
| 1 | 核心播放控制 | ✅ | ✅ | 无 | desktop/src/stores/playerStore.ts；apps/mobile/src/stores/playerStore.ts |
| 2 | 播放队列 | ✅ | ✅ | 无 | 桌面 playQueue/addToQueue/playNext；移动 songQueueActions |
| 3 | 播放模式 | ✅ | ✅ | 无 | desktop/services/playback/playModeControl.ts；apps/mobile/services/mobilePlayModeModel.ts |
| 4 | 音量持久化 | ✅ | ✅ | 无 | desktop playerStore L560+；mobile playerStore |
| 5 | 淡入淡出 | ✅ | ✅ | 无（层不同） | desktop/services/playerEngine.ts L249-307；mobile playerStore |
| 6 | 首页发现/每日推荐/FM入口 | ✅ | ✅ | 无 | desktop/views/HomeView.tsx；mobile/screens/HomeScreen.tsx |
| 7 | 搜索(历史/建议/聚合/去重) | ✅ | ✅ | ⬆️移动端多 bili 源 | desktop/views/SearchView.tsx L146-235；mobile/screens/SearchScreen.tsx |
| 8 | 私人FM | ✅ | ✅ | 无 | desktop/views/PersonalFmView.tsx；mobile/screens/PersonalFmScreen.tsx |
| 9 | 曲库/本地音乐 | ✅ | ✅ | 无 | desktop/views/LocalMusicView.tsx；mobile/screens/LibraryScreen.tsx |
| 10 | 下载(进度/重试/音质/ID3标签) | ✅ +可配目录+ID3 | ✅ +ID3(标题/歌手/专辑+封面+内嵌歌词) | 仅目录不可配(见 P1-1，平台沙盒限制) | desktop downloadStore/downloadService；mobile downloadService + services/id3TagWriter.ts |
| 11 | 歌词(译文/沉浸/滚动暂停) | ✅ | ✅ | 无 | desktop/hooks/useLyricAutoScroll.ts；mobile/components/LyricView.tsx |
| 12 | 睡眠定时器 | ✅ | ✅ | 无 | desktop/stores/sleepTimerStore.ts；mobile ImmersiveLyricsScreen |
| 13 | 音质切换 | 🟡 仅偏好 | ⬆️ 偏好+播放中实时切 | 移动端更强 | desktop playbackResolver.ts；mobile PlayerScreen L289-311 |
| 14 | 均衡器(5段/EQ/声像/混响/变调) | ✅ | 🟡 pitch 不生效 | 见 P2-1 | desktop soundEffectStore.ts；mobile soundEffectStore.ts |
| 15 | 缓存(音频/封面/歌词/URL/清理) | ✅ | ✅ | 无 | desktop mediaCache/persistentCache；mobile cacheService/playbackUrlCache |
| 16 | 设置子页 | ✅ 8段 | ✅ 8段 | 缺 desktop-lyric/misc | desktop/views/SettingsView.tsx；mobile/screens/SettingsScreen.tsx |
| 17 | B站收藏合集 | ✅ | ⬆️ 独立详情页 | 移动端更强 | desktop PlaylistsView L274+；mobile BiliCollectionDetailScreen |
| 18 | WebDAV 同步 | ✅ | ✅ | 无 | desktop webdavSyncService；mobile WebDavSyncScreen |
| 19 | 自定义音源(LX) | ✅ | ✅ | 无 | desktop customSourceStore；mobile CustomSourceScreen |
| 20 | 登录(网易云/B站) | ✅ | ✅ | 无 | desktop WyCookieLoginModal；mobile LoginScreen |
| 21 | 桌面歌词悬浮窗/解锁视窗 | ✅ | ❌ | 桌面专属 | desktop LyricWindowView/LyricUnlockView |

## 二、移动端相对桌面端的缺口清单

### P0（核心播放/搜索/曲库）—— 无缺口
移动端在播放控制、队列、模式、音量持久化、淡入淡出、首页发现、搜索、FM、本地音乐上完全覆盖，且搜索音源与播放中切音质反超桌面。

### P1（音效/下载/歌词相关）
- **P1-1 下载保存位置不可配置**
  - 桌面：downloadStore.chooseDownloadDir() 弹系统目录选择器，downloadDir 经 persist 持久化。
  - 移动：downloadService.getDownloadDirectoryPath() 固定为 RNFS.DocumentDirectoryPath/auralflow/downloads，downloadDirectoryModel 注释「系统限制下不可改」。
  - 证据：desktop/stores/downloadStore.ts L50-66,116；mobile/services/downloadService.ts L18-23

- **P1-2 下载文件不写 ID3 元数据/封面** ✅ 已解决（2026-07-11）
  - 桌面：enhanceDownloadedFile() 写 ID3(标题/歌手/专辑)+内嵌封面+内嵌歌词+.lrc 旁注。
  - 移动：原 downloadSong() 仅写 .lrc 旁注。现已新增纯 JS ID3v2.4 写入器 `apps/mobile/src/services/id3TagWriter.ts`（无原生依赖，Hermes 兼容），在下载成功后由 `enhanceDownloadedFile` 嵌入标题/歌手/专辑 + APIC 封面 + USLT 内嵌歌词；本地歌曲跳过，任一步失败仅告警不中断。对齐桌面行为。
  - 验证：tsc 0 错误；id3TagWriter.test.ts 7/7 通过；全量 330 用例通过。
  - 证据：mobile/services/id3TagWriter.ts；mobile/services/downloadService.ts enhanceDownloadedFile/fetchCoverBytes；mobile/services/__tests__/id3TagWriter.test.ts

### P2（细节对齐）
- **P2-1 音效「变调 pitch」移动端不生效**
  - 桌面：setPitch→SoundTouch 真实变速变调。
  - 移动：setPitch 保留控件并持久化，但 soundEffectService.setPitch 注释「Android AudioFx 不支持，返回 false」，实际无效。
  - 证据：mobile/stores/soundEffectStore.ts 顶部注释；mobile/services/soundEffectService.ts L50

- **P2-2 孤立 sleepTimerStore（仅 timer 模式）未被使用**
  - 移动端 useSleepTimerStore 仅自身定义，全代码无 import/调用；真正 UI 走 playerStore.startSleepTimer/startSongSleepTimer。建议清理死代码。
  - 证据：grep useSleepTimerStore 仅命中定义；ImmersiveLyricsScreen 用 playerStore

- **P2-3 桌面歌词悬浮窗/解锁视窗**：桌面独占，移动端为全屏沉浸歌词页，平台特性差异非缺陷。
- **P2-4 鼠标拖尾特效**：仅桌面 MiscSection 有，移动端 N/A。
- **需确认**：移动端是否处理锁区/付费歌词解锁。桌面 LyricUnlockView(role lyric-unlock) 对应此能力；移动端 lyricOverlayStore.locked 是系统歌词叠层锁，概念不同。建议比对 desktop/views/LyricUnlockView.tsx 与 mobile/lyricsService。

## 三、两端行为差异（代码级额外发现）
1. 搜索音源：桌面仅 wy+tx；移动端多 bili 视频源（SearchSource 含 bili，searchBiliVideos）。
2. 音质切换：桌面仅偏好无播放中 UI；移动端 PlayerScreen 可实时切。移动端 > 桌面。
3. 下载目录：桌面可选持久化；移动端沙盒硬编码。平台约束但仍是体验差。
4. 睡眠定时器架构：桌面单一 store 承载两模式；移动端把歌曲计数放 playerStore，另留未用的 timer-only store。
5. 淡入淡出：桌面引擎级(Web Audio ramp)；移动端 store 级显式 fadeVolume。效果一致。
6. 本地音乐元数据编辑：两端都有能力，移动端无独立 Modal 组件，需确认 LibraryScreen 是否暴露 UI 入口。

## 结论
以桌面为基线，移动端 P0 全覆盖且两处反超。P1-2（下载写 ID3/封面）已解决；剩余缺口：P1-1 下载目录不可配置（平台沙盒限制，仅 UI 展示）、P2-1 变调 pitch 在 Android 不生效（AudioFx 不支持），外加桌面专属特性（悬浮歌词窗、鼠标特效）。建议后续处理 P2-1 与清理 P2-2 孤立 store。
