# AuralFlow 移动端验证基线

> 2026-08-27。本文档定义移动端核心功能的验证基线：验证环境、核心功能验证项及其验证方法、预期结果与状态，作为移动端开发与回归的权威对照表。
>
> 基线代码：移动端 `apps/mobile/`，共享核心 `@lx/core`。

---

## 1. 目的

为 AuralFlow 移动端建立一份可逐项复核的功能验证基线。每一项核心功能给出明确的验证方法与预期结果，回归时按表执行并更新状态，确保：

- 新功能交付与回归有统一对照标准；
- 已知既有失败不被静默忽略，状态如实记录；
- 重新执行时必须保留命令输出，并更新本文件的日期、计数与失败清单；
- 只有失败项被修复并重新运行全量验证后，才能将对应状态改为通过。

---

## 2. 验证环境

| 项 | 值 |
|---|---|
| 框架 | React Native 0.86 |
| UI 库 | React 19.2.3 |
| Node | >= 22.11.0 |
| 构建工具 | Android Studio |
| Android minSdk | 24 |
| Android targetSdk | 36 |
| 工作目录 | `apps/mobile` |
| package | `@auralflow/mobile@0.1.0` |
| 脚本来源 | `apps/mobile/package.json` |
| 执行命令 | `npm run typecheck` · `npm test` |
| 基线日期 | 2026-08-27 |

---

## 3. 核心功能验证项

| 功能 | 验证方法 | 预期结果 | 状态 |
|---|---|---|---|
| **播放** | 搜歌 → 播放 → 进度/暂停/seek → 上下首 → 播放模式切换 → 倍速 → 淡入淡出 | 播放/暂停/seek 立即响应；4 种播放模式（list/single/shuffle/sequence）切换生效；倍速保持音高（`androidPitchService.setRate` 双参）；淡入淡出 `fadeVolume` 余弦曲线 | 待验证 |
| **后台播放** | 切背景 → 自动推进不中断 → 前台服务通知栏 → 遥控 | `playbackService.ts` RNTP 后台 `PlaybackActiveTrackChanged` → `advanceAfterTrackFinished` 自动推进；前台服务通知栏显示；遥控响应 | 待验证 |
| **歌词** | 加载 → 同步高亮 → 翻译 → 手动偏移 → 点击行跳转 → 用户滚动暂停 | `@lx/core` parser 6 格式归一化加载；KaraokeLyricLine 行内进度填充同步高亮；译文合并 ±150ms 双语；`LyricSettingsScreen` 偏移滑块接进渲染；点击行 seek 跳转；`onScrollBeginDrag` + 3s 暂停自动滚动 | 待验证 |
| **沉浸式** | 打开 → PagerView 滑动 → 下拉关闭 → 旋转封面 → 队列面板 | `ImmersiveLyricsScreen` Modal fullScreenModal 打开；PagerView 2 页（封面/歌词）左右滑；`PanResponder` `dy>120` 仅封面页下拉关闭；`Animated.timing` 25s 旋转封面 `useNativeDriver` 暂停从当前角度恢复；队列面板可用 | 待验证 |
| **搜索** | 关键词 → 分类（综合/单曲/歌手/专辑/歌单）→ 历史 → 建议 | `searchAll` 并发搜索；5 分类切换结果正确；搜索历史 get/add/remove/clear；`getSearchSuggestions` 联想词；`searchRequestSeqRef` + `requestId` 竞态保护 | 待验证 |
| **歌单** | 网易歌单 CRUD → 本地歌单 CRUD → 收藏 → WebDAV 同步 | `playlistStore` 网易歌单 CRUD + `setWyPlaylistSubscribed`；`usePlaylistStore` 本地歌单 CRUD；收藏生效；`webdavSyncService.ts` 原生 fetch + lastModified 冲突 + `@lx/core` webdav-merge 合并（额外同步本地歌单） | 待验证 |
| **下载** | 下载 → 进度 → 暂停/取消/恢复 → ID3 嵌入 → sidecar .lrc | `downloadStore` 串行 + `downloadService.ts`；进度 180ms 节流；暂停/取消/恢复生效；`id3TagWriter.ts` 纯 JS ID3v2.4 + APIC 封面 + USLT 歌词；sidecar .lrc 旁注 | 待验证 |
| **缓存** | URL 缓存命中 → 磁盘 LRU → 预取暖 | `playbackUrlCache.ts` URL 缓存 6h/30min/1yr 命中；`cacheService.ts` 三层（内存 10min / 磁盘 LRU 100MB）；预取暖生效 | 待验证 |
| **账号** | 网易 QR/Cookie 登录 → Bili Cookie → 登出 → 登录过期 | `wyQrLoginService.ts` getQrCodeKey/createWyQrCode/pollWyQrLoginStatus；网易 Cookie；`biliService` B 站 Cookie；登出生效；登录过期处理 | 待验证 |
| **B 站** | 收藏夹 → 收藏 → DASH 音频 → 视频 | `biliService.getBiliCollectionSongs` favorite/season/series 三种；收藏；DASH 音频解析播放；`searchBiliVideos` 视频源 | 待验证 |
| **日推/FM** | 日推加载 → 私人 FM → trash → 自动下一首 | `dailyRecommendMetaModel` 日推加载；`personalFmMetaModel` 私人 FM；trash 不喜欢；自动下一首推进 | 待验证 |
| **本地音乐** | 扫描 → 播放 → 标签编辑 → 封面/歌词写回 | `LocalMusicModule` 778 行 MediaStore + jaudiotagger 扫描；本地路径播放；标签编辑；封面/歌词写回 | 待验证 |
| **浮窗歌词** | 权限请求 → 显示 → 拖动 → 锁定 → 通知栏开关 | `canDrawOverlays` / `requestOverlayPermission` 权限请求；浮窗显示；拖动；锁定；通知栏开关切换 | 待验证 |
| **自定义源** | 导入 → 测试 → 启用 → 播放 → 更新检查 | `customSourceRuntime.ts`（与桌面端对齐）导入；测试连接；启用；解析播放；更新检查 | 待验证 |
| **deep link** | `auralflow://` 打开 → 跳转正确页面 | `auralflow://` 协议打开 App；跳转到正确页面（如初始搜索关键词代替地址栏） | 待验证 |

---

## 4. 状态约定

- **待验证**：尚未在本基线周期内执行验证，或验证环境尚未就绪。
- **通过**：按验证方法执行后，实际结果与预期结果一致。
- **未通过**：实际结果与预期不一致，须在下方"已有失败逐项记录"中登记，不静默忽略。

只有当某项的验证方法被执行、命令输出被保留、且实际结果与预期一致后，才能将其状态从"待验证"改为"通过"；反之若不一致，改为"未通过"并登记失败项。重新执行时应保留命令输出，并更新本文件的日期与状态。

---

## 5. 已有失败逐项记录

（本基线周期内若出现未通过项，在此逐项登记失败现象与处置；不将失败隐藏或跳过。）

- _暂无_

---

## 6. 可复核证据

- `apps/mobile/package.json` 明确 `typecheck` 等价于 `tsc --noEmit`，`test` 等价于 `vitest run`。
- 重新执行时应保留 `npm run typecheck` 与 `npm test` 的完整命令输出，并更新本文件的日期、计数与失败清单。
- 人工回归基线参照 `docs/mobile-alignment-checklist.md`。
