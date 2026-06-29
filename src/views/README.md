# views

页面级组件由 `src/App.tsx` 路由挂载。当前实际页面如下。

| 文件 | 路由或窗口 |
|---|---|
| `HomeView.tsx` | `/` |
| `SearchView.tsx` | `/search` |
| `LocalMusicView.tsx` | `/local` |
| `PlaylistsView.tsx` | `/playlists` |
| `DownloadsView.tsx` | `/downloads` |
| `PlaylistDetailView.tsx` | `/playlist/:id` |
| `ArtistDetailView.tsx` | `/artist/:id` |
| `AlbumDetailView.tsx` | `/album/:id` |
| `DailyRecommendView.tsx` | `/daily` |
| `PersonalFmView.tsx` | `/fm` |
| `SettingsView.tsx` | `/settings` |
| `LyricWindowView.tsx` | 桌面歌词窗口 |
| `LyricUnlockView.tsx` | 桌面歌词解锁窗口 |

`/library` 不是独立页面，会重定向到 `/playlist/favorites`。

## SearchView

`SearchView.tsx` 负责搜索页输入、联想、结果缓存恢复和分类展示。当前分类为 `综合 / 单曲 / 歌手 / 专辑 / 歌单`。综合页展示歌手、新专辑、一个歌单摘要和单曲列表；单曲、歌手、专辑、歌单 tab 展示对应完整列表。
