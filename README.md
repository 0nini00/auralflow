# AuralFlow Desktop

基于 **Tauri v2 + React + TypeScript + Vite** 的多源桌面音乐播放器。

## 前置依赖

1. **Node.js** >= 20
2. **npm** >= 10
3. **Rust** 工具链（Tauri 需要）
   - 安装：https://www.rust-lang.org/tools/install
   - 安装后确保 `cargo` 在 PATH 中
4. **平台相关依赖**（Windows 通常已内置；Linux/macOS 见 Tauri 文档）
   - https://v2.tauri.app/start/prerequisites/

## 安装依赖

```bash
cd auralflow
pnpm install
```

> 你也可以用 `npm install`，但项目使用 pnpm workspace 管理本地包，推荐优先使用 pnpm。

## 运行开发版本

```bash
pnpm tauri:dev
```

这会同时启动 Vite 前端（端口 1420）和 Tauri 桌面窗口。

## 构建生产版本

默认 `tauri.conf.json` 中 `bundle.active` 为 `false`，方便先验证前端构建。

```bash
pnpm run build
```

如果你想生成 Windows 安装包，需要先在 `src-tauri/icons/` 放入图标，然后把 `tauri.conf.json` 里的 `bundle.active` 改成 `true`，再运行：

```bash
npm run tauri:build
```

生成图标命令：

```bash
pnpm tauri icon path/to/source-icon.png
```

## 项目结构

```
auralflow/
├── src/                          # React 前端
│   ├── main.tsx                  # 入口
│   ├── App.tsx                   # 示例页面
│   ├── index.css                 # 全局样式
│   ├── services/                 # 业务逻辑 / 音源 provider
│   ├── stores/                   # Zustand 状态
│   ├── views/                    # 页面级组件
│   ├── components/               # 可复用 UI
│   └── lib/                      # Tauri 薄封装和工具
├── src-tauri/                    # Tauri Rust 后端
│   ├── src/
│   │   └── main.rs               # Rust 入口 / commands
│   ├── capabilities/
│   │   └── default.json          # 权限声明
│   ├── icons/                    # 应用图标（需自行添加）
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── build.rs
├── package.json
├── tsconfig.json
├── vite.config.ts
└── index.html
```

## 当前状态

这是一个**可运行的最小骨架**，包含：

- Vite + React + TypeScript 前端
- Tauri v2 Rust 后端
- 一个示例 `greet` 命令，演示前后端通信
- 业务分层目录和说明文档

接下来需要逐步迁移：

1. `services/sources/wyProvider.ts` 接入网易云搜索/播放/歌词/歌单
2. `services/playerEngine.ts` 实现播放引擎
3. `stores/` 补齐播放、队列、设置、下载状态
4. `views/` + `components/` 搭建新 UI
5. `src-tauri/src/commands/` 添加文件系统、SQLite、下载等 Rust 命令
