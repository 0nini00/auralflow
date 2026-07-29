# stores

Zustand 全局状态。持久化用户数据通过 `libraryPersistence.ts` 写入 Tauri `library_*` 命令。

| 文件 | 用途 |
|---|---|
| `playerStore.ts` | 当前曲目、队列、进度、音量、播放模式和 FM 状态 |
| `playerSync.ts` | 主窗口和歌词窗口之间的播放状态同步 |
| `favoritesStore.ts` | 喜欢歌曲 |
| `playlistStore.ts` | 本地歌单 |
| `historyStore.ts` | 最近播放历史 |
| `libraryStore.ts` | 本地音乐歌曲和扫描目录 |
| `libraryRefreshModel.ts` | 本地库刷新合并规则 |
| `libraryPersistence.ts` | Tauri 命名空间持久化 helper |
| `downloadStore.ts` | 下载任务状态 |
| `customSourceStore.ts` | 自定义音源导入、启用、测试和更新状态 |
| `discoveryStore.ts` | 发现、每日推荐和私人 FM 数据 |
| `wyAccountStore.ts` | 网易云账号、歌单、登录验证结果和歌单详情缓存 |
| `themeStore.ts` | 主题 |
| `sleepTimerStore.ts` | 睡眠定时 |
| `soundEffectStore.ts` | 均衡器、声像、混响和变调 |
| `lyricSettingsSync.ts` | 桌面歌词设置跨窗口同步 |

持久化命名空间包括 `favorites`、`playlists`、`library`、`customSources`、`recent` 和 `soundEffect`。
