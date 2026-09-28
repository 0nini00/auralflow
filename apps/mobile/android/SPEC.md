---
id: mobile-native
type: submodule-design
status: draft
title: Android 原生层 — 桥接边界
parent: mobile
tags: [auralflow, mobile, android]
---

## 职责

Android 原生层（`apps/mobile/android/app/src/main/java/cn/chenle/auralflow/mobile/`，15 个 Java + 2 个 Kotlin）承担 JS 做不到的四件事：

- **系统数据与文件**：`LocalMusicModule` —— MediaStore 扫描，jaudiotagger 读写标签与内嵌封面。
- **系统窗口**：`LyricOverlayModule` + `LyricOverlayService`（配套 `LyricOverlayPreferences`、`LyricNotificationReceiver`）—— WindowManager 悬浮歌词，可拖动、可锁定、随播放滚动。这是移动端唯一的窗口级能力。
- **安全存储与加密**：`SecureStorageModule`（Keystore AES-256-GCM）与 `CryptoModule`（原生 weapi：AES-CBC + RSA NoPadding）。凭据加密是原生独有的——桌面端用 Windows DPAPI。
- **脚本运行时**：`lx_bridge`（`assets/lx_bridge/`）——隐藏 WebView 沙箱执行 LX 脚本。Hermes 不支持 `new Function`，这是移动端唯一可行的执行环境。

其余模块提供单点能力：`CoverColorModule`（封面主色）、`ImagePickerModule`、`ApkInstallerModule`、`CustomSourceFilePickerModule`、`OrientationModule`、`WakeLockModule`、`BatteryOptimizationModule`（后台保活与电池豁免）。`apply-track-player-patch.js` 在 `postinstall` 期给 RNTP 的 `MusicService` 打补丁，补上通知栏歌词按钮。

`LocalMusicPackage` 是唯一的 ReactPackage，注册上述 **11 个模块**——新增模块必须同时改这里，否则 JS 侧只会拿到 `undefined`。

## 边界

**允许**：Android SDK（minSdk 24 / compileSdk 36 / targetSdk 36）与 RN 桥接 API。

**禁止**：

- 不依赖 `@lx/core`，也不参与任何业务规则判定——原生只提供能力，不决定「播哪首歌」或「用哪个音源」；两者都在 JS 侧。
- 不实现音效链（均衡器 / 混响 / 声像 / 变调）——该能力已随 `SoundEffectModule` 移除，且明确不重新引入。

**接通方式**：JS 侧只在 11 个 service 里经 `NativeModules` 触达原生——`localMusicService`、`secureStorageService`、`imagePickerService`、`customSourceFilePicker`、`orientationService`、`lyricOverlayService`、`coverColorService`、`apkInstallService`、`wakeLockService`、`backgroundPlaybackService`、`weapi`。新增原生能力要同时改这两侧。**注意注册名不一定等于类名**：`NativeModules.AuralFlowOrientation` 对应的是类 `OrientationModule`——按类名取不到时去查 `getName()`。

**权限边界**（`AndroidManifest.xml`）：INTERNET / SYSTEM_ALERT_WINDOW / WAKE_LOCK / FOREGROUND_SERVICE_MEDIA_PLAYBACK / POST_NOTIFICATIONS / READ_MEDIA_AUDIO。**无 RECORD_AUDIO**。

**已知边界瑕疵**：`lx_bridge` 的 WebView 配置宽松（`originWhitelist ["*"]`、`mixedContentMode "always"`、`allowFileAccessFromFileURLs`）——与桌面端的参数遮蔽一样**不是安全边界**。脚本能力的实际收敛靠白名单交集（kg/tx/wy 只有 `musicUrl`，local 另有 `lyric` / `pic`）与 musicUrl 返回值的 `assertPublicOutboundUrl` 复核。
