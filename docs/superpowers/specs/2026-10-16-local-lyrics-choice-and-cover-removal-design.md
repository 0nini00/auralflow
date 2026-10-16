---
id: local-lyrics-choice-and-cover-removal
type: submodule-design
status: approved
title: 本地曲：删去封面匹配/搜索，歌词匹配加「选择歌词 / 不匹配」
parent: module-design
---

# 本地曲：删去封面匹配/搜索，歌词匹配加手动选择

## 目标与用户场景

**问题**：本地曲缺歌词时会自动联网匹配，但同名不同曲会被匹到错的歌词；用户没有任何办法纠正——只能眼睁睁看着错词。

**要解决的两件事**：

1. **封面不再「猜」**：删去双端本地曲的封面匹配/搜索能力（平台自动匹配、平台候选手选、本机图片导入、封面 URL 输入）。本地曲封面只允许来自音频文件自己：**内嵌标签 → 同目录旁挂图**，都没有就显示占位图。
2. **歌词可以被纠正**：歌词仍然默认自动匹配（这是有用的），但双端都要能**手动选择一份候选**，或明确**「不要匹配」**。选择按「文件路径 + 内容指纹」记住，改文件名/移动目录后仍然生效。

## 范围

**两端**：`desktop/`（Tauri v2 + React 18）、`apps/mobile/`（React Native + Android）。

**只有本地曲（`source: "local"`）受影响**。在线曲的歌词来自音源本身、封面是平台封面，均不变。

**明确保留**（不要顺手删）：

- `set_audio_cover`（Rust 命令 + 桥 + 双端标签写入）：下载**在线**曲时把平台封面写进文件标签，与本地曲封面无关。
- Rust `media_cache::sniff_image_extension`：它被 `set_audio_cover` 使用；只删 `save_manual_cover` / `write_manual_cover`。
- 桌面「手动资料编辑」弹窗本身（改标题/歌手/专辑/写回文件），只去掉其中的**封面**部分；它同时是「选择歌词」的一个既有落点。
- 移动端 `CoverColorModule`（用当前封面主色做主题）：封面来源变成内嵌/旁挂后仍然工作。
- 在线曲的一切歌词/封面行为、下载流程、WebDAV 同步。

## 数据模型（双端一致）

本地曲记录新增三个可选字段：

```ts
type LocalLyricsMode = "auto" | "picked" | "local-only";
lyricsMode?: LocalLyricsMode;   // 缺省即 "auto"
lyricsFingerprint?: string;     // 做出选择时该音频文件的内容哈希
lyricsSourceLabel?: string;     // 仅用于 UI 显示「当前使用：QQ音乐 / LRCLIB」，不参与判定
```

`picked` 时歌词文本沿用既有的按曲覆盖字段：桌面 `LocalSong.lyricsOverride` / `MusicInfo.localLyrics`，移动 `MusicInfo.localLyrics`。**不新增存放歌词文本的字段。**

### 三态语义

| mode | 行为 |
|---|---|
| `auto`（默认） | 现有行为：内嵌标签 / 旁挂 `.lrc` → LRCLIB → 平台搜索（网易云 / QQ） |
| `picked` | 只用选中的那一份文本，**永不联网再搜**；显示 `lyricsSourceLabel` |
| `local-only` | **不联网**，只用内嵌标签与旁挂 `.lrc`；都没有则显示「无歌词」，不显示任何来源标注 |

`local-only` 就是用户说的「选择不匹配歌词」。它必须与 `auto` 下有本地歌词的情况有**可观察的区别**：前者不再对这首歌发起任何歌词网络请求。

**必须修掉的既有缺陷**：移动端 `localMusicMetadataModel.normalizeOptionalText` 把空串变成 `undefined`，导致「明确不匹配」无法表达（会退回自动搜索）。桌面靠 `localLyrics === ""`（`lyricsService.ts:38`）表达不匹配——两端语义从此统一到 `lyricsMode`，不再依赖空串约定。

### 指纹绑定

- **移动端**：复用已有的原生 SHA-256 `signature`（`LocalAudioAssetsReader`，已参与 `localMediaInputKey` 与缓存键），无需新原生代码。
- **桌面端**：新增 Rust 命令 `hash_local_file(path) -> String`，用**已有的 `md5` crate** 流式读取（不新增依赖）。指纹不用于安全用途，只需内容变更检测。
- **计算时机**：只在用户做出选择时算一次，随记录持久化；不得在扫描或播放路径上算术。
- **匹配顺序**：先按 `path` 精确命中；未命中时用 `size` 相等 + `lyricsFingerprint` 相同判定；指纹不同则视为新文件，选择失效。
  **实际交付（2026-10-16）**：改名/移动由**按内容哈希索引的孤儿表**认回。桌面侧的选择挂在记录上，而记录 id 是 `md5(路径)`（`local_audio.rs:212`），所以记录消失时把选择移进 `lyricsChoicesByHash`（与 `localSongs` 同一个 `library` 命名空间，上限 200 条，超出按时间淘汰）；扫描合并后 `rebindLocalLyricsChoices` 先比 `size`，只有 size 吻合才调 `hash_local_file` 确认内容——**绝不对整库每个文件哈希**。移动端同构：`localLyricsChoiceOrphanModel` + `localLyricsChoiceOrphanStore`（`auralflow.mobile.localLyricsChoiceOrphans`，上限 200），在解析本地曲时用**已经拿到**的原生 SHA-256 `signature` 认领，不额外读取或哈希。指纹本身桌面为 `"<size>:<md5>"` 复合串、校验只比 size；移动端直接比 `signature`。
- **内容变了**：指纹不匹配 → 选择失效、回到 `auto`，并在 UI 上不提示（静默失效，避免噪音）；但**不得**静默把错误歌词当成正确。

## 交互

**入口（双端各两处）**：

1. 本地曲列表的行内 / 操作菜单（未播放时就能预先指定）。
2. 沉浸歌词页的更多菜单（正在听时发现不对就地换）。

**「选择歌词」面板**：

- 候选列表，来源为：本地已有（内嵌 / 旁挂 `.lrc`）、LRCLIB、平台搜索（网易云、QQ）。
- 每条显示：来源 + 标题 / 歌手 / 专辑 + 时长差 + 首行预览。`packages/core/local-media-match.ts` 的判定结果用来**排序并标注**（同一录音档 / 同曲异唱档），不用于隐藏候选——用户可以自己判断。
- 底部动作：**「不要匹配（只用本地歌词）」** → `local-only`；**「恢复自动匹配」** → `auto` 并清除文本与指纹；选中某条 → `picked`。
- 当前生效的来源要能看到（`lyricsSourceLabel`）。

**失败处理**：候选搜索失败（离线 / 平台报错）只显示错误与「重试」，不改变当前 mode；本地已有歌词必须始终可达（离线也能选 `local-only`）。

## 各端改动清单

### 桌面（删封面）

- 删除 `services/localCoverMatch.ts`（整个文件）及其三处触发：`stores/playerStore.ts` 的 `applyLocalCover`（223-238 与其调用）、`services/lyricsService.ts` 的 `triggerLocalCoverMatch`（421-425 与其两处调用）、`services/playback/prefetchService.ts` 的封面触发。
- `services/localPlaybackMetadata.ts`：去掉 `rememberLocalCover` 与封面回填；**注意**它承担引擎逐帧回写元数据的职责，只删封面分支，不动其它字段。
- `services/localMusicService.ts`：去掉 `LocalSong.coverOverride`（字段与读取）。
- 手动资料编辑：`manualMediaMatchService.ts` 去掉 `getManualCover` / `cacheManualCover` / `pickManualCover` / `coverDataUrl` / `setAudioCover` 调用；`manualMediaMatchModel.ts` 去掉 `cover` / `coverOverride`；`components/ManualMediaMatchDialog.tsx` 与 `components/MetadataEditModal.tsx` 去掉封面区块。
- Rust：`commands/media_cache.rs` 删 `save_manual_cover` / `write_manual_cover` 与其测试模块；`main.rs` 从 `generate_handler!` 移除该命令。**保留** `sniff_image_extension` 与 `image_magic_tests`。
- 桥：`desktop/packages/tauri-bridge/src/index.ts` 删 `saveManualCover`。
- 后果（已知并接受）：既有用户的 `coverOverride` 与 `manual-covers` 目录不再被读取，封面回落到内嵌/旁挂；`manual-covers` 里的文件不删。

### 桌面（加歌词选择）

- `LocalSong` 增加 `lyricsMode` / `lyricsFingerprint` / `lyricsSourceLabel`，并在 `toMusicInfo` 映射到 `MusicInfo`。
- 用户编辑必须在重新扫描后保留：与桌面现有的「用户编辑优先级」机制一致（扫描时不再用内嵌值覆盖用户选择）。
- `services/lyricsService.ts`：`getLocalLyricsOverride` 改为按 `lyricsMode` 判定；新增候选获取函数（复用 `localMediaMatch` 的网易搜索 + LRCLIB + 本地内嵌/旁挂）。
- 新增候选面板组件与两处入口。
- Rust：新增 `hash_local_file` 命令并注册。

### 移动端（删封面）

- `services/localMediaSearchService.ts`：删封面搜索分支，只留歌词。
- `services/localMediaAssetsService.ts`：删 `needs.cover` / `coverUri` 与 `localMediaInputKey` 里的封面字段。
- `services/localMediaRuntime.ts`：删封面抓取与尺寸校验分支。
- `services/localMediaPlaybackModel.ts`：封面来源改为内嵌/旁挂。
- `screens/LibraryScreen.tsx`：删相册选图与封面 URL 输入。
- `services/id3TagWriter.ts`：去掉封面参数（元数据与歌词写入保留）。
- `services/localMusicScanModel.ts`：`LOCAL_EDITABLE_FIELDS` 去掉 `picUrl` / `img`。
- 删除 `services/imagePickerService.ts`、原生 `ImagePickerModule.java` 与 `LocalMusicPackage` 中的注册行。

### 移动端（加歌词选择）

- `MusicInfo` 本地记录增加三个字段；`localMusicMetadataModel` 与 `LOCAL_EDITABLE_FIELDS` 同步（否则重新扫描会清掉用户选择）。
- `localMediaInputKey` 必须包含 `lyricsMode` 与指纹，否则 30 天旧缓存会命中、选择看起来没生效。
- `localMediaSearchService` 暴露候选列表（含 `alternatives`，目前 UI 层零引用）；「选择歌词」面板与两处入口。

## 验证

- `pnpm test:all`（当前基线：core 163 / 桌面 531 / 移动 615 / Rust 70 全过）必须全绿。
- 新增测试：
  1. 本地曲封面解析**不发起任何网络请求**（双端各一条）。
  2. `lyricsMode` 三态：`auto` 走自动链、`picked` 只用选中文本且不联网、`local-only` 不联网且无本地歌词时为空。
  3. 指纹绑定：改名后仍生效；内容变了失效回 `auto`。
  4. 移动端「不匹配」不被 `normalizeOptionalText` 吞掉。
  5. 重新扫描不覆盖用户选择（双端）。
- 真机手测（本机做不了，留给用户）：Android 构建、桌面实际启动。

## 未决 / 已知限制

- 手动选择和指纹只绑定到本地文件；文件被替换（内容变）后选择静默失效，用户需重选。
- 跨设备不携带（选择存在各自的曲库记录里，WebDAV 同步的是在线歌单与收藏，不含本地曲记录）。
- 平台候选列表的质量取决于平台搜索，`local-media-match` 只做排序与标注，不做过滤。
