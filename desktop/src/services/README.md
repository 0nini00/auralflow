# services/

业务逻辑层：承载播放引擎、源解析、账号、同步、缓存、下载等核心规则；直接读写 Zustand store，所有 IO 经 `@lx/tauri-bridge` 包装 Rust 命令，并消费 `@lx/core` 的跨平台能力。

## 目录结构

```
services/
├── lyrics/   # 歌词（5）：animationIntensity autoScrollModel matchScore parserCore playbackSync
├── playback/ # 播放（12）：builtinNeteaseBackend builtinProviderBackend customSourceBackend
│             #       immersiveKeyboard playbackResolver playbackSnapshot playbackSnapshotModel
│             #       playModeControl prefetchModel prefetchService streamProbe types
├── search/   # 搜索（5）：含 searchSuggestions（本地历史 + 网易云 suggest）
├── sources/  # 源（6）：wyProvider txProvider biliProvider builtin customSource
└── *.ts      # 22 个顶层服务
```

## 核心服务清单

| 服务 | 文件 | 行数 | 职责 |
| --- | --- | --- | --- |
| 播放引擎 | `playerEngine.ts` | 388 | HTMLAudio + rAF + 500ms 后备 + 余弦淡入淡出（90/140ms，`fadeToken` 取消）+ 外部暂停 `shouldResumeAfterExternalPause` 500ms 保护窗 + 预览检测 `isPreviewDuration` + 预加载 `preloadAudio` |
| 自定义源运行时 | `customSourceRuntime.ts` | 776 | LX 脚本 `new Function` 沙箱（`fakeWindow = Object.create(null)` 无原型）+ 静态正则拒 `constructor.constructor/eval/Function` + 宿主全局传 undefined 阻 `__TAURI_INTERNALS__` + HTTP 代理 `outboundRequest`（Rust SSRF）+ LRU(8) `key=id::djb2a-hash` + `parseDesktopUserApiInfo` 头部 + `testCustomSourceDeep` 两阶段 init + `musicUrl`（wy 2034742057 林俊杰《江南》 / tx 0039MnYb0qxYhV）20s |
| WebDAV 同步 | `webdavSyncService.ts` | 629 | 同步锁 `withSyncLock` + `lastModified` 冲突 `assertCloudNotStale` + 下载 merge / 上传 overwrite + localStorage 备份 + `/AuralFlow/` 写 / `/LX_Music/` 读回退 |
| 网易账号 | `wyAccountService.ts` | 601 | weapi/eapi 双通道 + QR 登录（type=3 unikey → SVG 二维码 → 轮询 800/801/802/803）+ 歌单 CRUD + 日推/FM + `extractSetCookie`（`Headers.getSetCookie`） |
| B 站账号 | `biliAccountService.ts` | 362 | WBI 签名 + 收藏夹 + DASH 音频 |
| 歌词 | `lyricsService.ts` | 345 | 多源嵌入式 → provider `getLyric` → 搜索匹配 + `scoreLyricContentQuality` + 翻译合并 |
| 二维码 | `qrCode.ts` | 237 | SVG 二维码生成 |
| 私人 FM 队列 | `personalFmQueue.ts` | 223 | 私人 FM 队列 + dislike → trash |
| 下载 | `downloadService.ts` | 177 | 下载 + ID3 嵌入 + sidecar `.lrc` |
| 预取 | `prefetchService.ts` | 210 | 预取 `[-1,+1,+2]` 随机 `[+1,+2,-1]` → `playerEngine.preload`，10min TTL |
| 源解析 | `playback/playbackResolver.ts` | 209 | 源解析链 + 竞速 + `streamProbe` + `isPreviewStream` |
| 持久化缓存 | `persistentCache.ts` | 290 | 持久化缓存 |
| 封面主色 | `artworkColor.ts` | 164 | 封面主色 → CSS 变量 |
| 网关客户端 | `builtinMusicApiClient.ts` | 187 | gdstudio 网关客户端 |
| 搜索建议 | `search/searchSuggestions.ts` | 246 | 本地历史 + 网易云 suggest |

子目录内其余文件见各自实现。

## 与 stores 的关系

- services 持模块单例状态，或直接读写 Zustand store；**不持有 React 状态**。
- 组件不调用 services 内部规则，仅订阅 store；store 变更由 services 驱动。

## 与 @lx/core 的关系

消费 `@lx/core` 的跨平台能力：`sources`、`lyrics`、`playback-quality`、`stream-integrity`、`webdav-merge`、`outbound-host`、`mobile-api`。

## 与 @lx/tauri-bridge 的关系

所有文件系统、网络、窗口、通知等 IO 均经 `@lx/tauri-bridge` 的全类型 `invoke` 包装转发至 Rust 命令；services 不直接调用 Tauri 原生 API。
