# services

业务逻辑层。这里可以调用 Tauri bridge、Tauri HTTP plugin、浏览器 API 和 store，但应避免把页面布局逻辑放进来。

## 顶层服务

| 文件 | 用途 |
|---|---|
| `builtinMusicApiClient.ts` | 内置音乐 API 文本请求、搜索、播放 URL 和歌词解析 |
| `builtinMusicApiModel.ts` | 内置音乐 API URL、结果映射和 gateway 元数据 |
| `customSourceRuntime.ts` | LX 自定义音源脚本解析、测试和更新检测 |
| `downloadService.ts` | 下载任务、歌词文本写入和进度事件 |
| `localMusicService.ts` | 本地音乐扫描、元数据映射和写入 |
| `lyricsService.ts` | 歌词加载、解析和来源选择 |
| `mediaInterruptionPolicy.ts` | 外部媒体播放时的暂停策略 |
| `neteasePlaylistUtils.ts` | 网易云歌单和歌曲映射工具 |
| `personalFmQueue.ts` | 私人 FM 队列控制 |
| `playerEngine.ts` | HTMLAudioElement 和 WebAudio 播放引擎 |
| `playlistTransferService.ts` | 歌单导入导出和迁移 |
| `qrCode.ts` | 网易云扫码登录二维码 SVG data URI |
| `scrobbleService.ts` | 网易云听歌打卡触发 |
| `updateService.ts` | 应用更新检查 |
| `userDataReset.ts` | 清空用户数据时的持久化和内存状态协调 |
| `webdavSyncService.ts` | WebDAV 备份和恢复 |
| `wyAccountService.ts` | 网易云账号、二维码登录、歌单、每日推荐、私人 FM 和 weapi 请求 |

## 网易云二维码登录

`wyAccountService.ts` 不依赖单独的 Node API 服务。它通过前端 eapi 加密和 Tauri HTTP plugin 直接请求网易云 desktop 二维码登录接口：

- `/api/login/qrcode/unikey` 生成二维码 key，使用 `type: 3`。
- `music.163.com/login?codekey=...` 作为二维码内容。
- `/api/login/qrcode/client/login` 轮询扫码状态，使用 `type: 3`。

扫码成功时优先读取响应体 Cookie，也兼容从 `Set-Cookie` 响应头提取 Cookie。`803` 返回 Cookie 后交给 `WyCookieLoginModal` 保存并验证账号；`800` 会让弹窗停止轮询并显示过期状态。

## 子目录

| 目录 | 用途 |
|---|---|
| `playback/` | 播放 URL 解析、内置网易云后端、自定义源后端、预取和播放模式 |
| `search/` | 搜索聚合、缓存、歌曲元数据合并和搜索联想 |
| `sources/` | `wyProvider`、`txProvider` 和音源注册入口 |

## 搜索服务

`src/services/search` 当前包含：

- `searchAggregation.ts`：统一聚合歌曲、歌单、歌手和专辑搜索结果。
- `searchResultCache.ts`：缓存搜索结果和当前分类 tab。
- `searchSuggestions.ts`：合并网易云在线联想、最近搜索和当前结果生成的联想词。
