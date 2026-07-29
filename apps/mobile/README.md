# AuralFlow Mobile

AuralFlow Mobile 是 AuralFlow 的 Android 端工程。桌面端继续使用 Tauri + React，移动端使用 React Native + TypeScript，优先复用 `@lx/core` 中的歌曲模型、歌词解析和内置音乐 API 工具。

## 当前能力

- Android React Native 工程骨架。
- 底部导航：发现、搜索、歌单、播放。
- 网易云 / QQ 音乐歌曲搜索。
- 通过内置音乐 API 解析播放链接。
- 使用 `react-native-track-player` 播放歌曲，并预留后台播放和通知栏控制。
- 拉取并解析歌词，复用 `@lx/core` 的 LRC / 逐字歌词解析逻辑。
- 使用 AsyncStorage 保存移动端播放历史。

## 开发

在仓库根目录安装依赖：

```bash
pnpm install
```

启动 Metro：

```bash
pnpm mobile:start
```

运行 Android：

```bash
pnpm mobile:android
```

生成 debug APK：

```bash
pnpm mobile:build:debug
```

APK 输出目录：

```text
apps/mobile/android/app/build/outputs/apk/debug/
```

## 后续接入

- 网易云账号登录和歌单。
- B 站收藏合集。
- 歌曲、封面和歌词落盘缓存。
- Android 媒体库权限和本地歌曲扫描。
- 更完整的歌词进度、锁屏控制和通知栏交互。
