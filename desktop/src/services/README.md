# services/

业务逻辑层：承载播放引擎、源解析、账号、同步、缓存、下载等核心规则；直接读写 Zustand store，系统级 IO 主要经 `@lx/tauri-bridge` 包装的 Rust 命令（但有 45 条直接 `import @tauri-apps/*` 的语句、分布在 35 个文件，见文末），并消费 `@lx/core` 的跨平台能力。

## 目录结构

```
services/
├── lyrics/   # 歌词（4）：animationIntensity autoScrollModel lyricOriginNote playbackSync（解析器在 @lx/core 的 lyrics/parser.ts，本地已无 parserCore）
├── playback/ # 播放（13）：builtinNeteaseBackend builtinProviderBackend crossSourceFallbackService customSourceBackend
│             #       immersiveKeyboard playbackResolver playbackSnapshot playbackSnapshotModel
│             #       playModeControl prefetchModel prefetchService streamProbe types
├── search/   # 搜索（5）：含 searchSuggestions（本地历史 + 网易云 suggest）
├── sources/  # 源：wyProvider txProvider（registry 注册；builtin / customSource backend 见 playback/）
└── *.ts      # 32 个顶层服务
```

## 核心服务清单

| 服务 | 文件 | 行数 | 职责 |
| --- | --- | --- | --- |
| 播放引擎 | `playerEngine.ts` | 425 | HTMLAudio + rAF + 500ms 后备 + 余弦淡入淡出（90/140ms，`fadeToken` 取消）+ 外部暂停 `shouldResumeAfterExternalPause` 500ms 保护窗 + 预览检测 `isPreviewDuration` + 预加载 `preloadAudio` |
| 自定义源运行时 | `customSourceRuntime.ts` | 892 | LX 脚本 `new Function` 参数遮蔽（`fakeWindow = Object.create(null)` 无原型；**非安全边界**：可经 constructor 链取回真实 globalThis，静态正则黑名单已移除，真正隔离未实施）+ 宿主全局传 undefined + HTTP 代理 `outboundRequest`（Rust SSRF）+ LRU(8) `key=id::djb2a-hash` + `parseDesktopUserApiInfo` 头部 + `testCustomSourceDeep` 两阶段 init + `musicUrl`（wy 2034742057 林俊杰《江南》 / tx 0039MnYb0qxYhV）20s |
| WebDAV 同步 | `webdavSyncService.ts` | 865 | 同步锁 `withSyncLock` + `lastModified` 冲突 `assertCloudNotStale` + 下载 merge / 上传 overwrite + localStorage 备份 + `/AuralFlow/` 写 / `/LX_Music/` 读回退 |
| 网易账号 | `wyAccountService.ts` | 632 | weapi/eapi 双通道 + QR 登录（type=3 unikey → SVG 二维码 → 轮询 800/801/802/803）+ 歌单 CRUD + 日推/FM + `extractSetCookie`（`Headers.getSetCookie`） |
| 歌词 | `lyricsService.ts` | 501 | 多源嵌入式 → provider `getLyric` → LRC Lib 两轮直查（主歌手不带时长 → 完整歌手带时长）→ 网易搜索候选交 `localMediaMatch.ts` 判定（不再本地打分；同曲异唱档带 `origin` 标注）+ `scoreLyricContentQuality` 组内择优 + 翻译合并 |
| 歌词来源标注 | `lyrics/lyricOriginNote.ts` | 23 | 同曲异唱档（`LyricOrigin.tier === "other-performer"`）生成一条 10s 停留的「歌词来自 X 的演唱版本」提示，供歌词窗与沉浸歌词浮层显示；同一录音档不提示 |
| 歌词选择 | `localLyricsChoiceModel.ts` | 198 | 本地曲三态 `lyricsMode` 的判定与 patch 生成（`auto` / `picked` / `local-only`，缺省 `auto`）+ 桌面指纹 `"<size>:<md5>"` 的构造、解析与绑定判定 `isLocalLyricsChoiceBound`；空串不再冒充「不匹配」 |
| 歌词选择服务 | `localLyricsChoiceService.ts` | 38 | 候选获取（本地已有 / LRCLIB / 平台搜索，按 `localMediaMatch` 排序标注但**不隐藏候选**）+ `computeLocalLyricsFingerprint`（只在做出选择时调 Rust `hash_local_file` 算一次） |
| 歌词选择孤儿表 | `localLyricsChoiceOrphan.ts` | 272 | 改名/移动后认回选择：按内容 md5 索引的 `lyricsChoicesByHash`（上限 200 条）+ `rebindLocalLyricsChoices`。**认回要先比 `size`、只有吻合才调 `hash_local_file`**——绝不对整库每个文件哈希 |
| 平台匹配 | `localMediaMatch.ts` | 100 | 本地曲 ↔ 网易云公共匹配层：老版 web 搜索（8 条）+ `@lx/core` `selectLocalMediaMatch` 判定 + `adoptedMatchCandidateId`；**只服务歌词**（2026-10-16 起本地曲封面不再走平台匹配），`fetchNeteaseJson` 带上 Referer |
| 二维码 | `qrCode.ts` | 237 | SVG 二维码生成 |
| 私人 FM 队列 | `personalFmQueue.ts` | 223 | 私人 FM 队列 + dislike → trash |
| 下载 | `downloadService.ts` | 205 | 下载 + ID3 嵌入 + sidecar `.lrc` |
| 预取 | `playback/prefetchService.ts` | 228 | 预取 `[-1,+1,+2]` 随机 `[+1,+2,-1]` → `playerEngine.preload`，10min TTL |
| 源解析 | `playback/playbackResolver.ts` | 330 | 源解析链 + 竞速 + `streamProbe` + `isPreviewStream` |
| 持久化缓存 | `persistentCache.ts` | 312 | 持久化缓存 |
| 封面主色 | `artworkColor.ts` | 189 | 封面主色 → CSS 变量 |
| 网关客户端 | `builtinMusicApiClient.ts` | 187 | gdstudio 网关客户端 |
| 搜索建议 | `search/searchSuggestions.ts` | 246 | 本地历史 + 网易云 suggest |

子目录内其余文件见各自实现。

## 与 stores 的关系

- services 持模块单例状态，或直接读写 Zustand store；**不持有 React 状态**。
- 组件不调用 services 内部规则，仅订阅 store；store 变更由 services 驱动。

## 与 @lx/core 的关系

消费 `@lx/core` 的跨平台能力：`sources`、`lyrics`、`playback-quality`、`stream-integrity`、`webdav-merge`、`outbound-host`、`mobile-api`。

## 与 @lx/tauri-bridge 的关系

`@lx/tauri-bridge` 是**部分** Tauri 命令的类型化包装，**不是唯一 IPC 路径、也不是强制关口**：`desktop/src` 有 45 条直接 `import @tauri-apps/*` 的语句（分布在 35 个文件：`plugin-http` 的静态白名单直连，以及 `plugin-dialog` / `plugin-fs` / `plugin-shell` 等），其中 2 处直接 `invoke`（`services/outboundHttp.ts`、`utils/compression.ts`）。所以「新增 IO 必须走桥」这条规则在代码里并不成立——细节见 `desktop/src/SPEC.md` 与 `desktop/packages/tauri-bridge/SPEC.md`。
