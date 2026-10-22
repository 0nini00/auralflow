# services/

业务逻辑层：承载播放引擎、源解析、账号、同步、缓存、下载等核心规则；直接读写 Zustand store，系统级 IO 主要经 `@lx/tauri-bridge` 包装的 Rust 命令（但有 40 条直接 `import @tauri-apps/*` 的语句、分布在 33 个文件，见文末），并消费 `@lx/core` 的跨平台能力。

## 目录结构

```
services/
├── lyrics/   # 歌词（3）：animationIntensity autoScrollModel playbackSync（解析器在 @lx/core 的 lyrics/parser.ts，本地已无 parserCore）
├── playback/ # 播放（13）：builtinNeteaseBackend builtinProviderBackend crossSourceFallbackService customSourceBackend
│             #       immersiveKeyboard playbackResolver playbackSnapshot playbackSnapshotModel
│             #       playModeControl prefetchModel prefetchService streamProbe types
├── search/   # 搜索（5）：含 searchSuggestions（本地历史 + 网易云 suggest）
├── sources/  # 源：wyProvider txProvider（registry 注册；builtin / customSource backend 见 playback/）
└── *.ts      # 31 个顶层服务
```


## 核心服务清单

| 服务 | 文件 | 行数 | 职责 |
| --- | --- | --- | --- |
| 播放引擎 | `playerEngine.ts` | 425 | HTMLAudio + rAF + 500ms 后备 + 余弦淡入淡出（90/140ms，`fadeToken` 取消）+ 外部暂停 `shouldResumeAfterExternalPause` 500ms 保护窗 + 预览检测 `isPreviewDuration` + 预加载 `preloadAudio` |
| 自定义源运行时 | `customSourceRuntime.ts` | 933 | LX 脚本 `new Function` 参数遮蔽（`fakeWindow = Object.create(null)` 无原型；**非安全边界**：可经 constructor 链取回真实 globalThis，静态正则黑名单已移除，真正隔离未实施）+ 宿主全局传 undefined + HTTP 代理 `outboundRequest`（Rust SSRF）+ LRU(8) `key=id::djb2a-hash` + `parseDesktopUserApiInfo` 头部 + `testCustomSourceDeep` 两阶段 init + `musicUrl`（wy 2034742057 林俊杰《江南》 / tx 0039MnYb0qxYhV）20s |
| WebDAV 同步 | `webdavSyncService.ts` | 865 | 同步锁 `withSyncLock` + `lastModified` 冲突 `assertCloudNotStale` + 下载 merge / 上传 overwrite + localStorage 备份 + `/AuralFlow/` 写 / `/LX_Music/` 读回退 |
| 网易账号 | `wyAccountService.ts` | 694 | weapi/eapi 双通道 + QR 登录（type=3 unikey → SVG 二维码 → 轮询 800/801/802/803）+ 歌单 CRUD + 日推/FM + `extractSetCookie`（`Headers.getSetCookie`） |
| 公开发现 | `wyDiscoverService.ts` | 150 | 免登录的 `/api/toplist`、`/api/playlist/list`：榜单清单（内置表打底 + 接口补封面/更新频率，失败返回 `degraded`）、按分类分页、推荐歌单。**不带 Cookie**，`hasMore` 按接口原始条数判断 |
| 歌词 | `lyricsService.ts` | 335 | 按曲：本地曲只解析文件自己的词（内嵌标签 / 同目录旁挂 `.lrc` / 用户手写），没有就返回「本地文件没有歌词」；在线曲走 provider `getLyric`，失败如实报错。**平台匹配 / LRCLIB / 候选挑选 / 来源标注已整体删除**，`localLyrics` 空串表示用户主动清除 |
| 手动编辑 | `manualMediaEditService.ts` | 62 | 本地曲标题/歌手/专辑/歌词的保存：只写库，或按字段逐个写回文件并记录真实成功的部分（`ManualMediaSaveError.appliedPatch`）。原 `manualMediaMatchService` 的「搜候选并取歌词」已删除，配套草稿与请求令牌在 `manualMediaEditModel.ts` |
| 二维码 | `qrCode.ts` | 237 | SVG 二维码生成 |
| 私人 FM 队列 | `personalFmQueue.ts` | 223 | 私人 FM 队列 + dislike → trash |
| 下载 | `downloadService.ts` | 209 | 下载 + ID3 嵌入 + sidecar `.lrc` |
| 预取 | `playback/prefetchService.ts` | 228 | 预取 `[-1,+1,+2]` 随机 `[+1,+2,-1]` → `playerEngine.preload`，10min TTL |
| 源解析 | `playback/playbackResolver.ts` | 413 | 源解析链 + 竞速 + `streamProbe` + `isPreviewStream` |
| 持久化缓存 | `persistentCache.ts` | 319 | 持久化缓存 |
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

`@lx/tauri-bridge` 是**部分** Tauri 命令的类型化包装，**不是唯一 IPC 路径、也不是强制关口**：`desktop/src` 有 40 条直接 `import @tauri-apps/*` 的语句（分布在 33 个文件：`plugin-http` 的静态白名单直连，以及 `plugin-dialog` / `plugin-fs` / `plugin-shell` 等），其中 3 个文件直接 `invoke`（`services/outboundHttp.ts`、`services/autostartService.ts`、`utils/compression.ts`）。所以「新增 IO 必须走桥」这条规则在代码里并不成立——细节见 `desktop/src/SPEC.md` 与 `desktop/packages/tauri-bridge/SPEC.md`。
