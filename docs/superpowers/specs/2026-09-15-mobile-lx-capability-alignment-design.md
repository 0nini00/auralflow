# AuralFlow 移动端 LX 能力对齐设计

日期：2026-09-15
状态：对照 [souvenp/lx-netease-music-mobile](https://github.com/souvenp/lx-netease-music-mobile) v1.8.85 源码取证后的落地规格，待按工作流实施

## 1. 背景

AuralFlow 移动端与 LX-N 不是同一棵代码树。播放内核（静音占位轨、失败政策、RemoteDuck、切歌竞态令牌、网关竞速）已经按生产环境修过，**禁止用 LX 的空轨 + 事件总线替换**。

需要对齐的是 LX 的产品层能力，接到现有内核旁边：

1. 原生歌词时钟（浮窗自走，不依赖 JS 每行推词）
2. 心动模式（与私人 FM 并存，不是替换）
3. 相似歌 / 关注歌手 / 收藏专辑
4. 听歌阈值入历史（2 分钟或 50%）+ 网易云打点

## 2. 非目标

以下明确不做：

- 替换 `playbackService.ts` 主循环、静音轨、`playbackFailurePolicy`、`RemoteDuck`、`playRequestId`
- 把 `heartbeat` 塞进 `MobilePlayMode` 循环（LX 那样会污染模式键）
- 用 QuickJS 替换 WebView 自定义源
- 引入 RNN、抽屉主导航、桌面小组件、横屏 PlayDetail
- 改 WebDAV schema / 远端根路径
- 桌面端 UI；纯逻辑可进 `@lx/core` 供两端以后共用
- 浮窗逐字卡拉 OK、罗马音解析（AF 歌词模型目前只有 `tr`）
- 把本地「我喜欢」改成网易云红心歌单

## 3. 工作流 A：原生歌词时钟

### 3.1 现状

- 应用内 `LyricView`：RN FlatList，进度算行号。保留。
- 浮窗 `LyricOverlayService`：两个 TextView，**没有时钟**。
- `PlayerBar` 的 MiniLyric effect 在每次 `currentIndex` 变化时 `updateLyricOverlay(current, next)`。App 退到后台后 JS 可能被挂起，浮窗停在最后一行。

### 3.2 方案

原生浮窗持有歌词行数组和播放时钟，JS 只在会话边界同步：

| JS 事件 | 原生动作 |
|---|---|
| 歌词数组变化且归属当前曲 | `setLyrics(lines)` |
| 开播 / 恢复 / seek | `play(positionSeconds)` |
| 暂停 | `pause()` |
| 倍速变化 | `setRate(rate)` 后按新速率重排下一行 |
| 切歌或歌词不归属当前曲 | `clearLyrics()`，回退显示「歌名 - 歌手」 |

**不要**每 0.25s 进度事件都 `play()`。前台最多 5s 校准一次；后台全靠原生时钟。

### 3.3 原生时钟

- 输入：`{ time: number; text: string; tr?: string }[]`（秒）
- `Handler` 按 `(next.time - now) / rate` 调度
- 息屏：停 ticker、冻结当前行；亮屏若仍 `isPlaying`，用 `elapsedRealtime` 补时后继续
- 译文：设置项 `showTranslation`；有 `tr` 时当前行主词、下一行优先译文，否则下一行歌词
- 罗马音：本轮不做
- 无歌词 / 归属失败：保持现有歌名回退，不启时钟

### 3.4 不变量

- `LyricView` 行为不变
- 现有外观（字号、透明度、颜色、字体、锁定、下一行开关）仍走 Preferences
- 浮窗权限撤销路径不变
- 通知栏歌词按钮仍只控制显隐，不改 RNTP 补丁策略

## 4. 工作流 B：心动模式

### 4.1 与私人 FM 的关系

| | 私人 FM | 心动 |
|---|---|---|
| API | `GET /api/radio/get` | `weapi/playmode/intelligence/list` |
| 种子 | 无 | 一首 wy 曲 + 一个 wy 歌单 id |
| 上下文 | `playbackContext.type === "personalFm"` | **新** `type === "heartbeat"` |
| 入口 | 首页 FM 卡 | 「我喜欢」页按钮；未登录禁用 |

两者都是「服务端拉流、JS 队列只是当前批次」，都**不**进入 `list/single/shuffle/sequence` 四模式循环。`playNext` 按 context 分支，与现有 FM 相同套路。

### 4.2 种子规则

AF「我喜欢」是本地收藏，不是网易云红心歌单。心动 API 需要 `playlistId` + `songId`：

1. 必须已登录网易云
2. `playlistId`：`getUserPlaylists` 结果里 `specialType === 5` 的红心歌单；找不到则失败并提示
3. `songId`：当前正在播且 `source === "wy"` 的歌；否则本地收藏里第一首 wy 歌；再没有则禁用按钮

### 4.3 播放

- `startHeartbeat({ seedSong, playlistId })` 拉最多 150 首，写入 `heartbeat` context（batch + buffer），`playFromQueue(0)` 走现有单曲播放内核
- 切歌：复用 FM 的 buffer 消费；buffer 低时用**当前曲**再请求 intelligence/list 续批
- 不喜欢：本轮不做（不要误接到 FM 的 `trashPersonalFmSong`）
- 快照：`playbackSnapshot` 增加 heartbeat 上下文序列化，形状对齐 FM

## 5. 工作流 C：网易云资产页

### 5.1 新增页面

| 路由 | 数据 | 复用 |
|---|---|---|
| `FollowedArtists` | `weapi/artist/sublist` | 点进现有 `ArtistDetail` |
| `SubscribedAlbums` | `weapi/album/sublist` | 点进现有 `AlbumDetail` |
| `SimilarSongs` | `weapi/v1/discovery/simiSong` | `SongList` + `playQueue`（普通 queue 上下文） |

入口：

- 「我的」登录后快捷卡：关注的歌手、收藏的专辑
- 沉浸页更多菜单：相似歌曲（仅 `source === "wy"`）
- 歌手详情关注/取关、专辑详情收藏/取消：本工作流后半段，可与列表页分任务

### 5.2 映射

- 歌手：`{ id, name, picUrl, alias }` → 现有 `SearchArtistResult`
- 专辑：`{ id, name, picUrl, artist }` → 现有 `SearchAlbumResult`
- 相似歌：`mapWyTrackToMusicInfo`

未登录：快捷卡禁用，文案说明需要网易云 Cookie。

## 6. 工作流 D：听歌阈值 + 打点

### 6.1 现状问题

`playSongCore` 在 `play()` 成功后立刻 `addToHistory`。点开即记，和 LX「听了才算」不一致，也会把切歌误触写进历史。

### 6.2 阈值（纯函数，进 `@lx/core`）

```
accumulatedPlayedSeconds >= 120
OR (durationSeconds > 0 AND accumulatedPlayedSeconds >= durationSeconds * 0.5)
```

- 只在 `isPlaying` 且非静音占位轨时累加
- seek 向前：累加真实播放差（与 LX 相同，delta 在 (0, 2s) 才计入，避免拖动进度条刷满）
- 同一播放会话每首歌最多写历史一次、打点一次
- 切歌 / 失败跳过：未达阈值不写

### 6.3 打点

- 仅 `source === "wy"` 且已登录
- `weapi/feedback/weblog`，payload 对齐 LX：`action=play`，`id/sourceId/time/end=playend`
- `sourceId`：当前歌单 id（若有）；否则 `"0"`
- 打点失败只打日志，**不得**回滚已写入的本地历史
- 未登录：只写本地历史，不请求

### 6.4 WebDAV

历史条目仍是 `{ key, song, playedAt }`。阈值只改变**何时插入**，不同步 schema。

## 7. 禁区文件

实施时不得修改下列文件的控制流（工作流 B 的 `playNext` 分支除外，且只能**增加** heartbeat 臂，不得改写 queue / FM / 失败跳过）：

- `apps/mobile/src/player/playbackService.ts`
- `apps/mobile/src/services/playbackFailurePolicy.ts`
- `apps/mobile/src/services/audioInterruptionPolicy.ts`
- `apps/mobile/src/stores/playerStore.ts` 中 `SILENCE_GAP_*`、`playRequestId`、`play()` 双轨入队、PlaybackError 重试
- `apps/mobile/src/services/customSourceRuntime.ts` / WebView 桥
- `apps/mobile/src/services/queueNavigationModel.ts` 的四种队列模式算法

## 8. 验证

- 纯逻辑：`@lx/core` vitest（阈值、歌词行调度、心动续批索引）
- 移动端：`pnpm mobile:typecheck`、`pnpm mobile:lint`
- 手工：见实施计划各工作流 Produces
