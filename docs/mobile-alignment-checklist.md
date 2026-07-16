# 移动端对齐清单（Sprint 1：现状基线与对齐契约）

> 目的：冻结桌面端信息架构、移动端复用基础与回归验证口径，为后续增量改造提供可执行契约。本清单只记录现状、目标与验证方式；不重写稳定业务、不引入新依赖、不提出常驻侧边栏。

## 1. 文件边界与参考实现

| 角色 | 文件 | Sprint 1 边界 |
|---|---|---|
| 桌面布局参考 | `desktop/src/components/Layout/Sidebar.tsx` | 只作为导航顺序、分组、账号 footer 的信息架构参考；不修改。 |
| 桌面顶部栏参考 | `desktop/src/components/Layout/Header.tsx` | 只作为搜索、返回/前进、主题切换语义参考；不修改。 |
| 桌面布局参考 | `desktop/src/components/Layout/Layout.tsx` | 只作为 Sidebar/Header/Content/PlayerBar 层级参考；不修改。 |
| 移动抽屉 | `apps/mobile/src/navigation/MainDrawerNavigator.tsx` | 保持 `drawerType: "front"`、遮罩和可配置手势；不改成常驻侧栏。 |
| 移动导航内容 | `apps/mobile/src/components/AppSidebar.tsx` | 镜像桌面入口和设置/账号 footer；由 Drawer 控制显隐。 |
| 移动顶部栏 | `apps/mobile/src/components/MobileHeader.tsx` | 汉堡、搜索/联想、主题切换的移动映射。 |
| 移动设计 token | `apps/mobile/src/theme/tokens.ts` | 复用 spacing、radius、typography、touch、layout；页面不得新增无说明硬编码。 |
| 移动响应式工具 | `apps/mobile/src/utils/responsive.ts` | 复用 `TABLET_MIN_WIDTH = 768`、`phone`/`tablet` 判定；不另建断点。 |

## 2. 对齐逐项清单

字段定义：**桌面入口**是对齐参照；**移动对应页面**是当前路由/组件；**当前差异**描述基线事实；**目标状态**是后续改造契约；**验证方式**给出可执行的检查方法。

| 范畴 | 桌面入口 | 移动对应页面 | 当前差异 | 目标状态 | 验证方式 |
|---|---|---|---|---|---|
| 导航 | `Sidebar.tsx`：发现、搜索、每日推荐、私人 FM、歌单、下载、本地音乐、设置 | `MainDrawerNavigator.tsx` + `AppSidebar.tsx`：Home/Search/Daily/FM/Playlists/Downloads/Local/Settings | 桌面 Sidebar 常驻，移动是 Drawer；路由名称是英文而展示标签为中文 | 入口顺序、分组、命名语义一致；移动始终使用默认隐藏的 front Drawer | 对照两文件入口列表；逐项点击移动入口并确认路由；确认无常驻 sidebar |
| 顶部栏 | `Header.tsx`：搜索、联想、主题切换、返回/前进 | `MobileHeader.tsx`：汉堡、搜索/联想、主题切换；详情/沉浸页可隐藏搜索 | 移动用汉堡替代桌面前进/后退，搜索实现为 RN TextInput | 保持搜索提交、联想、主题切换语义；页面场景可显示标题；汉堡打开 Drawer | 手动输入关键词、提交并检查 Search 参数；点主题按钮；检查 accessibilityLabel |
| 内容页：首页 | `HomeView.tsx`（由 `Layout.tsx` Outlet 承载） | `HomeScreen` | 桌面工作区有固定内容滚动层；移动为屏幕级内容和 MiniPlayer | 首页入口、搜索快捷入口、推荐内容可发现性与桌面语义一致，复用已有 action/store | 手机/平板分别打开首页；检查搜索快捷入口、推荐卡片、加载/空态 |
| 内容页：搜索 | `Header.tsx` 搜索提交 → `/search?q=`；`SearchView.tsx` | `SearchScreen` + `MobileHeader` | 桌面搜索位于全局 Header，移动搜索位于 MobileHeader | 输入、联想、提交、结果详情跳转保持一致，不重写搜索服务 | 提交关键词；验证 Search 路由参数、联想点击、详情跳转和返回 |
| 内容页：歌单/详情 | `PlaylistsView.tsx`、`PlaylistDetailView.tsx` | `LibraryScreen` 及其歌单/专辑/艺人详情入口 | 移动将多个 library section 合并在 LibraryScreen | 保留歌单、历史、本地音乐等既有入口，卡片/列表层级逐步靠拢桌面 | 分别进入歌单、历史、本地 section；检查详情、收藏、播放操作 |
| 播放器 | `PlayerBar.tsx`（`Layout.tsx` workspace 底部） | `MiniPlayer` → `PlayerScreen` | 移动播放器折叠为 MiniPlayer，完整播放器为独立页面 | 播放状态跨页面保持；入口可发现；不重写 TrackPlayer、playerStore 或 playerService | 播放歌曲后切换导航；点击 MiniPlayer；验证暂停、上一首/下一首、进度 |
| 歌词 | 桌面播放器/歌词相关入口（播放器栏进入歌词视图） | `ImmersiveLyricsScreen` / lyric stores | 手机需要折叠呈现，平板可使用更宽布局 | 手机安全区内可进入/退出沉浸歌词；平板允许更接近桌面的并排密度 | 手机竖屏、横屏和平板分别进入歌词；验证退出、滚动和 MiniPlayer 不遮挡 |
| 下载 | `DownloadsView.tsx` + Sidebar 的下载入口 | `DownloadScreen` + `downloadStore`/`downloadService` | 桌面为工作区页面，移动为 Drawer 页面；底层服务共用 | 下载入口、质量选择、进度、失败/重试状态语义一致；不改下载引擎 | 从 Drawer 进入；选择质量并开始下载；检查进度、失败和重试 |
| 设计语言 | `theme.css`、`layout.css`、`player.css`；`Layout.tsx` 层级 | `theme/tokens.ts`、各移动组件 palette | 桌面 CSS token 与移动几何 token 表达方式不同 | 移动颜色走 theme palette，几何统一 spacing/radius/typography/touch/layout；不新增无说明 token | 静态检索新增样式；逐屏检查颜色、圆角、字号、间距是否来自 token/palette |
| 手机 | 桌面工作区的单一参考密度 | `responsive.ts` `form: "phone"`；各 Screen/MiniPlayer | 手机宽度需要折叠播放器、单列内容和更大触控行高 | 单列、折叠播放器、最小触控目标；Drawer 仍默认关闭 | 使用手机竖屏/横屏；检查无横向溢出、触控目标、Drawer 覆盖层 |
| 平板 | 桌面 Sidebar + Workspace 的并排信息密度 | `responsive.ts` `form: "tablet"`（宽度 ≥ 768） | 平板可以承载更宽内容，但不能把 Drawer 固定展开 | 更宽内容/并排布局可逐步靠拢桌面；Drawer 仍是 front overlay、非常驻 | 768dp 及以上宽度、横竖屏、分屏下检查布局；确认侧栏仍可关闭并覆盖内容 |

## 3. Drawer 交互契约（必须保持）

1. **初始状态：关闭。** `MainDrawerNavigator` 不使用常驻侧栏；进入任一 phone/tablet 尺寸的主导航页面时，Drawer 不自动展开。
2. **打开：** `MobileHeader` 的汉堡按钮（`onOpenDrawer`）打开 Drawer；导航项选择后关闭 Drawer。
3. **遮罩关闭：** Drawer 使用 front overlay 和半透明 `overlayColor`；点击遮罩关闭，不穿透触发内容操作。
4. **返回键关闭：** Android 硬件返回键/系统返回手势在 Drawer 打开时优先关闭 Drawer；Drawer 已关闭时才交给页面栈返回。该行为由 React Navigation Drawer router 的默认 back handling 保持，后续如自定义必须补充回归测试。
5. **边缘滑动：** `swipeEnabled` 是可配置能力（当前基线开启）；允许按平台、可访问性或产品设置关闭，但不得依赖它替代汉堡按钮。
6. **禁止方案：** 不得提出或实现 phone/tablet 任一尺寸的常驻 Sidebar、push layout 或自动展开 Drawer。

## 4. Sprint 1 变更边界

- 本 Sprint 交付本清单和 `docs/mobile-verification-baseline.md`。
- 不修改稳定业务、播放器/歌词/下载底层服务，不新增 npm 依赖。
- 后续 Sprint 才能改变导航视觉、页面布局和播放器/下载呈现；所有变更先对照本契约并补回归。
