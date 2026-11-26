<p align="center">
  <img src="desktop/src/assets/logo.png" width="112" height="112" alt="AuralFlow 标志">
</p>

<h1 align="center">AuralFlow</h1>

<p align="center">面向 Windows 与 Android 的音乐播放器，支持在线搜索、本地曲库、同步歌词与 WebDAV 数据同步。</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/0nini00/auralflow/releases/latest">下载安装</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="https://github.com/0nini00/auralflow/issues">反馈问题</a> ·
  <a href="#鸣谢">鸣谢</a>
</p>

## 功能

AuralFlow 将在线音乐与本地音频放在同一个播放器中。桌面端使用 Tauri 和 React，Android 端使用 React Native，两端通过 `@lx/core` 共享歌曲模型、歌词解析、音源协议与数据同步规则。

| 功能 | Windows | Android |
| --- | --- | --- |
| 搜索与播放 | 网易云 / QQ 音乐搜索、自定义音源、播放队列、循环模式、倍速与睡眠定时 | 具备相同核心能力，支持后台播放与通知栏控制 |
| 音乐库 | 本地目录扫描、标签编辑、歌单、收藏、历史、下载与离线播放 | MediaStore 扫描和文件导入、标签编辑、歌单、收藏、历史、下载与离线播放 |
| 歌词 | 滚动跟随、逐字渲染、译文与独立桌面歌词窗口 | 行级高亮、译文、歌词偏移校准与悬浮歌词 |
| 播放背景 | 改编自 MyGo Music 的动态烟雾，以及封面背景 | 基于主题强调色的柔光色域，配色不随歌曲封面变化 |
| 系统集成 | 托盘、系统媒体控制与桌面歌词 | 系统媒体控制、展开媒体卡片中的悬浮歌词开关 |
| 跨端数据 | 通过 WebDAV 同步歌单、收藏、历史与自定义音源脚本 | 使用相同同步格式，与桌面端交换数据 |

在线功能还包括推荐、私人 FM、排行榜、评论与 MV。歌曲能否播放、可用音质取决于实际音源、曲目和账号权限。

本地歌曲的歌词来自内嵌标签或同目录的 `.lrc` 文件，封面来自内嵌图片或本地旁挂图片；缺失歌词时不会联网匹配。

## 下载安装

在 [GitHub Releases](https://github.com/0nini00/auralflow/releases/latest) 下载适合设备的安装包。

| 平台 | 发布文件 | 说明 |
| --- | --- | --- |
| Windows x64 | `*-windows-x64-setup.exe` | 安装版 |
| Windows x64 | `*-windows-x64-portable.exe` | 单文件便携版；应用数据仍保存在系统用户目录 |
| Android ARM64 | `*-arm64-v8a.apk` | 64 位 ARM 设备 |
| Android ARM32 | `*-armeabi-v7a.apk` | 32 位 ARM 设备 |

Android 安装包要求 Android 7.0 / API 24 或更高版本。目前发布 Windows 与 Android 安装包，未提供 macOS、Linux 或 iOS 安装包。

发布页同时提供源码归档与 SHA256 校验文件。Windows 安装包附带应用更新签名和更新清单。

## 快速开始

1. 安装对应平台的版本，打开 AuralFlow。
2. 先播放一首本地音乐：Windows 进入 **本地音乐 → 扫描文件夹**；Android 在曲库的本地音乐区域选择 **扫描本地** 或 **添加文件**，按提示授予文件或音频访问权限。
3. 点击歌曲开始播放，再打开完整播放器查看歌词和播放控制。

听在线音乐时，可以按歌名或歌手搜索；需要自定义音源时，在 **设置 → 音源** 导入并启用脚本。依赖账号的功能在账号设置中登录后使用。

Android 悬浮歌词首次使用需要授予悬浮窗权限。开启后，可从展开的系统媒体卡片控制开关，方便后台操作；按钮是否显示及具体位置由手机系统界面决定。

跨设备同步时，在两端的同步设置中填写 WebDAV 服务信息。WebDAV 同步曲库记录和自定义音源，不上传本地音频文件。

## 本地开发

以下命令均在仓库根目录执行。发布脚本使用 PowerShell 7，桌面端原生代码目前依赖 Windows API。

### 环境要求

| 工具 | 配置 |
| --- | --- |
| Node.js | 本地开发使用 Node.js 24，CI 同时覆盖 22 系列 |
| pnpm | `11.5.1`，由根目录 `packageManager` 字段固定 |
| Windows 桌面工具链 | Rust stable、MSVC C++ 构建工具与 WebView2，详见 [Tauri 环境准备](https://v2.tauri.app/start/prerequisites/) |
| Android 工具链 | JDK 17、Android SDK 36、Build Tools 36.0.0、NDK 27.1.12297006、CMake 3.22.1 |

安装依赖：

```powershell
git clone https://github.com/0nini00/auralflow.git
cd auralflow
pnpm install --frozen-lockfile
```

移动端 `postinstall` 会应用原生依赖补丁，并准备自定义音源运行时资源。请保留安装生命周期脚本，项目构建依赖这些已修补的接口。

### 启动应用

```powershell
pnpm desktop:tauri:dev
```

该命令启动包含 Rust 后端的桌面应用。`pnpm desktop:dev` 只启动前端，适合调试界面。

Android 需先连接已开启 USB 调试的设备，或启动模拟器，然后在两个终端分别运行：

```powershell
# Terminal 1
pnpm mobile:start
```

```powershell
# Terminal 2
pnpm mobile:android
```

### 检查与测试

```powershell
pnpm check:all
pnpm test:core
pnpm test:desktop
pnpm mobile:test
pnpm test:rust
```

Android 原生标签测试还需要 JDK 17、FFmpeg 和 jaudiotagger 3.0.1。测试从 Gradle 缓存查找 jaudiotagger，也可通过 `JAUDIOTAGGER_JAR` 指定路径。Rust 测试在 Windows 上运行；完整验证环境见 [CI 配置](.github/workflows/ci.yml)。

### 构建安装包

```powershell
# Android debug APK
pnpm mobile:build:debug

# Signed Android releases, one ABI per invocation
.\apps\mobile\build-release-arm64.ps1 -Abi arm64-v8a
.\apps\mobile\build-release-arm64.ps1 -Abi armeabi-v7a

# Windows installer, executable, and updater manifests
.\desktop\build-release.ps1
```

Android Release 构建通过 `AURALFLOW_KEYSTORE_DIR` 指定外部签名配置目录。Windows Release 构建需要按[发布脚本](desktop/build-release.ps1)配置更新签名材料。签名凭据不包含在仓库中。

发布脚本将正式产物归档到 `dist/`。Windows 脚本只有显式传入 `-Publish` 才会上传，发布标签必须与构建所用源码提交一致。

## 仓库结构

```text
auralflow/
├── apps/mobile/                 React Native app and Android native modules
├── desktop/                     React frontend and Tauri application
│   ├── src-tauri/               Rust native backend
│   ├── packages/tauri-bridge/   Desktop IPC bridge
│   └── third-party/mygo-music/  Smoke background attribution and license
├── packages/core/               Shared models, parsers, source and sync logic
├── docs/                        Design notes and troubleshooting documents
└── .github/workflows/ci.yml     Automated checks and Android debug build
```

实现细节可查阅[移动端开发说明](apps/mobile/README.md)、[共享核心边界](packages/core/SPEC.md)、[桌面原生层边界](desktop/src-tauri/SPEC.md)与 [Android 原生层边界](apps/mobile/android/SPEC.md)。

## 反馈与贡献

欢迎通过 [Issues](https://github.com/0nini00/auralflow/issues) 提交问题与功能建议。报告问题时，请提供应用版本、设备与系统版本、复现步骤和错误信息；附加日志前移除账号 Cookie、密码和私人服务器信息。

提交代码时，请为涉及的行为补充适当检查。修改 Android 原生代码或依赖补丁时，除 JavaScript 测试外，还应编译 Android 工程。

## 鸣谢

感谢以下项目的作者和维护者。AuralFlow 使用了其中的框架与库，也参考或移植了部分项目的协议和实现。

### 代码移植与协议参考

- **[MyGo Music](https://github.com/egoist/mygo-music)**：由 egoist 开发。桌面烟雾背景的着色器、配色和运动逻辑改编自提交 `a717245f18e773f27ffe9ee08b330dd101218515` 的 `internal/app/backdrop.go`，移植为 WebGL GLSL；当前未接入低音联动。详见[移植说明](desktop/third-party/mygo-music/NOTICE.md)及保留的 [AGPL-3.0 许可证](desktop/third-party/mygo-music/LICENSE)。
- **[LX Music Desktop](https://github.com/lyswhut/lx-music-desktop)**：感谢 lyswhut 及其贡献者，项目参考了 LX 自定义音源脚本协议、音乐元数据约定和歌词解析行为。

### 框架与依赖

| 项目 | 在 AuralFlow 中的用途 |
| --- | --- |
| [Tauri](https://github.com/tauri-apps/tauri)、[React](https://github.com/react/react)、[React Native](https://github.com/react/react-native) | 桌面外壳、界面与 Android 应用框架 |
| [Vite](https://github.com/vitejs/vite)、[TypeScript](https://github.com/microsoft/TypeScript)、[pnpm](https://github.com/pnpm/pnpm) | 前端构建、类型检查与工作区管理 |
| [React Native Track Player](https://github.com/doublesymmetry/react-native-track-player)、[KotlinAudio](https://github.com/doublesymmetry/KotlinAudio)、[ExoPlayer](https://github.com/google/ExoPlayer) | Android 音频播放、后台服务和媒体会话控制 |
| [React Native Video](https://github.com/TheWidlarzGroup/react-native-video) | MV 与评论语音播放 |
| [Lofty](https://github.com/Serial-ATA/lofty-rs)、[jaudiotagger](https://www.jthink.net/jaudiotagger/) | 本地音频标签、内嵌歌词与封面处理 |
| [Zustand](https://github.com/pmndrs/zustand)、[React Navigation](https://github.com/react-navigation/react-navigation) | 应用状态与移动端导航 |
| [Lucide](https://github.com/lucide-icons/lucide) | 桌面端和移动端图标 |
| [Reanimated / Worklets](https://github.com/software-mansion/react-native-reanimated)、[Gesture Handler](https://github.com/software-mansion/react-native-gesture-handler) | 移动端动画与手势 |
| [React Native WebView](https://github.com/react-native-webview/react-native-webview)、[Endo / SES](https://github.com/endojs/endo) | 移动端自定义音源运行时与 JavaScript 执行隔离 |
| [CryptoJS](https://github.com/brix/crypto-js)、[node-forge](https://github.com/digitalbazaar/forge)、[pako](https://github.com/nodeca/pako) | 协议加密与压缩歌词处理 |
| [OpenCC JS](https://github.com/nk2028/opencc-js) | 歌词简繁转换 |
| [AsyncStorage](https://github.com/react-native-async-storage/async-storage)、[React Native FS](https://github.com/itinance/react-native-fs)、[FastImage](https://github.com/dream-horizon-org/react-native-fast-image) | 移动端持久化、文件访问与图片加载 |

内置音乐接口适配还使用了 [GD Studio Music API](https://music-api.gdstudio.xyz/)。

以上列出主要依赖。完整 JavaScript 依赖关系见 [pnpm-lock.yaml](pnpm-lock.yaml)，桌面 Rust 依赖见 [Cargo.lock](desktop/src-tauri/Cargo.lock)。也感谢为这些项目提交代码、反馈问题和参与测试的贡献者。

## 许可证说明

仓库目前没有项目整体的 `LICENSE` 文件，本 README 不为整个项目指定统一许可证。

改编自 MyGo Music 的烟雾实现标注为 `AGPL-3.0-only`，来源说明与许可证保存在 [desktop/third-party/mygo-music](desktop/third-party/mygo-music/) 中。其他依赖保留各自的上游许可证；移动端运行时还随仓库保留了 [node-forge](apps/mobile/android/app/src/main/assets/lx_bridge/forge.LICENSE.txt) 与 [SES](apps/mobile/android/app/src/main/assets/lx_bridge/ses.LICENSE.txt) 的许可文本。
