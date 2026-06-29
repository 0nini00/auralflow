# AuralFlow

AuralFlow 是一个基于 Tauri v2、React、TypeScript 和 Rust 的 Windows 桌面音乐播放器。当前代码面向多音源搜索播放、本地音乐整理、网易云账号能力、桌面歌词、下载、音效和 WebDAV 备份。

## 当前功能

- 多音源搜索：网易云、QQ 音乐，支持歌曲、歌单、歌手和专辑搜索。
- 搜索体验：搜索页按综合、单曲、歌手、专辑和歌单分类；综合页展示歌手、新专辑、歌单摘要和单曲列表，搜索框支持网易云在线联想和最近搜索联想。
- 播放解析：优先使用内置音乐 API 元数据解析，失败后走自定义音源解析。
- 网易云账号：Cookie 登录和网易云音乐 App 扫码登录、用户歌单、喜欢列表、每日推荐、私人 FM、歌单歌曲增删和听歌打卡。
- 播放体验：播放队列、播放历史、喜欢歌曲、本地歌单、最近播放、播放模式、快捷键和系统媒体控制。
- 歌词体验：主播放器歌词、沉浸式滚动歌词、桌面歌词窗口、译文显示和桌面歌词样式调整。
- 本地音乐：扫描目录、保留失败目录的既有歌曲、读取音频信息、编辑元数据、写入封面和内嵌歌词。
- 下载：下载歌曲文件，并可写入同名歌词文本。
- 音效：均衡器、声像、混响和变调。
- 数据与同步：收藏、歌单、本地库、自定义音源、历史和音效按命名空间持久化，支持 WebDAV 上传/下载。
- 桌面集成：系统托盘、深链、透明桌面歌词窗口和 Windows MSI 打包。

## 技术栈

- 前端：React 18、TypeScript、Vite、Zustand、React Router、lucide-react
- 桌面端：Tauri v2、Rust
- 后端能力：本地文件扫描、音频标签读写、下载、zlib fallback、设置和用户数据持久化、桌面歌词窗口
- 网络能力：Tauri HTTP plugin、浏览器 fetch、前端 weapi/eapi 加密
- 包管理：pnpm workspace

## 开发

安装依赖：

```bash
pnpm install
```

启动 Tauri 开发环境：

```bash
pnpm tauri:dev
```

仅启动 Vite：

```bash
pnpm dev
```

## 验证

```bash
pnpm run test:regression
pnpm run typecheck
pnpm run build
```

Rust 侧检查：

```bash
cd src-tauri
cargo check
```

## 构建

前端构建：

```bash
pnpm run build
```

生成 Windows 安装包：

```bash
pnpm tauri:build
```

安装包输出目录：

```text
src-tauri/target/release/bundle/msi/
```

当前 Windows MSI 发布包：

```text
src-tauri/target/release/bundle/msi/AuralFlow_0.1.0_x64_en-US.msi
```

## 项目结构

```text
auralflow/
├── packages/
│   ├── core/              # 音源接口、注册表、轮询解析器
│   └── tauri-bridge/      # Tauri invoke 类型封装
├── scripts/               # Node 回归脚本
├── src/                   # React 前端
│   ├── components/        # 复用组件
│   ├── hooks/             # React hooks
│   ├── lib/               # 加密和通用底层工具
│   ├── services/          # 搜索、播放、下载、账号、同步等业务逻辑
│   ├── stores/            # Zustand 状态
│   ├── styles/            # 样式
│   ├── utils/             # 前端工具
│   └── views/             # 路由页面和歌词窗口视图
└── src-tauri/             # Rust 后端
    ├── capabilities/      # Tauri 权限
    └── src/               # commands、config、library、lyric_window、tray
```

## 网易云登录

扫码登录由前端 `wyAccountService.ts` 直接调用网易云 weapi 二维码接口：先生成二维码 key，再展示 `music.163.com/login?codekey=...`，随后轮询扫码状态。状态码 `801` 表示等待扫码，`802` 表示等待手机确认，`803` 会返回 Cookie 并进入账号验证，`800` 会停止轮询并提示刷新二维码。二维码请求会带时间戳，避免拿到缓存的旧状态。

Cookie 登录和扫码登录最终都会写入同一个 `wyCookie` 设置项，并通过 `wyAccountStore` 验证账号和加载歌单；如果新登录验证失败，会回滚到旧 Cookie 和旧账号状态。

## 沉浸式歌词

点击底部播放器封面会打开 `ImmersiveLyricsOverlay.tsx`。覆盖层复用当前歌词管线展示沉浸式滚动歌词；底栏控制分为歌词工具、播放控制和辅助工具三组。

## 远端仓库

```bash
git clone https://github.com/0nini00/auralflow.git
```
