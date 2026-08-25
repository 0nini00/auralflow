# AuralFlow Mobile

AuralFlow 的 Android 端，基于 React Native 0.86 + TypeScript。桌面端（Tauri + React）与移动端共享 `@lx/core`（歌曲模型、歌词解析、内置音乐 API 客户端），功能高度对齐，播放器与歌词交互参考 lx-music 打磨。

## 能力总览

### 发现与搜索
- 首页信息流：推荐歌单 / 新歌 / 新碟 / 排行榜 / MV。
- 搜索：网易云 + QQ 音乐多源合并、搜索联想、最近搜索、结果去重；歌单 / 歌手 / 专辑分类搜索。
- 每日推荐、私人 FM（下一首预取，切歌秒开）、排行榜、歌单广场。
- B站合集（需在设置中登录 B站）。

### 播放
- 全屏沉浸播放器（lx 竖屏风格）：封面页 / 歌词页 / 控制栏 / 更多菜单 / 评论 / 音质切换 / 睡眠定时。
- 迷你播放器（底部导航上方，显示封面 / 歌名 / 歌手 / 迷你歌词）。
- 播放队列、下一首播放 / 稍后播放、播放模式（顺序 / 列表 / 单曲 / 随机去重）、倍速、音质切换。
- 通知栏控制、后台播放、系统媒体键 / 锁屏控制。

### 歌词
- 滚动跟随（用户滚动暂停 3 秒后恢复）、逐字卡拉 OK（YRC / QRC / KRC）、译文、简繁转换。
- 字号 / 颜色 / 字体 / 对齐 / 字重 / 行距 / 透明度 / 动效强度自定义。
- Android 悬浮歌词窗（可拖动、可锁定、随播放滚动）。

### 本地音乐
- MediaStore 扫描 + 手动选歌；内嵌封面 / 歌词提取，回退同名 `.lrc` 旁挂与 `folder.jpg` sidecar。
- 可写回标题 / 歌手 / 封面 / 歌词标签（Android 13+ 需系统授权）。

### 缓存与下载
- 封面 / 歌词 / 音频三级缓存（MD5 命名、immutable + LRU 100MB、歌词 30 天过期）。
- 串行下载队列：音质选择（128 / 192 / 320 / FLAC / Hi-Res）、进度 / 速度、暂停 / 继续 / 取消、ID3 嵌标签 + 旁挂 `.lrc`。

### 数据
- 播放历史分时间记录（今天 / 昨天 / 日期），31 天滚动。
- 本地歌单、我喜欢（收藏）、下载管理。
- WebDAV 同步（与桌面端 / lx 互通）：歌单收藏历史 + 自定义音源，支持启动自动同步。

### 账号与服务（设置 → 账号与服务）
- 网易云（二维码登录）、B站（Cookie 登录）。

## 音源分工（与桌面端一致）

```
官方直连（wy + tx） ──► 搜索 / 歌单 / 封面 / 歌曲信息 / 歌词
内置音乐 API 网关 ──► 播放 URL + 下载（gdstudio 免 key）
自定义 lx 音源    ──► 播放兜底
B站              ──► 独立解析链路
```

内置网关（gdstudio）解析失败时自动回退自定义音源。

## 导航结构

- **抽屉（根导航）**：主页栈 + 设置栈（8 个分类：账号与服务 / 播放 / 歌词 / 外观 / 音源 / 同步与备份 / 存储与数据 / 关于）。推入页也可直接唤出侧边栏。
- **底部 Tab**：首页、搜索、曲库、我的。
- **「我的」顶部分栏**：本地音乐、播放历史、下载、B站合集（未登录时隐藏 B站 Tab）。
- **全屏播放器 / MV 播放器**：全屏模态，位于抽屉之上。

## 开发

```bash
# 在仓库根目录安装依赖
pnpm install

# 启动 Metro
pnpm mobile:start

# 运行到已连接的设备（USB 调试）
pnpm mobile:android

# 生成 debug APK
pnpm mobile:build:debug
```

APK 输出目录：

```text
apps/mobile/android/app/build/outputs/apk/debug/
```

**Release APK**：

```bash
cd apps/mobile/android && ./gradlew assembleRelease
```

- 签名凭据从仓库外目录读取（环境变量 `AURALFLOW_KEYSTORE_DIR`，缺省本机 `F:/auralflow-secrets`）；未配置时回退 debug 签名（仅限本地调试）。
- `postinstall` 会自动执行 `apply-track-player-patch.js`（修复 track-player 的类型/行为补丁）。

**质量检查**：

```bash
pnpm mobile:typecheck   # TypeScript 检查
pnpm mobile:lint        # ESLint（含 react-hooks rules-of-hooks 防护）
```

## 目录结构

```text
src/
├── components/          # 共享 UI 组件（ActionButton / SongList / 设置卡片等）
├── navigation/          # 根抽屉 / 底部 Tab / 设置栈
├── screens/             # 各页面（含 immersive/ 全屏播放器、settings/ 设置二级页）
├── services/            # 播放、下载、缓存、WebDAV、本地音乐、音源、历史等
├── stores/              # Zustand 状态层
└── theme/               # 主题 token 与排版规范
```

更多细节见仓库根 [README.md](../../README.md) 与 [FEATURE_COMPARISON.md](./FEATURE_COMPARISON.md)（双端功能对齐表）、[CACHE_IMPLEMENTATION.md](./CACHE_IMPLEMENTATION.md)（缓存实现）。
