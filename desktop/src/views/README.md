# views/

页面视图层：路由驱动的薄视图，组合 hooks / stores / services 呈现界面；业务规则下沉到 services，仅活动 section 挂载以保首屏快。

## 路由映射

| 路由 | 视图组件 | 职责 |
| --- | --- | --- |
| `/` | HomeView | 发现页：推荐歌单 / 排行榜 / 快速入口 |
| `/search` | SearchView (1029 行，最大) | 综合 / 单曲 / 歌手 / 专辑 / 歌单分类 + 建议 + 历史 |
| `/library` | （重定向） | 无独立视图，仅重定向到 `/playlist/favorites` |
| `/local` | LocalMusicView | 本地音乐扫描 / 列表 / 网格 / 元数据编辑 |
| `/playlists` | PlaylistsView | 歌单中心 |
| `/downloads` | DownloadsView | 下载管理 |
| `/history` | HistoryView | 播放历史 |
| `/stats` | StatsView | 听歌统计：总时长 / 次数 / Top 歌曲 / Top 歌手 / 按天趋势（纯 CSS 条形） |
| `/playlist/:id` | PlaylistDetailView | 歌单详情 |
| `/artist/:id` | ArtistDetailView | 歌手详情 |
| `/album/:id` | AlbumDetailView | 专辑详情 |
| `/daily` | DailyRecommendView | 每日推荐 |
| `/fm` | PersonalFmView | 私人 FM |
| `/settings` | SettingsView | 顶部标签栏（8 个分区，横向可滚动、吸顶，`←/→`/`Home`/`End` 可切换）+ 仅活动 section 挂载 |

## settings/ 子视图（8 个）

| 子视图 id | 组件 | 职责 |
| --- | --- | --- |
| `appearance` | AppearanceSettingsSection | 外观 |
| `playback` | PlaybackSettingsSection | 播放 |
| `sources` | SourcesSettingsSection | 音源 |
| `desktop-lyric` | DesktopLyricSettingsSection | 桌面歌词 |
| `data` | DataSettingsSection | 数据 |
| `sync` | SyncSettingsSection | 同步 |
| `misc` | MiscSettingsSection | 其他 |
| `about` | （内联在 SettingsView.tsx 里，无独立文件） | 关于 |

`SettingRow.tsx` 是各 section 共用的展示组件，本身不是一个 section。

## useSettingsViewModel

`useSettingsViewModel.ts`：集中外观，用 `Pick<>` 类型切片聚合播放 / 源 / 数据状态，供 SettingsView 及子视图订阅，避免各子视图重复选 store。

## 设计约定

- **视图薄**：视图只组合 hooks / stores / services，不写业务规则。
- **业务下沉**：业务规则全部在 services。
- **按需挂载**：SettingsView 仅挂载活动 section，其余不渲染。
- **首屏优先**：非首屏视图用 `lazy import()`，保首屏加载快。
