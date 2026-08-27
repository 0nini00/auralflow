# views/

页面视图层：路由驱动的薄视图，组合 hooks / stores / services 呈现界面；业务规则下沉到 services，仅活动 section 挂载以保首屏快。

## 路由映射

| 路由 | 视图组件 | 职责 |
| --- | --- | --- |
| `/` | HomeView | 发现页：推荐歌单 / 排行榜 / 快速入口 |
| `/search` | SearchView (1029 行，最大) | 综合 / 单曲 / 歌手 / 专辑 / 歌单分类 + 建议 + 历史 |
| `/local` | LocalMusicView | 本地音乐扫描 / 列表 / 网格 / 元数据编辑 |
| `/playlists` | PlaylistsView | 歌单中心 |
| `/downloads` | DownloadsView | 下载管理 |
| `/history` | HistoryView | 播放历史 |
| `/playlist/:id` | PlaylistDetailView | 歌单详情 |
| `/artist/:id` | ArtistDetailView | 歌手详情 |
| `/album/:id` | AlbumDetailView | 专辑详情 |
| `/daily` | DailyRecommendView | 每日推荐 |
| `/fm` | PersonalFmView | 私人 FM |
| `/settings` | SettingsView | 单页 sticky 168px 导航 + 9 子视图 `useState` 切换，仅活动 section 挂载 |

## settings/ 子视图（9 个）

| 子视图 | 职责 |
| --- | --- |
| AppearanceSettings | 外观 |
| PlaybackSettings | 播放 |
| SourceSettings | 音源 |
| DesktopLyricSettings | 桌面歌词 |
| SyncSettings | 同步 |
| AboutSettings | 关于 |
| AccountSettings | 账号 |
| MiscSettings | 其他 |
| （第 9 个见目录文件） | — |

## useSettingsViewModel

`useSettingsViewModel.ts`：集中外观，用 `Pick<>` 类型切片聚合播放 / 源 / 数据状态，供 SettingsView 及子视图订阅，避免各子视图重复选 store。

## 设计约定

- **视图薄**：视图只组合 hooks / stores / services，不写业务规则。
- **业务下沉**：业务规则全部在 services。
- **按需挂载**：SettingsView 仅挂载活动 section，其余不渲染。
- **首屏优先**：非首屏视图用 `lazy import()`，保首屏加载快。
