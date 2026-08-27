# stores/

全局状态层：~16 个 Zustand store，集中持有播放、歌单、收藏、历史、设置等状态；store 不含 React 逻辑，组件订阅、services 读写。

## Store 清单

| Store | 文件 | 职责 | 持久化方式 |
| --- | --- | --- | --- |
| playerStore | `playerStore.ts` (899 行) | 当前曲目 / 队列 / 随机 / 循环 / FM / 引擎桥接 | 非持久化（快照存 library） |
| playlistStore | — | 歌单 CRUD | `libraryPersistence` → `library/playlists.json` |
| favoritesStore | — | 收藏 | `libraryPersistence` → `library/favorites.json` |
| historyStore | — | 播放历史 | `libraryPersistence` → `library/recent.json` |
| libraryStore | — | 本地音乐库 | `libraryPersistence` → `library/library.json` |
| customSourceStore | — | LX 脚本导入 / 测试 / 更新 | `libraryPersistence` → `library/customSources.json` |
| downloadStore | — | 下载队列（2 并发） | zustand `persist` → `"download-storage"` |
| themeStore | — | 主题 + accent CSS 变量 | zustand `persist` → `"af-theme"` |
| wyAccountStore | — | 网易账号 | 非持久化（cookie 在 settings） |
| biliAccountStore | — | B 站账号 | 非持久化（cookie 在 settings） |
| discoveryStore | — | 日推 / FM | 非持久化 |
| sleepTimerStore | — | 睡眠定时器 | 非持久化 |
| lyricSettingsSync | — | 歌词设置跨窗口同步 | BroadcastChannel |

## 持久化架构

- **libraryPersistence**：`attachLibraryPersistence` 订阅各 store → 300ms 防抖写 → 一次性 localStorage → Rust 迁移落盘到 `library/*.json`。覆盖 playlist / favorites / history / library / customSource 五类。
- **zustand persist**：`downloadStore`（`"download-storage"`）、`themeStore`（`"af-theme"`）直接用 zustand 内建 persist 中间件。
- **非持久化**：`playerStore` / `wyAccountStore` / `biliAccountStore` / `discoveryStore` / `sleepTimerStore` 仅内存态（cookie 等敏感数据由 settings 侧管理）。

## 跨窗口同步

- **playerSync**：`BroadcastChannel("auralflow-player-sync")` + Tauri 事件后备；进度变化在 Δ≥0.4s 或 200ms 节流时广播，保证 main / lyric / lyric-unlock 三窗口一致。
- **lyricSettingsSync**：BroadcastChannel 广播歌词设置变更。

## 设计约定

- **数据流向**：services → store 直接读写；组件 → store 订阅；store 内不含 React 逻辑。
- **敏感数据**：cookie 等不进 Zustand 持久化，由 settings 统一管理。
- **窗口角色**：`App.tsx` 按 `getCurrentWindow().label` + `location.hash` 区分 main / lyric / lyric-unlock，各窗口订阅同一套 store。
