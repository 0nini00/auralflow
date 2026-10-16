---
id: mobile
type: module-design
status: draft
title: "@auralflow/mobile — 移动端"
parent: auralflow-architecture
tags: [auralflow, mobile]
---

## 职责

移动端把桌面端的能力按 Android 平台的方式重新落地，并在平台允许的地方反超。它由 JS 层（`apps/mobile/src`）与 Android 原生层（`apps/mobile/android`）构成，后者见 `mobile-native`。

四条平台约束塑造了整个移动端的结构——它们是理解这里所有「为什么和桌面端不一样」的前提：

- **Hermes 不支持 `new Function`**：用户导入的 LX 脚本无法在 JS 线程执行，只能在独立的隐藏 WebView（`lx_bridge`）里跑。移动端的自定义音源因此被切成两半：RN 侧的编排与桥代理，加 WebView 内的执行环境。
- **RN 的 fetch 无法禁用重定向**：`redirect: "manual"` 在 OkHttp 上不生效，出站校验只能拦响应回流，拦不住重定向落点。这是与桌面端「每跳验证」的已知能力差，见 `source-resolution`。
- **后台 JS 会被系统挂起**：播放靠前台服务保活，曲目推进靠 TrackPlayer 的后台事件而非 JS 定时器；`playerStore` 用每曲尾随的 15s 静音占位轨（`SILENCE_GAP_TRACK_ID`，文件 `android/app/src/main/res/raw/silence_2s.wav` 现为 15s——文件名与 id 未改）保持前台服务存活。
- **播放器是原生的**：`react-native-track-player`（ExoPlayer），不是 `HTMLAudioElement`；音频效果走原生 AudioFx。

移动端独有的能力（相对桌面端）：通知栏与锁屏控制、deep link、分享、MV、首页信息流（推荐 / 新歌 / 新碟 / 排行榜 / MV）、Android 悬浮歌词窗、自动检查自定义源更新、电池优化豁免引导。这些由平台能力支撑，不是桌面端的缺口。

共同目标见 `auralflow-goal`；共享纯逻辑见 `core`；音源解析与自定义源的完整设计见 `source-resolution`。

**结构**：导航为 Drawer > NativeStack > BottomTabs（Library 另有 MaterialTopTabs），16 个 Zustand store，`screens/` 下含 `immersive/` 与 `settings/` 两个子域。

## 边界

**允许**：`@lx/core`（`workspace:*`）与 RN 生态（React Native 0.86 / React 19、React Navigation 7、Zustand 5、TrackPlayer 4、Reanimated、fast-image、react-native-video、crypto-js、node-forge、pako、opencc-js、lucide-react-native）。

**禁止**：

- 不依赖 `@lx/tauri-bridge`，也不 `import` 任何 `@tauri-apps/*`——桌面专属。移动端到原生的唯一通路是 `NativeModules`。
- 不复制 `core` 已有的规则。
- 不把 `core` 当 IO 层用——core 只给纯函数，网络、存储、文件都在移动端自己的 service 里。

**约束强度**：移动端有 ESLint（`eslint.config.mjs`），但只开 `react-hooks/rules-of-hooks: error` 与 `react-hooks/exhaustive-deps: warn`，风格与未使用变量交给 `tsc --noEmit`。**有测试，且不需要真机**：`tests/` 下有 28 个 `*.test.cjs`，跑法是 `package.json` 的 `test` 脚本（`node --test --test-timeout=60000 tests/*.test.cjs`），根脚本 `pnpm mobile:test`，`.github/workflows/ci.yml` 的 js 任务会执行它。两类都不需要设备：(a) 纯逻辑与源码契约测试——`tests/helpers/loadTs.cjs` 用 `typescript.transpileModule` 在内存里转译 TS，未 mock 的 bare import 一律抛 `Unmocked import`，所以没有 RN 运行时也能跑；其中本地媒体匹配的用例直接加载 `@lx/core` 的真实实现（判定已收敛到 core，移动端不再有副本）；(b) 原生契约测试——`local-audio-assets-native.test.cjs` 与 `local-tag-edit.test.cjs` 用 `javac` 编译原生源码片段，配真 jaudiotagger 3.0.1 jar 与 `ffmpeg` 生成的音频跑真 JVM，仍不需要设备，但强依赖本机工具链（CI 里装 temurin 17 + ffmpeg，并校验 jar 的 sha256）。设备上的手测照旧，`docs/mobile-verification-baseline.md` 是这套手测的权威对照表。

**下载后处理失败必须上报（与桌面端对称，本层硬规则）**：`services/downloadService.ts` 的 `enhanceDownloadedFile` 与 `writeSidecarLyrics` 返回 `string[]` 警告，经 `QueueTask.onWarnings` → `downloadSong` 第 4 个参数 → `store.addDownload(..., warnings)` → `DownloadedItem.warning` → `downloadListMetadataModel.warningLabel` → `DownloadList` 直接显示（移动端没有 hover，文本完整渲染、2 行截断，不塞进 tooltip）。两条约束：**不得抛错**——后处理失败时音频已完整落盘，抛错会让 store 走 catch 分支把下载判为失败；**「跳过」不算失败**——`isLocal` / 非 mp3 / 超过 25MB 三条提前返回都返回空数组。该文件另有 5 处空 `catch`（质量偏好写入 `saveLastSelectQuality`、扩展名解析、`findExistingDownloadFile` 的目录列举、封面扩展名解析、`clearDownloadedFiles` 批量删除）与 2 处 `.catch(() => undefined)`（封面与临时文件的 unlink）是有意为之的尽力清理，不是缺陷，不要「顺手清理」它们。

**Zustand 选择器必须返回稳定引用（本层的硬规则）**：Zustand 5 的 `useStore` 内部就是 `useSyncExternalStore`，**没有 equalityFn**——选择器每次新建对象或数组，React 会认为快照一直在变，直接把整屏崩在错误边界上，报 `Maximum update depth exceeded`。传给 `useXxxStore(selector)` 的选择器只能返回：原始值（字符串 / 数字 / 布尔）、store 里已有的引用（对象字段、数组元素、已存在的函数），或按身份记忆化的值（`WeakMap` / `useMemo`）。已踩过：`services/localMediaPlaybackModel.ts` 的 `selectLocalMediaLyricOriginNote` 每次返回新建的 `{ text, holdMs }`，播放带来源标注的本地曲即崩；修法是按来源对象身份用 `WeakMap` 缓存，并由 `tests/local-media-lyric-origin.test.cjs` 钉住「同一来源必须返回同一个对象」。

**本地歌单里的同步残留必须主动清理（本层的硬规则 + 一次性数据修复）**：`stores/playlistStore.ts` 在**读盘后**（`loadLocalPlaylists`）与**同步合并后**（`mergeFromSync`）各跑一次 `scrubSyncedCloudPlaylistRefs`（规则在 `core`，与桌面端共用，有单测）。

成因：旧版移动端按 `source === "local"` 归类而**不看 id**，把旧版桌面端上传的云端歌单引用（`source:"local"` + 纯数字 id）物化成了本地歌单；归类守卫修好后**已落盘的那批不会自己消失**，而合并规则「不丢本地独有项」会让它们永久留存、每次同步再传回云端，与桌面端的清洗形成乒乓。移动端自建的本地歌单 id 恒为 `local-<ts>-<8位>`，所以**纯数字 id 的本地歌单只可能来自这条污染路径**。

两条约束：**只剔除本地 0 首的纯数字 id 条目**——有歌曲的保守保留并告警，那可能是用户真在用的歌单，删掉就是静默销毁用户数据；**先备份再丢弃**（AsyncStorage `auralflow.mobile.localPlaylists.scrub-backup`），清理是数据修复，但不能表现为静默销毁。

来源已下线的历史条目则相反：收藏（`favoritesStore`）与本地歌单歌曲（`playlistStore`）在读盘后与同步合并后各跑一次 `core` 的 `dropRemovedSourceEntries`；播放历史（`historyStore`）走的是同属 `core` 的 `isRemovedSource` 谓词（本地 `withoutRemovedSources` 过滤，丢弃条数走 `console.warn`），同样读盘后（`loadHistory`）与同步合并后（`mergeHistory` / `replaceAllHistory`）各一次。三者都直接丢弃、不备份（用户明确选择）。

**本地曲的封面与歌词来源（2026-10-16 起）**：封面**只取音频文件自己**——内嵌 albumart → 同目录旁挂图（`folder.jpg` / `cover.jpg` 与同名图），都没有就显示占位图；**不联网匹配，也没有换封面入口**（平台封面匹配、相册选图、封面 URL 输入连同原生 `ImagePickerModule` 已删除）。歌词仍默认自动匹配，但按曲可纠正：`lyricsMode` 三态 `auto` / `picked` / `local-only`（缺省 `auto`；`picked` 只用选中文本、永不联网，`local-only` 不联网、只用内嵌与旁挂 `.lrc`），判定与 patch 生成在 `services/localLyricsChoiceModel.ts`，候选面板是 `components/LyricsChoiceSheet.tsx`，入口在本地曲列表菜单与沉浸歌词页的更多菜单。两个地方必须一并处理，否则用户的选择会被无声清掉：`localMusicScanModel` 的 `LOCAL_EDITABLE_FIELDS` 要包含 `lyricsMode` / `lyricsFingerprint` / `lyricsSourceLabel`（重新扫描不得覆盖），`localMediaAssetsService.localMediaInputKey` 要带上 mode 与指纹（否则 30 天旧缓存会命中、选择看起来没生效）。指纹复用原生已有的 SHA-256 `signature`，**不额外算哈希**。改名/移动由 `localLyricsChoiceOrphanModel` + `localLyricsChoiceOrphanStore` 的孤儿表认回：记录消失时把选择存进 `auralflow.mobile.localLyricsChoiceOrphans`（上限 200 条），认领发生在解析本地曲时、用**已经拿到**的 `signature`，并带一份进程内索引——播放路径不得每次读 AsyncStorage。
