# 沉浸式播放详情对齐

沉浸式播放详情（全屏歌词 / 播放控制）是两端体验最重的页面之一。两端共享歌词同步、歌词设置、播放概念与调色，但落地形态按平台分化：桌面用 CSS Overlay 全屏，移动用 Modal 路由 + PagerView 分页。

## 设计目标

- **全屏沉浸**：覆盖普通界面，封面与歌词为主角，控件收束到边缘。
- **歌词为主**：滚动歌词跟随播放，支持卡拉 OK 逐字、译文、简繁转换、字号 / 行距调节。
- **体验一致**：两端歌词同步算法、歌词设置、播放模式 / 倍速 / 音量 / 睡眠定时器 / 队列概念保持一致，调色 palette 统一。
- **平台适配**：交互模式按平台原生能力落地——桌面键盘 + 鼠标，移动手势 + 触觉反馈。

---

## 桌面端实现

`ImmersiveLyricsOverlay`：`position: fixed` 全屏覆盖层，挂在普通界面之上，不走路由。

- **大封面呼吸**：封面居中，呼吸动画随播放节拍缩放。
- **滚动卡啦 OK 歌词**：单页歌词滚动，逐字进度由 `background-clip: text` + `clip-path: inset()` 纯 CSS / DOM 可视化填充（无 JS 动画驱动逐字）。
- **3 组控件栏**：顶部 / 中部 / 底部三组控件区。
- **CSS 变量数据驱动**：用 CSS 自定义属性承接运行时状态，避免重渲染整屏：
  - `--af-immersive-progress`（播放进度）
  - `--af-immersive-volume`（音量）
  - `--af-immersive-artwork-rgb`（封面主色，驱动整体配色）
  - `--af-immersive-anim-scale`（动画缩放）
- **纯 CSS / DOM 可视化**：卡拉 OK 逐字、进度条等均由 CSS（`background-clip: text` + `clip-path: inset()`）驱动，JS 只更新变量值。
- **全屏**：`useNativeFullscreen` 调用浏览器原生全屏 API。
- **队列面板**：`scrollIntoView` 把当前曲目滚到可视区。
- **分享**：`buildMusicShareText` 生成分享文本写入剪贴板。
- **键盘**：`resolveImmersiveKeyboardAction` 处理空格 / 方向键 / ↑↓ / M / ESC。

---

## 移动端实现

`ImmersiveLyricsScreen`（`Modal` + `fullScreenModal`）作为路由级全屏 Modal 弹出，内部结构：

```text
Modal (fullScreenModal)
  └─ PagerView 2 页
       ├─ 第 0 页：ImmersiveCoverPage（封面）
       └─ 第 1 页：LyricView（歌词）
  └─ ImmersiveTransport（进度 + 控件，叶子组件）
  └─ ImmersiveTopBar / ImmersiveModals
  └─ isLyricsPage && <KeepAwake />
```

### useImmersiveController（558 行）

`src/screens/immersive/useImmersiveController.ts` 承担**所有状态与操作**，UI 组件只做渲染：

- **状态隔离**：0.25s 进度 tick 只重渲染进度叶子组件（`ImmersiveTransport` 内部订阅），不触发全屏重渲染。
- **下拉关闭**：`dismissResponder`（`PanResponder.create`），仅在**封面页**生效——`!isLyricsPageRef.current && g.dy > 80 && g.dy > Math.abs(g.dx) * 1.5` 响应，`g.dy > 120` 释放即 `onClose`。
- **浮窗歌词切换**：`canDrawOverlays` / `requestOverlayPermission` 检查并请求 Android 悬浮窗权限。
- **封面长按下载**：长按封面弹出菜单（下载封面 / 下载歌曲）。

### 旋转封面（ImmersiveCoverPage）

- `Animated.timing(spinValue, { duration: 25000 * (1 - value), useNativeDriver: true })`——25s 一圈，`useNativeDriver` 走原生动画线程。
- **暂停从当前角度恢复**：暂停时停止动画，恢复时从当前角度继续，不跳回 0°。

### Marquee 跑马灯（ImmersiveTopBar）

`Marquee` 组件包裹歌名，过长时 `Animated.timing(translateX)` 滚动，短则不滚；对齐 lx Marquee。

### LyricView（587 行）

`src/components/LyricView.tsx`，歌词滚动核心：

- **动态行高累积偏移**：`onLayout` 记录每行真实高度，目标行居中偏移 = `累计行高(0..index-1) + 当前行一半 - viewportHeight × 0.42`（对齐 lx `handleScrollToActive`）。
- **相邻行平滑**：相邻行（diff == 1）用 `easeInOutQuad` 缓动 **600ms** 平滑滚动。
- **跨行 / seek 即时**：跨行 / seek / 首次用 `scrollToIndex({ animated: false, viewPosition: 0.42 })` 立即定位。
- **3s 用户滚动暂停**：`onScrollEndDrag` 后 3s 恢复自动跟唱，滚动持续时不提前恢复。
- **捏合缩放**：双指 `Pinch` 手势即时改字号，松手写回 store；行高缓存失效后等 `onLayout` 重测，再把当前行滚回 42% 锚点。
- **点击行跳转**：`onSeek(item.time)` 跳转到该行时间。
- **简繁转换**：`opencc-js`（`chineseConversionService`）按需转换。
- **活跃行缩放**：当前行放大强调。

### KeepAwake / 触觉反馈

- **KeepAwake 仅歌词页**：`isLyricsPage && <KeepAwake />`，只在歌词页保持亮屏。
- **触觉反馈**：`hapticLight()` 在切歌 / 按键触发轻触觉。

---

## 一致性点

两端共享以下逻辑，确保核心体验一致：

| 维度 | 共享实现 |
| --- | --- |
| **歌词同步** | `useLyricLineIndex` 共享——锚点外推 + 0.12s 迟滞，两端用同一行号推进算法 |
| **歌词设置** | `lyricSettingsStore` 共享（字号 / 颜色 / 字体 / 对齐 / 字重 / 行距 / 译文 / 动效强度） |
| **播放模式 / 倍速 / 音量** | 概念一致，参数互通 |
| **睡眠定时器** | `sleepTimerStore` 一致 |
| **队列** | 队列概念一致 |
| **封面调色** | palette 一致（移动 `--af-immersive-artwork-rgb` 对应桌面同源） |

---

## 平台差异点

| 维度 | 桌面端 | 移动端 |
| --- | --- | --- |
| **全屏形态** | CSS `position: fixed` Overlay 全屏 | Modal 路由 `fullScreenModal` |
| **页面结构** | 单页歌词 | PagerView 封面 + 歌词分页 |
| **卡拉 OK 可视化** | CSS `background-clip: text` + `clip-path: inset()` | `Animated` + `scrollToIndex` |
| **交互** | 键盘（空格 / 方向键 / ↑↓ / M / ESC） | 手势（PanResponder 下拉关闭 / 捏合缩放 / 点击行跳转） |
| **旋转封面** | 无 | 25s `Animated.timing` 旋转，暂停从当前角度恢复 |
| **分享** | `buildMusicShareText` 写剪贴板 | `Share.share` 系统分享面板 |
| **亮屏** | 常驻应用，无需 KeepAwake | KeepAwake 仅歌词页 |
| **触觉** | 无 | `hapticLight` 触觉反馈 |
| **浮窗歌词** | 独立桌面歌词窗口（透明置顶 webview） | Android 浮窗（`WindowManager` + `canDrawOverlays` 授权） |

---

## 对齐结论

**核心体验一致，交互模式按平台适配。** 两端共享歌词同步（`useLyricLineIndex`）、歌词设置（`lyricSettingsStore`）、播放概念（模式 / 倍速 / 音量 / 睡眠 / 队列）与封面调色（palette），差异只在落地形态：桌面用 CSS Overlay 单页 + 纯 CSS 卡拉 OK + 键盘交互，移动用 Modal + PagerView 分页 + Animated 卡拉 OK + 手势交互 + 旋转封面。这些差异是平台原生设计的自然结果，而非功能缺口。
