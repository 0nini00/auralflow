# AuralFlow Android Mobile MV and Home Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each worker must inspect the current diff before editing and return verification evidence.

**Goal:** 为 Android 移动端实现固定顺序、账号隔离的有限首页信息流，并在网易云歌曲上下文中提供独立 MV 播放页和可靠的音频恢复流程。

**Architecture:** `MusicInfo.mvId` 是首页与 MV 唯一共享数据。首页由网易云请求适配器经 `homeFeedService` 编排后进入按账号持久化的 Zustand Store，最近播放继续由 `historyStore` 独立拥有；MV 由可序列化根路由进入，临时 URL 仅存在于 `wyMvService` 和页面内存，`mvAudioSession` 独立管理 TrackPlayer 暂停与恢复。

**Tech Stack:** TypeScript 5.8、React 19、React Native 0.86.0（Fabric/New Architecture、Hermes）、React Navigation 7、Zustand 5、AsyncStorage 2.2、`react-native-track-player@4.1.2`、安装前经 metadata 核验后锁定的 `react-native-video`、Android Gradle/Media3。

## Global Constraints

- Android mobile 优先；不改变桌面端首页或播放器行为，不扩展核心 `SourceResolver`。
- 首页固定顺序：快捷区、推荐歌单、登录后每日推荐、新歌、新碟、最近播放；不做混合无限流或 MV 频道。
- 未登录是正常状态，公共推荐歌单、新歌、新碟和本地最近播放必须可用；登录仅增加每日推荐、私人 FM 和个性化歌单。
- 首页远端缓存作用域只能是 `anonymous` 或 `wy:${userId}`，key 为 `auralflow.mobile.homeFeed.v1:${scopeKey}`，TTL 固定 10 分钟。
- 新鲜缓存不自动刷新；过期缓存先展示后刷新；下拉刷新忽略 TTL；同作用域刷新去重；模块独立失败、独立重试并保留旧数据。
- `historyStore` 仍是最近播放唯一所有者，最近播放不进入 `HomeFeedSnapshot`。
- `MusicInfo` 只增加 `mvId?: string`；网易云映射把 `0`、`null`、空白值归一为 `undefined`，其他值转字符串；其他来源不伪造该字段。
- MV 入口条件固定为 `song.source === "wy" && typeof song.mvId === "string" && song.mvId.trim().length > 0`。
- MV 路由只传 `songId`、`mvId`、`name`、`singer`、可选 `picUrl`；不得传递或持久化 URL、Cookie、请求头、音频会话快照。
- 自动画质顺序固定为 1080→720→480；网络错误留在当前档重试，明确无 URL 或解码失败才降档。
- MV 页面黑底竖屏承载 16:9 `contain` 视频；默认不锁横屏，不修改全局 orientation 或 cleartext policy。
- 仅正常退出且进入前正在播放、当前 `${source}:${id}` 未变化、用户未抑制恢复、音频尚未自行恢复时调用 `resume()`。
- 引入依赖前先查询 npm/pnpm metadata，确认 RN 0.86、Fabric/New Architecture、Android 支持后锁定精确版本；不得关闭 New Architecture 或用宽泛 Gradle `force` 掩盖冲突。
- 保留 `apps/mobile/apply-track-player-patch.js` 的现有行为，安装和构建后重新验证补丁。
- 不新增、恢复或修改测试文件、`__tests__`、Vitest 配置/依赖/脚本；验证仅用 typecheck、静态扫描、Android Debug/Release 编译、依赖报告和真机流程。
- 不 commit、不 push；每任务先执行 `git status --short` 和目标文件 diff，不覆盖、回退或整理用户现有未提交改动。
- 所有交互目标至少 44dp，提供明确 accessibility role、label、state；骨架不进入可访问性树。

---

## 文件职责图谱

```text
packages/core/src/sources/types.ts
  └─ MusicInfo.mvId
      ├─ apps/mobile/src/services/wyMusicMapper.ts
      │   ├─ musicApi.ts（搜索/歌手/专辑）
      │   └─ wyPlaylistService.ts（歌单/每日推荐/FM）
      ├─ apps/mobile/src/services/wyMvService.ts
      │   └─ WyMvPlayerScreen.tsx ─ react-native-video
      │       ├─ mvAudioSession.ts ─ playerStore/TrackPlayer
      │       └─ RootNavigator/navigationRef/AppShell
      └─ SongList.tsx + immersive/useImmersiveController.ts
          └─ openWyMvPlayerScreen()

wyHomeFeedService.ts（原始公共/登录 API）
  └─ homeFeedService.ts（并发、映射、截断、回退、错误）
      └─ homeFeedStore.ts（Zustand + AsyncStorage + scope + TTL）
          └─ HomeScreen.tsx
              ├─ HomeQuickActions.tsx
              ├─ HomeHorizontalRail.tsx
              ├─ HomeSongSection.tsx
              ├─ HomeRecentSection.tsx ─ historyStore
              └─ MainTabNavigator.tsx（四 Tab/详情导航）
```

### 文件职责

- `apps/mobile/src/services/wyMusicMapper.ts`：唯一移动端网易云歌曲映射器及 MV id 归一化。
- `apps/mobile/src/services/wyMvService.ts`：MV metadata、临时播放源、画质与错误分类；不持久化 URL。
- `apps/mobile/src/services/mvAudioSession.ts`：进入快照、暂停、抑制恢复、幂等关闭与恢复判定。
- `apps/mobile/src/screens/WyMvPlayerScreen.tsx`：视频 UI、内存源状态、清晰度、生命周期和失败恢复。
- `apps/mobile/src/services/wyHomeFeedService.ts`：公共/个性化歌单、新歌、新碟网易云请求。
- `apps/mobile/src/services/homeFeedModels.ts`：判别联合、snapshot、错误、scope 和 TTL 常量。
- `apps/mobile/src/services/homeFeedService.ts`：模块请求编排、映射、数量限制、公共回退和独立收敛。
- `apps/mobile/src/stores/homeFeedStore.ts`：账号隔离缓存、SWR、去重、强制刷新与模块重试。
- `apps/mobile/src/components/home/*`：无嵌套卡片的独立首页模块视图。
- `apps/mobile/src/screens/HomeScreen.tsx`：固定顺序布局、导航、播放、聚焦刷新和下拉刷新。

---

### Task 1: MV 模型、统一映射与 API

**Exact files:**
- Modify: `packages/core/src/sources/types.ts`
- Create: `apps/mobile/src/services/wyMusicMapper.ts`
- Modify: `apps/mobile/src/services/musicApi.ts`
- Modify: `apps/mobile/src/services/wyPlaylistService.ts`
- Create: `apps/mobile/src/services/wyMvService.ts`

**Consumes:** 现有 `MusicInfo`、`getWyCookie(): Promise<string | null>`、`musicApi.ts` 与 `wyPlaylistService.ts` 的网易云响应结构及现有加密/请求约定。

**Produces:**
```ts
export function normalizeWyMvId(value: unknown): string | undefined;
export function mapWyTrackToMusicInfo(track: unknown): MusicInfo;
export type WyMvQuality = 1080 | 720 | 480;
export type WyMvErrorKind = "unavailable" | "restricted" | "network" | "expired" | "decoder" | "player";
export interface WyMvMetadata { mvId: string; availableQualities: WyMvQuality[] }
export interface WyMvSource {
  mvId: string;
  requestedQuality: WyMvQuality;
  actualQuality: WyMvQuality;
  url: string;
  expiresAt?: number;
}
export function getWyMvMetadata(mvId: string): Promise<WyMvMetadata>;
export function resolveWyMvSource(mvId: string, quality: WyMvQuality): Promise<WyMvSource>;
export function classifyWyMvError(error: unknown): WyMvErrorKind;
```

- [ ] **Step 1:** 运行 `git status --short`，并对上述现有文件执行 `git diff -- <files>`；记录并保留用户 hunks。
- [ ] **Step 2:** 在 `MusicInfo` 增加唯一新字段 `mvId?: string`，不改变旧序列化数据和非网易云构造路径。
- [ ] **Step 3:** 创建共享映射器；兼容 `track.mv`、`song.mv` 形态，保留现有歌手、专辑、封面、时长和 gateway 语义。
- [ ] **Step 4:** 用共享映射器替换 `musicApi.ts` 和 `wyPlaylistService.ts` 的私有网易云映射，覆盖搜索、歌手、专辑、歌单详情、每日推荐和私人 FM。
- [ ] **Step 5:** 按现有网易云服务请求约定实现 metadata/source API；校验 HTTPS 和实际画质，错误对象不得记录 Cookie 或完整鉴权 URL。
- [ ] **Step 6:** 保证重试重新解析 URL；URL 仅作为 `WyMvSource` 返回，不写入 `MusicInfo`、Store、AsyncStorage、历史或路由。
- [ ] **Step 7:** 执行验证：
```bash
pnpm --filter @auralflow/mobile typecheck
rg -n "mapWyTrackToMusicInfo|normalizeWyMvId|mvId" apps/mobile/src/services packages/core/src/sources/types.ts
rg -n "SourceResolver|AsyncStorage|persist" apps/mobile/src/services/wyMvService.ts
```
预期：typecheck 通过；网易云映射汇聚到共享函数；MV 服务不触碰音频解析或持久化。

---

### Task 2: 视频依赖、全屏播放器、导航与音频恢复

**Exact files:**
- Modify: `apps/mobile/package.json`, `pnpm-lock.yaml`
- Create: `apps/mobile/src/services/mvAudioSession.ts`
- Create: `apps/mobile/src/screens/WyMvPlayerScreen.tsx`
- Modify: `apps/mobile/src/navigation/types.ts`, `navigationRef.ts`, `index.ts`, `RootNavigator.tsx`
- Modify: `apps/mobile/src/components/AppShell.tsx`
- Inspect/preserve: `apps/mobile/apply-track-player-patch.js`, `apps/mobile/android/gradle.properties`, `apps/mobile/android/app/src/main/AndroidManifest.xml`
- Modify only with demonstrated need: `apps/mobile/android/app/build.gradle`

**Consumes:** Task 1 的 `WyMvQuality`、`WyMvSource`、MV API；现有 `usePlayerStore` 的 `currentSong`、`isPlaying`、`pause()`、`resume()`；React Navigation 根栈。

**Produces:**
```ts
export interface WyMvPlayerRouteParams {
  songId: string; mvId: string; name: string; singer: string; picUrl?: string;
}
export interface MvAudioSessionSnapshot {
  trackKey: string | null; wasPlaying: boolean; suppressResume: boolean;
}
export interface MvAudioSession {
  snapshot: MvAudioSessionSnapshot;
  suppressResume(): void;
  close(reason: "normal" | "abnormal"): Promise<void>;
}
export function startMvAudioSession(): Promise<MvAudioSession>;
export function openWyMvPlayerScreen(song: MusicInfo): Promise<void>;
```

- [ ] **Step 1:** 检查目标文件现有 diff；执行 `pnpm view react-native-video versions --json`、`pnpm view react-native-video@<candidate> peerDependencies engines --json` 和包仓库/发布 metadata 检查，记录 RN 0.86、Fabric/New Architecture、Android/Media3 支持证据。
- [ ] **Step 2:** 仅在证据通过后运行 `pnpm --filter @auralflow/mobile add react-native-video@<exact-version> --save-exact`；若不兼容，停止 MV UI 准入并保留首页任务可独立实施，不关闭 New Architecture。
- [ ] **Step 3:** 实现 `startMvAudioSession()`：先读取 `${source}:${id}` 和播放态，保存快照，播放中则等待 `pause()`；暂停失败时抛错且不导航。
- [ ] **Step 4:** 实现幂等 `close()`：先由页面释放视频，再重新读取当前 track/playback；仅满足全局恢复条件且 `reason === "normal"` 时 `resume()`，并防止双调用。
- [ ] **Step 5:** 注册 `WyMvPlayer` 可序列化路由和 helper；页面参数禁止 URL，`AppShell` 仅在该路由隐藏 AppHeader、PlayerBar 并使用浅色状态栏。
- [ ] **Step 6:** 实现黑底竖屏页面：16:9 `resizeMode="contain"`、播放/暂停、进度/seek、时间、可用清晰度、重试、保持暂停、控件淡出和完整 accessibility。
- [ ] **Step 7:** 初始解析严格遍历 `[1080, 720, 480]`；网络错误不自动降档；无 URL/解码错误降档；递增 request id 或 AbortController 阻止迟到响应覆盖新选择。
- [ ] **Step 8:** 页面失焦/后台/中断暂停视频；仅此前在播且用户未主动暂停时恢复视频。顶部返回、Android Back、手势和卸载统一走一次 close，退出后清理 URL、timer、listener。
- [ ] **Step 9:** 检查 `newArchEnabled=true`、Manifest 无 orientation/cleartext 放宽，确认 patch 脚本仍生效；若需 Gradle 约束，只加可解释的窄约束。
- [ ] **Step 10:** 执行验证：
```bash
pnpm --filter @auralflow/mobile exec node apply-track-player-patch.js
pnpm --filter @auralflow/mobile typecheck
pnpm --filter @auralflow/mobile android:assembleDebug
rg -n "react-native-video|WyMvPlayer|startMvAudioSession|resizeMode=\"contain\"" apps/mobile/package.json apps/mobile/src
rg -n "newArchEnabled=true" apps/mobile/android/gradle.properties
```
预期：依赖精确锁定、补丁成功、typecheck 与 Debug 构建通过，URL 不出现在路由类型或持久化状态中。

---

### Task 3: SongList 与沉浸页 MV 入口

**Exact files:**
- Modify: `apps/mobile/src/components/ActionMenuSheet.tsx`
- Modify: `apps/mobile/src/components/SongList.tsx`
- Modify: `apps/mobile/src/screens/immersive/ImmersiveMoreMenu.tsx`
- Modify: `apps/mobile/src/screens/immersive/useImmersiveController.ts`
- Modify: `apps/mobile/src/screens/ImmersiveLyricsScreen.tsx`

**Consumes:** `MusicInfo.mvId`；`openWyMvPlayerScreen(song: MusicInfo): Promise<void>`；现有单例歌曲菜单和沉浸更多菜单。

**Produces:**
```ts
export function canPlayWyMv(song: MusicInfo | null | undefined): boolean;
// useImmersiveController 返回值新增：
canPlayMv: boolean;
openCurrentMv(): Promise<void>;
```

- [ ] **Step 1:** 检查五个文件的当前 diff，保留用户正在修改的沉浸控件、弹层和 `SongList` 行为。
- [ ] **Step 2:** 在 `ActionMenuIconKey` 增加 `"mv"` 并映射 lucide `Video` 图标。
- [ ] **Step 3:** 定义并复用 `canPlayWyMv`；条件必须同时满足网易云来源和非空白 `mvId`。
- [ ] **Step 4:** 在 `SongList` 单例 action sheet 中插入“播放 MV”；点击调用 helper，暂停/导航失败用现有 `Alert` 风格提示且不破坏其他菜单项。
- [ ] **Step 5:** 控制器从 `currentSong` 派生 `canPlayMv` 和 `openCurrentMv()`；沉浸更多菜单仅在 eligible 时渲染同名命令。
- [ ] **Step 6:** `ImmersiveLyricsScreen` 接线时先关闭更多菜单，再启动 MV 会话；不得创建第二套播放状态或把 URL放进 controller。
- [ ] **Step 7:** 执行验证：
```bash
pnpm --filter @auralflow/mobile typecheck
rg -n "播放 MV|canPlayWyMv|openWyMvPlayerScreen" apps/mobile/src/components apps/mobile/src/screens
rg -n "source === \"wy\"|mvId\.trim" apps/mobile/src
```
预期：两个入口使用同一 eligibility 规则；QQ、B站、本地、网易云 `mv=0` 均无入口。

---

### Task 4: 首页推荐 API、section 模型与账号隔离 10 分钟缓存

**Exact files:**
- Create: `apps/mobile/src/services/wyHomeFeedService.ts`
- Create: `apps/mobile/src/services/homeFeedModels.ts`
- Create: `apps/mobile/src/services/homeFeedService.ts`
- Create: `apps/mobile/src/stores/homeFeedStore.ts`
- Modify only if current账号状态不足: `apps/mobile/src/stores/accountStore.ts`

**Consumes:** Task 1 共享网易云映射器；`getDailyRecommendSongs()`；`getWyCookie()`；`accountStore.user.userId`；AsyncStorage。

**Produces:**
```ts
export type HomeSectionKind = "recommendedPlaylists" | "dailySongs" | "newSongs" | "newAlbums";
export type HomeSectionStatus = "idle" | "loading" | "ready" | "refreshing" | "error";
export interface HomeFeedError { kind: "network" | "auth" | "invalid" | "unknown"; message: string }
export interface HomeSectionBase { kind: HomeSectionKind; title: string; status: HomeSectionStatus; updatedAt?: number; error?: HomeFeedError }
export type HomeSection =
  | (HomeSectionBase & { kind: "recommendedPlaylists"; items: WyPlaylistInfo[] })
  | (HomeSectionBase & { kind: "dailySongs" | "newSongs"; items: MusicInfo[] })
  | (HomeSectionBase & { kind: "newAlbums"; items: SearchAlbumResult[] });
export interface HomeFeedSnapshot { scopeKey: string; fetchedAt: number; sections: HomeSection[] }
export interface HomeFeedContext { scopeKey: string; isLoggedIn: boolean }
export const HOME_FEED_TTL_MS = 10 * 60 * 1000;
export function getHomeFeedScope(userId: string | null): string;
export function fetchHomeFeed(context: HomeFeedContext): Promise<HomeSection[]>;
export function fetchHomeSection(context: HomeFeedContext, kind: HomeSectionKind): Promise<HomeSection>;
```

Store actions:
```ts
activateScope(context: HomeFeedContext): Promise<void>;
refreshAll(context: HomeFeedContext, options?: { force?: boolean }): Promise<void>;
retrySection(context: HomeFeedContext, kind: HomeSectionKind): Promise<void>;
getCurrentScopeState(): { snapshot: HomeFeedSnapshot | null; refreshing: boolean };
```

- [ ] **Step 1:** 检查现有账号、网易云服务、Store 和 lockfile diff；不让 feed 层直接读取 AsyncStorage 中的 Cookie。
- [ ] **Step 2:** 实现公共推荐歌单、新歌、新碟和登录态个性化歌单请求；公共请求无 Cookie 时不得抛“未登录”。
- [ ] **Step 3:** 定义判别联合、固定标题、错误类型、数量上限、scope/key/TTL helpers；最近播放和 quick actions 不进入 snapshot。
- [ ] **Step 4:** `fetchHomeFeed` 并发请求适用模块并独立收敛；登录个性化歌单空或失败时回退公共歌单，每日推荐仅登录请求。
- [ ] **Step 5:** Store 激活 scope 时读取对应 key；损坏 JSON 删除该 key 并按无缓存处理；新鲜缓存直接用，过期缓存先显示再后台刷新。
- [ ] **Step 6:** 同 scope 整页刷新复用在途 Promise；强制刷新不并行写同一 snapshot；成功模块覆盖，失败模块保留旧项并写错误，无旧项则局部 error。
- [ ] **Step 7:** 写入前核对请求启动 scope；迟到结果只写自己的 scope 缓存，不污染当前 UI。退出立刻切回 `anonymous`，账号间不交叉读取。
- [ ] **Step 8:** `retrySection` 只请求指定模块；auth 失效触发账号状态复核，公共模块继续可用。
- [ ] **Step 9:** 执行验证：
```bash
pnpm --filter @auralflow/mobile typecheck
rg -n "HOME_FEED_TTL_MS|anonymous|wy:|auralflow.mobile.homeFeed.v1" apps/mobile/src/services apps/mobile/src/stores/homeFeedStore.ts
rg -n "Promise\.allSettled|retrySection|inFlight|fetchedAt" apps/mobile/src/services/homeFeedService.ts apps/mobile/src/stores/homeFeedStore.ts
rg -n "history|recent" apps/mobile/src/services/homeFeedModels.ts apps/mobile/src/stores/homeFeedStore.ts
```
预期：10 分钟、账号 scope、模块独立失败和去重显式存在；snapshot 不复制历史。

---

### Task 5: 首页模块组件、HomeScreen 重做与导航接线

**Exact files:**
- Create: `apps/mobile/src/components/home/HomeSectionFrame.tsx`
- Create: `apps/mobile/src/components/home/HomeQuickActions.tsx`
- Create: `apps/mobile/src/components/home/HomeHorizontalRail.tsx`
- Create: `apps/mobile/src/components/home/HomeSongSection.tsx`
- Create: `apps/mobile/src/components/home/HomeRecentSection.tsx`
- Modify: `apps/mobile/src/screens/HomeScreen.tsx`
- Modify: `apps/mobile/src/navigation/MainTabNavigator.tsx`
- Modify if nested route typing requires: `apps/mobile/src/navigation/types.ts`

**Consumes:** Task 4 section/store API；Task 3 已增强 `SongList`；`historyStore.loadHistory()`；现有 `playQueue`、详情 helper、四 Tab。

**Produces:**
```ts
interface HomeScreenProps {
  onNavigateToPlayer(): void;
  onNavigateToSearch(): void;
  onNavigateToHistory(): void;
  onNavigateToDailyRecommend(): void;
  onNavigateToFm(): void;
  onOpenPlaylist(playlist: WyPlaylistInfo): void;
  onOpenAlbum(album: SearchAlbumResult): void;
}
type HomeRailItem =
  | { kind: "playlist"; value: WyPlaylistInfo }
  | { kind: "album"; value: SearchAlbumResult };
```

- [ ] **Step 1:** 检查 `HomeScreen`、导航和共用组件现有 diff；保留四 Tab、PlayerBar 和用户导航改动。
- [ ] **Step 2:** 实现 `HomeSectionFrame` 的 skeleton、ready、empty、refreshing、缓存更新失败和无缓存 error/retry；错误不升级为全屏失败。
- [ ] **Step 3:** 实现快捷区：匿名显示搜索/历史，登录增加每日推荐/FM；可换行且触控目标 ≥44dp。
- [ ] **Step 4:** 实现可访问的横向歌单/专辑轨道，方形封面、单行省略、内容类型 label、小屏无页面横向溢出。
- [ ] **Step 5:** 实现紧凑歌曲模块，复用 `SongList`，每日推荐显示有限首和“查看全部”；新歌点击按模块顺序建立队列。
- [ ] **Step 6:** 实现最近播放模块，直接读取 `historyStore`，支持播放、完整历史入口和独立空/错误态。
- [ ] **Step 7:** 重做 `HomeScreen` 为单一纵向滚动容器；严格按快捷区→推荐歌单→登录每日推荐→新歌→新碟→最近播放渲染，不保留旧 Hero/卡片网格。
- [ ] **Step 8:** mount/checkStatus 后激活当前 scope；首页重新聚焦仅在缓存过期时后台刷新；下拉执行 `Promise.all([refreshAll(context, { force: true }), loadHistory()])`；模块重试调用 `retrySection`。
- [ ] **Step 9:** 接通搜索 `SearchTab`、历史 `LibraryTab > History`、`DailyRecommend`、`PersonalFm`、`PlaylistDetail`、`AlbumDetail`；需要时把 `LibraryTab` 改为 `NavigatorScreenParams<LibraryTopTabParamList> | undefined`。
- [ ] **Step 10:** 为底部 PlayerBar、Tab 和 safe area 保留足够 padding；缓存刷新不清空内容或造成大幅跳动。
- [ ] **Step 11:** 执行验证：
```bash
pnpm --filter @auralflow/mobile typecheck
rg -n "HomeQuickActions|recommendedPlaylists|dailySongs|newSongs|newAlbums|HomeRecentSection" apps/mobile/src/screens/HomeScreen.tsx
rg -n "Hero|发现音乐|onNavigateToSearch=\{\(\) => \{\}\}" apps/mobile/src/screens/HomeScreen.tsx apps/mobile/src/navigation/MainTabNavigator.tsx
rg -n "RefreshControl|force: true|retrySection|loadHistory" apps/mobile/src/screens/HomeScreen.tsx
```
预期：typecheck 通过；模块顺序固定；匿名公共内容不受登录限制；旧 Hero 和空导航回调消失。

---

### Task 6: 集成验证、Android 编译和手工检查

**Exact files:**
- Inspect: Tasks 1-5 的全部文件、`apps/mobile/apply-track-player-patch.js`、Android Gradle/Manifest、`pnpm-lock.yaml`
- Modify: 仅修复验收发现的集成缺陷；不重构无关代码
- Create: 无

**Consumes:** Tasks 1-5 全部接口和用户流程。

**Produces:** typecheck、依赖树、Debug/Release 编译及 Android 真机逐项结果；无提交产物。

- [ ] **Step 1:** 执行 `git status --short`、`git diff --check` 和目标范围 diff；确认没有覆盖用户 hunks、桌面行为或恢复已删除测试文件。
- [ ] **Step 2:** 执行静态检查：
```bash
pnpm --filter @auralflow/mobile typecheck
rg -n "mv.*url|url.*mv|Cookie|Authorization" apps/mobile/src/navigation apps/mobile/src/stores apps/mobile/src/screens
rg -n "SourceResolver|saveCachedPlaybackUrl|cacheAudioFile" apps/mobile/src/services/wyMvService.ts apps/mobile/src/screens/WyMvPlayerScreen.tsx
find apps/mobile packages/core -type f \( -name '*.test.*' -o -name '*.spec.*' -o -name 'vitest.config.*' \) -print
```
人工确认 URL 仅位于 MV 服务/页面内存，Cookie/鉴权信息不进入路由、缓存、日志和历史；没有新增或恢复测试/Vitest 文件。
- [ ] **Step 3:** 运行补丁、类型和两种构建：
```bash
pnpm --filter @auralflow/mobile exec node apply-track-player-patch.js
pnpm --filter @auralflow/mobile typecheck
pnpm --filter @auralflow/mobile android:assembleDebug
pnpm --filter @auralflow/mobile android:assembleRelease
```
全部退出 0；若 Release 未执行，不得标记通过。
- [ ] **Step 4:** 在 `apps/mobile/android` 生成 Debug/Release runtime dependency report 到系统临时目录，检查 `react-native-video`、Media3/ExoPlayer、Kotlin、OkHttp、AndroidX 最终版本和重复类；确认无宽泛 `force`，记录后删除报告。
- [ ] **Step 5:** Android 首页手工检查：匿名冷启动公共模块可用且无登录墙；搜索/历史/详情导航正确；登录增加每日推荐/FM/个性化歌单；退出和双账号切换无串缓存。
- [ ] **Step 6:** 检查 10 分钟内聚焦不刷新、过期缓存先展示后刷新、下拉忽略 TTL、单模块失败保留旧内容、无缓存局部报错、断网时历史独立可用。
- [ ] **Step 7:** 检查新歌/历史队列、固定模块顺序、横向轨道、小屏滚动、最后一项不被 PlayerBar/Tab 遮挡，以及所有模块 accessibility。
- [ ] **Step 8:** Android MV 手工检查：eligible 入口一致；1080→720→480；网络重试重新解析；无 URL、版权/地区、过期、解码、播放器错误提示与动作正确；手动清晰度只列可用档。
- [ ] **Step 9:** 检查竖屏黑底 16:9 contain、控件/seek/accessibility、后台/锁屏/来电暂停、迟到请求隔离、连续切画质和反复进退无崩溃/黑屏/明显 Surface 泄漏。
- [ ] **Step 10:** 检查音频互斥和恢复矩阵：进入前播放且 trackKey 不变时正常退出恢复；进入前暂停、保持暂停、通知/Bluetooth 切歌、音频已自行恢复、异常退出、初始化失败均不恢复旧歌；快速双返回最多恢复一次。
- [ ] **Step 11:** 检查 AppHeader/PlayerBar 仅 MV 路由隐藏，其他页面、四 Tab、详情和音频播放无回归；修复缺陷后重跑受影响的静态、构建和手工项。

---

## 任务依赖

```text
Task 1 ─┬─> Task 2 ─> Task 3 ─┐
        └─> Task 4 ─> Task 5 ─┴─> Task 6
```

Task 2 若因原生兼容性门槛阻塞，Task 4-5 仍可独立交付首页；不得以关闭 New Architecture、破坏 RNTP 或放宽全局原生策略换取 MV 上线。

## 计划自审

- **规格覆盖：通过。** 六个任务覆盖模型/映射/MV API、依赖 metadata 门槛、全屏播放器与音频恢复、两个 MV 入口、首页 API/判别联合/账号隔离 10 分钟缓存、模块 UI/首页/导航、Debug/Release/依赖树和 Android 手工矩阵。
- **占位符扫描：通过。** 所有步骤均给出 exact files、输入输出、操作顺序、关键签名和验证命令；没有留待执行者自行猜测的占位内容或省略引用。
- **类型命名一致性：通过。** `MusicInfo.mvId`、`WyMvQuality`、`WyMvSource`、`WyMvPlayerRouteParams`、`MvAudioSessionSnapshot`、`HomeSectionKind`、`HomeSection`、`HomeFeedSnapshot`、`HomeFeedContext`、Store action 和导航 callback 在生产方与消费方一致。
- **变更边界：通过。** 计划不包含测试/Vitest 新增或恢复、不包含 commit/push、不修改桌面行为，并要求每任务保护现有未提交改动。
