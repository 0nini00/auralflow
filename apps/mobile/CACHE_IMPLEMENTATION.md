# 缓存实现

移动端缓存围绕「切歌秒开 + 离线可播 + 流量节省」设计，分三层 + URL 缓存 + 预取 + 预览检测 + 播放快照，核心逻辑在 `src/services/cacheService.ts`、`playbackUrlCache.ts`、`streamProbe.ts`、`playbackSnapshot.ts` 与 `stores/playerStore.ts` / `services/playerService.ts`。

## 三层架构

| 层级 | 介质 | 容量 / TTL | 内容 | 驱逐 |
| --- | --- | --- | --- | --- |
| 内存预取 | 进程内 Map | 10min TTL | 下一首已解析的播放 URL / 歌词 / 封面 | TTL 过期 |
| 磁盘音频文件 | RNFS 文件系统 | LRU 100MB，immutable | 音频文件、封面、歌词 | LRU（mtime 最旧优先） |
| AsyncStorage URL 缓存 | AsyncStorage | 500 条；wy 6h / tx 30min / bili 1yr | 歌曲 → 播放 URL 映射 | 条数上限 + 源差异 TTL |

### 磁盘目录

```text
{RNFS.CachesDirectoryPath}/auralflow/
├── covers/      # 封面（MD5 命名）
├── lyrics/      # 歌词 JSON
└── audio/       # 音频文件
```

> 注：音频文件按 `DocumentDirectoryPath/auralflow/audio/` 维护（下载入库），缓存文件目录走 `CachesDirectoryPath`，两者均 immutable + LRU。

## URL 缓存（playbackUrlCache）

`src/services/playbackUrlCache.ts`，把「歌曲 + 音质 → 播放 URL」持久化到 AsyncStorage，避免重复解析。

- **容量**：`MAX_PLAYBACK_URL_ENTRIES = 500`，超出按最旧条目淘汰。
- **源差异 TTL**：
  - `PLAYBACK_URL_TTL_MS = 6h`（网易云 wy）
  - `BILI_PLAYBACK_URL_TTL_MS = 30min`（B站，URL 易变）
  - `LOCAL_PLAYBACK_CACHE_TTL_MS = 1yr`（本地文件，几乎永不过期）
- **写入**：`saveCachedPlaybackUrl` 通过 `writeQueue` **串行化写入**，避免并发写竞争 AsyncStorage。
- **读取 probe-on-read**：命中缓存 URL 后并不直接信任，读取时会做探活（probe-on-read），死链 / 失效条目用 `invalidateCachedPlaybackUrl(song, quality)` 清除。
- **失效**：`invalidateCachedPlaybackUrl(song)` 删除指定歌曲 / 音质条目；切音质、试听片段判定、播放失败等路径都会调用它。

## 磁盘缓存（cacheService）

`src/services/cacheService.ts`：

- **immutable 语义**：封面 / 音频「URL 不变永不过期」（对齐 lx 的 FastImage immutable 缓存），只受容量上限约束，避免定期失效反复重新下载。歌词例外：内容可能随版权 / 修词更新，保留 `MAX_CACHE_AGE = 30天` 过期。
- **LRU 驱逐**：`cacheEvictionModel.selectFilesToEvict` + `enforceCacheSizeLimit`，总大小超过 `MAX_CACHE_SIZE = 100MB` 时按 `mtime` 最旧优先删除，直到低于上限；写入文件后去抖触发。
- **命名**：封面 / 音频按 URL 的 MD5 哈希命名；歌词按 `{source}-{id}.json`。
- **缓存命中**：`isCacheValid` 仅对歌词做过期校验，封面 / 音频只判存在性。
- **写入中断清理**：下载中断（网络错误）留下的部分文件会被清理，避免下次被误判为有效 immutable 缓存。

## 内存预取（prefetchSong）

`services/playerService.ts`：

- `PREFETCH_TTL_MS = 10 * 60 * 1000`（10min）：内存预取条目 10 分钟内有效。
- `prefetchSong(song)` 预解析单首歌曲的播放 URL + 歌词 + 封面（各自幂等，已命中则跳过），只解析并缓存 URL，**不写入 TrackPlayer 原生队列**——原生队列始终保持单曲，切歌由 JS 调度。
- 与 `playerStore.playNextInQueue` 集成：「下一首播放 / 稍后播放」插入队列时立即调用 `prefetchSong` 预热，播到该曲时命中缓存秒开。
- `invalidatePrefetchForSong(song)` 清除指定歌曲的预取条目（试听片段、切歌抢占、URL 失效时调用）。

## 封面缓存（CachedImage）

`components/CachedImage.tsx`，对齐 lx 的双层缓存：

- **底层**：`@d11/react-native-fast-image`（Glide 原生）`cache: FastImage.cacheControl.immutable` + `transition: FastImage.transition.fade`，提供原生内存 + 磁盘双层缓存，列表滚动重复渲染零异步开销。
- **缩略图**：`resizeCoverUrl(uri, size)`（来自 `@lx/core`，`COVER_SIZE_THUMB`）按显示尺寸请求缩略图，省流量。
- **B站防盗链 Referer-bypass**：B站图片有防盗链限制，FastImage 直接加载远程 URL 会携带 Referer 导致 403，必须先用 `RNFS.downloadFile` 下载到本地（不带 Referer）再以 `file://` 显示。
- **2 重试 URL 变异**：远端加载失败时自动重试（重试会改 URL 强制 FastImage 重新请求，避免复用失败结果），重试后仍失败则回退到已下载的本地缓存文件。
- **请求头**：仅对远端 URL 带浏览器 UA（部分图床 403 防护）；本地 `file://` 不带 headers，避免 Glide 按 key 混缓存。
- **UI 集成**：`SongList` / `MiniPlayer` / `PlayerScreen` / 沉浸页封面均使用 `CachedImage`。

## 歌词缓存

- **30 天 TTL**：歌词内容可能随版权 / 修词更新，`MAX_CACHE_AGE = 30天`，命中时若过期则可能更新（may update）。
- **持久化**：JSON 格式存盘，文件名 `{source}-{id}.json`。
- **下载 sidecar .lrc**：下载歌曲时 `downloadService` 把歌词格式化为 `.lrc`，写到音频文件旁挂（`sidecarLrcPath`：替换扩展名为 `.lrc`），与嵌入 ID3 的歌词共用同一次网络拉取，避免重复请求。

## 预览检测

试听片段（30s 预览）与完整版同样返回 200/206，单纯状态码无法区分。两层检测：

### 1. 死链探测（streamProbe）

`src/services/streamProbe.ts`：竞速胜出 URL 探活，发 **1 字节 Range 请求**（`Range: bytes=0-0`）验证服务器真的能出数据。

- **死代理**：LX 音源代理等黑盒服务器 TCP 握手成功后不返回任何字节，ExoPlayer 会卡住；1 字节 Range 在 **5s 内无响应即判死**（探活超时 `PROBE_TIMEOUT`）。
- **Content-Range 解析**：用 `parseContentRangeTotal`（`@lx/core`）从响应头 `content-range` 读出真实总长度，供试听判定。

### 2. 试听时长比对（isPreviewDuration）

`stores/playerStore.ts`：TrackPlayer 报告 `duration` 后，调 `isPreviewDuration({ actualDurationSeconds: duration, expectedDurationSeconds: song.interval })`（`@lx/core`）比对实际与预期时长：

- 判定为试听片段 → **暂停播放** + `invalidateCachedPlaybackUrl(song)` + `invalidatePrefetchForSong(song)`，清掉无效 URL 与预取，触发重新解析 / 降级到下一可用音源。
- 同样在播放失败 / 切歌抢占路径里做失效清理。

## 播放快照（initPlaybackSnapshotPersistence）

`src/services/playbackSnapshot.ts`：后台播放状态持久化与启动恢复。

- **启动恢复**：`loadPlaybackSnapshot` 从 AsyncStorage 读出快照，写回 `playerStore`（`currentSong` / `queue` / `currentIndex` / `shuffleHistory` / `position` / `duration` / `playMode` / `playbackRate` / `volume` 等）。
- **不 autoplay**：恢复只写 store 状态，**不自动播放**，需用户手动点播放（避免重启后突然出声）。
- **先渲染**：恢复时先把 `currentSong` 写入 store，使 `PlayerBar` / 迷你播放器在用户进入应用瞬间就有内容可渲染（封面 / 歌名 / 歌手），再在后台异步解析 URL，体验顺滑。
- **订阅保存**：`initPlaybackSnapshotPersistence()` 启动时恢复一次，随后订阅 store 变化 debounce 保存到磁盘。恢复完成后再挂订阅，避免恢复期间其它启动写入（如音量恢复）触发 debounce 保存，把尚未恢复的默认状态覆盖到磁盘快照上。
- **私人 FM 退化**：personalFm 上下文的缓冲无法离线恢复，快照恢复时退化为 queue 上下文。

## 核心文件

```text
apps/mobile/src/
├── services/
│   ├── cacheService.ts            # 三层缓存核心（封面 / 歌词 / 音频，LRU，immutable）
│   ├── cacheEvictionModel.ts      # LRU 驱逐策略（mtime 最旧优先）
│   ├── playbackUrlCache.ts       # URL 缓存（writeQueue 串行化、probe-on-read、源差异 TTL）
│   ├── playbackPrefetchModel.ts  # 预取 key 构造 / 命中判定
│   ├── streamProbe.ts            # 1 字节 Range 死链 / 试听探测（5s 超时）
│   ├── playbackSnapshot.ts       # 播放快照持久化与启动恢复（initPlaybackSnapshotPersistence）
│   ├── playerService.ts          # prefetchSong / invalidatePrefetchForSong / 播放解析
│   └── downloadService.ts        # 下载 + sidecar .lrc + ID3 嵌标签
├── stores/
│   └── playerStore.ts            # isPreviewDuration 试听判定 + 失效清理（1004 行）
└── components/
    └── CachedImage.tsx            # FastImage immutable + Glide + B站 Referer-bypass + 2 重试
```
