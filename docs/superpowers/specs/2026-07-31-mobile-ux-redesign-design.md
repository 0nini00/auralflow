# AuralFlow Android 端 UI/UX 优化设计文档

| 项目 | 内容 |
|---|---|
| 日期 | 2026-07-31 |
| 目标 | 把桌面端"平铺入口"模式改造成适合小屏手机的底部标签 + 隐藏抽屉混合导航 |
| 影响范围 | `apps/mobile`（React Native 端） |
| 采用方案 | 底部 4 标签 + 侧边抽屉（账号/设置） + PlayerBar 精简 + 沉浸式播放器优化 |

---

## 1. 背景与问题

当前移动端仍存在较浓的桌面端移植痕迹：

- **入口太散**：抽屉中陈列 `Home / Search / Daily / FM / Playlists / Local / Downloads / Library / Settings` 共 9 项，切换需要"打开抽屉 → 找入口 → 点击进入"三步。
- **底部 PlayerBar 控件过多**：进度条、封面、播放模式、上一首/下一首、播放/暂停、添加到歌单、悬浮歌词、睡眠定时、音量滑块、展开按钮全挤在一个条里，小屏上极易误触。
- **曲库页信息过载**：歌单、本地音乐、下载、历史、B 站合集竖向堆叠，滚动很长。
- **首页 Hero 占用首屏**：`padding: 24` + 大间距导致小屏手机首屏几乎只剩 Hero banner。
- **沉浸式播放器控件常驻**：顶部和底部控件始终可见，歌词/封面被严重遮挡。

本设计的目标是在**不砍功能**的前提下，让小屏下的高频操作触手可及，低频操作通过层级或手势收纳。

---

## 2. 整体交互架构

采用 **底部 4 标签 + 侧边抽屉 + 全局顶部搜索** 混合结构：

```infographic
infographic hierarchy-tree-curved-line-rounded-rect-node
data
  title 优化后导航架构
  items
    - label Root Stack
      children
        - label MainDrawer
          children
            - label 底部 Tab Navigator
              children
                - label 发现 Home
                - label 曲库 Library
                  children
                    - label 歌单
                    - label B站
                - label 我的 Me
                  children
                    - label 账号卡片（顶部）
                    - label 本地
                    - label 历史
                    - label 下载
                - label 搜索 Search
            - label Drawer 抽屉
              children
                - label 账号区
                - label 工具区
                - label 设置 / 关于
        - label Player 全屏播放器
        - label Daily / FM
        - label 详情页系列
```

- **底部标签**（4 个）：`发现 / 曲库 / 我的 / 搜索`
- **侧边抽屉**：账号卡片 + 网易云/B站账号管理 + 工具快捷入口 + 设置 + 关于
- **Daily / FM**：从首页或抽屉 push 进去，不占底部标签位
- **全局搜索**：Header 搜索框常驻，回车后 push `SearchScreen`

---

## 3. 底部标签导航

### 3.1 Tab 结构

| 标签 | 图标 | 子内容 | 说明 |
|---|---|---|---|
| **发现** | Home | Hero + 每日推荐 + 私人FM + 最近播放网格 | 无目的浏览起点 |
| **曲库** | Library | 歌单 / B站（TopTab） | 云端歌单管理 |
| **我的** | User | 顶部账号卡片 + 本地 / 历史 / 下载（TopTab） | 个人文件型资产 |
| **搜索** | Search | 搜索框 + 建议 + 结果 | 找歌 |

### 3.2 "我的" tab 详情

顶部放一个**小账号卡片**：显示头像/昵称，未登录时显示"点击登录"。点击卡片打开抽屉进入账号详情。

卡片下方是三个子标签：`本地 / 历史 / 下载`。

```text
┌─────────────────────────────────────┐
│  [头像] 昵称          网易云 已登录 │  ← 小账号卡片，点击开抽屉
├─────────────────────────────────────┤
│  [ 本地 ]  [ 历史 ]  [ 下载 ]      │  ← TopTab
├─────────────────────────────────────┤
│                                     │
│  （对应子标签内容）                  │
│                                     │
└─────────────────────────────────────┘
```

### 3.3 "曲库" tab 详情

两个子标签：`歌单 / B站`。

```text
┌─────────────────────────────────────┐
│  [ 歌单 ]  [ B站 ]                 │  ← TopTab
├─────────────────────────────────────┤
│                                     │
│  歌单 tab：未登录→登录卡片           │
│           已登录→我喜欢+歌单网格     │
│  B站 tab：登录提示或合集列表         │
│                                     │
└─────────────────────────────────────┘
```

### 3.4 Tab 切换规则

- 切换 tab 不销毁已有页面状态（`lazy` 加载 + `unmountOnBlur: false`）
- 每个 tab 内部使用 `@react-navigation/material-top-tabs` 做子标签
- 底部 tab bar 高度目标 56dp，图标 24dp，标签文字 12dp

### 3.5 RootStack 内容

底部标签之上，RootStack 继续承载：

- `Player` 全屏 modal
- `ArtistDetail`、`AlbumDetail`、`PlaylistDetail`、`LocalPlaylistDetail`、`BiliCollectionDetail`、`LikedSongs`、`SearchFallbackDetail`
- `DailyRecommendScreen`、`PersonalFmScreen`（从 Home push）

---

## 4. 侧边抽屉（Drawer）

### 4.1 抽屉布局

```text
┌─────────────────────────────────────┐
│  ┌─────────────────────────────────┐│
│  │  头像 + 昵称 + 会员状态         ││
│  │  （未登录显示"点击登录"）       ││
│  └─────────────────────────────────┘│
│                                     │
│  ── 账号 ──                         │
│  [网易云账号] 已登录 / 未登录       │
│  [B站账号]   已登录 / 未登录       │
│                                     │
│  ── 工具 ──                         │
│  [自定义音源]                       │
│  [WebDAV 同步]                      │
│  [数据管理]                         │
│                                     │
│  ── 其他 ──                         │
│  [设置]                             │
│  [关于]                             │
│                                     │
│  AuralFlow v1.x.x                  │
└─────────────────────────────────────┘
```

注意：每日推荐和私人 FM **不在抽屉里**，它们是「发现」tab 的核心内容（Hero 快捷入口 + 卡片），已经在底部标签内一步可达。抽屉只放底部标签覆盖不到的低频功能。

### 4.2 各项说明

| 分组 | 项目 | 说明 |
|---|---|---|
| **账号区** | 头像 + 昵称 | 顶部大卡片，点击进入账号详情 / 登录流程 |
| **账号** | 网易云账号 | 状态显示，点击管理（登录/退出/切换） |
| **账号** | B站账号 | 同上 |
| **工具** | 自定义音源 | 管理自定义脚本来源 |
| **工具** | WebDAV 同步 | 同步歌单/设置到 WebDAV |
| **工具** | 数据管理 | 导出导入、缓存清理 |
| **其他** | 设置 | Push 进设置子页（外观/播放/歌词等） |
| **其他** | 关于 | 版本号、更新检查、协议 |

### 4.3 抽屉触发方式

- Header 左侧汉堡按钮
- 边缘右滑手势（Android 标准）
- `AppHeader` 保留汉堡按钮，不移除

---

## 5. AppHeader（全局顶部栏）

### 5.1 改动前

左侧：汉堡菜单 + 后退 + 前进
中间：搜索框 + 建议下拉
右侧：主题切换

### 5.2 改动后

左侧：**汉堡菜单**（打开抽屉）+ **后退**（必要时）
中间：**全局搜索框**（保留 NetEase 搜索建议）
右侧：**主题切换**

- 保留汉堡菜单：抽屉仍是账号/设置/工具的唯一入口
- 移除全局前进按钮：移动端全局 forward 需求极低
- 搜索框回车后 push `SearchScreen`，不切 tab

```text
[☰]  [搜索歌曲、歌手、专辑]  [🌙/☀]
```

---

## 6. 底部 PlayerBar 精简

### 6.1 改动前

```text
[================ 进度条 ================]
[封面 歌名/歌手] [模式] [⏮] [▶] [⏭] [➕] [词] [⏲] [↗] [🔊] [音量条]
[ 0:12                         3:45 ]
```

### 6.2 改动后（单行，目标高度 56dp）

```text
[======= 进度条 ======]
[封面 歌名/歌手]        [♡] [▶] [⏭] [⋯]
```

| 元素 | 说明 |
|---|---|
| 进度条 | 居顶细条，点击/拖动可 Seek |
| 封面 + 歌名/歌手 | 左侧，点击进入沉浸式播放器 |
| 喜欢 | 仅当可喜欢时显示，实心/空心 |
| 播放/暂停 | 主按钮，loading 态转菊花 |
| 下一首 | 高频，保留 |
| `⋯` 更多 | 弹出菜单收纳：播放模式、上一首、添加到歌单、睡眠定时、悬浮歌词、音量/静音、展开全屏 |

- 音量滑块从 PlayerBar 移除：用户更常用系统音量键，如需精准调节可进菜单或全屏。
- 播放模式仍可通过 `⋯` 切换，并在图标上保留状态角标。

---

## 7. HomeScreen（发现页）

### 7.1 布局目标

小屏首屏必须让用户看到"最近播放"内容，而不是只看到一个 Hero。

### 7.2 具体调整

| Token / 区域 | 改动前 | 改动后 |
|---|---|---|
| `hero.padding` | 24 | 16 |
| `hero.gap` | 18 | 12 |
| `heroTitle.fontSize` | `typography.display` (24) | `typography.heading` (18) |
| `container.gap` | 28 | 20 |
| `grid.columns` | 2/3/4 | 手机固定 2 列；平板 3/4 |
| `grid.gap` | 14 | 12 |

- Hero 文案收短，按钮从两行改成水平一行。
- "私人 FM" 和 "搜索音乐" 保留为 Hero 内的 pill 按钮。
- 最近播放网格固定 2 列，小屏卡片不要太大，保证一屏至少看到 4 张卡片 + Hero。

---

## 8. LibraryScreen（曲库）重构

### 8.1 当前问题

一个 ScrollView 里依次摆：账号状态、网易云歌单、本地歌单、本地音乐扫描、B 站、下载、历史……，页面很长且类型混杂。

### 8.2 新方案

曲库 tab 内部只保留 2 个子标签：`歌单 / B站`。本地/历史/下载移到「我的」tab。

使用 `@react-navigation/material-top-tabs`：

| 子标签 | 内容 |
|---|---|
| 歌单 | 账号歌单（未登录显示登录卡片）+ 本地自建歌单 |
| B站 | 已登录 B 站账号的合集 |

### 8.3 歌单 tab 操作

- 顶部登录卡片（未登录）
- "我喜欢的音乐" 固定卡片
- 用户歌单网格
- 底部 `+ 新建歌单` 按钮

### 8.4 B站 tab 操作

- 登录提示或合集列表

---

## 9. MyMusicScreen（我的）

### 9.1 定位

把原来散落在各处的个人文件型资产（本地音乐、播放历史、下载）统一到一个 tab。

### 9.2 布局

```text
┌─────────────────────────────────────┐
│  [头像] 昵称          网易云 已登录 │  ← 小账号卡片
├─────────────────────────────────────┤
│  [ 本地 ]  [ 历史 ]  [ 下载 ]      │  ← TopTab
├─────────────────────────────────────┤
│                                     │
│  本地 tab：歌曲列表 + FAB扫描       │
│  历史 tab：最近播放 + 清空按钮      │
│  下载 tab：下载中/已完成/失败       │
│                                     │
└─────────────────────────────────────┘
```

### 9.3 各子标签操作

- **本地**：歌曲列表、扫描/导入 FAB、编辑 metadata/封面/歌词
- **历史**：最近播放列表、清空、单条删除
- **下载**：下载任务列表、暂停/取消/重试、已完成列表

---

## 10. ImmersiveLyricsScreen（沉浸式播放页）

### 10.1 目标

让歌词和封面成为主角，控件不常驻遮挡。

### 10.2 交互改动

| 改动 | 说明 |
|---|---|
| 自动隐藏控件 | 进入 3 秒后，顶部栏和底部 transport 淡出隐藏；点击任意位置恢复 |
| 歌词/封面切换 | 由顶部按钮改为**上下滑动手势**：上滑看歌词，下滑回封面 |
| PosterMode | 保留，但要进入/退出手势明确，可在长按封面或双击时切换 |
| 底部主控 | 仅保留：上一首、播放/暂停、下一首、喜欢、播放队列 |
| 次级操作 Sheet | 点击 `⋯` 弹出底部 Sheet：`添加到歌单 / 睡眠定时 / 倍速 / 音量 / 分享 / 悬浮歌词开关` |
| 顶部栏 | 保留关闭按钮、歌曲名/歌手、歌词设置入口；歌词设置改为页面内弹窗或 Push |

### 10.3 视觉上

- 封面居中，占屏幕 40%-45% 高度。
- 歌词区域 `fontSize` 在手机上用 `typography.heading` ~ 20，确保可读。
- 高亮行加大/加粗，上下行减弱透明度。

---

## 11. Token 与间距调整

在 `apps/mobile/src/theme/tokens.ts` 基础上只新增/调整少量值：

```ts
export const layout = {
  pagePadding: 16,
  tabletPagePadding: 20,
  songRowMinHeight: 56,
  songRowPadding: 8,
  artworkSize: 48,
  headerHeight: 56,
  compactControlHeight: 36,
  playerBarHeight: 56,       // 新增：约束 PlayerBar 高度
} as const;
```

- 不新增颜色 token，继续复用 `themePaletteModel`。
- 不改动字体 scale，只在使用处降级（例如 Hero title 从 `display` 降到 `heading`）。

---

## 12. 可访问性

- 所有图标按钮保留 `accessibilityRole="button"` 和 `accessibilityLabel`。
- PlayerBar 进度条保持 `accessibilityRole="adjustable"`。
- 底部标签使用 `tabBarAccessibilityLabel`。
- 自动隐藏控件后，屏幕朗读用户需可通过双击恢复控件，因此隐藏的控件应设 `accessibilityElementsHidden` 并在恢复时重新参与。

---

## 13. 影响文件清单

| 文件 | 改动说明 |
|---|---|
| `apps/mobile/src/navigation/RootNavigator.tsx` | Drawer 保留，内部从旧 9 项改为 BottomTabs + 抽屉内容 |
| `apps/mobile/src/navigation/MainDrawerNavigator.tsx` | 重构为底部 4 标签 + Drawer 内容组件 |
| `apps/mobile/src/navigation/types.ts` | 更新 ParamList 类型 |
| `apps/mobile/src/navigation/navigationRef.ts` | 更新 navigate 辅助函数 |
| `apps/mobile/src/components/AppShell.tsx` | 保留 Drawer 逻辑，接入 BottomTabs |
| `apps/mobile/src/components/AppHeader.tsx` | 保留汉堡，移除前进按钮 |
| `apps/mobile/src/components/PlayerBar.tsx` | 精简为一行 + 更多菜单 |
| `apps/mobile/src/components/AppSidebar.tsx` | 重构为 Drawer 内容（账号+工具+设置） |
| `apps/mobile/src/screens/HomeScreen.tsx` | 收紧 spacing/字号 |
| `apps/mobile/src/screens/LibraryScreen.tsx` | 拆分为 TopTab（歌单/B站）|
| `apps/mobile/src/screens/MyMusicScreen.tsx` | 新增：账号卡片 + 本地/历史/下载 TopTab |
| `apps/mobile/src/screens/ImmersiveLyricsScreen.tsx` | 自动隐藏 + 手势切换 + 次级 Sheet |
| `apps/mobile/src/services/appShellModel.ts` | 更新导航状态推导 |
| `apps/mobile/package.json` | 若未安装则加入 `@react-navigation/bottom-tabs` / `@react-navigation/material-top-tabs` |
| `apps/mobile/src/theme/tokens.ts` | 新增 `layout.playerBarHeight` |

---

## 14. 验收标准

### 14.1 导航

- [ ] 打开 App 后看到底部 4 个标签，切换无需打开抽屉。
- [ ] 汉堡按钮 / 右滑能打开抽屉，抽屉内显示账号、工具、设置。
- [ ] 从 Header 搜索框回车，push 进 SearchScreen。
- [ ] Daily / FM 从首页 Hero 或抽屉进入，按 Back 返回。
- [ ] 所有详情页（歌单/专辑/歌手/B站合集）push 正常，按 Back 返回。

### 14.2 PlayerBar

- [ ] 小屏（5.5 英寸以下模拟器/真机）PlayerBar 高度不超过 56dp，不折行。
- [ ] 播放/暂停、下一首、喜欢、`⋯` 可触控区域不小于 44dp。
- [ ] `⋯` 菜单能正确唤起并操作：播放模式、上一首、添加到歌单、睡眠定时、悬浮歌词、音量/静音、展开全屏。

### 14.3 曲库

- [ ] 曲库页顶部有 2 个子标签（歌单/B站），切换不卡顿。
- [ ] 未登录网易云时，「歌单」tab 显示登录卡片。

### 14.4 我的

- [ ] 顶部账号卡片显示正确，点击能打开抽屉。
- [ ] 三个子标签（本地/历史/下载）切换正常。
- [ ] 本地 tab 通过 FAB 触发扫描。

### 14.5 沉浸式播放器

- [ ] 进入 3 秒后顶部/底部控件自动隐藏，点击屏幕恢复。
- [ ] 上下滑动可在歌词和封面间切换。
- [ ] `⋯` 弹出的次级 Sheet 覆盖所有高频次操作。

### 14.6 Home

- [ ] 6.5 英寸手机上首屏能看到完整 Hero + 至少 2 行最近播放卡片。
- [ ] 私人 FM / 搜索音乐入口保留。

---

## 15. 不在本次范围

- 不新增播放器音效（EQ/混响），移动端暂时没有该能力。
- 不改本地音乐扫描的底层权限逻辑。
- 不改动桌面端任何代码。
- 不改后端 API / 数据模型，仅改 UI/UX 层。

---

## 16. 分阶段实施建议

| 阶段 | 内容 | 影响面 |
|---|---|---|
| Phase 1 | 导航重构：MainDrawer 保留但内容改为 BottomTabs + Drawer 内容组件 | 大 |
| Phase 2 | PlayerBar 精简 + 更多菜单 | 中 |
| Phase 3 | LibraryScreen TopTab 拆分（歌单/B站）+ MyMusicScreen 新建 | 中 |
| Phase 4 | AppSidebar 重构为账号/工具/设置抽屉 | 中 |
| Phase 5 | 沉浸式播放器 auto-hide + 手势优化 | 中 |
| Phase 6 | HomeScreen 间距/字号微调 + 回归测试 | 小 |

建议按顺序做，每阶段完成后在 Android 真机上跑一遍主要路径。
