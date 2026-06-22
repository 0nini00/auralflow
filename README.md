# AuralFlow

AuralFlow 是一个基于 **Tauri v2 + React + TypeScript + Rust** 的 Windows 桌面音乐播放器，面向日常听歌、歌单管理、本地音乐整理和桌面歌词使用场景。

## 功能特性

- 多音源搜索与播放：支持网易云、QQ 音乐等来源的歌曲搜索、播放链接解析和歌词获取。
- 网易云账号能力：支持 Cookie 登录、用户歌单、喜欢列表、每日推荐和私人 FM。
- 播放器体验：播放队列、播放历史、最近播放、喜欢歌曲、本地歌单、网易云自建歌单添加。
- 桌面歌词：独立透明桌面歌词窗口，支持置顶、锁定、悬停解锁、样式调整、位置和尺寸记忆。
- 歌词与评论：支持歌词展示、译文、全屏播放页歌词滚动和歌曲评论。
- 本地音乐：扫描本地音乐、读取音频信息、编辑元数据、写入封面和歌词。
- 下载与增强：下载歌曲，并可保存歌词、封面等关联内容。
- 音效控制：均衡器、空间/混响、变调等播放效果。
- 分享链接：可复制当前歌曲的网易云或 QQ 音乐链接。
- 数据与同步：本地数据持久化，支持 WebDAV 同步配置。
- Windows 安装包：Tauri MSI 打包，生成可安装的桌面应用。

## 技术栈

- 前端：React 18、TypeScript、Vite、Zustand、lucide-react
- 桌面端：Tauri v2、Rust、Tokio
- 网络与加密：reqwest、crypto-js、node-forge、AES/EAPI/WEAPI 相关实现
- 包管理：pnpm workspace

## 开发环境

需要安装：

- Node.js 20+
- pnpm
- Rust 工具链
- Tauri v2 所需平台依赖

安装依赖：

```bash
pnpm install
```

启动开发环境：

```bash
pnpm tauri:dev
```

## 构建

前端构建：

```bash
pnpm run build
```

生成 Windows MSI 安装包：

```bash
pnpm tauri build
```

安装包输出目录：

```text
src-tauri/target/release/bundle/msi/
```

## 项目结构

```text
auralflow/
├── src/                    # React 前端
│   ├── components/         # 通用组件
│   ├── hooks/              # React hooks
│   ├── services/           # 音源、播放、下载、同步等服务
│   ├── stores/             # Zustand 状态管理
│   ├── styles/             # 全局样式
│   ├── utils/              # 工具函数
│   └── views/              # 页面视图
├── src-tauri/              # Tauri / Rust 后端
│   ├── src/                # Tauri commands、配置、桌面歌词窗口等
│   ├── capabilities/       # Tauri 权限配置
│   └── tauri.conf.json     # Tauri 应用和打包配置
├── packages/               # workspace 内部包
├── scripts/                # 回归测试脚本
└── docs/                   # 设计和重构文档
```

## 常用命令

```bash
pnpm run typecheck
pnpm run test:desktop-lyric
pnpm run test:personal-fm
pnpm run test:recent-played
pnpm run test:share-link
pnpm tauri build
```

## 远端仓库

```bash
git clone https://github.com/0nini00/auralflow.git
```

后续修改建议从云端同步：

```bash
git pull
git add -A
git commit -m "Update AuralFlow"
git push
```
