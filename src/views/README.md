# views

页面级组件，每个文件对应一个路由页面。

推荐页面：

- `HomePage.tsx`：首页 / 发现 / 每日推荐
- `SearchPage.tsx`：搜索（歌曲 + 歌单）
- `PlaylistPage.tsx`：歌单详情
- `LibraryPage.tsx`：本地歌单 / 播放历史
- `DownloadPage.tsx`：下载管理
- `SettingsPage.tsx`：设置（Cookie、主题、网关）
- `PlayerPage.tsx`：全屏播放页 / 桌面歌词页

页面只负责组合 components 和调用 services/stores，不包含复杂业务逻辑。
