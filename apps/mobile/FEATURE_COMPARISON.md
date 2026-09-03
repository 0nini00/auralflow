# 移动端功能对比

> 本文档基于两端实际代码结构核对，对照 07-11 模块对比结论。核心功能两端已全对齐，差异为平台原生设计（桌面窗口 / 托盘 / 快捷键 vs 移动通知栏 / 后台 / 触摸），而非能力缺失。

## 技术栈

| 端 | 框架 | 状态管理 | 播放引擎 | 持久化 |
| --- | --- | --- | --- | --- |
| 桌面端 | Tauri v2 + React 18 + Vite | Zustand | 浏览器 Audio / playerEngine | Rust JSON（settings / library） |
| 移动端 | React Native 0.86（Android） | Zustand | react-native-track-player | AsyncStorage（Cookie 等敏感项存原生 Keystore 加密存储） |

两端共享 `@lx/core`（歌曲模型、歌词解析、`webdav-merge`、内置音乐 API 工具）与网易云 / QQ 音乐 provider 逻辑。

---

## 一、与桌面共享功能

两端实现同一功能，但实现方式按平台各有差异。

| 功能 | 桌面实现 | 移动实现 |
| --- | --- | --- |
| **搜索** | 前端组件 + provider | `SearchScreen` / `searchDetailNavigation` / `searchSuggestionService` / `searchHistoryService` |
| **歌单** | 网易云歌单 + 本地歌单 | `wyPlaylistService` + `playlistStore` + `localPlaylistModel` |
| **每日推荐** | 前端页面 | `DailyRecommendScreen` |
| **私人 FM** | 前端 FM 逻辑 | `PersonalFmScreen`（约 640 行） |
| **播放** | 浏览器 Audio + playerEngine | react-native-track-player + `playerService` |
| **歌词** | 前端滚动歌词 + 逐字卡拉 OK | `LyricView`（587 行，行级高亮：纯色 + 缩放动画，不做逐字填充）+ `lyricSettingsStore` |
| **本地音乐** | Rust 目录扫描 + 元数据 | `localMusicService` + RN-FS + 权限 + jaudiotagger 写回 |
| **缓存** | 浏览器缓存 | `cacheService` + `CachedImage`（Glide）+ `playbackUrlCache` |
| **下载** | Rust 文件操作 | `downloadService` + `DownloadScreen`（串行队列；暂停即删半成品、整曲重下，无断点续传） |
| **历史** | Rust JSON | `historyStore` + `useHistoryStore` |
| **WebDAV 同步** | 前端 `withSyncLock` | `webdavSyncService`（约 1000 行；远端根 `/AuralFlow/`，读回退旧 `/LX_Music/`，上传只写新路径）+ `webdavStore` |
| **账号** | Cookie + 二维码登录 | Cookie 粘贴登录（`NeteaseAccountCard`：剪贴板一键读取、掩码摘要、MUSIC_U 检测；无二维码扫码）+ 原生 SecureStorageModule（Keystore） |
| **主题** | `themeStore`（亮 / 暗 / 跟随系统） | `themeStore`（同） |
| **B 站** | biliService + biliAccountStore | `biliService`（约 800 行）+ `biliAccountStore`（LRU 收藏夹） |
| **自定义音源** | 前端运行时 | `customSourceRuntime` + `CustomSourceScreen` |
| **睡眠定时器** | `sleepTimerStore` | `sleepTimerStore` |
| **沉浸式歌词** | `ImmersiveLyricsOverlay`（CSS） | `ImmersiveLyricsScreen`（Modal + PagerView） |

---

## 二、移动端独有功能

移动端因平台特性增加的能力，桌面端无对应实现。

| 功能 | 实现方式 | 说明 |
| --- | --- | --- |
| **通知栏控制** | TrackPlayer 通知 + `LyricNotificationReceiver` | 系统通知栏播放控制 |
| **后台播放** | react-native-track-player 后台服务 | 应用退到后台继续播放 |
| **锁屏控件** | TrackPlayer 系统媒体控件 | 锁屏界面显示播放控件 |
| **Deep link** | `mobileDeepLinkService`（`auralflow://` scheme） | 外部链接唤起应用并定位页面，AndroidManifest 注册 `auralflow` scheme |
| **分享面板** | `Share.share`（`shareMusicService`） | 系统分享面板分享歌曲信息 |
| **MV 播放器** | `react-native-video`（`MvPlayerScreen`） | 独立 MV 播放界面 |
| **首页 feed** | `homeFeedStore` + `homeFeedService`，600s TTL，按账号隔离 | 首页推荐流缓存，`HOME_FEED_TTL_MS = 600_000`，按 `wy:{userId}` / `anonymous` scope 隔离 |
| **Android 浮动歌词** | `WindowManager` 浮窗（`LyricOverlayService.java`） | 系统级悬浮歌词，需 `canDrawOverlays` / `requestOverlayPermission` 授权 |
| **自动检查自定义源更新** | `customSourceStore`，24h 节流 | `REMOTE_CHECK_MIN_INTERVAL_MS = 24h`，距上次远端检查不足 24h 跳过 |
| **沙盒下载目录** | RNFS `DocumentDirectoryPath` | 下载固定到应用沙盒目录 |
| **增量挂载列表** | 增量加载本地音乐 | 扫描结果增量挂载，避免一次性全量加载 |
| **CachedImage Glide** | `@d11/react-native-fast-image` | Glide 原生双层缓存，列表滚动零异步开销 |
| **PanResponder 手势** | `PanResponder`（沉浸屏下拉关闭等） | 原生手势交互 |
| **简繁转换** | `opencc-js`（`chineseConversionService`） | 歌词简繁转换，按需构造转换器 |
| **触觉反馈** | `hapticLight`（`hapticService`） | 按键 / 切歌轻触觉反馈 |

---

## 三、桌面端独有功能

桌面端因平台特性增加的能力，移动端无对应实现。

| 功能 | 实现方式 | 说明 |
| --- | --- | --- |
| **浮动歌词窗口** | 透明置顶 webview（约 753 行 Rust） | 独立桌面歌词窗口，置顶 / 锁定 / 字体颜色 / 动画强度 |
| **系统托盘** | Tauri 托盘 | 最小化到托盘、托盘控制 |
| **全局热键** | 空格 / 方向键 / ↑↓ / M | 全局媒体键与键盘快捷键 |
| **Rust 文件操作** | Tauri Rust 命令 | 高性能文件读写 / 扫描 |
| **可变下载目录** | 用户可选下载路径 | 下载目录可自定义（移动端固定沙盒） |
| **cursor 光标特效** | canvas | 鼠标光标视觉特效 |
| **WebAudio EQ** | WebAudio API | 前端均衡器音效 |
| **无缝预加载** | `preloadAudio` 暖缓存 | 预加载下一首音频暖缓存，切歌无缝 |

---

## 对齐状态总结

据 07-11 模块对比，核心功能两端**全对齐**：

| 功能类别 | 对齐度 |
| --- | --- |
| 核心播放 | 100% |
| 搜索 | ~100% |
| 歌词 | ~95%（移动端行级高亮，无逐字卡拉 OK；无独立桌面歌词窗口，但有 Android 浮窗歌词） |
| 账号登录 | ~95%（移动端仅 Cookie 粘贴登录，无二维码扫码） |
| 歌单与收藏 | 100% |
| 本地音乐 | ~95% |
| 内容浏览 | 100% |
| 数据管理 | 100% |
| WebDAV 同步 | 100% |
| **总体** | **核心全对齐，差异为平台原生设计** |

真正的差异集中在**平台形态**——桌面端窗口 / 托盘 / 全局热键 / Rust 文件操作 / WebAudio，移动端通知栏 / 后台播放 / 触摸手势 / 浮窗歌词 / 系统分享——而非能力缺失。两端共享 `@lx/core` 合并算法与 provider 逻辑，确保歌单 / 收藏 / 历史跨端同步语义一致。
