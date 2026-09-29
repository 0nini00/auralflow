---
id: desktop
type: module-design
status: draft
title: "@auralflow/desktop — 桌面端"
parent: auralflow-architecture
tags: [auralflow, desktop]
---

## 职责

桌面端是 AuralFlow 的功能先导端：新能力先在这里落地，移动端随后对齐。它是一个 Tauri v2 应用，由三块构成，各自的细节在子节点里：

- **React 前端**（`desktop/src`）——界面、状态与业务规则。见 `desktop-frontend`。
- **Rust 后端**（`desktop/src-tauri`）——系统级能力：文件与媒体、流式下载、出站 SSRF 守卫、托盘、独立歌词窗口、凭据加密。见 `desktop-native`。
- **IPC 桥**（`desktop/packages/tauri-bridge`）——部分 Tauri 命令的类型化包装。见 `tauri-bridge`。

端上独有的能力（相对移动端）：透明浮窗歌词窗口、系统托盘、窗口内快捷键、扫码登录、Rust 侧文件操作、可变下载目录、光标特效。这些由平台能力支撑，不是移动端的缺口。

共同目标见 `auralflow-goal`；两端共享的纯逻辑见 `core`；音源解析见 `source-resolution`。

**平台限定**：桌面端只面向 Windows。`secret_store.rs` 在其他平台编译期直接失败，而不是静默退回明文存储。

## 边界

**允许**：`@lx/core` 与 `@lx/tauri-bridge`（均为 `workspace:*`），以及 Tauri v2 官方插件（api / plugin-deep-link / plugin-dialog / plugin-fs / plugin-http / plugin-shell）、React 18、React Router 6、Zustand 5、crypto-js、node-forge、lucide-react。

**禁止**：

- 不依赖 React Native 或任何移动端运行时。
- **两端必须同答案的纯逻辑不得在桌面端复制**。已知技术债：`desktop/src/services/lyrics/playbackSync` 仍是 `core/lyrics/playbackSync` 的本地超集副本（多了词级进度与时钟外推），迁移未完成。
- Web 前端不做系统级 IO——除下述已知例外，一律经 IPC 转发。

**已知边界瑕疵（实情）**：`@lx/tauri-bridge` 不是唯一 IPC 路径，也不是强制关口。`desktop/src` 有 31 处直接 `import` `@tauri-apps/*`，包括 `plugin-http` 的静态白名单直连，以及 4 处直接 `invoke`（`components/MetadataEditModal.tsx`、`services/appBackground.ts`、`services/outboundHttp.ts`、`utils/compression.ts`）。桥覆盖的是命令面的一部分，旁路是有意保留的——所以「新增 IO 必须走桥」这条规则在代码里并不成立。细节见 `tauri-bridge`。

**约束强度**：桌面端没有 ESLint 配置（全仓库只有移动端有），因此这些边界是约定而非工具强制，越界不会有检查报错。
