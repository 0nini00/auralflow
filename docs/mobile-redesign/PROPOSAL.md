# AuralFlow Mobile · 界面重构设计方案 v1

> 2026-10-23 · 基于 `apps/mobile` 当前代码（v0.7.10）与 `@lx/core` 现状
>
> 配套原型：[`mockup.html`](./mockup.html)（可切浅色 / 深色）
> 预览图：[`assets/preview-light.png`](./assets/preview-light.png) · [`assets/preview-dark.png`](./assets/preview-dark.png) · [`assets/preview-screens.png`](./assets/preview-screens.png)
>
> 范围：**只改移动端界面层**。播放引擎、音源解析、缓存、WebDAV、歌词解析、Android 原生模块均不动。

---

## 0. 一页结论

这次重构不做「换皮」，做四件结构性的事：

1. **删掉 Drawer**。它现在只装 8 类设置（另有设置首页），却占着一层导航、一套手势和一套返回分支。设置搬进「我的」。
2. **重定义四个 Tab**：首页 / 搜索 / 音乐库 / 我的。把散在「曲库」和「我的」两处的歌单、收藏、本地、历史、下载合并进「音乐库」。
3. **把绿色收回来**。默认主题色与按钮/文字统一深绿 `#0D7A42`；旧品牌荧光绿 `#3BD877` 从界面色彩中退役，仅保留旧值迁移（logo 图片素材不受影响）。
4. **让封面驱动播放页**。播放页恒定深色，背景由封面取色生成；列表页保持中性，封面是唯一的彩色区域。

外观设置提供 8 个预设主题色（默认 `#0D7A42`）与 HSV 调色盘；旧品牌绿 `#3BD877` 自动迁移到默认深绿。

量化结果：

| 指标 | 现在 | 方案 |
|---|---|---|
| 常驻框架（顶栏 + 迷你播放器 + 标签栏） | 182 px | 136 px |
| 390×844 下内容可视高度 | ≈ 614 px | ≈ 662 px（+7.8%） |
| 设置入口 | 1 个（藏在全屏抽屉里） | 1 个（我的 → 设置，可见） |
| 歌单位置 | 「我的」（与账号混在一起） | 「音乐库」（与本地/收藏同屏） |
| 搜索入口 | 2 个（全局顶栏 + 搜索 Tab） | 1 个（搜索 Tab） |
| 主色文字对比度 | 1.86:1（不达标） | 5.4:1（AA） |
| 正文基准字号 | 14 | 15 |

交付物：**8 屏高保真原型 + 完整令牌 + 组件清单 + 5 阶段实施计划**。确认后按阶段 0 开始改代码。

### 实施状态（2026-10-23）

- ✅ **阶段 0**：令牌与主题（暖中性画布、`primaryInk`、`actionFill` 按钮、Chip 选中态、字号/间距）。
- ✅ **阶段 1**：导航壳（删除 Drawer、根 Stack、64px 标签栏、浮起迷你播放器、PageHeader、设置从「我的」进入）。
- ✅ **阶段 2**：音乐库单屏五段（歌单/本地/收藏/历史/下载）；歌单从「我的」迁入；首页「继续收听」+ 4 格快捷入口；搜索空态「按风格浏览」。
- ✅ **阶段 3**：播放页恒定深色 + 封面氛围色、66px 实心播放键、队列直入口、封面/歌词页指示点。
- ✅ **阶段 4**：详情页封面 128 + 品牌实心播放全部；设置首页与「我的」设置区改分组行列表。
- 🟡 **阶段 5 打磨**：详情页悬浮吸顶栏与「我的」本周统计卡已完成；队列当前曲钉住卡、热搜数据、全局动效细化留待后续。
- 验证：`pnpm mobile:typecheck` / `pnpm mobile:lint` / `pnpm mobile:test`（537 例）全绿。

详见 [`IMPLEMENTATION.md`](./IMPLEMENTATION.md)。

---

## 1. 项目理解

### 1.1 产品是什么

AuralFlow 是一个跨平台音乐播放器：Windows 桌面端（Tauri v2 + React 18）与 Android 移动端（React Native 0.86 + React 19），共享 `@lx/core` 的领域模型与纯逻辑。

它要解决的核心问题只有一个：**让「点一首歌就能听到它」在多音源环境下依然可靠**。用户不该关心歌来自网易云、QQ 音乐、本地文件还是自己导入的 LX 脚本。由此推出三条主线：多源取链互为兜底、双端能力对齐、确定性优先于聪明。

这一点直接决定了界面该突出什么：**「正在播放什么、它从哪来、下一首是什么」比运营位更重要**。当前界面把多源标签默认隐藏（`SongList` 的 `hideSourceTag = true`），反而把产品最独特的能力藏了起来。

### 1.2 移动端技术底座与硬约束

| 维度 | 事实 | 对设计的约束 |
|---|---|---|
| 框架 | RN 0.86 + React 19.2.3，Hermes | 无 `new Function`；LX 脚本走隐藏 WebView，不影响 UI |
| 播放 | react-native-track-player 4.1.2 / ExoPlayer | 播放状态由原生事件驱动，UI 不能假设 JS 定时器可靠 |
| 导航 | React Navigation 7：Drawer > NativeStack > BottomTabs + MaterialTopTabs | 现有四层；本次压到两层 |
| 状态 | 16 个 Zustand store，**选择器必须返回稳定引用** | 新组件不能在选择器里新建对象/数组 |
| 动效 | Reanimated 4.5.1、gesture-handler 3、PagerView 8 | 共享元素、手势、弹簧动画都有现成能力 |
| 原生 | 11 个 Android 模块，含 `CoverColorModule` | 封面取色不需要新写原生代码 |
| 底线 | minSdk 24，无 RECORD_AUDIO | 动效与模糊要考虑低端机；不做频谱分析 |

### 1.3 现有信息架构与视觉系统

- **导航**：Drawer（8 类设置）→ MainTabs（首页 / 搜索 / 曲库 / 我的）→ 曲库内 MaterialTopTabs（本地音乐 / 播放历史 / 下载）。
- **顶栏**：`AppHeader` 在除设置与播放页之外的每个页面渲染：汉堡、返回、全局搜索框、主题切换。
- **迷你播放器**：作为自定义 `tabBar` 的上一行，固定 56 px；push 页由 `AppShell` 贴底渲染。
- **沉浸播放**：`ImmersiveLyricsScreen` 全屏 Modal + PagerView 两页（封面 / 歌词）。
- **视觉**：浅色 `#F8F9FA` 画布 + 纯白表面；深色 `#121212` + `#1A1A1A`；强调色 `#3BD877` 可自定义；圆角 8/12/16/20；正文 14、说明 12。
- **组件**：5 个 `ui/` 原语（Button / Chip / IconButton / ListItemButton / ModalActions）+ 兼容包装器；业务组件各自硬编码样式。

### 1.4 与桌面端的关系

桌面端已有一版重构方向文档（`docs/ui-redesign/DIRECTIONS.md`、`PROPOSAL.md`），讨论的是侧栏、标题栏、88 px 播放条。移动端是**另一个表面**：不追求逐像素一致（`goal-and-requirements.md` 明确「不做逐像素的双端一致性」），但共享暖中性画布、深绿色相、深浅双主题、圆角卡片与沉浸氛围。本方案是移动端的对应物。

---

## 2. 现状审计

### 2.1 导航：四层，抽屉只装设置

`RootNavigator.tsx` 把 Drawer 放在根部；`DrawerContent.tsx` 的全部内容是品牌头 + 8 个设置分类 + 版本号。也就是说：

- 一个全屏抽屉、一套边缘手势、一个 `BackHandler` 分支，只为了打开设置；
- `AppShell.tsx` 里为了抽屉写了 `findOpenDrawerKey`、`DrawerActions.closeDrawer` 等逻辑；
- 设置页本身已经是 `SettingsNavigator` 的 9 个页面（设置首页 + 8 类），抽屉只是它的第二入口。

**结论**：抽屉的存在成本远高于收益。设置放进「我的」，是 Android 用户最熟悉的归属。

### 2.2 内容归属：三处重复

| 内容 | 现在在哪 | 问题 |
|---|---|---|
| 歌单（本地 + 网易云） | 「我的」 | 「曲库」里反而没有歌单，名不副实 |
| 本地音乐 / 历史 / 下载 | 「曲库」的三个顶 Tab | 与「我的」的快捷入口（播放历史）重复 |
| 搜索 | 全局顶栏 + 搜索 Tab | 同一个意图两个入口，顶栏还占 70 px |
| 主题切换 | 每个页面顶栏 + 设置 → 外观 | 同一个设置两个入口 |
| 设置 | 抽屉（唯一入口） | 藏在全屏抽屉里，不可预期 |

「我的」现在是账号 + 快捷入口 + 本地歌单 + 云端歌单 + 新建/导入/导出，信息密度过高；「曲库」只剩本地文件、历史、下载，语义过窄。

### 2.3 空间：182 px 常驻框架

按 390×844 计算：

```
现在：状态栏 24 + 顶栏 70 + 迷你播放器 56 + 标签栏 56 + 手势区 24 = 230
      内容可视 ≈ 614 px（72.7%）
方案：状态栏 24 + 迷你播放器 64 + 间隙 6 + 标签栏 64 + 手势区 24 = 182
      内容可视 ≈ 662 px（78.4%）
```

顶栏还是「浮动圆角卡片 + 搜索框」，视觉上比内容更抢眼；滚动时不会收起，长期占用最宝贵的一行。

### 2.4 视觉：绿色通胀与对比度

| 问题 | 证据 | 影响 |
|---|---|---|
| 主色对比度不足 | `#3BD877` 在白底 1.86:1，却被用作图标、链接、Tab 文字 | 浅色模式下看不清，不符合 WCAG AA |
| 绿色铺满 | 抽屉 9 个图标全绿、Tab 选中全绿、Chip 全绿、链接全绿 | 没有「重点」，品牌色失去信号意义 |
| 深色边框偏蓝 | `#334155`（slate）配绿色强调 | 冷暖冲突，卡片边界发灰 |
| 深色层级弱 | `#121212` / `#1A1A1A` 只差 8 级 | 卡片与背景糊在一起，只靠 1px 边框 |
| 字号偏小 | 正文 14、说明 12、Tab 12 | 390 dp 上偏紧，长时间阅读累 |
| 无阴影体系 | 移动端 token 只有几何，没有 elevation | 卡片、弹层、迷你播放器缺层次 |

### 2.5 组件与状态

- 5 个原语是好的基础，但页面层仍在各写各的：`HomeFeedSections` 自己实现卡片与 rail，`MyMusicScreen` 用 `QuickActionCard`，`LibraryScreen` 用 `ActionButton`，`SongList` 是一个 1000+ 行的「全能行」（下载、变体、MV、多选、编辑）。
- 空态 / 错误态 / 加载态不统一：有的用 `ActivityIndicator + 文案`，有的用占位块，有的直接空白；只有歌单详情有 `PlaylistDetailSkeleton`。
- `SongList` 默认隐藏来源标签，多源这个核心差异点在列表里看不见。

### 2.6 问题清单

**P0 · 结构**

1. Drawer 只装设置，层级浪费。
2. 曲库 / 我的 的内容归属混乱，歌单不在「库」里。
3. 全局搜索与搜索 Tab 重复。
4. 182 px 常驻框架 + 不收起的大标题区。

**P1 · 视觉**

5. 主色对比度不达标，且过度使用。
6. 字号偏小、层级平，页面像「一堆等权重的卡片」。
7. 深色配色冷暖冲突、层级弱。
8. 播放页缺少与封面相关的身份感。

**P2 · 打磨**

9. 空 / 错 / 载三态不统一。
10. 没有统一的动效与触感语言。
11. 多源标签默认隐藏，差异化能力不可见。

---

## 3. 设计目标与原则

### 3.1 目标

| 目标 | 可验证的结果 |
|---|---|
| 更快开始 | 冷启动 → 首页「继续收听」一键续播；播放页主按钮 66 px 落在拇指区 |
| 更少误触 | 所有可点区域 ≥ 44；列表行 52–60；主操作不与滚动区争夺手势 |
| 更强辨识 | 每屏只有一个绿色主按钮；播放页背景随封面变化 |
| 更省眼力 | 正文 15、说明 13；浅色对比度全部 ≥ 4.5；深色不刺眼 |
| 可持续扩展 | 所有页面消费同一套 token 与 12 个共享组件，不再各写各的 |

### 3.2 五条原则

1. **封面是光源，界面是暗房**：播放页 / 详情页用封面取色；列表页保持中性。
2. **绿色只代表「现在」和「下一步」**：播放中、主按钮、选中态；其余全部中性。
3. **一个意图，只留一个入口**：设置只在「我的」，歌单只在「音乐库」，搜索只在「搜索」。
4. **主操作落在拇指区**：播放、继续收听、播放全部固定在屏幕下三分之一。
5. **框架会退让，内容不打折**：大标题随滚动收起，迷你播放器浮起，常驻框架压到 136 px。

外加一条元原则：**不为了新而新**。导航层级、返回逻辑、手势方向保持 Android 习惯；只改信息组织、视觉权重与操作位置，所有现有功能都有落点。

---

## 4. 信息架构

### 4.1 新结构

```
Root Stack（无 Drawer）
├─ MainTabs
│  ├─ 首页       继续收听 · 快捷入口 · 推荐 · 今日推荐 · 排行榜
│  ├─ 搜索       搜索框 · 最近搜索 · 热搜 · 风格 · 结果分组
│  ├─ 音乐库     歌单 / 本地 / 收藏 / 历史 / 下载（分段芯片）
│  └─ 我的       账号 · 听歌统计 · 云盘 · 音源 · 同步 · 设置
├─ Player（全屏模态，封面 / 歌词两页）
├─ 详情（歌单 / 专辑 / 歌手 / 本地歌单）
├─ 每日推荐 / 私人 FM / 排行榜 / 歌单广场 / 云盘 / 统计 / MV
└─ Settings（8 类 + 首页，从「我的」进入）
```

### 4.2 内容搬家

| 内容 | 现在 | 之后 |
|---|---|---|
| 设置（8 类） | 抽屉 | 我的 → 设置（保留 `SettingsNavigator`；返回改为「分类 → 首页 → 我的」） |
| 本地歌单 | 我的 → 本地歌单 | 音乐库 → 歌单（「我的歌单」分组） |
| 网易云歌单 | 我的 → 网易云歌单 | 音乐库 → 歌单（「收藏的歌单」分组） |
| 我喜欢 / 收藏 | 我的 → 快捷入口 | 音乐库 → 收藏（独立分段） |
| 播放历史 / 下载 | 曲库 → 顶部 Tab | 音乐库 → 分段芯片 |
| 歌单广场 / 排行榜 | 首页快捷入口 | 首页快捷入口 + 搜索空态 |
| 主题切换 | 顶栏图标 + 设置 | 我的 → 外观（行内开关） |
| 全局搜索 | 每页顶栏 | 搜索 Tab（音乐库头部保留一个搜索图标） |

### 4.3 路由映射

| 旧路由 / 入口 | 新路由 | 兼容处理 |
|---|---|---|
| `Drawer → Settings` | `RootStack → Settings` | 直接 navigate，返回栈更短 |
| `LibraryTab → Local/History/Downloads`（TopTabs） | `LibraryTab` + `params.section` | `openHistoryScreen` 等封装改为传 section；旧深链在 `navigationRef` 里映射 |
| `MyMusicTab` 的歌单区 | `LibraryTab` + `section: "playlists"` | store 不变，只换宿主页面 |
| `SearchTab` | `SearchTab` | 保留；空态扩展为发现页 |
| `Player` Modal | `Player` Modal | 保留；视觉与手势重做 |
| `Settings` 的 9 个子路由 | 不变 | `SettingsNavigator` 不动 |

### 4.4 返回、手势与深链

- **返回**：Tab 根 → 退出 App（Android 默认）；详情 / 设置 → pop；播放页 → 下滑或返回键关闭。删除抽屉后，`AppShell` 的 `BackHandler` 可以去掉「先关抽屉」分支。
- **手势**：播放页左右滑切歌、上滑开队列、下滑关闭；歌词页双指缩放；列表长按多选。避免与横向 rail 冲突：rail 只在列表页，播放页没有横向滚动容器。
- **深链**：现有 `openXxxScreen` 封装集中改一次；保留 `LibraryTab` 的旧 section 名称，避免外部链接失效。

---

## 5. 视觉系统

### 5.1 色彩

品牌绿从界面退役，绿色拆成三个角色：**填充**、**行动色**、**填充上的文字**。这是本次最关键的一次改色。

| Token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `canvas` | `#F3F3EF` | `#0B0F0D` | 页面底 |
| `surface` | `#FFFFFF` | `#121815` | 卡片 / 标签栏 / 迷你播放器 |
| `surfaceMuted` | `#EBEBE4` | `#19211D` | 输入框 / Chip / 图标底 |
| `surfaceStrong` | `#E0E0D6` | `#222C27` | 进度条底 / 分隔块 |
| `border` | `#E3E3D9` | `#26312C` | 1px 描边 |
| `text` | `#161A16` | `#F1F5F2` | 主文字 |
| `textMuted` | `#5B615A` | `#A7B3AE` | 次文字 |
| `textSubtle` | `#8B918A` | `#6E7C77` | 辅助 / 占位 |
| `action` | `#0D7A42` | `#6FE7AC` | 文字链接 / 图标行动色 |
| `actionFill` | `#0D7A42` | `#0D7A42` | 按钮/开关填充（与文字行动色同档） |
| `onActionFill` | `#FFFFFF` | `#FFFFFF` | 按钮填充上的文字 |
| `brand` | `#3BD877` | `#3BD877` | 旧品牌绿，仅迁移使用，不再进界面 |
| `danger` | `#EF4444` | `#EF4444` | 删除 / 错误 |

对比度：

- `#0D7A42` on `#FFFFFF` = **5.4:1**；on `#F3F3EF` ≈ **4.7:1**（AA 正文达标）。
- `#FFFFFF` on `#0D7A42` = **5.4:1**（主按钮）。品牌绿 `#3BD877` 不再承载文字，也不再进界面。
- `#6FE7AC` on `#0B0F0D` ≈ **12:1**（深色行动色）。
- 旧的 `#3BD877` on white = **1.86:1**，只能做装饰，不能承载文字。

**与桌面端的关系**：桌面端重构已选定「暖中性 + 深绿」方向（画布 `#F3F3EF`、强调色 `#17A34A`）。移动端沿用同一画布与同一色相；但 `#17A34A` 在白底只有 3.3:1，移动端正文与链接需要 4.5，因此行动色压深到 `#0D7A42`（5.4:1）。旧品牌绿 `#3BD877` 退役；两端并排看仍是同一个深绿色相，不是两套品牌。

来源色只做 6 px 圆点，不做整块标签：`wy #FF5A5F` / `tx #2ECC8F` / `local #8B918A` / 自定义 `#A78BFA`。

**用法规则**：

- 主按钮：`actionFill` 填充 + `onActionFill` 文字。
- 文字链接 / 次级图标：`action`。
- 播放中、当前曲、当前 Tab：`action` 或 `brand`。
- 其余图标、标题、分割线：`text` / `textMuted` / `border`。
- 一屏最多一个绿色填充按钮。

### 5.2 字体

不引入新字体（APK 体积与中文衬线适配成本都不划算），使用 Android 系统字体栈（Roboto / MiSans / HarmonyOS Sans）。

| Token | 字号 / 行高 | 字重 | 用途 |
|---|---|---|---|
| `micro` | 11 / 14 | 600 | Tab 标签、角标 |
| `caption` | 12 / 16 | 400 | 辅助说明 |
| `meta` | 13 / 18 | 400 | 歌手、时长、来源 |
| `body` | 15 / 22 | 400 | 正文 |
| `title` | 17 / 24 | 600 | 区块标题 |
| `section` | 20 / 26 | 700 | 页面区块 |
| `display` | 28 / 34 | 750 | 主页面大标题 |
| `hero` | 34 / 40 | 750 | 播放页大标题（备用） |

规则：

- 中文标题 `letter-spacing: -0.02em`；正文 0；全大写小标签 `+0.08em`。
- 时间、计数、码率用 `font-variant-numeric: tabular-nums`。
- 正文最小 12；11 只用于 Tab 与角标，不承载关键信息。
- 支持系统字体放大到 1.3×；Tab 标签用 `maxFontSizeMultiplier={1.2}` 防裁切。

### 5.3 间距、圆角、层级

| 类别 | 值 |
|---|---|
| 间距 | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 |
| 页面边距 | 20（平板 24） |
| 区块间距 | 32 |
| 卡片内边距 | 16 |
| 列表行高 | 52（设置）/ 58（歌曲）/ 64（歌单卡） |
| 圆角 | 8（角标）/ 12（小卡）/ 16（封面）/ 20（卡片）/ 28（弹层）/ 999（胶囊） |
| 触控 | ≥ 44；图标按钮 44 容器 + hitSlop |

层级：

| 层级 | 浅色 | 深色 |
|---|---|---|
| e1 列表 | `0 1px 2px rgba(16,22,20,.06)` | 亮度差 + `border` |
| e2 卡片 / 迷你播放器 | `0 6px 20px rgba(16,22,20,.10)` | `0 10px 24px rgba(0,0,0,.45)` |
| e3 弹层 | `0 18px 40px rgba(16,22,20,.16)` | `0 20px 48px rgba(0,0,0,.55)` |

深色下不靠阴影区分，靠 `surface` 的亮度阶梯（`#0B0F0D → #121815 → #19211D`）。

### 5.4 图标

- 继续用 `lucide-react-native` 0.460.0，描边从 2 降到 **1.8**，视觉更轻。
- 尺寸：18（行内）/ 20（常规）/ 22（Tab）/ 26（播放控制）。
- 仅播放 / 暂停使用填充；其余保持线性。
- 图标按钮容器 44，图标 20；视觉重量靠容器与间距，不靠放大图标。

### 5.5 封面氛围背景（技术实现）

原型里的播放页背景是模糊光晕，但 **RN 不支持 CSS `filter: blur`**，实现要换一种方式。好消息是这条链路已经存在：

- `services/coverColorService.ts` 已封装 `CoverColorModule`（androidx.palette），并做了「本地缓存封面优先、按 URL + 明暗缓存 240 条、并发去重、失败返回空色」。
- `ImmersiveLyricsScreen` 已在 `ambientCoverTint` 开启时使用它，叠一层 `LinearGradient`。

本期做的是**把它从「可选叠加」升级为播放页的默认底色**，并补足层次：

1. 底层：`#0B0F0D`。
2. 左上：`base` → 透明，`opacity 0.55`。
3. 右下：`accent` → 透明，`opacity 0.35`（`accent` 为空时只用 `base`）。
4. 顶部 / 底部：黑色纵向渐变，保证文字对比度 ≥ 4.5:1。
5. 需要更柔的过渡时，用 `react-native-svg` 的 `RadialGradient` 代替 blur。
6. **性能**：颜色只在 `artwork` 变化时取一次；`fetchCoverColors` 已有缓存，不随 0.25s 进度 tick 重算。
7. **降级**：取色失败或无封面时回退到 `palette.brand` 的深色渐变；保留 `ambientCoverTint` 开关，默认开启。

### 5.6 深色模式

- 不用纯黑 `#000`：`#0B0F0D` 带一点绿调，和品牌色同一色相，OLED 上也不会有拖影。
- 边框从 slate `#334155` 换成 `#26312C`，去掉冷暖冲突。
- 播放页**恒定深色**（见 §12 Q2）；其余页面跟随系统 / 手动 / 定时。
- 状态栏：浅色主题 `dark-content`，深色 `light-content`；播放页强制 `light-content`。

---

## 6. 页面设计

> 以下尺寸均为 390×844 基线；括号内为组件高度。

### 6.1 首页

**目标**：打开就知道「现在听什么」，其次才是发现。

**结构**

1. 大标题区（约 72）：日期 12 + 「晚上好」28 + 头像 40。滚动后收成 56 的紧凑标题。
2. 继续收听卡（88）：封面 56 / 标题 15 / 元信息 11 / 进度线 2 / 播放 40。没有播放记录时，降级为「从每日推荐开始」。
3. 快捷入口（4 格）：54 图标块 + 11 标签。登录时为「每日推荐 / 私人 FM / 排行榜 / 歌单广场」；未登录时前两格替换为「本地音乐 / 下载」，**不渲染任何依赖账号的入口**（沿用 `goal-and-requirements.md` 的规则，同时保持 4 格布局不塌陷）。
4. 为你精选（rail）：封面 132 + 标题 13.5 + 元信息 11；右侧渐隐提示可滑。
5. 今日推荐（列表）：行高 58，封面 44；默认显示 1–5 首，底部「查看全部 30 首」。
6. 排行榜（可选）：3 张 108 卡片，带名次角标。

**交互**：点继续收听卡任意位置 → 打开播放页并续播；点播放按钮 → 原地续播；长按卡片 → 更多（加入队列 / 查看专辑）。

**状态**：无历史 → 引导卡；加载 → 3 行骨架；单区块失败 → 行内错误 + 重试，不影响其他区块。

**与现状差异**：去掉 6 个深色胶囊快捷入口；新增「继续收听」；排行榜与歌单广场不再只靠首页，搜索空态也能到达。

---

### 6.2 搜索

**目标**：空态就是发现页，输入后原地变结果。

**结构**

1. 大标题「搜索」28。
2. 搜索框 46：圆角 15，`surfaceMuted` 底，左搜索图标、右麦克风（语音搜索可选）。
3. 最近搜索：标题 13 + 可删除 Chip 30。
4. 热搜榜：行高 44，前 3 名用行动色序号，右侧「热 / 新」角标。
5. 按风格浏览：2 列 × 3 行，54 高渐变块。
6. 结果态：分段「单曲 / 歌单 / 专辑 / 歌手 / 视频」+ 来源筛选；行高 58，元信息带来源圆点；多源曲目显示「多源」角标，点击打开变体选择。

**交互**：输入 220ms 防抖（沿用现有）；提交后收键盘；结果页顶部保留搜索框，可继续改词。

**状态**：空态（发现）、输入中（建议）、加载（骨架）、无结果（关键词 + 建议）、错误（重试）。

**与现状差异**：移除顶栏全局搜索框；空态从「只有输入框」变成可逛的发现页；来源筛选显性化。

---

### 6.3 音乐库

**目标**：一个地方管所有「我拥有的音乐」。

**结构**

1. 标题「音乐库」26 + 搜索图标 + 更多。
2. 分段芯片 32：歌单 / 本地 / 收藏 / 历史 / 下载（横向可滑，选中实心墨色）。
3. 工具行：数量 / 容量 + 排序。
4. 歌单：2 列卡片（封面 1:1，圆角 16），「新建歌单」为虚线卡；分组「我的歌单」「收藏的歌单」。
5. 本地：扫描 / 导入 / 排序；行内显示格式、码率、大小。
6. 收藏：顶部「我喜欢」大卡 + 列表。
7. 历史：按日期分组，右上角日历入口。
8. 下载：筛选「全部 / 进行中 / 已完成」，进行中显示进度与速度。

**交互**：长按任意行进入多选，底部出现操作条（加入队列 / 下载 / 删除 / 移动）；分段切换保留滚动位置；下拉刷新只刷新当前段。

**状态**：空库（扫描 CTA）、扫描中（进度）、无收藏、无历史、无下载、权限被拒（去设置）。

**与现状差异**：取代「曲库三个顶 Tab + 我的两段歌单」；`LibraryScreen` 成为唯一宿主；`MaterialTopTabs` 不再需要。

---

### 6.4 我的

**目标**：只放「关于我」的内容，成为设置与账号的家。

**结构**

1. 标题「我的」28 + 头像。
2. 账号卡（80）：头像 52 / 昵称 16 / 「网易云 · Lv.9 · 已登录」11；未登录时为登录 CTA。
3. 统计卡（96）：本周时长 / 播放次数 / 歌手数，三列；点击进入听歌统计。
4. 第一组（52 行）：音乐云盘 / 自定义音源 / WebDAV 同步。
5. 第二组：外观 / 播放与音质 / 歌词与浮窗 / 设置。

**交互**：外观行右侧直接放「跟随系统 / 浅色 / 深色」三态开关，不用进二级页；WebDAV 行显示同步状态点。

**状态**：未登录（账号卡变 CTA，云盘/同步仍可见但进入时提示）；同步中（行内 spinner）；同步失败（红点 + 行内说明）。

**与现状差异**：不再承载歌单与收藏；设置从抽屉搬入；主题切换从顶栏搬入。

---

### 6.5 播放（封面页）

**目标**：一屏只有一件事——当前这首歌。

**结构**

1. 顶部栏 54：下箭头 40 / 「正在播放 · 来自每日推荐」/ 更多 40。
2. 封面 318，圆角 26，投影；背景为封面取色的氛围渐变。
3. 标题 25/750；元信息 13：来源圆点 + 歌手 + 音质。
4. 进度条 3 px + 时间 10.5 tabular。
5. 传输：随机 44 / 上一首 48 / 播放 66 / 下一首 48 / 循环 44。
6. 操作行：歌词 / 队列 / 定时 / 音质（图标 19 + 标签 9.5）。
7. 页面指示：两个点，当前页为 16 px 胶囊。

**交互**：左右滑切歌（封面视差 0.3）；上滑开队列；下滑关闭；点封面切歌词页；长按封面下载（沿用现有）。

**状态**：加载中（播放键内 spinner）、失败（顶部行内提示 + 重试）、无封面（品牌渐变占位）、无音源（提示换源）。

**与现状差异**：播放键从 56 → 66；增加氛围背景与操作行；页面指示明确「还有一页歌词」。

---

### 6.6 歌词

**目标**：跟唱不费眼，切页不打断。

**结构**

- 与封面页共用顶部栏与背景，只换中间区域。
- 歌词区上下渐隐遮罩；当前行 24/750，前后行 17/500（30% 白）；译文 13（62% 白）。
- 底部：细进度条 + 时间 + 上一首 / 播放 56 / 下一首。
- 操作行保留「歌词 / 队列 / 定时 / 音质」，当前项高亮。

**交互**：点行跳转；双指缩放字号（16–30）；滚动暂停自动跟随 3 秒；长按复制；简繁转换沿用设置。

**状态**：无歌词 → 居中「这首歌没有歌词」+ 说明「本地曲只读取文件内嵌或同名 .lrc」；纯音乐 → 「纯音乐，请欣赏」；加载中 → 3 行骨架。

**与现状差异**：当前行更大、译文更弱；底部控制更轻；不再需要额外的「歌词页」导航。

---

### 6.7 队列

**目标**：看清「接下来是什么」，并能立刻调整。

**结构**

- 底部抽屉 596，顶部圆角 28，手柄 34×4。
- 标题「播放队列 + 12 首 · 剩余 38 分钟」+ 清空。
- 当前曲固定卡：左侧 3 px 绿色竖条 + 封面 42 + 绿色标题 + 波形图标。
- 「接下来播放」：行高 52，封面 38，右侧拖拽手柄。
- 底部安全区。

**交互**：长按拖拽排序；左滑移除；点击跳播；清空二次确认。

**状态**：空队列 → 空态；单曲循环 → 提示「当前为单曲循环」。

**与现状差异**：当前曲从列表中分离并钉在顶部；拖拽手柄常驻，不再隐藏。

---

### 6.8 歌单详情

**目标**：快速确认「这是什么」并开始播放。

**结构**

1. 悬浮导航：返回 36 / 更多 36。
2. 头部：封面 128 + 类型标签 9.5 + 标题 20/750 + 元信息 11 + 创建者。
3. 操作行：播放全部（实心行动绿，44 高，唯一主按钮）+ 随机 44 + 下载 44。
4. 曲目列表：行高 54，序号 11 tabular；当前曲绿色 + 波形；其余右侧更多。
5. 底部「查看全部 32 首」。

**交互**：上滑头部收成 56 px 条（返回 + 标题 + 更多）；播放全部从第一首开始；随机播放打乱队列。

**状态**：空歌单、加载骨架、部分歌曲无版权（行内「换源」）、下载中（行内进度）。

**与现状差异**：头部从「大封面居中」改为「封面 + 信息同排」，首屏能多看到 3–4 首歌；主按钮只有一个。

---

## 7. 组件库

### 7.1 保留与改造

| 组件 | 处理 | 说明 |
|---|---|---|
| `ui/Button` | 改造 | 主按钮改行动绿填充 + 白字；高度 36/44/52 |
| `ui/Chip` | 改造 | 32/36；选中态实心墨色（深色下 actionFill） |
| `ui/IconButton` | 改造 | 容器 36/44/56；描边 1.8 |
| `ui/ListItemButton` | 保留 | 设置行继续用 |
| `ui/ModalActions` | 保留 | 弹窗底部按钮 |
| `PlayerBar` | 改造为 `MiniPlayer` | 浮起 64，进度线在顶部，圆角 20 |
| `AppHeader` | 拆为 `PageHeader` | push 页：返回 + 标题 + 操作；去掉搜索与主题 |
| `SectionHeader` | 改造 | 17/700 + 右侧「全部」文字按钮 |
| `SongList` | 保留 | 功能型长列表继续用；新增轻量 `TrackRow` 给 rail / 预览 |
| `QueueModal` | 改造 | 复用现有 sheet 宿主，重做头部与当前曲卡 |
| `ScreenState` | 扩展 | 统一空 / 错 / 载三态 |

### 7.2 新增

| 组件 | 职责 | 关键 props |
|---|---|---|
| `AppTabBar` | 4 Tab，选中胶囊，64 高 | `state`, `descriptors`, `navigation` |
| `LargeHeader` | 主 Tab 大标题，滚动收起 | `title`, `subtitle`, `right`, `scrollY` |
| `SegmentedChips` | 5 段横向芯片 | `items`, `value`, `onChange` |
| `MediaCard` | 歌单 / 专辑卡（1:1） | `cover`, `title`, `meta`, `onPress` |
| `TrackRow` | 轻量歌曲行 | `song`, `index`, `playing`, `source`, `onPress`, `onMore` |
| `StatTile` | 三列统计 | `items: {value, label}[]` |
| `SettingsRow` | 52 行，图标 + 标题 + 值 + 箭头 | `icon`, `title`, `value`, `onPress` |
| `EmptyState` | 空态 | `icon`, `title`, `description`, `action` |
| `Skeleton` | 骨架（行 / 卡 / 详情） | `variant`, `count` |
| `AmbientBackground` | 封面取色氛围 | `coverUrl`, `colors`, `children` |
| `SourceTag` | 来源圆点 + 文案 | `source`, `showLabel` |
| `SheetHandle` | 抽屉手柄 | — |

### 7.3 关键实现约束

- **Zustand 选择器只返回稳定引用**（`SPEC.md` 的硬规则）。`StatTile`、`SegmentedChips` 的 items 用 `useMemo` 或常量；不要在选择器里 `map`。
- `AppTabBar` 必须自己处理底部安全区，并保持 `MAIN_TAB_BAR_HEIGHT` 的固定高度语义，避免 react-navigation 的内容让位计算出错。
- `MiniPlayer` 继续复用 `setImmersiveFlySource` 的测量结果做封面共享元素，不再新写一套坐标。
- `TrackRow` 用 `memo`，`palette` 与回调保持稳定引用，避免长列表整屏重渲染。
- `AmbientBackground` 只在 `coverUrl` 变化时计算颜色；播放进度更新不得触发它重渲染。

---

## 8. 动效与手势

| 场景 | 参数 | 说明 |
|---|---|---|
| 按压 | `scale 0.97` / `opacity 0.8`，120ms ease-out | 所有可点元素 |
| Tab 切换 | 图标与标签颜色 180ms | 不做页面横移动画 |
| 迷你播放器 → 播放页 | spring(damping 26, stiffness 260) + 封面共享元素 | 复用现有测量 |
| 播放页下滑关闭 | 位移 > 120 或速度 > 800 | 背景随位移淡出 |
| 左右切歌 | 位移 > 25% 或速度 > 800 | 封面视差 0.3 |
| 队列抽屉 | 320ms `cubic-bezier(.2,.8,.2,1)` | 遮罩 200ms 淡入 |
| 歌词行 | 240ms 颜色 + `scale 1.04` | 当前行 |
| 骨架 | 1.6s shimmer | 仅加载态 |

触感：播放 / 暂停轻触；Chip 切换选择反馈；下载完成成功反馈；删除用警告反馈。全部走现有 `hapticService`。

减弱动效：系统开启后，spring 改 120ms 淡入，歌词缩放取消，骨架改静态。

---

## 9. 无障碍与可用性

- **触控**：所有可点区域 ≥ 44；52 行与 44 图标按钮是下限；图标按钮加 `hitSlop`。
- **对比度**：正文 ≥ 4.5:1；大字号 ≥ 3:1；绿色文字只用 `action`，不用 `brand`。
- **不只靠颜色**：当前 Tab 有胶囊底 + 颜色；来源有圆点 + 文案；播放中有波形图标 + 颜色。
- **屏幕阅读器**：图标按钮必须有 `accessibilityLabel`；加载用 `accessibilityLiveRegion="polite"`；错误用 `accessibilityRole="alert"`；队列行播报「第 3 首，共 12 首」。
- **字体缩放**：1.0–1.3 不裁切；Tab 标签限 1.2；标题允许换行。
- **单手**：主操作在底部 1/3；顶部只放返回、标题、更多。
- **横屏 / 平板**：≥ 768 时页面边距 24，歌单网格 3 列，播放页封面最大 360。

---

## 10. 实施计划

> 每个阶段结束都能跑、能截图对比、能回滚。不做大爆炸式重写。

### 阶段 0 · 令牌与主题（S）

**改动**

- `apps/mobile/src/theme/tokens.ts`：新增字阶、圆角、布局常量（`tabBarHeight: 64`、`miniPlayerHeight: 64`、`pagePadding: 20`）。
- `apps/mobile/src/theme/controlTokens.ts`：按钮 36/44/52，图标 18/20/26。
- `apps/mobile/src/services/themePaletteModel.ts`：新增 `action`、`actionFill`、`onActionFill`、`surfaceStrong`、`sourceColors`；保留旧字段做别名。
- `apps/mobile/src/components/ui/*`：按新令牌调整。

**验收**：`pnpm mobile:typecheck` 通过；除颜色外布局不变；浅色 / 深色截图对比。

**风险**：调色板缓存 key 要包含新字段；旧字段别名不要删，避免 100+ 处样式报错。

### 阶段 1 · 导航壳（M）

**改动**

- `navigation/RootNavigator.tsx`：移除 Drawer 包装，改为 Root Stack。
- `navigation/MainTabNavigator.tsx`：新 `AppTabBar`，4 Tab；移除 MaterialTopTabs。
- `components/AppShell.tsx`：删除抽屉打开 / 关闭分支；顶栏只给 push 页。
- `components/AppHeader.tsx` → `components/PageHeader.tsx`。
- `components/PlayerBar.tsx` → `components/MiniPlayer.tsx`。
- `navigation/tabLayout.ts`：更新高度常量。

**验收**：四 Tab 可切换；迷你播放器不遮挡内容；键盘弹出时隐藏；返回键行为正确；无 Drawer 残留。

**风险**：自定义 tabBar 的安全区与高度计算；`SettingsNavigator` 的 `fixup` 重置逻辑；旧深链。

### 阶段 2 · 四个主页面（L）

**改动**

- `screens/HomeScreen.tsx`：继续收听、快捷入口、rail、今日推荐。
- `screens/SearchScreen.tsx`：空态发现页 + 结果分组 + 来源筛选。
- `screens/LibraryScreen.tsx`：分段芯片 + 五个段的内容 + 多选。
- `screens/MyMusicScreen.tsx`：账号、统计、设置入口；歌单移出。
- 新增 `components/large-header`、`segmented-chips`、`media-card`、`track-row`、`stat-tile`、`empty-state`、`skeleton`。

**验收**：所有入口唯一；空 / 错 / 载三态齐全；歌单数据仍来自原 store；无重复请求。

**风险**：`playlistStore` 在音乐库的加载时机；分段切换的滚动位置；Zustand 选择器稳定性。

### 阶段 3 · 播放与歌词（M）

**改动**

- `screens/ImmersiveLyricsScreen.tsx`、`screens/immersive/*`：复用 `coverColorService` 把氛围色升级为默认背景；新传输、歌词、页面指示。
- `components/QueueModal.tsx`：当前曲钉住、拖拽手柄。
- 新增 `components/ambient-background.tsx`、`source-tag.tsx`。

**验收**：播放页 60fps；0.25s 进度 tick 不重渲染整屏；封面共享元素正确；无歌词状态正确。

**风险**：取色异步导致的背景闪变（先用主题底色，取到后再 220ms 淡入）；深色恒定的状态栏；PagerView 与手势冲突。

### 阶段 4 · 详情与设置（M）

**改动**

- `screens/PlaylistDetailScreen.tsx`、`AlbumDetailScreen.tsx`、`ArtistDetailScreen.tsx`、`LocalPlaylistDetailScreen.tsx`：塌陷头部 + 新行样式。
- `screens/settings/*`：分组、`SettingsRow`、外观行内开关。
- 删除 `components/DrawerContent.tsx` 与相关导航代码。

**验收**：头部收起流畅；设置 8 类均可达；无抽屉引用；深链可用。

**风险**：嵌套滚动的头部折叠；设置页 `fixup` 与返回栈。

### 阶段 5 · 打磨（S）

- 空 / 错 / 载三态统一；动效与触感；无障碍标签；深色细节；360×800 与字体 1.3× 回归。
- 运行 `pnpm mobile:typecheck && pnpm mobile:lint && pnpm mobile:test`。
- 真机截图对比 8 屏，记录差异。

---

## 11. 风险与取舍

| 取舍 | 代价 | 缓解 |
|---|---|---|
| 去掉全局顶栏搜索 | 从任意页搜索多一次点击 | 音乐库头部保留搜索图标；搜索 Tab 常驻 |
| 去掉 Drawer | 老用户找不到设置 | 设置放在「我的」最底部，符合 Android 习惯；版本更新说明提示 |
| 播放页恒定深色 | 浅色主题下反差大 | 播放页是沉浸表面；如需跟随主题，另做浅色版（不在本期） |
| 音乐库用分段芯片 | 不能左右滑页切换 | 芯片横向可滑；内容切换即时；后续可加手势 |
| 歌单从「我的」搬到「音乐库」 | 老用户肌肉记忆 | 首次进入音乐库时高亮「歌单」段；更新说明 |
| 主色改行动色 | 全站色值变化 | 阶段 0 单独提交，截图 diff；旧字段别名保留；与桌面端共用同一画布与色相 |
| 封面取色 | 低端机额外计算 | 只算一次并缓存；失败回退品牌色 |

**明确不做**：不改播放核心、音源解析、缓存策略、WebDAV 合并、歌词解析、原生模块；不做逐像素双端一致；不引入新字体；不做频谱可视化。

---

## 12. 待确认的五个决策

1. **去掉抽屉与全局顶栏搜索，接受吗？** 设置统一进「我的」，搜索统一进搜索 Tab。
2. **播放页恒定深色，接受吗？** 让封面成为唯一光源；浅色主题下也不切白底。
3. **音乐库用分段芯片替代顶部 Tab？** 五个分段横向可滑，省一行高度；不能左右滑页。
4. **首页第一屏以「继续收听」为主？** 没有播放记录时降级为每日推荐入口。
5. **绿色收敛为「仅交互与播放中」？** 图标、标题、分割线全部中性；按钮填行动绿，旧品牌绿只保留迁移与 logo 素材。

这五点确认后，我按阶段 0 开始改代码；其余细节（间距、圆角、动效时长）可在实现时按真机微调。

---

## 附录 A · 验收清单

- [ ] 390×844 / 360×800 / 768 宽平板，浅色与深色均无裁切、无重叠。
- [ ] 字体缩放 1.0 / 1.3，Tab 与列表标题不截断。
- [ ] 所有可点区域 ≥ 44；图标按钮有 `accessibilityLabel`。
- [ ] 四 Tab 切换、返回、深链、播放页下滑关闭均正确。
- [ ] 迷你播放器在有歌 / 无歌 / 键盘弹出三种状态下布局正确。
- [ ] 首页无历史、加载、单区块失败三种状态。
- [ ] 搜索空态、输入中、无结果、错误四种状态。
- [ ] 音乐库五个分段各自的空态与加载态。
- [ ] 播放页加载、失败、无封面、无歌词四种状态。
- [ ] 队列空、单曲循环、拖拽排序、左滑删除。
- [ ] `pnpm mobile:typecheck`、`pnpm mobile:lint`、`pnpm mobile:test` 全绿。

## 附录 B · 文件索引

**新增**

```
apps/mobile/src/components/navigation/AppTabBar.tsx
apps/mobile/src/components/navigation/LargeHeader.tsx
apps/mobile/src/components/MiniPlayer.tsx
apps/mobile/src/components/PageHeader.tsx
apps/mobile/src/components/SegmentedChips.tsx
apps/mobile/src/components/MediaCard.tsx
apps/mobile/src/components/TrackRow.tsx
apps/mobile/src/components/StatTile.tsx
apps/mobile/src/components/SettingsRow.tsx
apps/mobile/src/components/EmptyState.tsx
apps/mobile/src/components/Skeleton.tsx
apps/mobile/src/components/AmbientBackground.tsx
apps/mobile/src/components/SourceTag.tsx
```

**改动**

```
apps/mobile/src/theme/tokens.ts
apps/mobile/src/theme/controlTokens.ts
apps/mobile/src/services/themePaletteModel.ts
apps/mobile/src/navigation/RootNavigator.tsx
apps/mobile/src/navigation/MainTabNavigator.tsx
apps/mobile/src/navigation/tabLayout.ts
apps/mobile/src/components/AppShell.tsx
apps/mobile/src/components/AppHeader.tsx（拆为 PageHeader）
apps/mobile/src/components/PlayerBar.tsx（改为 MiniPlayer）
apps/mobile/src/components/QueueModal.tsx
apps/mobile/src/screens/HomeScreen.tsx
apps/mobile/src/screens/SearchScreen.tsx
apps/mobile/src/screens/LibraryScreen.tsx
apps/mobile/src/screens/MyMusicScreen.tsx
apps/mobile/src/screens/ImmersiveLyricsScreen.tsx
apps/mobile/src/screens/immersive/*
apps/mobile/src/screens/PlaylistDetailScreen.tsx
apps/mobile/src/screens/AlbumDetailScreen.tsx
apps/mobile/src/screens/ArtistDetailScreen.tsx
apps/mobile/src/screens/LocalPlaylistDetailScreen.tsx
apps/mobile/src/screens/settings/*
```

**删除**

```
apps/mobile/src/components/DrawerContent.tsx
apps/mobile/src/navigation/MainDrawerNavigator.tsx
```

---

*方案版本 v1 · 2026-10-23 · 设计：UiDesigner · 代码基线：AuralFlow 0.7.10*
