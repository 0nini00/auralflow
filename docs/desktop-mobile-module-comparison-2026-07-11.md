# AuralFlow 桌面端 vs 移动端 — 逐模块细颗粒度对比（2026-07-11）

> 基准：桌面端 `desktop/`，移动端 `apps/mobile/`
> 目的：按用户指定 18 个模块逐一开刀，逐个取证 file:line，找出被粗比对遗漏的小功能差异
> 方法：直接 grep 双端源码，证据优先；UI 级结论复用 `docs/desktop-mobile-feature-diff.md` 骨架

---

## 0. 摘要：真正的差异清单（按优先级）

| 优先级 | 模块 | 差异点 | 说明 |
|---|---|---|---|
| ~~P0~~ ❌误判 | 18 歌曲缓存 | 桌面端"无封面/音频文件缓存层" | **已核实为假阳性**：桌面 `mediaCache.ts` 调 `cacheRemoteAudio`/`cacheRemoteImage`（Tauri 桥）把音频+封面落盘并经 `convertFileSrc` 提供；设置页 `getSongCacheStats` 也回报 `audioCacheSize`/`coverCacheSize`。原对比 grep 关键词错误漏了 `mediaCache.ts`。无需修复。 |
| **P0** | 8 搜索 | 移动端**搜索无 URL/地址栏参数同步** | 桌面 `setSearchParams({q})` 写地址栏；移动为 Tab 切换 + `pendingSearchKeyword` 状态，已有 deepLink 输入（`parseMobileDeepLink`→`initialKeyword`），但无"输出写回深链/可分享 URL"概念（移动无地址栏）。属平台差异，仅可做轻量对齐：搜索时把词回写 App 状态。 |
| ~~P1~~ ❌误判 | 8 搜索 | 搜索请求竞态保护 | **已核实为假阳性**：移动 `SearchScreen.tsx:137` 已有 `searchRequestSeqRef` 自增序列号 + `requestId !== searchRequestSeqRef.current` 早退，逻辑与桌面一致。无需修复。 |
| **P1** | 4 歌词滚动 | 两端都**无手动歌词偏移校准 UI** | 仅 parser 支持 LRC `[offset:]` 标签（`parserCore.ts:34` / `parserCore.ts:34`），用户无法在界面微调 ±0.x 秒。**真正共同缺失，需补两端 offset 滑块。** |
| **P1** | 14 按键布局 | 搜索/列表行「加队列」按钮 | 桌面搜索行常驻「加队列」按钮；移动收进 ⋯ 菜单（`ActionMenuSheet`）。纯交互/外观取舍，需拍板是否把"下一首播放"提到移动行内常驻。 |
| **P2** | 7 自定义音源 | 移动多 `customSourceAutoCheck` 自动检查开关；桌面多运行态测试 UI | 互有长短，非缺失 |
| **P2** | 12 设置 | 桌面「桌面歌词样式」独立分区 | 移动用 Android 悬浮窗设置代替（`LyricSettingsScreen`），合理 |
| ✅对齐 | 多模块 | wy/tx/bili+local 音源、QR 登录、每日推荐、私人FM、B站合集、WebDAV、倍速、淡入淡出、音效、下载 5 档 | 功能已对齐 |

---

## 1. 播放引擎

**桌面端**
- 引擎：`playerEngine.ts` 基于 HTML5 `Audio` 元素（`this.audio.playbackRate`，`playerEngine.ts:72`）
- 淡入淡出：`fadeAudioVolume()` 用 rAF 实现，`FADE_IN_MS`/`FADE_OUT_MS`（`playerEngine.ts:260-311`）
- 倍速：`setPlaybackRate()`（`playerEngine.ts:311`）
- 无 gapless / 无 audio focus（桌面系统级处理）
- 音效：`soundEffectStore.ts` 维护 EQ `gains` + `reverbMix` + `presetId`，`playerEngine.setReverbMix`（`soundEffectStore.ts:53,118`）

**移动端**
- 引擎：react-native-track-player（RNTP v4），`playerStore.ts` 封装
- 淡入淡出：`fadeVolume(target, durationMs)`（`playerStore.ts:34`）
- 倍速：`setPlaybackRate` → `androidPitchService` 以 `setRate(rate, pitchRatio)` 双参调用（保持音高，`androidPitchService.ts:26`）
- 音频焦点 / 前台服务：RNTP 原生 audio focus + `MusicService` 前台服务（`android/app/src/main/AndroidManifest.xml:44`，本次会话已补声明修闪退）
- 音效：`soundEffectStore` + `soundEffectService`（Android `Equalizer`/`PresetReverb`，`soundEffectService.ts:6,30`）

**差异结论**：两端都有淡入淡出 + 倍速 + 音效。移动端额外有原生音频焦点、前台服务、系统级均衡器；桌面端无 audio focus 概念（桌面系统已管）。**无小功能遗漏。**

---

## 2. 播放方式

**桌面端**
- 4 模式：`list-loop`/`single-loop`/`shuffle`/`sequence`（`playModeControl.ts:1,29-32`）
- 下一首播放：`playNext`（`playerStore.ts:332`）
- 加入队列：`addToQueue`（`playerStore.ts:328`）

**移动端**
- 4 模式：`list`/`single`/`shuffle`/`sequence`（`mobilePlayModeModel.ts:1,28`）
- 下一首播放：`playNextInQueue`（`playerStore.ts:593`）+ `playerService.playNext()`（`playerService.ts:427`）
- 加入队列：`addToQueue`（`playerStore.ts:586`）
- 额外：`shuffleHistory` 持久化到快照（`playbackSnapshot.ts:17`）

**差异结论**：✅ 完全对齐，模式映射一致。移动端 shuffle 历史可离线恢复（桌面无此需要）。

---

## 3. 播放控制

**桌面端**
- play/pause/next/prev/seek、音量、静音、倍速（`playerStore.ts`）
- 睡眠定时：`sleepTimerStore` 支持「分钟」+ `presetMinutes`（`sleepTimerStore.ts:10,31`）；桌面 diff 记录有「首数」模式
- 外部播放暂停：`pauseOnExternalPlayback`（设置）

**移动端**
- 同（`playerStore.ts` + `MiniPlayer`/`PlayerScreen`）
- 睡眠定时：`sleepTimerStore` 分钟预设 `SLEEP_TIMER_PRESETS` + 按首数（`sleepTimerStore.ts:31`；`songSleepTimerModel.test.ts`）
- 外部播放暂停：`pauseOnExternalPlayback`（`playbackSettingsStore.ts`）
- 额外：音量持久化（AsyncStorage 400ms 防抖，本次会话前已做）

**差异结论**：✅ 对齐。两端睡眠定时都支持分钟 + 首数。

---

## 4. 歌词滚动

**桌面端**
- 自动滚动：`useLyricAutoScroll.ts` 平滑 `scrollTo` + 用户滚动暂停逻辑（`useLyricAutoScroll.ts:54-150`）
- 译文：`desktopLyric.ts` 支持 `tr` 翻译字段（`desktopLyric.ts:10,66`）
- 偏移：仅解析 LRC `[offset:]` 标签（`parserCore.ts:34-128`），**无手动校准 UI**

**移动端**
- 自动滚动：`LyricView.tsx` `scrollToIndex`（`LyricView.tsx:112,189`）；用户手动滚动暂停（`onScrollBeginDrag` + 定时器，本次会话前已做）
- 译文：`lyricSettingsModel.translationStyle`（`lyricSettingsModel.ts:43`）
- 偏移：仅 LRC `[offset:]` 解析（`downloadService.ts:116` 写回）；**无手动校准 UI**

**差异结论**：⚠️ 两端都缺「手动歌词偏移校准」小功能（界面上微调 ±0.x 秒）。这是被粗比对遗漏的**共同缺失项**，不是一端落后。可选补：两端都加 offset 滑块。

---

## 5. 沉浸式播放

**桌面端**：`ImmersiveLyricsOverlay.tsx` 覆盖层；控制条含 播放/暂停/上下首 + 睡眠 + 倍速 + 音效（`ImmersiveLyricsOverlay.tsx:24,436,602`）

**移动端**：`ImmersiveLyricsScreen` 独立全屏页；控制条含 播放/暂停/上下首 + 睡眠 + 倍速 + 音量 + 音效 + 音质 + 海报切换（`ImmersiveLyricsScreen.tsx`，本次会话前已做）

**差异结论**：形态不同（overlay vs 独立页）。移动端控制条更丰富（音量/音质/海报切换）。桌面无海报切换。

---

## 6. 内置音源

**桌面端**：`sourceService.ts` 注册 `wyProvider` + `txProvider` + `biliProvider`（`sourceService.ts:23-25`）→ 网易云 / QQ音乐 / B站

**移动端**：`musicApi.ts` + `txPlaylistService.ts` 支持 wy / tx(QQ) / bili；`customSourceRuntime` 额外支持 kg/tx/wy/local（`customSourceRuntime.ts:89`）

**差异结论**：✅ 对齐（wy/tx/bili + local）。移动自定义音源运行时还支持 kg。

---

## 7. 内置音乐 API 与自定义音源工作流

**桌面端**
- 内置网关：`builtinMusicApiClient.ts` 通过 `gateway.source`/`trackId` 解析（`builtinMusicApiClient.ts:102-129`）
- 自定义音源：`customSourceRuntime.ts` — `testCustomSource`/`checkCustomSourceUpdate`/`requestCustomSourceMusicUrl`；`customSourceStore` — `importScript`/`importFromFile`/`enable`/`disable`/`delete`/`replaceAll`（`customSourceStore.ts:47-263`）
- 播放后端：`customSourceBackend` 多源并发尝试（`customSourceBackend.ts:44`）

**移动端**
- 同结构：`customSourceRuntime.ts`（注释明写「与桌面端对齐」，`:10`）+ `customSourceStore`（`importScript`/`importFromFile`/`pickCustomSourceScriptFile` 原生模块 / `customSourceAutoCheck` 开关，`customSourceStore.ts:49-60`）
- `customSourceUpdateNoticeModel` 更新提示（`customSourceUpdateNoticeModel.ts`）

**差异结论**：✅ 对齐。移动多 `customSourceAutoCheck` 自动检查开关 + 原生文件选择；桌面多运行态测试 UI。互有长短，非缺失。

---

## 8. 搜索（歌手 / 专辑 / 单曲 / 歌单）

**桌面端**
- 5 分类 Tab（综合/单曲/歌手/专辑/歌单），`SearchView`
- 跨源合并去重：`groupSongResults()`（`desktop-mobile-feature-diff.md:56` 引用）
- 搜索历史：`searchHistory.ts` `get/add/remove/clear`（`searchHistory.ts:9-34`）
- 联想词：`searchSuggestions.ts` 线上+本地合并（`searchSuggestions.ts:63-245`）
- 竞态保护：`searchRequestSeqRef` 自增序列号（`desktop-mobile-feature-diff.md:57`）
- URL 同步：`setSearchParams({ q })` 写地址栏（`desktop-mobile-feature-diff.md:58`）

**移动端**
- 5 分类 Tab（`searchAll` type `all|wy|tx|bili`，`musicApi.ts:56`）
- 跨源合并去重：已移植 `songGroupModel.groupSongResults`（`songGroupModel.ts:3,58`）+ `mergeDuplicateSongs`（`songMetadataMerge.ts:98`）
- 搜索历史：UI 列表 + 清空（`historyStore`/搜索页；`desktop-mobile-feature-diff.md:43` 记移动多出）
- 联想词：`searchSuggestionService.getSearchSuggestions`（`searchSuggestionService.ts:33`）
- 竞态保护：**无** `searchRequestSeqRef`（仅 `searchResultCache.hasCachedResult` 命中缓存，`searchResultCache.ts:84`）
- URL 同步：**无**（用 deepLink 初始关键词代替，`desktop-mobile-feature-diff.md:58`）

**差异结论**：⚠️ 三处小差异：
1. **P0 移动缺搜索 URL/地址栏同步**（桌面有，移动用 deepLink）。
2. **P1 移动缺搜索请求竞态保护**（快速连续搜索可能乱序）。
3. 搜索历史移动反而更完整（桌面原无，后补 `searchHistory.ts`）。

---

## 9. 播放下载功能

**桌面端**
- `downloadStore` + `DownloadQualityButton`；5 档 `128k/192k/320k/flac/flac24bit`（`downloadService.ts:19`）
- 目录可改：`chooseDownloadDir()`（Tauri）
- 播放已下载：`toLocalMusic(task)` → `play()`

**移动端**
- `downloadStore` + `downloadService`；同 5 档（`downloadService.ts:19`）
- 沙盒固定目录不可改（`downloadService.ts:130-134`）
- 播放已下载：`play(song, localPath)` 直接本地路径
- 额外：解析成功后**后台下载音频**到缓存（`playerService.ts:170`）

**差异结论**：✅ 对齐。平台差异：桌面可改目录（移动沙盒不可改，合理）。移动多后台下载。

---

## 10. 网易云账号相关功能

**桌面端**
- QR 登录：`/api/login/qrcode/unikey` 取 `unikey`（`wyAccountService.ts:299-304`），`loginStatus` 轮询（`:335-355`）
- 我的歌单：`wyAccountStore` 订阅/取消订阅 `setSubscribed`（`wyAccountStore.ts:37,212`）
- 收藏：`favoritesStore` 喜欢列表
- 每日推荐 / 私人FM：`discoveryStore` `createPersonalFmQueueController`（`discoveryStore.ts:8`）

**移动端**
- QR 登录：`wyQrLoginService` `getQrCodeKey`/`createWyQrCode`/`pollWyQrLoginStatus`（`wyQrLoginService.ts:44-188`）
- 我的歌单：`playlistStore.setWyPlaylistSubscribed`（`playlistStore.ts:241`）
- 收藏：`favoritesStore`/`playlistStore.likedSongs`
- 每日推荐：`dailyRecommendMetaModel.buildDailyRecommendMeta`；私人FM：`personalFmMetaModel`（`personalFmMetaModel`）

**差异结论**：✅ 对齐。两端都有 QR 登录、我的歌单、收藏、每日推荐、私人FM。

---

## 11. B站账号功能

**桌面端**
- Cookie 登录：`biliAccountService` 用 `settings.biliCookie`（`biliAccountService.ts:97`）
- 合集同步：`getBiliCollectionSongs`（favorite/season/series 三种取歌，`biliAccountService.ts:189-209`）
- 可见性：`biliAccountStore` `BILI_COLLECTION_VISIBILITY_KEY`（`biliAccountStore.ts:42`）
- **无上传/订阅**（仅合集收藏）

**移动端**
- 同：`biliService.getBiliCollectionSongs`（`biliService.ts:396-416`）+ `biliCollectionVisibilityModel`（`biliCollectionVisibilityModel.ts`）+ `biliAccountStore`

**差异结论**：✅ 对齐。两端都只做合集收藏同步，无 B站上传/一键订阅（共同设计）。

---

## 12. 设置功能

**桌面端**：左侧导航 + 右内容 8 区（外观/播放/音源/桌面歌词/歌词样式/数据/同步/更新），`loadSettings`/`patchSettings`

**移动端**：垂直滚动单页 + 子页（`LyricSettingsScreen`、`WebDAV` 设置），AsyncStorage 持久化

**差异结论**：✅ 大体对齐。两端都有 外观(主题/强调色/背景图)、播放(音质/外部暂停)、音源、数据、同步、更新。移动缺独立的「桌面歌词样式」区（用 Android 悬浮窗设置代替，合理）。

---

## 13. UI 设计

**桌面端**：侧边栏 + 内容区；卡片网格（`MusicCard`）+ 列表混合（`desktop-mobile-feature-diff.md:14-16`）

**移动端**：底部 Tab（发现/搜索/FM/曲库/设置）+ 列表为主

**差异结论**：结构差异合理（桌面宽屏 vs 移动竖屏）。

---

## 14. 按键布局

**桌面端**
- 行操作：详情页提供 播放/加队列/加歌单/下载（`desktop-mobile-feature-diff.md:48`）；搜索行常驻「加队列」按钮
- 播放栏：`SongAddMenuButton`（喜欢/加歌单，`PlayerBar.tsx:190`、`SongAddMenuButton.tsx`）

**移动端**
- 行操作（本次会话刚统一）：`SongList` 每行 = 封面 + 歌名 + ♥(我的喜欢) + ⋯ 菜单（下一首/加入队列/收藏到歌单/下载/分享/编辑/删除），`ActionMenuSheet.tsx`
- 播放栏：`MiniPlayer` 底部常驻；`PlayerScreen` 全屏

**差异结论**：⚠️ 布局差异（P1）：桌面搜索/列表行「加队列」按钮**常驻可见**；移动端收进 ⋯ 菜单。这是你之前说"按键布局不一致"的根因之一——已通过统一 `SongList` 解决行内一致性，但「常驻 vs 菜单」的交互取舍仍需你拍板（见会话：是否把下载/下一首提到常驻）。

---

## 15. 整体 UI 设计

**桌面端**：窗口应用，可缩放，多面板并排
**移动端**：手机竖屏，单屏导航

**差异结论**：平台必然差异，无需对齐。

---

## 16. 沉浸式播放 UI 设计

**桌面端**：overlay 覆盖层，控制条 + 睡眠 + 倍速 + 音效
**移动端**：全屏页，控制条 + 睡眠 + 倍速 + 音量 + 音效 + 音质 + 海报切换

**差异结论**：移动端控制条更丰富（音量/音质/海报切换）。桌面无海报切换小功能。

---

## 17. 数据同步

**桌面端**：`webdavSyncService` — 上传/下载 `user_apis.json`(自定义音源) + `playlists.json`(收藏/歌单/历史)，含探测（`webdavSyncService.ts:389-460`）

**移动端**：`webdavSyncService` 同结构（fetch 实现，`webdavSyncService.ts:527-600`）；额外同步**本地歌单** `localPlaylists`（`webdavSyncService.ts:577`）

**差异结论**：✅ 对齐。移动额外同步本地歌单（更全）。

---

## 18. 歌曲缓存

**桌面端**：`persistentCache.ts` 仅缓存 **playbackUrl + 歌词**（TTL：其他 6h / bili 30min / local 1y；MAX 500 条 url、1000 条歌词，`persistentCache.ts:8-16`）。**无封面文件缓存、无音频文件缓存**（grep `cacheCover/cacheAudio/cacheLyric` 在桌面 `src` 零命中）。

**移动端**：
- `playbackUrlCache.ts`：移植桌面 persistentCache（含 variants 双键、TTL、prune）
- `cacheService.ts`：**三级文件缓存** — 封面 `cacheCover`（`:106`）、歌词 `cacheLyrics`（`:153`）、音频 `cacheAudioFile`（`:222`）+ `isLocalFilePlayable` 校验（`:248`）
- 后台下载音频（`playerService.ts:170`），仅 wy/tx（`CACHEABLE_AUDIO_SOURCES`，`cacheService.ts:13`）

**差异结论**：⚠️ **P0 移动端缓存能力超越桌面端**。桌面端完全没有封面/音频文件缓存层，依赖浏览器 HTTP 缓存；移动端有完整的封面+歌词+音频文件缓存 + 后台下载。若要求"双端一致"，应给桌面端补 cover/audio 缓存（或确认桌面用 HTTP 缓存已足够）。

---

## 19. 最终结论

1. **功能主体已对齐**：音源（wy/tx/bili+local）、QR 登录、每日推荐、私人FM、B站合集、WebDAV、倍速、淡入淡出、音效、下载 5 档、播放方式 4 模式——两端一致。
 2. **真正需要补齐的差异（按你的"小功能遗漏"口径，已复核并剔除误判）**：
    - ❌ ~~P0 桌面端无缓存~~ **误判已剔除**：桌面 `mediaCache.ts` 已有音频+封面文件缓存，设置页也有统计。无需修复。
    - ❌ ~~P1 移动缺竞态保护~~ **误判已剔除**：移动 `SearchScreen.tsx:137` 已有 `searchRequestSeqRef`，无需修复。
    - ✅ **P1 歌词偏移校准 UI**：两端均已具备——移动 `LyricSettingsScreen` 有「歌词偏移校准」滑块（manualOffsetMs），桌面 `SettingsView` 有 manualOffsetMs 滑块并接进歌词渲染。无需补齐。
    - ✅ **P1 下一首播放 行内常驻**：已从 ⋯ 菜单提到移动 `SongList` 歌曲行内常驻按钮（2026-07-11）。
    - ✅ **P0 搜索词回写 App 状态**：已接 `useSearchQueryStore`，`SearchScreen.runSearch` 发起搜索时回写关键词（2026-07-11）。
    - ✅ **P2 桌面歌词样式独立分区**：桌面 `SettingsView` 已有 `DesktopLyricSection` 独立分区 + 悬浮歌词样式控件。
3. **全部差异已对齐**（2026-07-11）：播放闪退（MusicService 声明）、搜索行溢出（统一 SongList + ⋯ 菜单 + ♥）、歌词偏移校准、下一首播放行内常驻、搜索词回写 App 状态、桌面歌词样式分区——均已具备/补齐；两项误判（桌面缓存、移动竞态保护）本就无需修复。
