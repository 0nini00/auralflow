# AuralFlow Android 移动端导航与设置重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `subagent-driven-development`（推荐）或 `executing-plans` 按任务执行；每完成一个任务先复核其 Produces 契约，再开始下一任务。所有步骤使用 checkbox 跟踪。

**Goal:** 在 `apps/mobile` 内建立 Android 手机优先的四 Tab、低频工具 Drawer、SettingsHome + Native Stack 设置体系，并保持现有播放器、搜索、曲库和下载业务状态不变。

**Architecture:** `RootStack` 保留播放器和内容详情；`MainDrawerNavigator` 只挂载 `MainTabs` 与 `SettingsNavigator`；`MainTabNavigator` 固定四个一级入口。设置分类统一由 `SettingsStackParamList` 和 `SETTINGS_CATEGORIES` 驱动，所有 App 内入口通过类型化嵌套参数深链。现有 `DownloadScreen` 是唯一下载管理实现，曲库 Downloads 与 Drawer 入口均渲染或导航到该组件，不复制状态或列表逻辑。

**Tech Stack:** React Native 0.86、React 19、TypeScript 5.8、React Navigation 7（Native Stack / Drawer / Bottom Tabs / Material Top Tabs）、Zustand 5、react-native-safe-area-context、lucide-react-native、Android Gradle。

## Global Constraints

- 只修改 `apps/mobile`；不修改桌面端导航、设置、视觉布局或跨平台无关代码。
- Android 手机优先；Settings 手机主流程必须是纵向 `SettingsHome` + Native Stack，不使用二级分类 Drawer。
- 不改变播放器、沉浸式播放页、PlayerBar、推荐流、首页模块、歌曲行、多选以及已有播放/下载/同步/音源/歌词业务逻辑。
- 不新增测试文件，不新增或恢复 Vitest 配置，不运行 Vitest；使用类型检查、Android 编译和手工回归验证。
- 不新增第二套下载状态、队列、持久化或下载列表；`DownloadScreen` 与 `useDownloadStore` 是唯一实现。
- 不提交 git；各任务均不得执行 `git commit`、`git push` 或暂存操作。
- 不回滚、覆盖或清理现有未提交改动；编辑前后使用 `git diff -- <exact files>` 隔离检查本任务差异。
- 所有交互目标至少 44dp，Android 关键操作按 48dp；使用现有 `touch.minTarget`，图标按钮提供 `accessibilityLabel`、正确 role/state。
- Safe Area 在系统边缘层只消费一次；Drawer 可消费自身 inset，但不得向 AppShell 重复传递。
- 失败不得显示成功反馈；异步操作保留原状态或回滚到已确认状态，并提供可理解的失败信息。
- 保留 `auralflow://search|daily|fm|playlist|album|artist`，搜索统一进入 `SearchTab`；不增加新的外部协议格式。

---

## 文件职责图谱

| 文件 | 职责 |
|---|---|
| `apps/mobile/src/navigation/types.ts` | 定义 Root、Main Drawer、四 Tab、Library Top Tabs、Settings Stack 的唯一参数契约。 |
| `apps/mobile/src/navigation/MainDrawerNavigator.tsx` | 挂载 `MainTabs` 与 `Settings` 两个主 Drawer screen。 |
| `apps/mobile/src/navigation/MainTabNavigator.tsx` | 注册首页、搜索、曲库、我的及曲库四分区；复用唯一下载页面。 |
| `apps/mobile/src/navigation/SettingsNavigator.tsx` | 注册 SettingsHome、八个设置详情及 Login/WebDav/CustomSources/LyricDetail。 |
| `apps/mobile/src/navigation/settingsRouteModel.ts` | 保存八分类的稳定 route、中文文案、说明、图标和严格顺序。 |
| `apps/mobile/src/screens/settings/SettingsHomeScreen.tsx` | 渲染纵向设置主页并导航到分类详情。 |
| `apps/mobile/src/components/settings/SettingsPage.tsx` | 提供统一详情页标题、返回按钮、滚动容器和触控/a11y 契约。 |
| `apps/mobile/src/services/appNavigation.ts` | 保存四个可见 Tab 的模型层顺序和文案。 |
| `apps/mobile/src/navigation/navigationRef.ts` | 提供类型化 Root/Main/Settings/Search/Downloads 程序化导航 helper。 |
| `apps/mobile/src/services/mobileDeepLinkService.ts` | 解析既有外部 URL 意图并保持搜索归一。 |
| `apps/mobile/App.tsx` | 等待 NavigationContainer ready 后分发外部深链意图。 |
| `apps/mobile/src/components/DrawerContent.tsx` | 渲染账号卡、音乐工具、应用分组并精确深链。 |
| `apps/mobile/src/components/AccountInfo.tsx` | 展示可复用账号摘要；退出能力仅由账号详情显式启用。 |
| `apps/mobile/src/screens/settings/AccountSettingsScreen.tsx` | 汇总网易云/B站账号、登录和可靠退出反馈。 |
| `apps/mobile/src/components/settings/PlaybackQualitySettings.tsx` | 如实展示播放音质与下载音质的共享状态语义。 |
| `apps/mobile/src/screens/settings/DataSettingsScreen.tsx` | 将普通存储信息与危险操作分区。 |
| `apps/mobile/src/components/CacheSettings.tsx` | 执行缓存/历史清理，管理 loading 与成功/失败反馈。 |
| `apps/mobile/src/screens/DownloadScreen.tsx` | 唯一下载管理 UI，连接 `useDownloadStore` 和本地播放。 |
| `apps/mobile/src/screens/LibraryScreen.tsx` | 保留本地、历史、B站内容；下载分区不再维护重复下载 UI。 |
| `apps/mobile/src/components/AppShell.tsx` | 协调 Header、内容、PlayerBar、返回键、Drawer 和安全区。 |
| `apps/mobile/src/services/appShellModel.ts` | 集中计算 chrome/层级展示状态，避免组件内 route 判断分叉。 |
| `apps/mobile/src/components/ScreenScaffold.tsx` | 提供不重复消费系统 inset 的内容滚动与底部避让。 |
| `apps/mobile/src/theme/tokens.ts` | 提供 `touch.minTarget = 44` 等统一尺寸 token。 |

---

### Task 1: 路由契约与 Settings 挂载

**Exact files:**
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/navigation/MainDrawerNavigator.tsx`
- Modify: `apps/mobile/src/navigation/SettingsNavigator.tsx`
- Create: `apps/mobile/src/screens/settings/SettingsHomeScreen.tsx`

**Consumes:** 现有 `RootStackParamList`、八个 `*SettingsScreen`、`LoginScreen`、`WebDavSyncScreen`、`CustomSourceScreen`、`LyricSettingsContent`。

**Produces:** `MainDrawerParamList.Settings: NavigatorScreenParams<SettingsStackParamList> | undefined`；`SettingsStackParamList` 中稳定 route：`SettingsHome | Account | Playback | Lyrics | Appearance | Sources | Sync | Data | About | Login | WebDav | CustomSources | LyricDetail`；产品可达的 `Main -> Settings`。

**关键签名:** 
```ts
export type MainDrawerParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Settings: NavigatorScreenParams<SettingsStackParamList> | undefined;
};

export type SettingsStackParamList = {
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

- [ ] 删除手机路径对 `SettingsDrawerParamList`、`Categories` 和 `SettingsCategories` Drawer 的依赖；保留仍有平板真实引用的共享内容，不做无关删除。
- [ ] 在 `MainDrawerNavigator` 注册 `<Drawer.Screen name="Settings" component={SettingsNavigator} />`，保持 `MainTabs` 为 initial route 且两个 screen 都隐藏 header。
- [ ] 创建 `SettingsHomeScreen` 骨架，接收 Native Stack navigation，并从后续统一分类模型渲染可滚动列表。
- [ ] 在 `SettingsNavigator` 以 `SettingsHome` 为 initial route，依次注册主页、八分类详情及四个子流程；`Login` 成功后 `replace("Account")` 或返回既有 `Account`，避免落回错误页面。
- [ ] 确认 Settings 详情没有注册进 `RootStackParamList`，App 内入口只能走 `Main -> Settings -> screen`。
- [ ] 检查本任务差异未覆盖用户改动：`git diff -- apps/mobile/src/navigation/types.ts apps/mobile/src/navigation/MainDrawerNavigator.tsx apps/mobile/src/navigation/SettingsNavigator.tsx apps/mobile/src/screens/settings/SettingsHomeScreen.tsx`。

**验证命令:** `pnpm mobile:typecheck`

---

### Task 2: 固定四 Tab 与唯一搜索/下载入口

**Exact files:**
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/navigation/MainTabNavigator.tsx`
- Modify: `apps/mobile/src/services/appNavigation.ts`
- Modify: `apps/mobile/src/screens/DownloadScreen.tsx`
- Modify: `apps/mobile/src/screens/LibraryScreen.tsx`

**Consumes:** Task 1 的 `MainTabParamList`；现有 `SearchScreen` 初始参数；`DownloadScreen({ onNavigateToPlayer })`；`LibraryTopTabParamList`。

**Produces:** 四 Tab 顺序 `HomeTab, SearchTab, LibraryTab, MyMusicTab`；唯一搜索状态入口；`LibraryTopTabParamList.Downloads` 与 Drawer 共用的唯一 `DownloadScreen`。

**关键路由:** 
```ts
navigateRoot("Main", {
  screen: "MainTabs",
  params: { screen: "SearchTab", params: { initialKeyword } },
});
// 曲库下载与 Drawer 下载最终都渲染同一个 DownloadScreen。
```

- [ ] 将 `MainTabParamList` 声明顺序及 Bottom Tab 注册顺序统一为 Home、Search、Library、MyMusic。
- [ ] 将 Home 用户文案由“发现”改为“首页”，同步 `APP_TABS` 为首页、搜索、曲库、我的；不增加歌曲/歌单/MV 独立搜索 Tab 或 store。
- [ ] 保持 `SearchTab` 的 `initialKeyword`、`initialDetailRoute` 消费后清空逻辑，验证歌曲、歌单、歌手、专辑、MV 仍使用既有搜索模型与详情 route。
- [ ] 将 `LibraryTopTabs.Downloads` wrapper 直接渲染 `DownloadScreen onNavigateToPlayer={openPlayerScreen}`。
- [ ] 从 `LibraryScreen` 移除仅为下载分区复制的 `useDownloadStore`、`DownloadList`、下载分支与加载副作用；本地、历史、B站行为保持不变。
- [ ] 保持 `DownloadScreen` 为唯一完整下载记录 UI，必要时增加可选 `onBack?: () => void` 以适配 Stack/Top Tab，但不得新建下载 store、队列或持久化。
- [ ] 检查差异：`git diff -- apps/mobile/src/navigation/types.ts apps/mobile/src/navigation/MainTabNavigator.tsx apps/mobile/src/services/appNavigation.ts apps/mobile/src/screens/DownloadScreen.tsx apps/mobile/src/screens/LibraryScreen.tsx`。

**验证命令:** `pnpm mobile:typecheck && git grep -n "useDownloadStore" -- apps/mobile/src/screens/LibraryScreen.tsx apps/mobile/src/screens/DownloadScreen.tsx`

---

### Task 3: SettingsHome 与 Native Stack 详情体验

**Exact files:**
- Modify: `apps/mobile/src/navigation/settingsRouteModel.ts`
- Modify: `apps/mobile/src/screens/settings/SettingsHomeScreen.tsx`
- Modify: `apps/mobile/src/components/settings/SettingsPage.tsx`
- Modify: `apps/mobile/src/components/settings/SettingsLinkRow.tsx`
- Modify: `apps/mobile/src/navigation/SettingsNavigator.tsx`

**Consumes:** Task 1 的 `SettingsStackParamList`；现有 palette、Lucide icons、`ScreenScaffold`、`touch.minTarget`。

**Produces:** 严格有序的 `SETTINGS_CATEGORIES`；每行直接 `navigate(category.name)`；Native Stack 返回按钮和 Android 系统返回行为。

**关键模型:** 
```ts
export const SETTINGS_CATEGORIES = [
  ["Account", "账号与服务"], ["Playback", "播放"],
  ["Lyrics", "歌词"], ["Appearance", "外观"],
  ["Sources", "音源"], ["Sync", "同步与备份"],
  ["Data", "存储与数据"], ["About", "关于"],
] as const;
```

- [ ] 将分类 route 类型直接收敛为八个 `SettingsStackParamList` 分类键，统一顺序、中文标题、简短说明和图标语义。
- [ ] 完成 SettingsHome 单列可滚动页面：标题“设置”，每行图标、标题、副标题、Chevron，`minHeight: touch.minTarget`，role 为 button，并读出标题和必要状态。
- [ ] 每行调用 `navigation.navigate(item.name)`；不得拼接 `DataSettings`、`DataScreen` 等别名。
- [ ] 将 `SettingsPage` 改为 Native Stack navigation：手机移除 `openDrawer`/“分类”按钮，详情页提供明确的返回图标按钮，点击 `goBack()`；触控至少 44dp。
- [ ] 配置 Stack 的 `animation: "slide_from_right"` 与 header 策略；详情返回 SettingsHome，SettingsHome 返回 MainTabs，重复进入 Settings 时复用当前 Settings 层。
- [ ] 检查差异：`git diff -- apps/mobile/src/navigation/settingsRouteModel.ts apps/mobile/src/screens/settings/SettingsHomeScreen.tsx apps/mobile/src/components/settings/SettingsPage.tsx apps/mobile/src/components/settings/SettingsLinkRow.tsx apps/mobile/src/navigation/SettingsNavigator.tsx`。

**验证命令:** `pnpm mobile:typecheck && git grep -nE 'Categories|openDrawer|SettingsDrawerParamList' -- apps/mobile/src/navigation apps/mobile/src/components/settings apps/mobile/src/screens/settings`

---

### Task 4: 主 Drawer 分组与精确深链

**Exact files:**
- Modify: `apps/mobile/src/components/DrawerContent.tsx`
- Modify: `apps/mobile/src/navigation/navigationRef.ts`
- Modify: `apps/mobile/src/navigation/drawerRouteModel.ts`
- Modify: `apps/mobile/src/services/mobileDeepLinkService.ts`
- Modify: `apps/mobile/App.tsx`

**Consumes:** Task 1 的嵌套参数契约；Task 2 的 `SearchTab`/Downloads；Task 3 的 Settings routes；`navigationRef.isReady()`。

**Produces:** 账号卡、音乐工具、应用三组入口；`openSettingsScreen(screen)`、`openDownloadsScreen()`、类型化搜索 helpers；既有 URL 全部归一到真实目标。

**关键 helper:** 
```ts
export function openSettingsScreen(
  screen: keyof SettingsStackParamList = "SettingsHome",
) {
  navigateRoot("Main", { screen: "Settings", params: { screen } });
}
export function openDownloadsScreen() {
  navigateRoot("Main", {
    screen: "MainTabs",
    params: { screen: "LibraryTab", params: { screen: "Downloads" } },
  });
}
```

- [ ] 删除 Drawer 内嵌 Login Modal；账号卡已登录时关闭 Drawer 后进入 `Account`，未登录时进入 `Login`，且账号卡不显示常驻退出按钮。
- [ ] 按“音乐工具”渲染下载管理、数据同步、音源管理；按“应用”渲染设置、关于 AuralFlow；不渲染首页、搜索、曲库、我的重复项。
- [ ] 为每项先执行 `navigation.closeDrawer()`，再携带嵌套参数导航：Downloads、Sync、Sources、SettingsHome、About；保留 WebDav/Data 快捷项时必须分别进入 `WebDav`/`Data`。
- [ ] 在 `navigationRef.ts` 增加完整类型化 helper，移除 AppShell 中 `as never` 搜索调用；NavigationContainer 未 ready 时由既有深链等待机制保留意图。
- [ ] 保持 `auralflow://search|daily|fm|playlist|album|artist` 解析契约；search/searchDetail 均进入唯一 SearchTab，无效搜索详情回退 SearchTab。
- [ ] 更新 `drawerRouteModel.ts` 使 `Settings` 对应 Settings 层，不把任意设置详情误判成底部 Tab。
- [ ] 检查差异：`git diff -- apps/mobile/src/components/DrawerContent.tsx apps/mobile/src/navigation/navigationRef.ts apps/mobile/src/navigation/drawerRouteModel.ts apps/mobile/src/services/mobileDeepLinkService.ts apps/mobile/App.tsx`。

**验证命令:** `pnpm mobile:typecheck && git grep -n 'navigate("Settings")' -- apps/mobile/src`

---

### Task 5: 账号、音质、Data 与可访问性

**Exact files:**
- Modify: `apps/mobile/src/components/AccountInfo.tsx`
- Modify: `apps/mobile/src/stores/accountStore.ts`
- Modify: `apps/mobile/src/screens/settings/AccountSettingsScreen.tsx`
- Modify: `apps/mobile/src/screens/settings/PlaybackSettingsScreen.tsx`
- Modify: `apps/mobile/src/components/settings/PlaybackQualitySettings.tsx`
- Modify: `apps/mobile/src/screens/settings/DataSettingsScreen.tsx`
- Modify: `apps/mobile/src/components/CacheSettings.tsx`
- Modify: `apps/mobile/src/components/settings/BiliAccountCard.tsx`

**Consumes:** `useAccountStore`、`useBiliAccountStore`、`usePlaybackSettingsStore.defaultQuality`/`PLAYBACK_SETTINGS_KEY`、现有 cache/history cleanup services、`touch.minTarget`。

**Produces:** 仅账号详情可见的可靠退出；同页网易云+B站状态；如实共享的播放/下载音质；Data 普通区/危险区；统一 loading/error/a11y 行为。

**关键语义:** 
```ts
type AccountInfoProps = {
  onPress?: () => void;
  onLoginPress?: () => void;
  showLogoutAction?: boolean;
};
// 当前 defaultQuality 同时用于在线播放与下载，UI 明示共享，不创建第二个 key。
```

- [ ] 将 `AccountInfo` 默认变为可点击状态摘要，只有 `showLogoutAction` 为 true 才渲染退出；Drawer 传 false，Account 详情传 true。
- [ ] 让 `accountStore.logout(): Promise<void>` 在失败时重新抛出错误并保留登录状态；账号页禁用重复点击，成功后才提示“已退出”，失败显示原因或通用失败提示。
- [ ] Account 页面同时展示网易云和 B站账号卡；未登录进入 Login，成功回 Account。
- [ ] Playback 页面分别显示“播放音质”“下载音质”；由于二者读取同一 `defaultQuality`，明确写出“当前共享同一默认音质”，保留 `PLAYBACK_SETTINGS_KEY` 和数据结构。
- [ ] Data 页面将缓存统计/非破坏性动作放普通区，将清空缓存、清理历史等放底部“危险操作”区；每项二次确认、destructive 语义、进行中禁用。
- [ ] 为设置读写和清理添加 try/catch/finally：失败不清零界面数据、不提示成功，显示失败文案且允许重试。
- [ ] 审计本任务所有 Pressable：至少 44dp，关键确认/删除按 48dp，补齐 label、role、disabled/busy/selected state，状态不能只靠图标或颜色。
- [ ] 检查差异：`git diff -- apps/mobile/src/components/AccountInfo.tsx apps/mobile/src/stores/accountStore.ts apps/mobile/src/screens/settings/AccountSettingsScreen.tsx apps/mobile/src/screens/settings/PlaybackSettingsScreen.tsx apps/mobile/src/components/settings/PlaybackQualitySettings.tsx apps/mobile/src/screens/settings/DataSettingsScreen.tsx apps/mobile/src/components/CacheSettings.tsx apps/mobile/src/components/settings/BiliAccountCard.tsx`。

**验证命令:** `pnpm mobile:typecheck && git grep -nE 'minHeight: (touch\.minTarget|4[4-9])|accessibility(Label|Role|State)' -- apps/mobile/src/components/AccountInfo.tsx apps/mobile/src/components/settings apps/mobile/src/screens/settings`

---

### Task 6: AppShell、返回键、安全区与完整验证

**Exact files:**
- Modify: `apps/mobile/src/components/AppShell.tsx`
- Modify: `apps/mobile/src/services/appShellModel.ts`
- Modify: `apps/mobile/src/components/ScreenScaffold.tsx`
- Modify: `apps/mobile/src/navigation/MainTabNavigator.tsx`
- Modify only if required by measured overlap: `apps/mobile/src/components/PlayerBar.tsx`
- Verify only: `apps/mobile/src/navigation/RootNavigator.tsx`
- Verify only: `apps/mobile/src/theme/tokens.ts`

**Consumes:** Tasks 1-5 的完整导航树；`findOpenDrawerKey`、Navigation state、Safe Area insets、PlayerBar 高度、Bottom Tab 高度。

**Produces:** Android 返回优先级、Settings/Tab/Root 详情 chrome 层级、一次性 Safe Area、PlayerBar/Tab 内容避让和最终验收证据。

**返回伪代码:** 
```ts
if (findOpenDrawerKey(rootState)) return closeTargetedDrawerAndConsume();
if (activeSettingsRoute !== "SettingsHome") return settingsNavigation.goBack();
if (activeSettingsRoute === "SettingsHome" && canGoBack) return navigationRef.goBack();
if (navigationRef.canGoBack()) return navigationRef.goBack();
return false;
```

- [ ] 将 active route/chrome 判定集中到 `appShellModel.ts`：主 Tab 显示底部 Tab；Settings 独立于 Tab；Root 详情不错误显示 Tab；MvPlayer/Player 保持既有全屏层级。
- [ ] 保持 `findOpenDrawerKey` 递归识别任意打开 Drawer；硬件返回先关闭 Drawer，再退 Settings 详情、SettingsHome、其他 Native Stack，根页返回 false 交给系统。
- [ ] 审计 Safe Area：AppShell 处理系统 top/bottom；ScreenScaffold 不重复加同边 inset；Drawer 只处理自身 inset；PlayerBar 使用 bottom inset，滚动内容同时避让 PlayerBar 与 Tab 实际高度。
- [ ] 在 Android 小屏、常规屏及横屏手测首页、搜索、曲库、我的、八个设置详情；确认文字不被 Header、PlayerBar、Tab 或系统栏遮挡。
- [ ] 手测 Drawer 每个入口、账号成功/失败退出、音质共享文案、Data 成功/失败清理、WebDav/Sources 子页、唯一下载页面的下载中/失败/完成/播放/删除/清理。
- [ ] 手测首页搜索、AppHeader 搜索和既有外部 URL；再回归首页、MV、歌曲行、多选、播放器、每日推荐、私人 FM 和各内容详情。
- [ ] 执行静态检查和 Android 编译；确认没有新增测试/Vitest、没有桌面端差异、没有 whitespace 错误，也没有执行 git 提交。

**验证命令:**
```bash
pnpm mobile:typecheck
pnpm mobile:build:debug
git diff --check
git status --short
git diff --name-only -- desktop
git diff --name-only -- apps/mobile | rg '(test|spec)\.(ts|tsx)$|vitest'
```

**验收预期:** TypeScript 与 Android debug build 成功；`git diff --check` 无输出；本任务未产生 desktop 文件差异；未新增测试或 Vitest 文件；所有手工流程符合 Global Constraints。

---

## 自审结果

- **规格覆盖：通过。** 六个任务覆盖路由挂载、固定四 Tab、SettingsHome + Native Stack、Drawer 分组深链、账号/音质/Data/a11y、AppShell/返回键/Safe Area/回归验证；非目标和 Android 约束已写入全局约束。
- **路由参数一致：通过。** 全文只使用 `Main -> Settings -> SettingsHome|Account|Playback|Lyrics|Appearance|Sources|Sync|Data|About|Login|WebDav|CustomSources|LyricDetail`，搜索只使用 `Main -> MainTabs -> SearchTab`，下载只使用 `Main -> MainTabs -> LibraryTab -> Downloads`。
- **下载唯一实现：通过。** `DownloadScreen` + `useDownloadStore` 是唯一下载管理实现；Library Downloads 直接渲染同一组件，Drawer 只导航到该入口，计划不创建第二套页面、状态或持久化。
- **范围与交付：通过。** 计划不新增测试/Vitest、不提交 git、不回滚现有改动，不要求桌面端修改；每任务均含 exact files、Consumes、Produces、checkbox、关键签名或伪代码和验证命令。
