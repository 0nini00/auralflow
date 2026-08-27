# 快速开始

本指南介绍如何在本地开发与构建 AuralFlow 双端应用。完整架构与设计决策见 [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)。

## 1. 环境要求

| 工具 | 版本 | 用途 |
|---|---|---|
| Node.js | **≥ 22.11.0** | 移动端 Metro 硬性要求（`engines.node`） |
| pnpm | 最新 | monorepo 包管理 |
| Rust 工具链 | stable | 桌面端 Tauri 后端构建 |
| Android Studio + Android SDK | — | 移动端构建，minSdk 24 / compileSdk 36 / targetSdk 36 |

> 桌面端 Vite dev 固定占用 **端口 1420**（`strictPort`），启动前确保该端口未被占用。

## 2. 安装依赖

在项目根目录执行：

```bash
pnpm install
```

安装会自动执行移动端 postinstall 补丁脚本 `apply-track-player-patch.js`（通知栏歌词开关相关）。

## 3. 桌面端开发

```bash
pnpm desktop:dev          # Vite dev（浏览器模式，端口 1420）
pnpm desktop:tauri:dev    # Tauri dev（原生窗口，含 Rust 后端热重载）
pnpm desktop:tauri:build  # 打包桌面安装包
```

- `desktop:dev` 仅启动前端，用于纯 UI 调试；需要 IPC / 文件 / 缓存等 Rust 能力时用 `desktop:tauri:dev`。
- Vite 产出按 `manualChunks` 固定分包：`react-vendor` / `tauri-vendor` / `crypto-vendor` / `ui-vendor`。

## 4. 移动端开发（Android）

```bash
pnpm mobile:start         # 启动 Metro Bundler
pnpm mobile:android       # 运行到已连接的 Android 设备 / 模拟器
pnpm mobile:build:debug   # 生成 debug APK（cd android && gradlew.bat assembleDebug）
```

- 需先启动 Metro（`mobile:start`），再在另一终端运行 `mobile:android`。
- 调试签名使用仓库内 `apps/mobile/android/app/debug.keystore`。
- 按 ABI 拆分的 APK 会复制到 `android/app/build/outputs/apk-alt`。

### Release APK

```bash
cd apps/mobile/android && ./gradlew assembleRelease
```

签名凭据从仓库外目录读取：
- 环境变量 `AURALFLOW_KEYSTORE_DIR`，缺省本机 `F:/auralflow-secrets`
- 需提供 `keystore.properties`，含 `AURALFLOW_RELEASE_STORE_FILE` / `AURALFLOW_RELEASE_STORE_PASSWORD` / `AURALFLOW_RELEASE_KEY_ALIAS` / `AURALFLOW_RELEASE_KEY_PASSWORD`
- **缺失时硬失败**，禁止产出 debug 签名的 release APK。

## 5. 类型检查与 Lint

```bash
pnpm desktop:typecheck    # 桌面端 tsc --noEmit
pnpm mobile:typecheck     # 移动端 tsc --noEmit
pnpm mobile:lint          # 移动端 eslint src App.tsx
```

> 双 React 版本共存（桌面 18.3.1 / 移动 19.2.3）。`pnpm-workspace.yaml` 的 `packageExtensions` 钉 `@types/react@18`，避免桌面端 TS2786 JSX 错误。若类型检查报大量 `react` 相关错，先确认 `pnpm install` 已正确应用 `packageExtensions`。

## 6. Rust 后端检查

```bash
cargo check --manifest-path desktop/src-tauri/Cargo.toml
```

首次执行会编译全部依赖，耗时较长；后续增量编译很快。`outbound-host.ts`（JS）与 `outbound.rs`（Rust）是 SSRF 规则的双实现，**规则变更时两份必须同步**。

## 7. 首次使用流程

1. **安装依赖**：`pnpm install`。
2. **启动桌面端**：`pnpm desktop:tauri:dev`（首次会编译 Rust，请耐心等待）。
3. **启动移动端**：先 `pnpm mobile:start`，再 `pnpm mobile:android`（需 USB 调试或模拟器已连接）。
4. **配置账号**：进入设置页登录网易云（二维码）或 B站（Cookie）。
5. **配置音源**：内置 gdstudio 网关免 key 直接可用；可选在设置中添加自定义 lx 音源脚本作为兜底。
6. **扫描本地音乐**（可选）：桌面端在本地音乐页选择目录扫描；移动端授予 `READ_MEDIA_AUDIO` 权限后扫描 MediaStore。
7. **验证**：执行一次搜索，确认多音源聚合返回结果；播放一首歌验证解析链与缓存。

## 常用命令速查

```bash
# 开发
pnpm desktop:dev          # 桌面 Vite dev
pnpm desktop:tauri:dev    # 桌面 Tauri dev
pnpm mobile:start         # 移动 Metro
pnpm mobile:android       # 移动运行到设备

# 构建
pnpm desktop:tauri:build  # 桌面安装包
pnpm mobile:build:debug   # 移动 debug APK

# 检查
pnpm desktop:typecheck    # 桌面类型
pnpm mobile:typecheck     # 移动类型
pnpm mobile:lint          # 移动 lint
cargo check --manifest-path desktop/src-tauri/Cargo.toml  # Rust
```
