# AuralFlow 桌面端 vs 移动端 — 逐功能对比

> 日期：2026-07-10  
> 基准 commit：桌面端 `desktop/`，移动端 `apps/mobile/`  
> 目的：逐功能比对 UI 布局 + 前后端实现差异，为架构改版提供精确依据

---

## 1. 首页（Home）

### UI 布局

| 区域 | 桌面端 | 移动端 | 差异 |
|---|---|---|---|
| Hero 区 | 左文右按钮（私人FM + 搜索） | 文字卡片 + 3 个发现卡片（每日推荐 / 私人FM / 搜索） | 移动端多了「每日推荐」入口卡片 |
| 最近播放 | `MusicCard` 网格，限 10 首，封面大卡 | `SongList` 列表行，限 10 首 | **展示形式不同**：桌面用卡片网格，移动用列表 |
| 操作按钮 | 顶部 SectionHeader 有「播放全部」 | 标题旁「播放全部」+「查看全部」 | 移动端多了「查看全部」跳曲库历史 |
| 空态 | 图标 + 两行文案 | 纯文字 | 桌面端空态更丰富 |

### 前后端

| 能力 | 桌面端 | 移动端 |
|---|---|---|
| 数据源 | `useHistoryStore` → `history.slice(0, 10)` | `useHistoryStore` → `buildHomeSongActions(history)` |
| 播放全部 | `playQueue(recent, 0)` (playerStore) | `playQueue(songActions.playAllSongs, 0)` (playerService) |
| 单曲操作 | `SongAddMenuButton`（喜欢/加歌单） | `SongList` 内建行操作（喜欢/下载/加歌单） |
| 导航 | react-router `navigate()` | `setMode("daily"/"fm")` 内联子页面 |

**结论**：功能对齐 ✅，展示形式差异合理（桌面卡片 vs 移动列表）

---

## 2. 搜索（Search）

### UI 布局

| 区域 | 桌面端 | 移动端 | 差异 |
|---|---|---|---|
| 搜索框 | Header 全局搜索 + SearchView 内搜索 | 独立 TextInput + 搜索按钮 | 桌面有两处搜索入口 |
| 源切换 | ❌ 无（聚合搜索） | ❌ 刚去掉 | ✅ 已对齐 |
| 分类 Tab | 横排按钮：综合/单曲/歌手/专辑/歌单 | 横向 ScrollView 同样 5 个 Tab | ✅ 一致 |
| 联想词 | 下拉 popover，线上+本地合并 | 弹出建议列表 | ✅ 功能一致 |
| 搜索历史 | ❌ 无独立历史 UI | ✅ 有搜索历史列表 + 清空 | **移动多出搜索历史** |
| 综合视图 | 突出显示 1 个最佳歌手/专辑/歌单 + 歌曲列表 | summaryGrid 数字卡片 + 分区预览各 3 个 | **布局差异大** |
| 歌曲结果 | 单曲合并去重（同名同歌手跨源合并为 1 行多源） | 直接列出所有源的歌曲，不去重 | **桌面端有跨源合并，移动端没有** |
| 歌手/专辑结果 | 点击跳详情页（wy）或显示「暂不支持」 | 点击走 `openSearchArtistDetail` → 降级 fallback | 移动端非 wy 降级更好 |
| 歌单收藏 | 网易云→收藏到账号，QQ→导入本地歌单 | 同逻辑 `handleImportPlaylist` | ✅ 一致 |
| 播放操作 | 点击行播放 + 加队列 + 加歌单 + 下载 4 个按钮 | 行操作（喜欢/下载/加歌单）| 桌面多「加队列」按钮 |
| 缓存 | `searchResultCache` 内存缓存 + 恢复 filter 状态 | `hasCachedResult` + `setCachedResult` | 机制不同 |

### 前后端

| 能力 | 桌面端 | 移动端 |
|---|---|---|
| 搜索函数 | `searchMergedSources()` — 按 type 并发搜 wy+tx，合并去重 | `searchAll("all", query)` — 搜 wy+tx songs，合并去重，再分别搜歌手/专辑/歌单 |
| 去重逻辑 | `groupSongResults()` — 同名+同歌手+时长差≤6s 合并，保留多源 variant | `mergeDuplicateSongs()` — 不同实现 |
| 请求竞态 | `searchRequestSeqRef` 自增序列号 | 无竞态保护（快速连续搜索可能乱序） |
| URL 同步 | `setSearchParams({ q })` 搜索参数同步到 URL | ❌ 无 URL/DeepLink 参数同步（已用 deepLink 初始关键词代替） |
| 联想词 | `fetchWySearchSuggestions` 网易云接口 | `getSearchSuggestions` 自己的实现 |

**结论**：⚠️ 搜索去重逻辑不一致；移动端缺少竞态保护；移动端搜索历史是增量

---

## 3. 歌单详情（Playlist Detail）

### UI 布局

| 区域 | 桌面端 | 移动端 |
|---|---|---|
| 入口 | `/playlist/:id` 路由，支持 `state.playlist` 预填 | `PlaylistDetailScreen` 通过 `openPlaylistRoute()` 子路由 |
| 封面+信息 | 左图右文，大封面 | 顶部封面 + 文字 |
| 操作 | 播放全部 / 随机 / 定位当前 / 刷新 / 收藏 | 播放全部 / 随机 / 定位当前 / 刷新 / 收藏 ✅ |
| 歌曲列表 | 虚拟列表 `VirtualList` | `SongList` 组件 |
| 行操作 | 播放/加队列/加歌单/下载 | 喜欢/下载/加歌单 |

### 前后端

| 能力 | 桌面端 | 移动端 |
|---|---|---|
| 数据加载 | 从 URL params 判断 source，分别调 wy/bili/tx 接口 | `PlaylistDetailScreen` props 传入 playlist 对象 |
| 刷新 | 重新 fetch 歌单详情 | 同 |
| 定位当前 | `scrollToCurrentSong()` | `scrollToCurrentSong()` ✅ |

**结论**：基本对齐 ✅

---

## 4. 歌手详情（Artist Detail）

### UI 布局

| 区域 | 桌面端 | 移动端 |
|---|---|---|
| 入口 | `/artist/:id` 路由 | `ArtistDetailScreen` 子路由 |
| 热门歌曲 | 列表 + 播放全部 | 列表 + 播放热门 |
| 专辑 | 网格卡片 | 列表 |
| 操作 | 播放全部 / 下载 / 加歌单 | 播放热门 / 随机播放 |

### 前后端

| 能力 | 桌面端 | 移动端 |
|---|---|---|
| 数据源 | `fetchNeteaseArtistDetail()` — 网易云 API | 同 |
| 非 wy 降级 | 不支持，显示「暂不支持详情」 | `SearchFallbackDetailScreen` 降级列表 ✅ 移动端更好 |

**结论**：移动端非 wy 降级更好；桌面端专辑展示用网格更丰富

---

## 5. 专辑详情（Album Detail）

### UI 布局

| 区域 | 桌面端 | 移动端 |
|---|---|---|
| 入口 | `/album/:id` 路由 | `AlbumDetailScreen` 子路由 |
| 封面+信息 | 左图右文 | 顶部封面 |
| 操作 | 播放全部 / 随机 | 播放全部 / 随机 / 定位当前 |
| 歌曲列表 | 列表 + 行操作 | 列表 + 行操作 |

**结论**：基本对齐 ✅，移动端多了定位当前播放

---

## 6. 下载管理（Downloads）

### UI 布局

| 区域 | 桌面端 | 移动端 |
|---|---|---|
| 入口 | 侧边栏独立页 `/downloads` | 原 Tab，现在曲库 section + 独立 DownloadScreen |
| 保存位置 | 显示目录路径 +「更改目录」按钮 | 显示路径 + 说明「沙盒固定无法更改」 |
| 任务列表 | grid 列表：封面+信息+进度条+操作 | 三段：下载中 / 失败 / 已下载 |
| 操作 | 播放(已完成) / 重试(失败) / 删除 | 重试 / 删除 / 取消 / 清空 |
| 音质显示 | ✅ 行内显示音质 | ✅ 行内显示音质 |
| 空态 | 图标 + 文案 | 图标 + 文案 ✅ |

### 前后端

| 能力 | 桌面端 | 移动端 |
|---|---|---|
| Store | `useDownloadStore` (Tauri bridge) | `useDownloadStore` (RN) |
| 下载触发 | `DownloadQualityButton` 组件选音质 | `SongList` 内建下载操作 |
| 播放已下载 | `toLocalMusic(task)` → `play()` | `play(song, localPath)` 直接本地路径 |
| 目录选择 | Tauri `chooseDownloadDir()` | ❌ 不可改（沙盒） |

**结论**：功能对齐 ✅，桌面端可改目录是平台差异

---

## 7. 播放页（Player）

### UI 布局

| 区域 | 桌面端 | 移动端 |
|---|---|---|
| 形态 | 底部固定 PlayerBar | 全屏 PlayerScreen |
| 封面 | 小缩略图（点击开沉浸歌词） | 大封面（点击开沉浸歌词）✅ |
| 歌曲信息 | 名称 + 歌手 | 名称 + 歌手 ✅ |
| 进度条 | 顶部细条 + 拖拽 | ProgressBar 组件 + 拖拽 ✅ |
| 播放控制 | 上一首/播放/下一首 | 上一首/播放/下一首 ✅ |
| 播放模式 | 图标切换（循环/单曲/随机/顺序） | 文字切换 ✅ |
| 音量 | 底部滑条 + 静音按钮 | 弹窗调节 + 静音 |
| 倍速 | ❌ 无 | ✅ 有（弹窗选择） |
| 睡眠定时 | 下拉菜单（15/30/45/60分钟 + 首数） | 弹窗（分钟/首数 + 自定义）✅ |
| 音效 | ❌ PlayerBar 无入口 | ✅ 有均衡器入口 |
| 音质切换 | ❌ 无 | ✅ 有（播放中切音质） |
| 歌词 | 点封面→沉浸歌词 | 内嵌歌词 + 沉浸歌词入口 |
| 桌面歌词 | 独立窗口（Tauri） | 悬浮窗（Android overlay）✅ |
| 队列 | ❌ PlayerBar 无队列 UI | ✅ 有队列弹窗 |
| 喜欢/分享/加歌单 | `SongAddMenuButton` | 独立按钮行 ✅ |
| 氛围色 | ❌ | ✅ 根据封面生成背景氛围色 |
| 系统歌词浮层 | ❌ 桌面无 | ✅ Android 歌词浮层 |

### 前后端

| 能力 | 桌面端 | 移动端 |
|---|---|---|
| Store | `usePlayerStore` (Zustand) | `usePlayerStore` (Zustand) — 不同实现 |
| 引擎 | Tauri playerEngine | react-native-track-player |
| 播放模式 | `getNextPlayMode()` 4 种 | `togglePlayMode()` 4 种 ✅ |
| 沉浸歌词 | `ImmersiveLyricsOverlay` 组件 | `ImmersiveLyricsScreen` 独立页面 |
| 音质切换 | ❌ | `switchCurrentPlaybackQuality()` |

**结论**：移动端播放页功能**超越**桌面端（倍速、音质切换、队列管理、氛围色）

---

## 8. 沉浸歌词（Immersive Lyrics）

### UI 布局

| 区域 | 桌面端 | 移动端 |
|---|---|---|
| 入口 | 点封面→overlay | 点封面→独立页面 |
| 歌词显示 | 大字号 + 译文切换 | 大字号 + 译文 ✅ |
| 控制条 | 播放/暂停/上一首/下一首 + 睡眠定时 + 倍速 + 音效 | 播放/暂停/上下首 + 睡眠 + 倍速 + 音量 + 音效 + 音质 ✅ |
| 译文开关 | ✅ | ✅ |
| 海报 | ❌ | ✅ 歌词海报切换 |

**结论**：移动端控制条更丰富 ✅

---

## 9. 设置（Settings）

### UI 布局

| 区域 | 桌面端 | 移动端 |
|---|---|---|
| 结构 | 左侧导航栏 + 右侧内容区（8 个分区） | 垂直滚动单一页面 |
| 账号 | 侧边栏底部头像 + 设置里 B站 Cookie | 设置页 AccountInfo + B站 Cookie |
| 外观 | 主题/强调色/背景图/光标特效/字体 | 主题/强调色/背景图 |
| 播放 | 音质/外部播放暂停 | 音质/外部播放暂停 ✅ |
| 音源 | 自定义音源脚本管理 | 自定义音源 ✅ |
| 桌面歌词 | 字号/字体/颜色/背景 | ❌ 无（移动端用悬浮窗设置代替）|
| 歌词样式 | 沉浸歌词字体/字号 | 独立 LyricSettingsScreen |
| 数据 | 缓存统计/清缓存/清历史 | CacheSettings 组件 ✅ |
| 同步 | WebDAV 配置 | WebDAV ✅ |
| 更新 | 检查更新 | 检查更新 ✅ |

### 前后端

| 能力 | 桌面端 | 移动端 |
|---|---|---|
| 持久化 | Tauri `loadSettings()` / `patchSettings()` | AsyncStorage via stores |
| 主题 | `useThemeStore` (desktop) | `useThemeStore` (mobile) — 不同实现 |
| 自定义音源 | `useCustomSourceStore` | `useCustomSourceStore` ✅ |

**结论**：移动端缺少桌面端的「桌面歌词样式」分区（因为用悬浮窗方案不同），其余对齐

---

## 10. 曲库（Library）— 原 PlaylistsView + HistoryView + LocalMusicView + DownloadsView

### UI 布局

| 区域 | 桌面端 | 移动端 |
|---|---|---|
| 结构 | 4 个独立页面 + 侧边栏入口 | 1 个 LibraryScreen + 顶部 Tab 切换分区 |
| 歌单分区 | 网易云歌单 + 本地歌单 + B站合集 分组展示 | 同样分组展示 ✅ |
| 历史分区 | 独立 HistoryView：播放全部/随机/清空/删除 | 曲库 history section：播放全部/随机/清空/删除 ✅ |
| 本地分区 | 独立 LocalMusicView：扫描/网格视图 | 曲库 local section：扫描/添加文件 ✅ |
| 下载分区 | 独立 DownloadsView | 曲库 downloads section + 独立 DownloadScreen |

### 前后端

| 能力 | 桌面端 | 移动端 |
|---|---|---|
| 歌单 CRUD | `usePlaylistStore` (desktop) | `usePlaylistStore` (mobile) ✅ |
| 历史管理 | `useHistoryStore` 清空/删除 | `useHistoryStore` 清空/删除 ✅ |
| 本地扫描 | Tauri 文件系统扫描 | `LocalMusicModule.scanMediaStore()` ✅ |
| B站合集 | `useBiliAccountStore` | `useBiliAccountStore` ✅ |
| 导入/导出 | `exportPlaylists` / `importPlaylists` | `shareExportedPlaylists` / `importPlaylistsFromJsonInput` ✅ |

**结论**：功能对齐 ✅，结构差异合理（桌面分页 vs 移动分区 Tab）

---

## 11. 每日推荐 / 私人 FM

### UI 布局

| 区域 | 桌面端 | 移动端 |
|---|---|---|
| 入口 | 侧边栏独立项 → `/daily` / `/fm` | 首页发现卡片 → 内联子页面 |
| 每日推荐 | 歌曲列表 + 播放全部/随机/刷新 | 同 ✅ |
| 私人 FM | 播放卡片 + 下一首 | 播放卡片 + 下一首 ✅ |

**结论**：功能对齐 ✅

---

## 12. 歌词设置（Lyric Settings）

### UI 布局

| 区域 | 桌面端 | 移动端 |
|---|---|---|
| 入口 | 设置→桌面歌词分区 | 播放页→设置→歌词样式按钮 |
| 基础 | 字号/行距/颜色 | 字号/行距/颜色 ✅ |
| 排版 | 对齐方式/字体 | 字体 ✅ |
| 颜色 | 背景/高亮/描边 | 高亮色 ✅ |
| 译文 | 开关 | 开关 ✅ |

**结论**：基本对齐 ✅

---

## 13. WebDAV 同步

### UI 布局

| 区域 | 桌面端 | 移动端 |
|---|---|---|
| 入口 | 设置→同步 | 设置→同步与音源 |
| 配置 | URL/用户名/密码 | URL/用户名/密码 ✅ |
| 操作 | 上传/下载/合并 | 上传/下载/合并 ✅ |

**结论**：功能对齐 ✅

---

## 14. 自定义音源

### UI 布局

| 区域 | 桌面端 | 移动端 |
|---|---|---|
| 入口 | 设置→音源 | 设置→同步与音源 |
| 导入 | 粘贴脚本 / 导入文件 | 粘贴脚本 ✅ |
| 管理 | 列表 + 启用/禁用/删除/更新检查 | 启用/禁用/删除 ✅ |
| 更新 | 自动检查 + 手动检查 | 启动时检查 ✅ |

**结论**：基本对齐 ✅

---

## 15. 缓存管理

### UI 布局

| 区域 | 桌面端 | 移动端 |
|---|---|---|
| 入口 | 设置→数据 | 设置→数据 |
| 缓存统计 | 封面缓存大小 / 歌词缓存大小 / 歌曲缓存大小 | 封面+歌词+歌曲缓存大小 ✅ |
| 清理 | 分类清理 + 全部清理 | 分类清理 + 全部清理 ✅ |
| 清历史 | 清空播放历史 | 清空播放历史 ✅ |

**结论**：功能对齐 ✅

---

## 汇总：真正需要补齐的差异

| 优先级 | 差异 | 说明 |
|---|---|---|
| **P0** | 搜索歌曲去重 | 桌面端跨源合并同名歌曲（`groupSongResults`），移动端没有 |
| **P0** | 搜索请求竞态保护 | 桌面端有 `searchRequestSeqRef`，移动端快速连续搜索可能乱序 |
| **P1** | 搜索历史 | 移动端有，桌面端没有 — 桌面可补 |
| **P1** | 播放页倍速/音质切换 | 移动端有，桌面端没有 — 桌面可补 |
| **P1** | 播放队列管理 UI | 移动端有弹窗管理，桌面端没有 |
| **P2** | 首页最近播放展示 | 桌面卡片网格 vs 移动列表 — 差异合理，不需对齐 |
| **P2** | 桌面端歌词样式分区 | 移动端用独立 LyricSettingsScreen 代替，不需对齐 |
| **P2** | 搜索综合视图 | 桌面突出最佳结果 vs 移动 summaryGrid — 差异合理 |
