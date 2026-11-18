# stores/

全局状态层：16 个 Zustand store（同目录下另有 `libraryPersistence` / `libraryRefreshModel` / `playerPersistence` / `playerResumeTarget` / `playerSync` / `playerSyncMain` 六个非 store 的辅助模块，以及 `player/` 目录——`playerStore` 的实现分块），集中持有播放、歌单、收藏、历史、设置等状态；store 不含 React 逻辑，组件订阅、services 读写。

## Store 清单

| Store | 文件 | 职责 | 持久化方式 |
| --- | --- | --- | --- |
| playerStore | `playerStore.ts` (195 行) + `player/` | 当前曲目 / 队列 / 随机 / 循环 / FM / 引擎桥接；对外只有 `usePlayerStore`，实现分块见下方「playerStore 的内部划分」 | 非持久化（快照存 library） |
| playbackMirrorStore | `playbackMirrorStore.ts` | 副窗口（桌面歌词 / 迷你播放器）里的播放状态镜像：只有界面读的 6 个字段，由主窗口广播的快照写入 | 非持久化 |
| playlistStore | — | 歌单 CRUD | `libraryPersistence` → `library/playlists.json` |
| favoritesStore | — | 收藏 | `libraryPersistence` → `library/favorites.json` |
| historyStore | — | 播放历史 | `libraryPersistence` → `library/recent.json` |
| libraryStore | — | 本地音乐库 | `libraryPersistence` → `library/library.json` |
| customSourceStore | — | LX 脚本导入 / 测试 / 更新 | `libraryPersistence` → `library/customSources.json` |
| downloadStore | — | 下载队列（2 并发） | zustand `persist` → `"download-storage"` |
| themeStore | — | 主题 + accent CSS 变量 | zustand `persist` → `"af-theme"` |
| wyAccountStore | — | 网易账号 | 非持久化（cookie 在 settings） |
| discoveryStore | — | 日推 / FM | 非持久化 |
| discoverFeedStore | — | 发现页推荐歌单 + 榜单清单 + 榜单试读（10 分钟 TTL，与账号无关） | 非持久化 |
| cloudDriveStore | — | 音乐云盘列表 + 容量（按 uid 归属，同账号加载过就复用，只有刷新/换账号才重拉；`services/cloudDriveCache` 落盘，10 分钟保鲜，退出登录删） | `library/cloudDrive.json`（按 uid 分区，缓存语义、不进 WebDAV 同步） |
| sleepTimerStore | — | 睡眠定时器 | 非持久化 |
| settingsStore | `settingsStore.ts` | 应用设置在前端的唯一持有者：读（`ensureSettingsLoaded` / selector）、写（`updateSettings` / `resetSettingsToDefault`）都只经过它 | Rust 设置文件（`load_settings` / `patch_settings` / `reset_settings`） |
| updateStore | `updateStore.ts` | 待安装的可用更新（更新弹窗的数据源） | 非持久化 |

## playerStore 的内部划分

`playerStore.ts` 只负责组装 store，并留着播放控制（togglePlay / pause / resume / stop / setProgress / setPlaybackRate）、播放模式、FM 开关和一次性提示这些短动作。其余在 `player/` 下，调用方一律从 `@/stores/playerStore` 导入，不直接引用这些文件：

| 文件 | 职责 |
| --- | --- |
| `player/types.ts` | `PlayerStore` 状态与动作类型、`RepeatMode`、`PlayerSet` / `PlayerGet` |
| `player/playRequestState.ts` | 请求代次、引擎接管目标、在途请求、切歌连点队列四份模块级状态的唯一持有者；`invalidatePlayRequest` 把它们一并复位 |
| `player/playbackPipeline.ts` | `play` 动作（取链、预取消费、缓存作废、跨源降级）及其辅助函数 |
| `player/queueNavigation.ts` | `playByIndex` / `next` / `prev`、连点补跳、私人 FM 续播 |
| `player/engineSync.ts` | 播放引擎事件到 store 的同步：状态与进度、听歌统计、出错自动跳、播完续播、试听片段兜底 |
| `player/queueActions.ts` | 队列编辑：`playQueue` / `addToQueue` / `playNext` / `removeFromQueue` / `insertQueueAt` / `clearQueue` |
| `player/volumeActions.ts` | `setVolume` / `toggleMute` 与音量防抖落盘 |

依赖单向：`types`、`playRequestState` ← `playbackPipeline` ← `queueNavigation` ← `engineSync` ← `playerStore`；`queueActions`、`volumeActions` 只依赖前两者之一并被 `playerStore` 组装。动作模块经参数拿 `set` / `get`，不反向导入 `playerStore`。除 `types` 外都只该在主窗口加载（`tests/window-dependency.test.ts` 点名锁着）。

## 持久化架构

- **libraryPersistence**：`attachLibraryPersistence` 订阅各 store → 300ms 防抖写 → 一次性 localStorage → Rust 迁移落盘到 `library/*.json`。覆盖 playlist / favorites / history / library / customSource 五类。
- **zustand persist**：`downloadStore`（`"download-storage"`）、`themeStore`（`"af-theme"`）直接用 zustand 内建 persist 中间件。
- **非持久化**：`playerStore` / `wyAccountStore` / `discoveryStore` / `sleepTimerStore` / `updateStore` 仅内存态（cookie 等敏感数据由 settings 侧管理）。

## 跨窗口同步

- **playerSync / playerSyncMain**：`BroadcastChannel("auralflow-player-sync")` + Tauri 事件后备；进度变化在 Δ≥0.4s 或 200ms 节流时广播。播放只在主窗口：`playerSyncMain`（只由 `MainWindow` 加载）把 `playerStore` 的快照发出去并执行副窗口发回的控件动作；`playerSync` 是通道与副窗口一端，把快照写进 `playbackMirrorStore`。副窗口不加载 `playerStore`（`tests/window-dependency.test.ts` 锁着）。
- **settingsStore**：不在窗口之间传值。任何一处写入都由 Rust 落盘并向所有窗口发 `settings-changed`（只带变化的字段名），各窗口收到后自己重读；只涉及 Rust 自管的窗口几何字段时不重读。未读到时 `settings` 为 `null`，不提供占位默认值；默认值只在 Rust 的 `AppSettings::default()`。
- 歌词窗的**锁定**是窗口运行时状态而不是设置：以 Rust 为准（`getLyricWindowState` 查询 + `lyric-settings-changed` 事件），不经过 settingsStore。

## 设计约定

- **数据流向**：services → store 直接读写；组件 → store 订阅；store 内不含 React 逻辑。反方向也存在：11 个 service 会 `import @/stores` 直接读写 store（`persistentCache`、`playback/playbackResolver`、`playback/prefetchService`、`playback/customSourceBackend`、`playback/playbackSnapshot`、`playback/playbackSnapshotModel`、`playlistTransferService`、`smtcService`、`taskbarService`、`customSourceRuntime`、`webdavSyncService`），所以这是**双向**关系，不是单向分层——详见 `desktop/src/SPEC.md`。
- **敏感数据**：cookie 等不进 Zustand 持久化，由 settings 统一管理。
- **窗口角色**：`App.tsx` 按 `getCurrentWindow().label` + `location.hash` 区分 main / lyric / lyric-unlock，主窗口用 `playerStore`，桌面歌词 / 迷你播放器用 `playbackMirrorStore`。
