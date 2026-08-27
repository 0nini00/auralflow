# AuralFlow Mobile

AuralFlow 的 Android 端，包名 `@auralflow/mobile`，基于 **React Native 0.86 + React 19.2.3 + TypeScript**，Android 优先。移动端与桌面端（Tauri + React）共同消费 `@lx/core` 共享核心（歌曲模型、歌词解析、内置音乐 API 客户端），功能高度对齐，播放器与歌词交互参考 lx-music 打磨。

## 技术栈

| 类别 | 依赖 | 版本 |
| --- | --- | --- |
| 运行时框架 | React Native / React | 0.86 / 19.2.3 |
| 语言 | TypeScript | ^5.8.3 |
| 播放器 | react-native-track-player（ExoPlayer 后端） | 4.1.2 |
| 导航 | @react-navigation/native + bottom-tabs / drawer / native-stack / material-top-tabs | v7 |
| 状态管理 | Zustand | ^5.0.14 |
| 动画 | react-native-reanimated + react-native-worklets | ^4.5.1 / ^0.10.2 |
| 加密 | crypto-js / node-forge（部分由原生 CryptoModule 承接，见下） | ^4.2.0 / ^1.4.0 |
| 压缩 | pako | ^3.0.0 |
| 中文转换 | opencc-js（简繁） | ^1.4.1 |
| 图标 | lucide-react-native | ^0.460.0 |
| 图片 | @d11/react-native-fast-image（Glide 原生缓存） | ^8.13.0 |
| 视频 | react-native-video | 6.19.2 |
| 文件系统 | react-native-fs | ^2.20.0 |
| 权限 | react-native-permissions | ^5.6.0 |
| 共享核心 | @lx/core（workspace） | workspace:* |
| 包管理 | pnpm + Node | **Node >= 22.11.0** |

## 功能列表

- **发现与搜索**：首页信息流（推荐歌单 / 新歌 / 新碟 / 排行榜 / MV）、搜索（网易云 + QQ 音乐多源合并、联想、最近搜索、去重，歌单 / 歌手 / 专辑分类）、每日推荐、私人 FM（下一首预取，切歌秒开）、排行榜、歌单广场、B站合集（需登录 B站）。
- **播放**：全屏沉浸播放器（封面页 / 歌词页 / 控制栏 / 更多菜单 / 评论 / 音质切换 / 睡眠定时）、迷你播放器（底部导航上方，封面 / 歌名 / 歌手 / 迷你歌词）、播放队列、下一首 / 稍后播放、播放模式（顺序 / 列表 / 单曲 / 随机去重）、倍速、音质切换、通知栏控制、后台播放、系统媒体键 / 锁屏控制。
- **歌词**：滚动跟随（用户滚动暂停 3 秒后恢复）、逐字卡拉 OK（YRC / QRC / KRC）、译文、简繁转换；字号 / 颜色 / 字体 / 对齐 / 字重 / 行距 / 透明度 / 动效强度自定义；Android 悬浮歌词窗（可拖动、可锁定、随播放滚动）；浮窗歌词。
- **本地音乐**：MediaStore 扫描 + 手动选歌；内嵌封面 / 歌词提取，回退同名 `.lrc` 旁挂与 `folder.jpg` sidecar；可写回标题 / 歌手 / 封面 / 歌词标签（Android 13+ 需系统授权）。
- **缓存与下载**：封面 / 歌词 / 音频三级缓存（MD5 命名、immutable + LRU 100MB、歌词 30 天过期）；串行下载队列（音质选择 128 / 192 / 320 / FLAC / Hi-Res、进度 / 速度、暂停 / 继续 / 取消、ID3 嵌标签 + 旁挂 `.lrc`）。
- **数据**：播放历史分时间记录（今天 / 昨天 / 日期），31 天滚动；本地歌单、我喜欢（收藏）、下载管理；WebDAV 同步（与桌面端 / lx 互通：歌单收藏历史 + 自定义音源，支持启动自动同步）。
- **账号与服务**：网易云（Cookie 登录 + 二维码登录）、B站（Cookie 登录）、QQ 音乐（无 cookie 直连）。详见 [ACCOUNT_LOGIN.md](./ACCOUNT_LOGIN.md)。
- **其它**：主题（动态 token）、B站视频 / MV、首页 feed、通知栏控制、浮窗歌词、deep link、分享、自动检查自定义源更新。

## 目录结构

```text
apps/mobile/
├── App.tsx                      # 应用入口
├── apply-track-player-patch.js  # postinstall 补丁脚本（补 MusicService.kt 通知栏歌词开关）
├── index.js                     # RN 注册入口
├── android/                     # 原生工程（含 6 个自研原生模块）
└── src/
    ├── components/              # 共享 UI 组件（60+，含 ui/ 5 个原语 + settings/）
    │   ├── ui/                  # Button / Chip / IconButton / ListItemButton / ModalActions
    │   └── settings/            # 账号卡片、设置卡片、音质、浮窗等设置类组件
    ├── screens/                 # 页面（37，含 immersive/ 全屏播放器 9、settings/ 设置二级页 8）
    │   ├── immersive/           # 全屏播放器子组件（封面页 / 控制栏 / 顶栏 / 更多菜单 / 传输栏 …）
    │   └── settings/            # 账号 / 播放 / 歌词 / 外观 / 音源 / 同步 / 数据 / 关于
    ├── services/                # 服务层（95）：播放、下载、缓存、WebDAV、本地音乐、音源、历史、B站、账号…
    ├── stores/                  # Zustand 状态层（15）：player / account / biliAccount / playlist / history …
    ├── navigation/              # 根抽屉 / 底部 Tab / 设置栈（8）
    ├── player/
    │   └── playbackService.ts   # TrackPlayer 事件处理
    ├── theme/                   # tokens.ts + controlTokens.ts（主题与排版规范）
    ├── utils/                   # base64 / compression / fetchWithTimeout
    └── hooks/
        └── useLyricLineIndex.ts  # 歌词行号 hook
```

## 开发指南

> 前置：仓库根目录执行 `pnpm install`。Node 版本 **>= 22.11.0**（见 `package.json#engines`）。`postinstall` 会自动执行 `apply-track-player-patch.js`（见下）。

```bash
# 启动 Metro（JS bundler）
pnpm mobile:start

# 运行到已连接的设备（USB 调试，react-native run-android）
pnpm mobile:android

# 生成 debug APK（cd android && gradlew assembleDebug）
pnpm mobile:build:debug

# 质量检查
pnpm mobile:typecheck      # tsc --noEmit
pnpm mobile:lint           # eslint src App.tsx（含 react-hooks rules-of-hooks 防护）
```

Debug APK 输出目录：

```text
apps/mobile/android/app/build/outputs/apk/debug/
```

Release 构建签名凭据从仓库外目录读取（环境变量 `AURALFLOW_KEYSTORE_DIR`，缺省本机 `F:/auralflow-secrets`），未配置时回退 debug 签名（仅限本地调试）。

## 关键设计说明

### 静音间隙技巧（Silence Gap Trick）

移动端后台播放最大的难题是：切歌间隙 JS 线程可能被系统挂起，导致下一首解析迟迟不触发。`playerStore.ts`（约 1004 行）采用双轨道技巧绕过：

- 真实歌曲轨道之外，常驻一条 **2 秒静音轨道**（`SILENCE_GAP_TRACK_ID`，URL 指向打包的 `android.resource://.../raw/silence_2s`）。
- 真实歌曲播完后 JS 调度自动跳到静音轨，使 ExoPlayer / 前台服务**始终处于「正在播放」状态**，保活前台服务、避免系统节流。
- 静音轨播放期间 JS 线程保持清醒，完成下一首 URL 解析与切歌；切到下一首真实歌曲后静音轨继续作为「间隙兜底」循环。
- 结果：跨曲间隙不再触发前台服务停止 / 媒体键失效，切歌延迟由「等系统唤醒」降为「等解析完成」。

### @lx/core 共享核心

移动端与桌面端通过 workspace 包 `@lx/core` 共享：歌曲模型（`MusicInfo`）、歌词解析（含逐字 YRC/QRC/KRC、`parseContentRangeTotal` 等）、内置音乐 API 客户端、封面缩略图尺寸常量（`COVER_SIZE_THUMB` / `resizeCoverUrl`）、试听时长比对（`isPreviewDuration`）。两端功能对齐表见 [FEATURE_COMPARISON.md](./FEATURE_COMPARISON.md)。

### Android 原生 6 模块

位于 `android/app/src/main/java/cn/chenle/auralflow/mobile/`，补 RN 生态缺失或受 Hermes 限制的能力：

| 模块 | 职责 |
| --- | --- |
| `CryptoModule` | weapi 加密原生实现：AES/CBC/PKCS5Padding + RSA/ECB/NoPadding（128 字节左零填充 → hex）。因 Hermes 处理不好 crypto-js / node-forge 的 RSA NoPadding，下沉到原生。 |
| `SecureStorageModule` | Android Keystore 加密存储（AES-256-GCM，alias `auralflow.mobile.secure-storage.v2`，格式 `v1:iv:ciphertext`，旧 AsyncStorage 自动迁移）。 |
| `LocalMusicModule` | MediaStore 本地音乐扫描 / 元数据读写。 |
| `LyricOverlayModule` / `LyricOverlayService` / `LyricNotificationReceiver` | 悬浮歌词窗 + 通知栏歌词开关与联动。 |
| `ImagePickerModule` / `CustomSourceFilePickerModule` | 图片与自定义音源文件选择。 |

### lx_bridge WebView 沙箱

自定义音源在 `services/customSourceRuntime.ts` + `customSourceWebViewBridge.tsx` 中跑在 WebView 沙箱里。原因：**Hermes 不能执行 `new Function` / `eval`**，而 lx 自定义音源脚本依赖动态求值。WebView 提供 JS 沙箱执行环境，宿主通过 bridge 注入歌曲信息、回传解析结果，隔离不可信脚本。

### apply-track-player-patch.js

`postinstall` 钩子运行的补丁脚本，对 `node_modules/react-native-track-player` 的 `MusicService.kt` 打补丁，注入通知栏歌词开关相关常量与逻辑（`LYRIC_NOTIFICATION_TOGGLE_ACTION`、`LyricNotificationReceiver` 联动、`LyricOverlayPreferences` 读取等）。RNTP 4.1.2 本身不提供通知栏歌词，需借此补丁把移动端的通知栏歌词按钮接到原生层。若 `pnpm install` 后通知栏歌词异常，先确认此脚本已成功执行。

### Node 版本

`package.json` 声明 `engines.node >= 22.11.0`。低版本 Node 会导致 Metro / RN 0.86 工具链报错，请使用 Node 22.11+ LTS。

---

更多细节见仓库根 [README.md](../../README.md)、[ACCOUNT_LOGIN.md](./ACCOUNT_LOGIN.md)（账号登录）、[CACHE_IMPLEMENTATION.md](./CACHE_IMPLEMENTATION.md)（缓存实现）、[FEATURE_COMPARISON.md](./FEATURE_COMPARISON.md)（双端功能对齐表）。
