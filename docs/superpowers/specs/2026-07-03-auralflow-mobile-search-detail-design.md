# AuralFlow 移动端搜索与详情设计规格

日期：2026-07-03
方向：在现有 Android MVP 基础上，把移动端从“单页搜索播放器”扩展为具备搜索分类和内容详情浏览能力的音乐应用。

---

## 1. 目标

在不触碰登录、下载、本地扫描的前提下，优先补齐移动端与桌面端最接近、最可复用的一段能力：

1. 搜索页支持 `综合 / 单曲 / 歌手 / 专辑 / 歌单`
2. 新增歌手详情页、专辑详情页、歌单详情页
3. 播放仍复用当前移动端播放链路，不重写播放器
4. 共享 `@lx/core` 的模型、歌词解析和内置音乐 API helper，避免把桌面端 store/Tauri 逻辑搬到 React Native

这一阶段的产物不是“完整移动端”，而是把当前 MVP 拉到“可浏览内容、可从搜索进入详情、可从详情直接播放”的状态。

## 2. 当前上下文

### 2.1 已有移动端

当前移动端入口在 [apps/mobile/App.tsx](/C:/Users/chenle/Desktop/auralflow/apps/mobile/App.tsx)，特点是：

- 底部 4 个 tab：发现、搜索、歌单、播放
- 搜索只支持单曲列表
- 没有真正的页面栈，所有内容都在单文件中切换
- 播放通过 `react-native-track-player`
- 历史通过 AsyncStorage 保存
- 歌词解析、内置音乐 API 请求已经复用 `@lx/core`

### 2.2 可复用桌面端能力

桌面端已经有成熟实现，可作为移动端设计参照：

- [src/views/SearchView.tsx](/C:/Users/chenle/Desktop/auralflow/src/views/SearchView.tsx)
- [src/views/ArtistDetailView.tsx](/C:/Users/chenle/Desktop/auralflow/src/views/ArtistDetailView.tsx)
- [src/views/AlbumDetailView.tsx](/C:/Users/chenle/Desktop/auralflow/src/views/AlbumDetailView.tsx)
- [src/views/PlaylistDetailView.tsx](/C:/Users/chenle/Desktop/auralflow/src/views/PlaylistDetailView.tsx)
- [src/services/wyAccountService.ts](/C:/Users/chenle/Desktop/auralflow/src/services/wyAccountService.ts)

但这些实现直接依赖桌面端 store、浏览器/Tauri 能力，不能直接搬到移动端。移动端需要复用的是：

- 搜索分类结构
- 歌手/专辑/歌单详情的信息架构
- `@lx/core` 里的类型、歌词 parser、内置音乐 API helper

## 3. 范围

### 3.1 本期范围

1. 搜索页支持五个分类：
   - 综合
   - 单曲
   - 歌手
   - 专辑
   - 歌单
2. 搜索结果支持进入详情页：
   - 歌手详情：先支持网易云
   - 专辑详情：先支持网易云
   - 歌单详情：支持网易云和 QQ 搜索结果进入远端歌单详情
3. 详情页歌曲支持：
   - 直接播放
   - 显示封面、作者、曲目基础信息
   - 拉取歌词并进入现有播放器页
4. 重构移动端目录结构，把 `App.tsx` 拆成 screen、service、navigation、component 几层
5. 增加面向纯逻辑的最小测试能力，覆盖搜索聚合和数据映射

### 3.2 本期明确不做

- 网易云登录、Cookie、扫码登录
- 我的歌单、喜欢列表、每日推荐、私人 FM
- 本地音乐扫描
- 下载、缓存、离线播放
- 桌面端那套复杂歌单写操作
- React Native 组件级自动化 UI 测试

## 4. 方案选择

### 4.1 备选方案

#### 方案 A：继续在 `App.tsx` 里堆状态

优点：

- 改动最小
- 出结果最快

缺点：

- 页面越多越难维护
- 很快会把详情、搜索、播放状态耦合成一个大组件
- 后续接登录、歌单、下载时会继续失控

#### 方案 B：大量把桌面端搜索/详情逻辑抽进 `@lx/core`

优点：

- 长期复用最好
- 桌面与移动的逻辑边界最统一

缺点：

- 本期会大改桌面端稳定逻辑
- 引入跨端边界风险
- 不适合用作第一步

#### 方案 C：引入移动端页面栈，复用纯共享逻辑

优点：

- 结构清晰，适合继续演进
- 共享边界明确
- 不需要改桌面端现有业务实现

缺点：

- 比方案 A 多一轮结构整理

### 4.2 选择

本期采用方案 C。

原因：

1. 当前移动端已经不是一次性 demo，继续堆状态会直接制造债务
2. 桌面端的业务逻辑复杂且依赖环境不同，本期不值得强行抽象
3. 搜索与详情是天然适合分 screen + service 的移动端结构

## 5. 页面与导航设计

### 5.1 导航方案

移动端新增 React Navigation，采用：

- Root Stack
- 底部 Tab 作为主壳

结构如下：

```text
RootStack
├── MainTabs
│   ├── HomeTab
│   ├── SearchTab
│   ├── LibraryTab
│   └── PlayerTab
├── ArtistDetail
├── AlbumDetail
└── PlaylistDetail
```

选择 React Navigation 而不是自定义页面栈，原因是：

- 它是 React Native 的主流方案
- 天然支持返回栈、参数传递、Header 控制
- 后续接登录、歌单、设置、下载时不需要再推翻导航层

### 5.2 页面职责

#### `HomeScreen`

- 继续保留当前发现页的轻量入口
- 展示推荐试听或最近播放
- 只负责跳转，不承担复杂业务

#### `SearchScreen`

- 输入关键词
- 切换五个分类
- 展示搜索结果
- 从结果进入详情或直接播放歌曲

#### `LibraryScreen`

- 继续保留当前占位能力
- 这一期不新增复杂行为

#### `PlayerScreen`

- 沿用现有播放器页
- 只接收当前播放状态和歌词，不承载新搜索逻辑

#### `ArtistDetailScreen`

- 展示歌手头像、名称、作品数、专辑数
- 展示热门歌曲列表
- 展示专辑列表
- 点击歌曲直接播放
- 点击专辑进入专辑详情

#### `AlbumDetailScreen`

- 展示专辑封面、名称、歌手、发行时间、曲目数
- 展示专辑曲目列表
- 点击歌曲直接播放

#### `PlaylistDetailScreen`

- 展示歌单封面、名称、作者、来源、曲目数
- 展示歌单曲目列表
- 支持网易云 / QQ 搜索结果跳入远端歌单详情
- 本期只读，不提供收藏、导入、删除操作

## 6. 搜索信息架构

### 6.1 搜索分类

移动端搜索与桌面端保持同样五类：

- `overview`
- `song`
- `artist`
- `album`
- `playlist`

界面文案为：

- 综合
- 单曲
- 歌手
- 专辑
- 歌单

### 6.2 综合页布局

综合页不做桌面端那种宽屏卡片组合，而是改成适合手机滚动的摘要块：

1. 最相关歌手
2. 代表专辑
3. 代表歌单
4. 单曲列表

选择规则：

- 歌手：结果第一个
- 专辑：优先较新的专辑；没有明确时间时取第一个
- 歌单：取结果第一个
- 单曲：沿用结果顺序

综合页只展示摘要，不展示所有内容，否则手机界面会显得过重。

### 6.3 单曲结果

- 展示封面、歌曲名、歌手、来源
- 点击整行直接播放
- 行尾保留“播放”或 icon 按钮

### 6.4 歌手 / 专辑 / 歌单结果

- 点击整行进入详情
- 未支持的来源明确显示“暂不支持详情”
- 本期歌手、专辑详情只对网易云开放
- 歌单详情支持网易云 / QQ

## 7. 数据与服务设计

### 7.1 共享层边界

继续复用 `@lx/core`：

- `MusicInfo`
- `PlaylistInfo`
- `ArtistInfo`
- `AlbumInfo`
- `SearchResult`
- 歌词 parser
- `createBuiltinMusicApiClient`

本期新增到 `@lx/core` 的内容只允许是纯函数或纯类型，例如：

- 搜索结果聚合 helper
- 与平台无关的结果计数和空结果工厂

不允许进入 `@lx/core` 的内容：

- React 组件
- React Navigation 代码
- AsyncStorage
- React Native Track Player
- Tauri / 浏览器 / 桌面 store 依赖

### 7.2 移动端服务层

新增或拆分如下模块：

```text
apps/mobile/src/
├── navigation/
│   ├── AppNavigator.tsx
│   └── types.ts
├── screens/
│   ├── HomeScreen.tsx
│   ├── SearchScreen.tsx
│   ├── LibraryScreen.tsx
│   ├── PlayerScreen.tsx
│   ├── ArtistDetailScreen.tsx
│   ├── AlbumDetailScreen.tsx
│   └── PlaylistDetailScreen.tsx
├── services/
│   ├── musicApi.ts
│   ├── mobileSearchService.ts
│   └── mobileDetailService.ts
├── components/
│   ├── SongRow.tsx
│   ├── ResultTabs.tsx
│   ├── SectionBlock.tsx
│   └── LoadingState.tsx
```

#### `musicApi.ts`

保留与内置音乐 API 的通用请求：

- 搜索歌曲
- 解析播放链接
- 拉取歌词

#### `mobileSearchService.ts`

负责移动端搜索聚合：

- 聚合单曲、歌手、专辑、歌单
- 组织综合页摘要
- 屏蔽 UI 不关心的接口差异

#### `mobileDetailService.ts`

负责详情数据请求：

- 网易云歌手详情
- 网易云歌手热门歌曲
- 网易云歌手专辑
- 网易云专辑详情
- 网易云 / QQ 歌单详情

### 7.3 详情数据来源

本期数据来源规则如下：

- 单曲搜索：内置音乐 API
- 歌手 / 专辑 / 歌单搜索：优先复用 provider 能力
- 歌手详情：移动端直接调用与桌面端同源的网易云接口实现
- 专辑详情：同上
- QQ 歌单详情：继续走 provider 的 `getPlaylistDetail`

如果某个 provider 不支持某类详情：

- 搜索结果仍可展示
- 详情入口显示“暂不支持详情”
- 不做空白页跳转

## 8. 状态设计

### 8.1 全局状态

本期不引入 Zustand 到移动端。

移动端仍保持轻量状态方案：

- 播放状态：继续由现有播放器状态持有
- 历史：AsyncStorage
- 页面级 loading / error / result：screen 内部 state

这样可以避免在尚未引入登录、歌单同步前过早建设全局 store。

### 8.2 导航参数

使用显式参数类型，至少包括：

- `ArtistDetail`: `{ artistId: string; source: "wy" }`
- `AlbumDetail`: `{ albumId: string; source: "wy" }`
- `PlaylistDetail`: `{ playlistId: string; source: "wy" | "tx"; title?: string }`

不直接把整块结果对象都塞进导航参数，避免参数结构漂移。

## 9. 播放与歌词

### 9.1 播放流程

所有页面中的歌曲播放统一复用当前移动端播放链路：

```text
点击歌曲
-> resolveSongUrl(song)
-> fetchSongLyrics(song)
-> playMobileTrack(song, url)
-> 写入历史
-> 跳转或切到 PlayerScreen
```

### 9.2 本期不做的播放器增强

以下能力不在本期范围：

- 播放队列管理
- 上一首 / 下一首的详情页联动
- 锁屏歌词
- 后台复杂控制面板

这些能力后续在“播放器与歌词”子项目里单独补。

## 10. UI 设计约束

移动端视觉延续当前深色基调，但做结构升级：

- 不做营销式 hero
- 以列表、摘要块、分段控件为主
- 结果行保持密度，方便扫描
- 详情页用大封面 + 标题 + 元信息 + 列表

控件约束：

- 分类切换用 segmented control
- 歌曲行保持稳定高度
- 操作按钮优先用 icon + 文本短标签
- 所有长标题支持单行截断或换行

## 11. 错误与空状态

### 11.1 搜索页

- 未输入关键词：显示引导文案
- 加载中：显示 loading state
- 请求失败：显示错误信息与重试按钮
- 无结果：显示“没有找到相关内容”

### 11.2 详情页

- 加载中：占位 skeleton 或 spinner
- 请求失败：错误信息 + 返回按钮 + 重试按钮
- 空曲目：显示“暂无内容”

### 11.3 不支持详情的来源

对不支持的详情来源，搜索结果不应崩溃或进入空白页，必须在点击前或点击时明确提示。

## 12. 测试与验证

### 12.1 测试策略

本期新增最小可维护测试能力，只覆盖纯逻辑，不覆盖 RN 组件渲染。

推荐为移动端引入 `vitest`，用于：

- 搜索结果聚合 helper
- 综合页摘要选择逻辑
- 详情数据映射
- 导航参数 helper

不在本期引入：

- `@testing-library/react-native`
- 端到端自动化

### 12.2 最小验证命令

实现完成后至少需要验证：

```bash
pnpm mobile:typecheck
```

如果本期加入测试，则还需要：

```bash
pnpm --filter @auralflow/mobile test
```

### 12.3 手动验收点

1. 搜索页可在五个分类间切换
2. 综合页能展示歌手、专辑、歌单摘要与单曲列表
3. 点击单曲可以播放并进入播放器页
4. 点击歌手可以进入歌手详情
5. 点击专辑可以进入专辑详情
6. 点击歌单可以进入远端歌单详情
7. 详情页的歌曲点击后仍能播放
8. 返回手势或返回按钮能正确退回上一页

## 13. 风险与处理

### 13.1 网易云详情接口与移动端环境差异

风险：

- 桌面端接口实现依赖浏览器/Tauri 运行环境

处理：

- 移动端单独实现 `mobileDetailService`
- 复用协议和映射逻辑，不直接复用桌面端服务文件

### 13.2 QQ 搜索与详情能力不对称

风险：

- QQ 结果可能支持搜索但不支持所有详情能力

处理：

- 本期只承诺 QQ 歌单详情
- QQ 歌手/专辑搜索结果允许展示，但详情入口禁用

### 13.3 `App.tsx` 现有结构过于集中

风险：

- 一边开发功能一边重构容易引入回归

处理：

- 先拆导航和 screen，再迁移搜索
- 播放逻辑尽量不动

## 14. 验收标准

满足以下条件视为本期设计对应的实现完成：

1. 移动端不再把所有界面堆在单个 `App.tsx`
2. 搜索页支持五个分类
3. 新增歌手、专辑、歌单详情页
4. 详情页歌曲可直接播放
5. 共享逻辑边界清晰，没有把桌面端 Tauri/store 依赖带入移动端
6. `pnpm mobile:typecheck` 通过
7. 若引入测试，相关纯逻辑测试通过

---

批准状态：设计已确认，待书面 spec 复核
