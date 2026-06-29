# AuralFlow 快速启动指南

## 开发启动

```bash
pnpm install
pnpm tauri:dev
```

这会启动 Vite 开发服务器并打开 Tauri 桌面窗口。

## 常用命令

```bash
pnpm dev
pnpm run test:regression
pnpm run typecheck
pnpm run build
pnpm tauri:build
```

Rust 侧检查：

```bash
cd src-tauri
cargo check
```

## 首次使用

1. 打开搜索页，输入歌曲、歌手、专辑或歌单关键词。
2. 搜索框会显示在线联想和最近搜索；结果页可在综合、单曲、歌手、专辑和歌单之间切换。
3. 点击歌曲播放，播放器会维护当前队列。
4. 在播放器中打开沉浸式歌词；覆盖层会显示滚动歌词，也可在设置中启用桌面歌词窗口。
5. 在本地音乐页添加扫描目录，刷新时扫描失败的目录会保留既有歌曲。
6. 在设置页配置网易云扫码登录或 Cookie 登录、自定义音源、WebDAV 和音效。

## 项目结构

```text
src/          React 前端
packages/     workspace 内部包
src-tauri/    Tauri Rust 后端
scripts/      Node 回归脚本
docs/         设计和实现文档
```

关闭主窗口会隐藏到系统托盘，真正退出需要从托盘菜单选择退出。
