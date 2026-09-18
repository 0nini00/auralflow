# AuralFlow 移动端 LX 能力对齐实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `subagent-driven-development`（推荐）或 `executing-plans` 按任务执行；每完成一个任务先复核其 Produces 契约，再开始下一任务。所有步骤使用 checkbox 跟踪。

**Goal:** 在 `apps/mobile` 内接入 LX-N 的四项产品层能力（原生歌词时钟、心动模式、网易云资产页、听歌阈值 + 打点），不触碰播放内核（静音轨、失败政策、Duck、竞态令牌、网关竞速）。

**Architecture:** 纯逻辑进 `@lx/core` 用 vitest 锁行为；原生歌词时钟在 `LyricOverlayService` 内自走；心动模式作为新的 `PlaybackContext` 分支与私人 FM 并存；网易云资产页复用现有 `ArtistDetail` / `AlbumDetail` / `SongList`；听歌阈值替换 `playSongCore` 内的即时 `addToHistory`，打点失败不回滚本地历史。

**Tech Stack:** React Native 0.86、React 19、TypeScript 5.8、Zustand 5、Vitest 2、Android Java、Gradle 9。

## Global Constraints

- 不修改 `playbackService.ts` 主循环、`SILENCE_GAP_*`、`playRequestId`、`play()` 双轨入队、PlaybackError 重试。
- 不修改 `playbackFailurePolicy.ts`、`audioInterruptionPolicy.ts`、`queueNavigationModel.ts` 四模式算法。
- 不修改 `customSourceRuntime.ts` / WebView 桥 / WebDAV schema / 远端根路径。
- 不把 `heartbeat` 塞进 `MobilePlayMode` 循环；它是 `PlaybackContext` 分支，和 `personalFm` 并列。
- 不用 LX 的空轨 + 事件总线替换 AF 的静音轨模型。
- Android 最低版本保持 24，目标版本保持 36。
- 不增加静默回退、空 catch 或伪成功路径。
- 当前共享工作树包含用户未提交改动；实施阶段不创建包含既有改动的 Git commit，每项用定向测试与文件级 diff checkpoint 代替提交。
- 代码、注释、日志和文档不使用 Emoji。
- 不新增 RNN、抽屉主导航、桌面小组件、横屏 PlayDetail。
- 浮窗逐字卡拉 OK、罗马音解析本轮不做（AF 歌词模型只有 `tr`）。

## 关联规格

- `docs/superpowers/specs/2026-09-15-mobile-lx-capability-alignment-design.md`

---

## 工作流 A：原生歌词时钟

### Task A1：@lx/core 歌词行调度纯模型

**Files:**
- Create: `packages/core/src/lyrics/overlay-clock.ts`
- Create: `packages/core/src/lyrics/overlay-clock.test.ts`
- Modify: `packages/core/src/lyrics/index.ts`

**Interfaces:**
- Produces: `scheduleOverlayTick(lines, position, rate, options): { nextDelayMs; nextLineIndex }`
- Produces: `shouldCalibrateClock(elapsedSinceLastSync, isForeground): boolean`

- [ ] **Step 1: Write failing tests for overlay-clock**

```ts
describe("scheduleOverlayTick", () => {
  const lines = [
    { time: 0, text: "intro" },
    { time: 5, text: "line 1" },
    { time: 10, text: "line 2" },
  ];
  it("position 0 时定位第 0 行，下个行在 5s 后", () => {
    const result = scheduleOverlayTick(lines, 0, 1);
    expect(result.nextLineIndex).toBe(0);
    expect(result.nextDelayMs).toBe(5000);
  });
  it("position 6.5 时定位第 1 行，下个行在 3.5s 后", () => {
    const result = scheduleOverlayTick(lines, 6.5, 1);
    expect(result.nextLineIndex).toBe(1);
    expect(result.nextDelayMs).toBeCloseTo(3500, -1);
  });
  it("rate=2 时延迟减半", () => {
    const result = scheduleOverlayTick(lines, 6.5, 2);
    expect(result.nextDelayMs).toBeCloseTo(1750, -1);
  });
  it("已到末行时返回 null delay", () => {
    const result = scheduleOverlayTick(lines, 100, 1);
    expect(result.nextLineIndex).toBe(2);
    expect(result.nextDelayMs).toBe(null);
  });
  it("空歌词返回 -1 行", () => {
    const result = scheduleOverlayTick([], 0, 1);
    expect(result.nextLineIndex).toBe(-1);
    expect(result.nextDelayMs).toBe(null);
  });
});

describe("shouldCalibrateClock", () => {
  it("前台超过 5s 需要校准", () => {
    expect(shouldCalibrateClock(6000, true)).toBe(true);
  });
  it("前台不足 5s 不需要", () => {
    expect(shouldCalibrateClock(3000, true)).toBe(false);
  });
  it("后台不需要校准（时钟自走）", () => {
    expect(shouldCalibrateClock(999999, false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/core && pnpm vitest run src/lyrics/overlay-clock.test.ts
```

- [ ] **Step 3: Implement overlay-clock**

实现 `scheduleOverlayTick`：用 `findCurrentLyricLineIndex` 定位当前行，取下一行的 `(next.time - position) / rate * 1000` 作为延迟；末行返回 null。`shouldCalibrateClock`：前台 5s 阈值。

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/core && pnpm vitest run src/lyrics/overlay-clock.test.ts
```

- [ ] **Step 5: Export from lyrics/index.ts**

```ts
export * from "./overlay-clock";
```

- [ ] **Step 6: Typecheck @lx/core**

```bash
cd packages/core && pnpm typecheck
```

---

### Task A2：LyricOverlayModule 增加时钟桥接口

**Files:**
- Modify: `apps/mobile/android/app/src/main/java/cn/chenle/auralflow/mobile/LyricOverlayModule.java`
- Modify: `apps/mobile/src/services/lyricOverlayService.ts`

**Interfaces:**
- Produces (native): `setLyrics(JSONString)` / `playLyricClock(positionSec)` / `pauseLyricClock()` / `setLyricClockRate(rate)` / `clearLyrics()`
- Produces (TS bridge): `setLyricOverlayLyrics(lines: LyricLine[])` / `playLyricOverlayClock(position: number)` / `pauseLyricOverlayClock()` / `setLyricOverlayClockRate(rate: number)` / `clearLyricOverlayLyrics()`

- [ ] **Step 1: 在 LyricOverlayModule 增加 setLyrics / play / pause / setRate / clear ReactMethod**

`setLyrics` 接收 JSON 字符串，解析为 `{ time, text, tr }[]`，存入 `LyricOverlayService`。`playLyricClock` 启动 Service ticker。`pauseLyricClock` 停 ticker。`setLyricClockRate` 更新速率。`clearLyrics` 清空并回退歌名。

- [ ] **Step 2: 在 LyricOverlayService 增加时钟 Handler**

Handler 接收 `scheduleOverlayTick` 的延迟，到点后更新 currentText/nextText 并 `renderState()`，然后排下下一行。息屏（`ACTION_SCREEN_OFF`）停 ticker；亮屏且 isPlaying 时用 `elapsedRealtime` 补时后继续。

- [ ] **Step 3: TS 桥接口扩展**

在 `lyricOverlayService.ts` 的 `NativeLyricOverlayModule` 增加 5 个方法，每个封装 `getNativeModule().xxx()`，JSON 序列化在 TS 侧完成。

- [ ] **Step 4: 手工验证编译**

```bash
cd apps/mobile && pnpm mobile:typecheck
```

- [ ] **Step 5: 手工验证 Android 编译**

```bash
cd apps/mobile/android && ./gradlew assembleDebug
```

---

### Task A3：替换 PlayerBar 浮窗推词为会话边界同步

**Files:**
- Modify: `apps/mobile/src/components/PlayerBar.tsx`（MiniLyric status effect）
- Modify: `apps/mobile/src/screens/immersive/useImmersiveController.ts`
- Modify: `apps/mobile/src/stores/lyricOverlayStore.ts`

**Interfaces:**
- Produces: 浮窗从「每行推词」改为「歌词数组变化时 setLyrics + play(position)，进度事件只在前台 5s 校准」

- [ ] **Step 1: 在 MiniLyric effect 内替换 updateLyricOverlay 为会话同步**

歌词数组变化且归属当前曲时调 `setLyricOverlayLyrics(lines)` + `playLyricOverlayClock(position)`。切歌 / 归属失败时 `clearLyricOverlayLyrics()`。

- [ ] **Step 2: 进度事件只做前台 5s 校准**

在 `useImmersiveController` 的进度回调里，`shouldCalibrateClock(elapsed, isForeground)` 为 true 时调 `playLyricOverlayClock(position)`，否则跳过。

- [ ] **Step 3: 暂停 / 倍速 / seek 同步**

`useImmersiveController` 的 onPause / onSeek / 倍速变化回调里分别调 `pauseLyricOverlayClock()` / `playLyricOverlayClock(position)` / `setLyricOverlayClockRate(rate)`。

- [ ] **Step 4: Typecheck**

```bash
cd apps/mobile && pnpm mobile:typecheck
```

- [ ] **Step 5: 手工验证**

打开浮窗 → 播放 → 切后台 30s → 回前台：浮窗应已自走到当前行，不卡在离开时的行。倍速 2x → 浮窗行切换速度同步翻倍。暂停 → 浮窗停在当前行不跳。

---

## 工作流 B：心动模式

### Task B1：@lx/core 心动续批索引纯模型

**Files:**
- Create: `packages/core/src/recommendations/heartbeat-queue.ts`
- Create: `packages/core/src/recommendations/heartbeat-queue.test.ts`
- Create: `packages/core/src/recommendations/index.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `buildHeartbeatBatchState(currentBatch, buffer, hasMore): HeartbeatBatchState`
- Produces: `shouldRefillHeartbeat(bufferLength, threshold): boolean`

- [ ] **Step 1: Write failing tests**

```ts
describe("buildHeartbeatBatchState", () => {
  it("batch + buffer 合并，index 0", () => {
    const state = buildHeartbeatBatchState([s1], [s2, s3], true);
    expect(state.batch).toEqual([s1, s2, s3]);
    expect(state.batchIndex).toBe(0);
  });
  it("buffer 空且 hasMore=false 标记结束", () => {
    const state = buildHeartbeatBatchState([s1], [], false);
    expect(state.hasMore).toBe(false);
  });
});

describe("shouldRefillHeartbeat", () => {
  it("buffer 低于 5 触发续批", () => {
    expect(shouldRefillHeartbeat(4, 5)).toBe(true);
  });
  it("buffer 等于阈值不触发", () => {
    expect(shouldRefillHeartbeat(5, 5)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/core && pnpm vitest run src/recommendations/heartbeat-queue.test.ts
```

- [ ] **Step 3: Implement**

`buildHeartbeatBatchState`：合并 batch + buffer，batchIndex = 0。`shouldRefillHeartbeat`：`bufferLength < threshold`。

- [ ] **Step 4: Run tests to confirm they pass**

- [ ] **Step 5: Export from index.ts**

```ts
export * from "./recommendations";
```

- [ ] **Step 6: Typecheck @lx/core**

---

### Task B2：wyPlaylistService 增加心动 API

**Files:**
- Modify: `apps/mobile/src/services/wyPlaylistService.ts`

**Interfaces:**
- Produces: `getHeartbeatModeList(seedSongId: string, playlistId: string): Promise<MusicInfo[]>`
- Produces: `findWyLikedPlaylistId(playlists: WyPlaylistInfo[]): string | null`

- [ ] **Step 1: 实现 findWyLikedPlaylistId**

从 `getUserPlaylists` 结果中找 `specialType === 5` 或 `name === "我喜欢的音乐"` 的歌单 id。找不到返回 null。

- [ ] **Step 2: 实现 getHeartbeatModeList**

调 `weapi/playmode/intelligence/list`，payload 对齐 LX：
```json
{ "playlistId": "xxx", "songId": "xxx", "type": "fromPlayOne", "startMusicId": "xxx", "count": "150" }
```
返回的 `body.data` 逐条 `mapWyTrackToMusicInfo`。

- [ ] **Step 3: Typecheck**

```bash
cd apps/mobile && pnpm mobile:typecheck
```

---

### Task B3：playerStore 增加 heartbeat PlaybackContext

**Files:**
- Modify: `apps/mobile/src/stores/playerStore.ts`
- Modify: `apps/mobile/src/services/playbackSnapshot.ts`

**Interfaces:**
- Produces: `HeartbeatContext` type
- Produces: `setHeartbeatContext(args)` / `setHeartbeatBatchIndex(index)` store actions

- [ ] **Step 1: 扩展 PlaybackContext 类型**

```ts
export interface HeartbeatContext {
  type: "heartbeat";
  seedSongId: string;
  playlistId: string;
  buffer: MusicInfo[];
  currentBatch: MusicInfo[];
  currentBatchIndex: number;
  hasMore: boolean;
}
export type PlaybackContext = { type: "queue" } | PersonalFmContext | HeartbeatContext;
```

- [ ] **Step 2: 增加 setHeartbeatContext / setHeartbeatBatchIndex**

形状对齐 `setPersonalFmContext` / `setPersonalFmBatchIndex`。

- [ ] **Step 3: playbackSnapshot 支持 heartbeat 序列化**

`buildSnapshot` 直接序列化 heartbeat context。`loadPlaybackSnapshot` 只恢复 `queue` 类型（和 FM 一样，buffer 无法离线恢复）。

- [ ] **Step 4: Typecheck**

---

### Task B4：playerService 心动播放 + 续批

**Files:**
- Modify: `apps/mobile/src/services/playerService.ts`

**Interfaces:**
- Produces: `startHeartbeat(seedSong: MusicInfo, playlistId: string): Promise<MusicInfo[]>`
- Produces: `playNextHeartbeatSong(): Promise<void>`

- [ ] **Step 1: 实现 startHeartbeat**

调 `getHeartbeatModeList(seedSong.id, playlistId)`，写入 `setHeartbeatContext`，`playSongCore(seedSong)`。

- [ ] **Step 2: 在 playNext 增加 heartbeat 分支**

`playNext` 内，`playbackContext.type === "heartbeat"` 时走 `playNextHeartbeatSong`，逻辑对齐 `playNextPersonalFmSong`：batch 内前进，buffer 低时用**当前曲**调 `getHeartbeatModeList` 续批。

- [ ] **Step 3: playbackService 曲末推进兼容 heartbeat**

`advanceAfterTrackFinished` 内，`playbackContext.type === "heartbeat"` 和 `"personalFm"` 走同一路径（已有 `if (queue.length > 0 || playbackContext.type === "personalFm")` 判断，改为 `|| playbackContext.type === "personalFm" || playbackContext.type === "heartbeat"`）。

- [ ] **Step 4: Typecheck**

- [ ] **Step 5: 手工验证**

「我喜欢」页 → 登录网易云 → 找到红心歌单 → 点「心动模式」→ 拉到 150 首并播放第一首 → 下一首前进到 batch[1] → 退后台 30s → 回前台自动切到下一首（静音轨保活）。

---

### Task B5：「我喜欢」页心动入口

**Files:**
- Modify: `apps/mobile/src/screens/LikedSongsScreen.tsx`
- Modify: `apps/mobile/src/components/PlaybackActionButtons.tsx`（可选）

- [ ] **Step 1: 在 LikedSongsScreen 头部增加「心动模式」按钮**

条件：`isLoggedIn && favorites 中至少一首 wy 歌`。点击调 `findWyLikedPlaylistId` → `startHeartbeat(seedSong, playlistId)`。失败提示「找不到网易云红心歌单」。

- [ ] **Step 2: Typecheck + 手工验证**

---

## 工作流 C：网易云资产页

### Task C1：wyPlaylistService / musicApi 增加资产 API

**Files:**
- Modify: `apps/mobile/src/services/wyPlaylistService.ts`（或新建 `wyAssetService.ts`）

**Interfaces:**
- Produces: `getFollowedArtists(): Promise<SearchArtistResult[]>`
- Produces: `getSubscribedAlbums(): Promise<SearchAlbumResult[]>`
- Produces: `getSimilarSongs(songId: string): Promise<MusicInfo[]>`

- [ ] **Step 1: 实现三个 API**

`weapi/artist/sublist` → `SearchArtistResult[]`（复用 musicApi 里的映射）
`weapi/album/sublist` → `SearchAlbumResult[]`
`weapi/v1/discovery/simiSong` → `MusicInfo[]`（`mapWyTrackToMusicInfo`）

均需 cookie，未登录抛错。

- [ ] **Step 2: Typecheck**

---

### Task C2：导航路由 + 页面

**Files:**
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`
- Modify: `apps/mobile/src/navigation/navigationRef.ts`
- Create: `apps/mobile/src/screens/FollowedArtistsScreen.tsx`
- Create: `apps/mobile/src/screens/SubscribedAlbumsScreen.tsx`
- Create: `apps/mobile/src/screens/SimilarSongsScreen.tsx`

- [ ] **Step 1: 在 RootStackParamList 增加三个路由**

```ts
FollowedArtists: undefined;
SubscribedAlbums: undefined;
SimilarSongs: { songId: string; songName: string };
```

- [ ] **Step 2: 在 navigationRef 增加三个 open 函数**

- [ ] **Step 3: 创建三个 Screen**

FollowedArtists / SubscribedAlbums：FlatList，点进复用 `openArtistDetailScreen` / `openAlbumDetailScreen`。
SimilarSongs：`SongList` + `playQueue`（普通 queue 上下文，不走心动）。

- [ ] **Step 4: 在 RootNavigator 注册三个 Stack.Screen**

- [ ] **Step 5: Typecheck + 手工验证**

---

### Task C3：入口接线

**Files:**
- Modify: `apps/mobile/src/screens/MyMusicScreen.tsx`
- Modify: `apps/mobile/src/screens/immersive/ImmersiveMoreMenu.tsx`
- Modify: `apps/mobile/src/screens/immersive/useImmersiveController.ts`

- [ ] **Step 1: MyMusicScreen 增加「关注的歌手」「收藏的专辑」快捷卡**

登录后显示，未登录禁用并提示。点击调 `openFollowedArtistsScreen` / `openSubscribedAlbumsScreen`。

- [ ] **Step 2: ImmersiveMoreMenu 增加「相似歌曲」项**

仅 `currentSong.source === "wy"` 时显示。点击调 `openSimilarSongsScreen({ songId, songName })`。

- [ ] **Step 3: Typecheck + 手工验证**

---

## 工作流 D：听歌阈值 + 打点

### Task D1：@lx/core 听歌阈值纯模型

**Files:**
- Create: `packages/core/src/history/listen-threshold.ts`
- Create: `packages/core/src/history/listen-threshold.test.ts`
- Create: `packages/core/src/history/index.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `createListenTracker(song, options): ListenTracker`
- Produces: `ListenTracker.accumulate(deltaSeconds, isPlaying): void`
- Produces: `ListenTracker.shouldRecord(): boolean`
- Produces: `ListenTracker.reset(): void`

- [ ] **Step 1: Write failing tests**

```ts
describe("ListenTracker", () => {
  it("播满 120s 触发", () => {
    const t = createListenTracker({ durationSeconds: 300 });
    for (let i = 0; i < 120; i++) t.accumulate(1, true);
    expect(t.shouldRecord()).toBe(true);
  });
  it("播满 50% 触发（300s 曲播 150s）", () => {
    const t = createListenTracker({ durationSeconds: 300 });
    for (let i = 0; i < 150; i++) t.accumulate(1, true);
    expect(t.shouldRecord()).toBe(true);
  });
  it("只播 60s 不触发", () => {
    const t = createListenTracker({ durationSeconds: 300 });
    for (let i = 0; i < 60; i++) t.accumulate(1, true);
    expect(t.shouldRecord()).toBe(false);
  });
  it("暂停不累加", () => {
    const t = createListenTracker({ durationSeconds: 300 });
    t.accumulate(100, false);
    expect(t.shouldRecord()).toBe(false);
  });
  it("seek 前进 delta>2s 不累加（防拖进度条刷满）", () => {
    const t = createListenTracker({ durationSeconds: 300 });
    t.accumulate(200, true);
    expect(t.shouldRecord()).toBe(false);
  });
  it("reset 后重新计数", () => {
    const t = createListenTracker({ durationSeconds: 300 });
    for (let i = 0; i < 150; i++) t.accumulate(1, true);
    t.reset();
    expect(t.shouldRecord()).toBe(false);
  });
  it("每首最多触发一次", () => {
    const t = createListenTracker({ durationSeconds: 300 });
    for (let i = 0; i < 150; i++) t.accumulate(1, true);
    expect(t.shouldRecord()).toBe(true);
    t.accumulate(100, true);
    expect(t.shouldRecord()).toBe(true); // 仍 true，不重复
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

- [ ] **Step 3: Implement**

```ts
export interface ListenTracker {
  accumulate(deltaSeconds: number, isPlaying: boolean): void;
  shouldRecord(): boolean;
  reset(): void;
}
export function createListenTracker(options: { durationSeconds: number; minSeconds?: number; ratio?: number }): ListenTracker {
  const min = options.minSeconds ?? 120;
  const ratio = options.ratio ?? 0.5;
  let accumulated = 0;
  let recorded = false;
  return {
    accumulate(delta, isPlaying) {
      if (!isPlaying) return;
      if (delta <= 0 || delta >= 2) return; // 连续播放才计，对齐 LX
      accumulated += delta;
    },
    shouldRecord() {
      if (recorded) return true;
      if (accumulated >= min || (options.durationSeconds > 0 && accumulated >= options.durationSeconds * ratio)) {
        recorded = true;
        return true;
      }
      return false;
    },
    reset() { accumulated = 0; recorded = false; },
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

- [ ] **Step 5: Export from index.ts**

- [ ] **Step 6: Typecheck @lx/core**

---

### Task D2：wyScrobbleService

**Files:**
- Create: `apps/mobile/src/services/wyScrobbleService.ts`

**Interfaces:**
- Produces: `scrobbleWySong(songId: string, sourceId: string, duration: number): Promise<void>`

- [ ] **Step 1: 实现 scrobbleWySong**

调 `weapi/feedback/weblog`，payload 对齐 LX：
```json
{ "logs": "[{\"action\":\"play\",\"json\":{\"id\":songId,\"download\":0,\"type\":\"song\",\"sourceId\":\"xxx\",\"time\":150,\"end\":\"playend\",\"wifi\":0}}]" }
```
失败只 `console.warn`，不抛错。

- [ ] **Step 2: Typecheck**

---

### Task D3：playSongCore 替换即时入历史

**Files:**
- Modify: `apps/mobile/src/services/playerService.ts`
- Modify: `apps/mobile/src/stores/playerStore.ts`（进度事件入口）

- [ ] **Step 1: 在 playSongCore 移除即时 addToHistory**

删除 `await addToHistory(song)` 这行。改为在播放成功后创建 `ListenTracker` 存入模块级 `Map<songKey, ListenTracker>`。

- [ ] **Step 2: 在进度事件回调里 accumulate + check**

`setupPlayerListeners` 的 `PlaybackProgressUpdated` 内，跳过静音占位轨，取 `delta = position - lastPosition`（模块级 `lastPositionMap`），调 `tracker.accumulate(delta, isPlaying)`。`tracker.shouldRecord()` 为 true 时调 `addToHistory(song)` + `scrobbleWySong`（仅 wy），然后 `tracker.reset()`。

- [ ] **Step 3: 切歌 / 失败跳过时 reset tracker**

`playSongCore` 开头、`playNext` / `playPrevious` 切歌时、`playbackService` 失败跳过时，清掉旧曲的 tracker。

- [ ] **Step 4: Typecheck**

- [ ] **Step 5: 手工验证**

播放一首 3 分钟的歌：播 10 秒切走 → 历史无新增。播满 2 分钟 → 历史新增一条。播满 50%（1 分 30 秒）→ 历史新增。同一首歌播满后再播不重复写入。切歌后 tracker 重置。

---

### Task D4：scrobble 设置开关

**Files:**
- Modify: `apps/mobile/src/stores/playbackSettingsStore.ts`
- Modify: `apps/mobile/src/screens/settings/PlaybackSettingsScreen.tsx`

- [ ] **Step 1: playbackSettingsStore 增加 `enableScrobble` (默认 true)**

- [ ] **Step 2: 打点逻辑读取开关**

`tracker.shouldRecord()` 为 true 且 `enableScrobble` 且 `source === "wy"` 时调 `scrobbleWySong`。本地历史不受开关影响。

- [ ] **Step 3: PlaybackSettingsScreen 增加开关行**

- [ ] **Step 4: Typecheck + 手工验证**

---

## 完成顺序建议

工作流 A 和 D 可并行（A 改浮窗 + PlayerBar，D 改 playSongCore + 进度事件，文件交叉少）。
工作流 B 依赖 D 的进度事件架构（tracker 积累在进度回调里），建议 D 先行。
工作流 C 纯新增页面，与 A/B/D 无交叉，随时可做。

## 验收

- `pnpm core:test` 全绿（新增 overlay-clock、heartbeat-queue、listen-threshold）
- `pnpm mobile:typecheck` 通过
- `pnpm mobile:lint` 通过
- `cd apps/mobile/android && ./gradlew assembleDebug` 通过
- 手工回归：播放/切歌/后台/暂停/倍速/浮窗/我喜欢/心动/资产页/历史阈值/打点
