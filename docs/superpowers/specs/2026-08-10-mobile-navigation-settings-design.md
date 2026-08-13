# AuralFlow Android 移动端导航与设置重构规格

- 日期：2026-08-10
- 范围：`apps/mobile`
- 平台优先级：Android 手机
- 状态：设计规格，尚未实施

## 1. 目标

本规格统一 Android 移动端的一级导航、主 Drawer 和 Settings 信息架构，使高频内容入口稳定、低频工具可发现、每个入口都能到达真实目标。

具体目标：

1. 底部固定四个 Tab，按 `首页`、`搜索`、`曲库`、`我的` 顺序显示。
2. `SearchTab` 是唯一的底部搜索一级入口，内部覆盖歌曲、歌单、歌手、专辑和 MV 搜索。
3. 主 Drawer 只保留账号和低频工具，不重复放置四个底部 Tab。
4. 将 `SettingsNavigator` 挂载到真实根导航路径；手机 Settings 使用普通纵向列表主页和 Native Stack 详情页。
5. 主 Drawer 和设置页的快捷入口全部深链到对应的真实目标，不再统一导航到不存在或不匹配的 `Settings` 目标。
6. 保持现有首页、MV、歌曲行、多选、播放器和推荐流行为不变，仅调整它们被访问的导航路径。
7. 保证 Android 返回键、系统安全区、PlayerBar、AppShell 和底部 Tab 在详情页及主流程中层级清晰且不互相遮挡。

## 2. 非目标

本次重构明确不包含：

- 不修改桌面端导航、桌面端设置或桌面端视觉布局。
- 不重做播放器、沉浸式播放页、PlayerBar、推荐流、首页内容模块或歌曲行。
- 不改变已有播放、下载、同步、音源、歌词和数据清理业务逻辑，除非为了接入真实导航目标必须补充适配。
- 不新增测试文件，不恢复或引入 Vitest 测试体系。
- 不新增第二套下载状态、下载队列或下载持久化逻辑。
- 不把 Settings 分类继续做成手机主交互的二级 Drawer；平板是否保留桌面式并排布局不在本规格的手机交互范围内。
- 不借本次导航改造清理无关的类型、组件、服务或跨平台代码。

## 3. 当前问题

### 3.1 底部 Tab

当前 `MainTabParamList` 的底部页面为 `HomeTab`、`LibraryTab`、`MyMusicTab`、`SearchTab`，但渲染顺序是首页、曲库、我的、搜索；`HomeTab` 的实际文案仍为 `发现`。这造成设计名称、用户可见名称和顺序不一致。

### 3.2 主 Drawer

主 Drawer 当前已有账号卡和低频工具入口，但自定义音源、WebDAV、数据管理、关于和设置都执行 `navigation.navigate("Settings")`。主 Drawer 类型当前也没有注册 `Settings` screen，导致入口与目标不一致，且不同工具无法深链到具体详情。

主 Drawer 还需要明确包含下载管理，并避免重复展示底部四个 Tab。

### 3.3 SettingsNavigator

当前 `SettingsNavigator` 的 `Categories` screen 内挂载了 `createDrawerNavigator`，手机端通过设置分类 Drawer 切换 Account、Appearance、Playback 等页面。这个 Navigator 没有接入 `MainDrawerNavigator` 的 screen 列表，因此不能作为产品可达的 Settings 根路径使用。

现有设置页面已经按分类拆分，但页面标题、分类排序和导航依赖旧的 `SettingsDrawerParamList`。手机端需要一个纵向 Settings 主页列表，再由 Native Stack 进入详情。

### 3.4 账号与操作反馈

当前账号卡常驻显示退出按钮。退出应归属账号详情页，避免主 Drawer 常驻高风险操作。退出失败时不能继续显示成功提示；网易云账号与 B站账号应在同一账号详情页可见。

### 3.5 播放质量文案

现有 `playbackSettingsStore` 使用 `defaultQuality` 和 `PLAYBACK_SETTINGS_KEY` 保存默认播放质量。设置页必须把“播放音质”和“下载音质”区分为不同文案和状态语义，默认不改已有 key 或数据结构；如果业务实现实际共享同一值，界面必须如实说明共享状态，不能伪装成两个独立设置。

### 3.6 层级与系统行为

AppShell 同时管理 AppHeader、内容区和 PlayerBar；导航容器内还包含底部 Tab 和 Drawer。当前重构若直接增加 Settings 或详情层，容易出现 PlayerBar 覆盖内容、底部 Tab 留在详情页、Safe Area 重复计算以及 Android 返回键先后顺序错误的问题。

## 4. 导航树

目标 Android 手机导航树如下：

```text
RootStack
├── Main: MainDrawerNavigator
│   ├── MainTabs: MainTabNavigator
│   │   ├── HomeTab: 首页 -> HomeScreen
│   │   ├── SearchTab: 搜索 -> SearchScreen
│   │   ├── LibraryTab: 曲库 -> LibraryTopTabs
│   │   │   ├── Local: 本地音乐
│   │   │   ├── History: 播放历史
│   │   │   ├── Downloads: 下载记录入口
│   │   │   └── Bili: B站合集
│   │   └── MyMusicTab: 我的 -> MyMusicScreen
│   └── Settings: SettingsNavigator
│       ├── SettingsHome: 设置主页
│       ├── Account: 账号与服务详情
│       ├── Playback: 播放详情
│       ├── Lyrics: 歌词详情
│       ├── Appearance: 外观详情
│       ├── Sources: 音源详情
│       ├── Sync: 同步与备份详情
│       ├── Data: 存储与数据详情
│       ├── About: 关于详情
│       ├── Login: 登录流程
│       ├── WebDav: WebDAV 详情
│       ├── CustomSources: 自定义音源详情
│       └── LyricDetail: 歌词高级详情
├── Player: 沉浸式播放器
├── MvPlayer: MV 播放
├── DailyRecommend: 每日推荐
├── PersonalFm: 私人 FM
├── ArtistDetail: 歌手详情
├── AlbumDetail: 专辑详情
├── PlaylistDetail: 歌单详情
├── LocalPlaylistDetail: 本地歌单详情
├── BiliCollectionDetail: B站合集详情
├── LikedSongs: 喜欢的歌曲
└── SearchFallbackDetail: 搜索兜底详情
```

`Player`、`MvPlayer` 和内容详情仍属于 Root Stack 全屏或独立详情层，不改成底部 Tab。Settings 详情不应被错误地注册到 `RootStack`，除非实现需要从外部系统深链直接启动；从 App 内统一经 `Main -> Settings` 进入。

## 5. Tab 信息架构

### 5.1 固定顺序与命名

`MainTabNavigator` 的 screen 注册顺序必须是：

| 顺序 | route name | 用户文案 | 目标 |
|---|---|---|---|
| 1 | `HomeTab` | 首页 | `HomeScreen` |
| 2 | `SearchTab` | 搜索 | `SearchScreen` |
| 3 | `LibraryTab` | 曲库 | `LibraryTopTabs` |
| 4 | `MyMusicTab` | 我的 | `MyMusicScreen` |

`HomeTab` 的 route name 可保持不变以降低迁移风险，但用户可见文案必须从 `发现` 改为 `首页`。`appNavigation.ts` 的 `APP_TABS` 也必须使用同一顺序和文案，避免模型层与 React Navigation 配置分叉。

### 5.2 搜索

底部只保留 `SearchTab` 一个搜索一级入口。搜索页内部使用既有搜索模型和详情路由，至少支持：歌曲、歌单、歌手、专辑、MV。首页搜索按钮、AppHeader 搜索提交和外部搜索深链都进入 `Main -> MainTabs -> SearchTab`，通过 `initialKeyword` 或 `initialDetailRoute` 传递初始意图。

不得再添加单独的歌曲搜索、歌单搜索、MV 搜索底部 Tab，也不得为同一搜索状态复制新的 store。

### 5.3 曲库

曲库继续复用现有 `LibraryScreen` 和 `LibraryTopTabParamList`。下载是曲库内部的一个可访问分区，同时主 Drawer 的“下载管理”直接进入同一下载实现，避免出现两套下载列表。

### 5.4 层级

播放器由 Root Stack 和 PlayerBar 打开，不能成为底部 Tab。Home、MV、歌曲行和多选现有行为保持原入口和数据流；本规格只要求它们在导航重排后仍可达。

## 6. 主 Drawer 信息架构

主 Drawer 不承载 `首页`、`搜索`、`曲库`、`我的` 的重复入口。内容分为账号卡和低频工具两部分：

```text
主 Drawer
├── 账号卡 -> 未登录进入 Login；已登录进入 AccountSettingsScreen
├── 音乐工具
│   ├── 下载管理 -> DownloadScreen（唯一实现）
│   ├── 数据同步 -> SyncSettingsScreen 或其 WebDAV 子页
│   └── 音源管理 -> SourcesSettingsScreen / CustomSourceScreen
└── 应用
    ├── 设置 -> SettingsHomeScreen
    └── 关于 AuralFlow -> AboutSettingsScreen
```

为满足已确认的低频快捷项，以下入口必须精确到目标：

| Drawer 文案 | 目标导航 | 说明 |
|---|---|---|
| 账号卡 | `Main -> Settings -> Account` | 已登录展示账号详情；未登录进入 `Login` |
| 下载管理 | `Main -> Settings` 外的 `DownloadScreen` 真实 route，或 Library Downloads 的统一适配目标 | 本规格选择 `DownloadScreen` 为唯一状态实现，见第 11 节 |
| 数据同步 | `Main -> Settings -> Sync` | 同步详情页可继续进入 `WebDav` |
| 音源管理 | `Main -> Settings -> Sources` | 自定义音源操作从 Sources 进入 `CustomSources` |
| 设置 | `Main -> Settings -> SettingsHome` | 进入纵向设置主页 |
| 关于 AuralFlow | `Main -> Settings -> About` | 直接进入关于详情，不能先落到设置主页 |
| WebDAV | `Main -> Settings -> WebDav`，或 `Sync -> WebDav` | 只有一个真实 WebDAV 编辑目标 |
| 数据管理 | `Main -> Settings -> Data` | 直接进入数据详情 |

建议为 `DownloadScreen` 在 `SettingsNavigator` 或共享工具栈增加明确的 `Downloads` route，但该 route 必须只渲染已有 `DownloadScreen`，而不是新建下载页面。

每个 Drawer item 的 `onPress` 都应先关闭主 Drawer，再执行目标导航；不能通过一个通用 `Settings` route 丢失目标上下文。

## 7. Settings 详细信息架构

### 7.1 手机主交互

手机端 `SettingsNavigator` 使用 Native Stack：

```text
SettingsStack
├── SettingsHome
├── Account
├── Playback
├── Lyrics
├── Appearance
├── Sources
├── Sync
├── Data
├── About
├── Login
├── WebDav
├── CustomSources
└── LyricDetail
```

`SettingsHomeScreen` 是普通纵向设置主页列表，每行包含图标、标题、简短说明和进入指示。点击行以 `navigation.navigate(categoryRoute)` 进入对应 Native Stack 详情页。手机主流程不使用二级 Settings Drawer，也不要求详情页提供“打开分类 Drawer”按钮。

现有 `SettingsPage` 应改为使用 Native Stack navigation 的返回行为，并移除手机端 `openDrawer` 分类按钮。已有分类内容组件可以复用，不复制业务状态。

### 7.2 分类顺序

`SettingsHomeScreen` 必须严格使用以下顺序和文案：

1. `Account`：账号与服务
2. `Playback`：播放
3. `Lyrics`：歌词
4. `Appearance`：外观
5. `Sources`：音源
6. `Sync`：同步与备份
7. `Data`：存储与数据
8. `About`：关于

route name 使用稳定的英文 PascalCase；用户文案使用中文。分类模型、Navigator screen 名称、深链映射和入口表必须共享同一组 route name，禁止出现 `DataSettings`、`Data`、`DataScreen` 混用导致的隐式路由。

### 7.3 详情内容边界

- `AccountSettingsScreen`：网易云账号、B站账号、登录、账号服务和退出。
- `PlaybackSettingsScreen`：播放音质、下载音质、外部播放打断和已有音效设置。
- `LyricsSettingsScreen`：歌词显示与已有歌词高级入口。
- `AppearanceSettingsScreen`：主题、强调色和已有背景相关设置。
- `SourcesSettingsScreen`：自定义音源列表、启用状态和进入 `CustomSources` 的操作。
- `SyncSettingsScreen`：同步与备份状态，进入 `WebDav` 的操作。
- `DataSettingsScreen`：缓存、历史和本地数据管理；危险操作单独分区。
- `AboutSettingsScreen`：版本、更新和 AuralFlow 信息。

不在 Settings 中加入播放器控制、推荐流设置、桌面端设置镜像或与本次导航无关的账户功能。

## 8. 路由参数与深链契约

### 8.1 类型契约

建议将类型收敛为以下结构：

```ts
type MainTabParamList = {
  HomeTab: undefined;
  SearchTab:
    | { initialKeyword?: string; initialDetailRoute?: SearchDetailRoute | null }
    | undefined;
  LibraryTab: NavigatorScreenParams<LibraryTopTabParamList> | undefined;
  MyMusicTab: undefined;
};

type MainDrawerParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Settings: NavigatorScreenParams<SettingsStackParamList> | undefined;
};

type SettingsStackParamList = {
  SettingsHome: undefined;
  Account: undefined;
  Playback: undefined;
  Lyrics: undefined;
  Appearance: undefined;
  Sources: undefined;
  Sync: undefined;
  Data: undefined;
  About: undefined;
  Login: undefined;
  WebDav: undefined;
  CustomSources: undefined;
  LyricDetail: undefined;
};
```

`MainTabParamList` 顺序和 `MainDrawerParamList` 的结构体现导航层级；类型名称必须与实际 Navigator 注册名称完全一致。Settings 入口使用 `navigation.navigate("Settings", { screen: "SettingsHome" })`，快捷项使用对应详情 screen。

### 8.2 App 内深链

所有程序化导航必须通过已类型化的 helper 或类型化 navigation prop：

- 设置主页：`Main(Settings(SettingsHome))`
- 账号：`Main(Settings(Account))`
- 音源：`Main(Settings(Sources))`
- WebDAV：`Main(Settings(WebDav))`，或由 `Sync` 再进入 `WebDav`
- 数据：`Main(Settings(Data))`
- 关于：`Main(Settings(About))`
- 搜索关键词：`Main(MainTabs(SearchTab({ initialKeyword })))`
- 搜索详情：`Main(MainTabs(SearchTab({ initialDetailRoute })))`

若 `Settings` 已在当前栈中，重复点击设置应回到或复用已有 Settings 栈，不叠加同一设置主页的无意义副本。Drawer 关闭动作不能改变目标参数。

### 8.3 外部 URL

保留现有 `auralflow://search|daily|fm|playlist|album|artist` 契约。搜索类 URL 必须归一到唯一 `SearchTab`；本次规格不增加新的外部协议格式。Settings 深链如需要支持，使用明确的 `auralflow://settings/<category>` 映射到对应 `SettingsStack` route，未知 category 安全回退 `SettingsHome`，不得导航到不存在的通用 Settings 页面。

## 9. UI/UX 布局

### 9.1 主 Shell

`AppShell` 继续提供全局 AppHeader、内容区和 PlayerBar。导航层级必须满足：

- 主 Tab 页面显示底部 Tab；进入 Root Stack 内容详情或播放器时不显示不属于该详情的底部 Tab。
- Settings 页面作为主 Drawer 的独立 screen 时，设置详情不能被主 Tab 内容误认为当前 Tab。
- PlayerBar 仅在现有允许显示的页面出现，内容滚动区域预留 `PlayerBar` 所需底部空间。
- MV 播放和沉浸式播放器继续使用现有全屏处理，不被 AppShell 的普通内容层覆盖。
- Drawer 关闭、设置详情返回和播放器返回不会改变正在播放的歌曲或队列。

### 9.2 SettingsHome

设置主页采用单列、可滚动、分组清晰的普通列表。列表首部显示“设置”，每个分类行至少包含 44dp 高度的可点击区域；副标题只表达该分类包含的内容，不显示实现细节或键盘快捷键。详情页使用统一的 `SettingsPage` 外壳、标题和返回按钮。

### 9.3 视觉与触控

所有图标按钮使用现有 Lucide 图标组件；按钮和导航图标必须设置 `accessibilityLabel` 与正确 `accessibilityRole`。可点击目标不小于 44dp，关键 Android 控件按 48dp 设计。文字不得被图标、PlayerBar、底部 Tab 或安全区遮挡。

## 10. 返回键与安全区

Android 返回处理优先级固定为：

1. 若任意 Drawer 打开，先关闭该 Drawer并消费返回事件。
2. 若当前是 Settings 详情页，返回 SettingsHome。
3. 若当前是 SettingsHome，返回主内容或关闭 Settings 层，遵循当前 Navigator 栈。
4. 其他详情页按当前 Native Stack 返回。
5. 根页面无可返回历史时交还系统默认行为。

主 Drawer 和 SettingsNavigator 的 Drawer（若平板适配仍存在）都必须可被 `findOpenDrawerKey` 识别。手机 Settings 不再使用二级 Drawer，因此手机返回不应打开或关闭设置分类菜单。

Safe Area 只在系统边缘层消费一次：AppShell 处理顶端和底端 inset，内部 screen 根据现有 `ScreenScaffold` 约定使用内容 inset，不再次叠加同一边缘 padding。Drawer 内容可以使用自身安全区，但不能把该 inset传递给 AppShell 后再次计算。PlayerBar 使用底部 inset，底部 Tab 使用自身布局高度，两者总高度必须被内容区避让。

## 11. 账号、退出与危险操作

### 11.1 账号

主 Drawer 的账号卡是账号入口和状态摘要，不是退出控制面板。常驻首屏不显示退出按钮；已登录点击账号卡进入 `AccountSettingsScreen`，退出按钮只在该页显示。账号页同时展示网易云和 B站账号卡，B站登录状态不隐藏在其他分类中。

退出流程：用户在账号详情点击退出，确认后调用现有 logout action。成功时才显示成功结果并刷新账号状态；失败时显示失败原因或通用失败提示，不得显示“已退出”。重复点击必须被禁用或幂等处理。

### 11.2 Data 危险区

`DataSettingsScreen` 将危险操作单独放在页面底部的“危险操作”区，与普通缓存查看、历史浏览和非破坏性操作分开。危险按钮使用 destructive 语义并明确说明影响范围，执行前二次确认；异步操作中显示进行中状态，成功和失败结果分别处理。清理失败不得移除仍存在的数据，也不得提示成功。

危险操作至少涵盖现有数据清理能力，不新增账号注销或播放器重置等范围外操作。所有错误结果可重试，不能静默吞掉关键失败。

## 12. 下载实现选择

选择复用现有 `DownloadScreen` 作为唯一下载管理实现，因为它已经连接 `useDownloadStore`、下载中/失败/已完成状态、本地路径、播放入口、删除和清理动作。不得为主 Drawer 新建第二个 DownloadScreen 或复制 `downloadStore` 状态。

实施方式：

1. 为 `DownloadScreen` 增加真实可达的 Navigator route 和返回回调，复用现有组件本体。
2. 主 Drawer 的“下载管理”直接导航到该 route。
3. `LibraryTopTabParamList.Downloads` 继续作为曲库内下载入口，但应渲染同一个下载内容实现，或者仅作为统一下载 route 的导航适配，不维护第二份下载 UI 状态。
4. 统一标题、空状态、失败状态和下载质量展示；下载质量文案使用“下载音质”，不借用“播放音质”标签。

如果现有 Library Downloads 已经承载完整下载页面，则优先让 `DownloadScreen` 成为该页面的共享组件，保留已有稳定入口；最终产品只能有一个下载状态源和一个下载记录实现。

## 13. 错误处理

- 未登录点击账号：进入 `Login`，登录成功返回 `Account`，失败保留登录页并展示失败原因。
- 深链目标不存在：记录可诊断日志，回退到最近的稳定父页面；设置未知分类回退 `SettingsHome`，搜索无效详情回退 `SearchTab`。
- 设置存储读取失败：显示默认或上次可用状态，并提供重试；不得把读取失败误报为用户已修改。
- 设置写入失败：保留原状态或回滚到已确认状态，显示“保存失败”，不得显示成功。
- WebDAV、音源、下载、数据清理等异步操作：明确区分加载、成功、失败和空状态；失败结果提供重试或返回上一级。
- 路由调用在 NavigationContainer 未 ready 时不得丢失关键用户操作；现有 helper 的 ready 约束需要保持，外部深链继续等待导航就绪。

## 14. 可访问性

所有可交互项必须满足：

- 有描述目标的 `accessibilityLabel`。
- 导航按钮、列表项、图标按钮使用正确的 `accessibilityRole`，选中 Tab 使用 `tab` 语义和 selected 状态。
- Drawer 项和 Settings 行能读出标题及必要的当前状态。
- 图标不是唯一信息来源，音质、同步、账号状态和危险动作必须有文本。
- 触控区域至少 44dp，关键操作目标按 48dp 设计；透明扩展点击区不能造成相邻按钮误触。
- 动态状态变化可被无障碍服务感知，失败提示与成功提示使用不同文本。
- 返回、关闭 Drawer、关闭详情和删除等图标按钮必须有明确 label，不能只依赖图形。

## 15. 分阶段交付

### 阶段一：契约与骨架

- 更新 `MainTabParamList`、`MainDrawerParamList`、`SettingsStackParamList` 和设置分类模型。
- 注册 `Settings` 到 `MainDrawerNavigator`，真正挂载 `SettingsNavigator`。
- 将 SettingsNavigator 的手机入口改为 `SettingsHome` Native Stack。
- 统一四个 Tab 的注册顺序、显示文案和模型层 `APP_TABS`。

验收：从主 Drawer 可进入 SettingsHome；返回键可从详情回主页；四个 Tab 顺序和文案准确。

### 阶段二：入口与深链

- 重写主 Drawer 分组和入口目标。
- 接通账号卡到 Account；接通 Sources、Sync/WebDav、Data、About 和下载管理真实目标。
- 统一内部 navigation helpers 和现有外部搜索深链。

验收：逐一点击主 Drawer 所有入口，不出现不存在的目标、不落到错误分类、不重复叠加无意义栈。

### 阶段三：设置内容与边界

- 按确定顺序调整 SettingsHome 列表。
- 调整 SettingsPage 的手机返回和安全区布局。
- 拆清播放音质/下载音质文案，保持已有 key 与 store 兼容。
- 移除主 Drawer 账号卡常驻退出按钮，将退出与 B站账号确认放入 Account 详情。
- 将 Data 危险操作分区并补齐失败反馈。

验收：账号、播放、歌词、外观、音源、同步、数据、关于八个详情均可达且状态真实。

### 阶段四：层级与回归

- 校验 AppShell、PlayerBar、底部 Tab、Drawer、Native Stack 和全屏播放器的层级。
- 检查首页、MV、歌曲行、多选、搜索详情、曲库分区和下载播放流程。
- 删除或停用仅服务于手机 Settings Drawer 的入口代码，但不删除仍被平板或其他平台使用的共享内容，具体以引用关系为准。

验收：Android 返回键顺序、Safe Area、触控尺寸和无障碍标签通过手工清单。

## 16. 验证清单

### 静态与构建验证

- [ ] `pnpm mobile:typecheck`
- [ ] Android `compileDebugKotlin`，命令按仓库实际 Gradle 任务执行，例如 `cd apps/mobile/android && gradlew.bat compileDebugKotlin`
- [ ] `git diff --check`
- [ ] 未新增测试文件或 Vitest 配置；本规格不要求运行 Vitest
- [ ] 桌面端工作区无本次任务产生的修改

### 手工导航流程

- [ ] 冷启动后看到底部四 Tab，顺序为首页、搜索、曲库、我的。
- [ ] 首页搜索入口、AppHeader 搜索和外部搜索 URL 都进入唯一 SearchTab。
- [ ] SearchTab 可搜索歌曲、歌单、歌手、专辑和 MV，并可打开已有详情。
- [ ] 打开主 Drawer，确认没有四个底部 Tab 重复项。
- [ ] 账号卡进入账号详情；退出仅在账号详情可见；退出成功和失败提示准确；B站账号同页可见。
- [ ] 下载管理进入唯一 DownloadScreen，实现下载中、完成、失败、删除、清理和下载歌曲播放。
- [ ] 音源管理进入 Sources；自定义音源操作进入 CustomSources。
- [ ] 数据同步进入 Sync，WebDAV 进入 WebDav；数据管理进入 Data；关于 AuralFlow 直接进入 About；设置进入 SettingsHome。
- [ ] SettingsHome 八个分类顺序准确，点击每行进入对应 Native Stack 详情。
- [ ] Android 详情返回 SettingsHome；SettingsHome 返回主内容；Drawer 打开时返回先关闭 Drawer。
- [ ] PlayerBar 不遮挡详情内容；底部 Tab 不覆盖 Root Stack 详情；MV 和沉浸式播放器保持现有全屏行为。
- [ ] 横竖屏或不同 Android 手机尺寸下，安全区只计算一次，触控目标不小于 44dp，关键控件按 48dp 设计。
- [ ] 图标按钮、Tab、Drawer 项、设置行、危险操作和关闭按钮均有正确 accessibilityLabel/role/state。
- [ ] 设置读写、登录、同步、音源、下载和数据清理失败时均不显示成功结果，并提供可理解的失败反馈。

## 17. 自审结论

本稿完成后按以下维度复核：

- 占位符扫描：全文没有未完成标记、示例占位内容、模板残留或空白章节。
- 矛盾扫描：确认主 Drawer 只放低频入口；四个 Tab 只在底部出现；手机 Settings 只以 SettingsHome + Native Stack 为主交互；下载只有一个状态实现。
- 路由扫描：确认 `HomeTab` 保留为兼容 route name但用户文案为首页；`MainDrawerParamList.Settings`、`SettingsHome`、八个详情 route 和现有 `WebDav`/`CustomSources` 命名关系明确，未将 Settings 详情误放 RootStack。
- 范围扫描：确认没有桌面端修改要求，没有播放器、推荐流、歌曲行或测试体系重做，也没有新增与导航无关的业务功能。
- 交付扫描：确认验证命令、手工流程、安全区、返回键、账号失败反馈、危险操作和无障碍均有可执行验收项。

结论：规格覆盖目标、非目标、当前问题、导航树、Tab/Drawer/Settings 信息架构、参数和深链契约、布局、返回键与安全区、账号和危险操作、下载选择、错误处理、可访问性、分阶段交付及验证清单；本文档不修改产品代码，也不包含 git 提交步骤。
