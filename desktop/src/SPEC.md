---
id: desktop-frontend
type: submodule-design
status: draft
title: 桌面端前端 — 分层与边界
parent: desktop
tags: [auralflow, desktop]
---

## 职责

桌面端前端把「用户意图」翻译成「服务调用」，把「服务状态」翻译成「界面」。它分五层，层内细节留给代码，规格只固定职责与依赖方向：

| 层 | 位置 | 职责 |
|---|---|---|
| 视图 | `views/` | 路由驱动的薄页面。只组合 hooks / store / service，不写业务规则；非首屏视图 `lazy import()`；设置页只挂载活动 section。 |
| 组件 | `components/` | 可见界面与交互。从 store 订阅数据，不持业务逻辑；CSS 类名统一 `af-` 前缀，tooltip 用 `data-tooltip` 而不额外插 DOM 节点。 |
| 状态 | `stores/` | Zustand store，只放状态与状态转换，不含 React 逻辑、不含业务规则。 |
| 业务 | `services/` | 业务规则唯一的落脚点：播放引擎、源解析、账号、同步、缓存、下载、歌词、应用自更新。持模块单例状态，直接读写 store。 |
| 工具 | `lib/` | 纯函数与加密原语（weapi / eapi），无 React、无副作用、无 IO。 |

另有 `hooks/`（复用逻辑）、`utils/`、`styles/`（`index.css` + 分层 CSS）、`assets/`。

**跨窗口**：`App.tsx` 按 `getCurrentWindow().label` 与 `location.hash` 区分 main / lyric / lyric-unlock 三个窗口。三者订阅同一套 store，靠 `stores/playerSync.ts`（BroadcastChannel + Tauri 事件）与 `stores/lyricSettingsSync.ts` 保持一致。

**应用自更新**：`services/updateService.ts`（三态检查 + 下载安装）↔ `stores/updateStore.ts`（待装版本）↔ `components/UpdateModal.tsx`（弹窗状态机：`idle → downloading → installing / failed`）。触发点是启动 3s 后的静默检查（`App.tsx`）与设置页「其他 → 软件更新」的手动检查。

两条硬规则：**只有真的发现新版本才弹窗**——静默检查失败不打扰用户（网络抖动很常见），失败原因只在设置页显示；**安装是终态**——Rust 侧一调起安装器就 `exit(0)`，装完由安装器重新拉起应用，所以「安装中」必须由前端自己画出来，不能指望 `downloadAndInstall` 的 Promise 返回（细节见 `desktop-native`）。

**路由**：BrowserRouter v6，13 个子路由（首页 index / search / library→收藏歌单重定向 / local / playlists / downloads / history / playlist/:id / artist/:id / album/:id / daily / fm / settings），外加通配重定向到首页。

## 边界

**允许**：`@lx/core`、`@lx/tauri-bridge`、`@tauri-apps/*`、React 18 / React Router 6 / Zustand / crypto-js / node-forge。

**依赖方向**：`views` 与 `components` 只向下依赖 `stores` / `hooks` / `lib`；`stores` 与 `services` 互相读写；业务规则只允许存在于 `services`。

**已知边界瑕疵（实情，与 `desktop/src/stores/README.md` 的表述不符）**：`stores` ↔ `services` 是**双向**的，不是单向数据流。`services` 里确实有 6 个文件反向 `import` `@/stores`：`webdavSyncService.ts`、`playlistTransferService.ts`、`playback/playbackSnapshot.ts`、`playback/customSourceBackend.ts`、`customSourceRuntime.ts`、`playback/playbackSnapshotModel.ts`。这是「服务直接读写 store」约定的自然结果，不是回归——但也意味着不存在可强制的单向分层。

同类瑕疵：`services` 并非全部经 IPC 桥访问原生能力，`desktop/src` 有 31 处直接 `import` `@tauri-apps/*`（详见 `desktop` 与 `tauri-bridge` 的边界）。

**约束强度**：桌面端没有 ESLint 配置（全仓库只有移动端有），所以以上分层是**约定而非工具强制**——越界不会有检查报错，评审时看这里。

**错误不得静默吞掉（本层的硬规则）**：`services` 里的异步失败要么显式抛出、要么转化成调用方能显示的状态，不允许空 `catch {}`。两类要分开处理：**操作失败**（下载、同步、取链）→ 抛错或让任务落到 failed 态；**后处理失败**（写 ID3 标签 / 嵌封面 / 写内联歌词与旁挂 `.lrc`）→ 音频文件此时已完整落盘，任务仍算 `completed`，但必须把原因作为 `warning` 回报到 `DownloadTask` 上并在下载页显示（`downloadService.enhanceDownloadedFile` 因此返回 `string[]`，而不是把下载判为失败——那会让用户以为整首歌没下下来）。刻意静默的只有纯清理动作：`stopDownload`、临时文件 unlink、批量删除。

**滚动容器与浮层配色（硬规则）**：滚动容器必须 `scrollbar-width` 与 `scrollbar-color`（或 `::-webkit-scrollbar` 三件套）成对出现——只写 `scrollbar-width: thin` 会落回引擎默认滚条，light 主题（`color-scheme: light`）下就是刺眼白条。**沉浸滚动条不随主题切换**：`--af-immersive-*` 表面上的滚动条色值取沉浸 ink 色族（`rgba(233,246,230,·)`），不得引用 `--af-border-primary` 等随主题变的 token（light 主题下它是 #e2e8f0 亮白灰，放上去仍是白条）。tooltip 仍沿用全局主题色。贴滚动容器右缘的元素，其 tooltip 必须用 `data-tooltip-placement` 的 `*-end` 变体右对齐——默认水平居中的 `::after` 盒子会向右溢出并撑出横向滚动条（`visibility: hidden` 的盒子同样计入滚动溢出区，未悬停时也会出现）。
**持久化归属**（哪些状态会活过重启）：`playlist` / `favorites` / `history` / `library` / `customSources` 五类经 `stores/libraryPersistence.ts` 防抖落盘到 `library/*.json`（一次性 localStorage → Rust 迁移）；`downloadStore` 与 `themeStore` 用 zustand `persist`；`playerStore`、账号 store、`discoveryStore`、`sleepTimerStore` 仅内存态——Cookie 等敏感数据刻意不进 Zustand 持久化，由 settings 侧与 Rust 统一管理。已下线来源的历史条目由 `core` 的 `dropRemovedSourceEntries` 在读盘后与同步合并后清理，直接丢弃不备份。
