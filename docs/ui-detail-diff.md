# AuralFlow UI 细节差异 — 桌面 vs 移动

> 2026-08-27，基于双端源码逐文件取证，按 UI 实现维度逐点对比桌面端与移动端的形态与技术差异。
>
> 基线代码：桌面端 `desktop/`，移动端 `apps/mobile/`，共享核心 `@lx/core`。
>
> 图例：🟢 共享（平台差异） · 💻 桌面独有 · 📱 移动独有 · ⬆️ 移动更全

---

## 1. 整体布局

| 维度 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 容器形态 | 侧边栏 240px + 内容区 + 底部播放栏的三段式窗口布局 | 底部 Tab（Home / Search / Library / Music）+ 抽屉式导航 | 🟢 平台原生 |
| 主导航载体 | 常驻 `Sidebar.tsx` 240px 固定列 | `Drawer` > `NativeStack` > `BottomTabs` + `MaterialTopTabs`，抽屉默认关闭 front overlay 形态 | 🟢 平台原生 |
| 曲库内嵌 | 独立页面（PlaylistsView / HistoryView / LocalMusicView / DownloadsView） | `LibraryScreen` 内嵌 Local / History / Downloads / Bili（Bili 条件登录） | 📱 移动独有 |
| 迷你播放器 | 底部 `PlayerBar` 全宽常驻 | 迷你播放器嵌入底部 Tab 栏，`keyboardVisible` 时隐藏 | 📱 移动独有形态 |
| 响应式 | 浏览器窗口缩放自适应 | 手机/平板竖横屏，Tab 栏 + 抽屉适配 | 🟢 平台原生 |

---

## 2. 路由导航

| 维度 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 路由框架 | react-router v6 `BrowserRouter` | React Navigation v7 `Drawer` > `NativeStack` > `BottomTabs` + `MaterialTopTabs` | 🟢 平台原生 |
| 路由数量 | 12 条路由：`/` `/search` `/local` `/playlists` `/downloads` `/history` `/playlist/:id` `/artist/:id` `/album/:id` `/daily` `/fm` `/settings` | 9 路由 `NativeStack`（设置等）+ BottomTabs 4 主 Tab + MaterialTopTabs（Library 内嵌 Local/History/Downloads/Bili） | 🟢 平台原生 |
| URL 同步 | `setSearchParams({q})` 写地址栏 | 无地址栏，用 deep link 初始关键词代替 | 💻 桌面独有 |
| 顶部栏 | `Header.tsx` 搜索 / 联想 / 主题切换 / 前进后退 | `MobileHeader.tsx` 汉堡 / 搜索 / 联想 / 主题切换 | 🟢 平台原生 |
| 导航栈修正 | 无（浏览器历史天然正确） | 栈形态修正器 `fixup`：mount + 450ms 各跑一次 `CommonActions.reset` 强制修正"打开 B 后退回 A"的残留页 bug | 📱 移动独有 |

---

## 3. 沉浸式播放

| 维度 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 容器形态 | `ImmersiveLyricsOverlay` `position:fixed` 全屏 CSS/DOM overlay | `ImmersiveLyricsScreen` Modal `fullScreenModal` + `PagerView` 2 页（封面 / 歌词） | 🟢 平台原生 |
| 状态隔离 | overlay 直接消费全局状态 | `useImmersiveController` 558 行，所有状态自包含隔离；0.25s 进度 tick 不重渲染全屏；`palette` 用 `useMemo` | 📱 移动独有 |
| 卡拉OK 渲染 | `background-clip:text` + `clip-path:inset()` 纯 CSS/DOM 实现 | Animated `clip-path` 驱动逐字高亮 | 🟢 平台原生 |
| 数据驱动 | CSS 变量 `--af-immersive-progress` / `volume` / `artwork-rgb` / `anim-scale` / `lyric-font-family` 由 JS 注入 `player.css` 消费 | Animated 值 + `useNativeDriver` 直接驱动原生 UI 线程 | 🟢 平台原生 |
| 可视化分析器 | 无 canvas、无 WebAudio analyser（纯 CSS 变量驱动） | 无 analyser，`Animated` + `useNativeDriver` 动画 | 🟢 双端均无频谱分析器 |
| 旋转封面 | 无 | `Animated.timing` 25s `useNativeDriver` 旋转，暂停从当前角度恢复；`coverSpin` 设置 `borderRadius: coverSize/2`（圆盘）vs 默认 8（圆角方） | 📱 移动独有 |
| 下拉关闭 | 无 | `PanResponder` `dy > 120` 仅在封面页触发下拉关闭 | 📱 移动独有 |
| 跑马灯 | 无 | Marquee 跑马灯标题 | 📱 移动独有 |
| 屏幕常亮 | 无 | KeepAwake 仅歌词页生效 | 📱 移动独有 |
| 浮窗歌词切换 | 无 | 沉浸内切换浮窗歌词，校验 `canDrawOverlays` / `requestOverlayPermission` | 📱 移动独有 |
| 封面长按 | 无 | 封面长按触发下载 | 📱 移动独有 |
| 沉浸键盘 | `resolveImmersiveKeyboardAction` 沉浸式内键盘动作分流 | 无键盘 | 💻 桌面独有 |

---

## 4. 歌词渲染

| 维度 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 渲染实现 | `ScrollingLyricsVisualizer` 纯 CSS 渐变填充当前行 + 逐词 `clip-path` | `LyricView` 587 行 动态行高测量 → 累积偏移滚动 | 🟢 平台原生 |
| 进度驱动 | `--af-scrolling-lyric-progress` CSS 变量驱动填充 | `PlaybackProgressClock` 行进度估算 + Animated 驱动 | 🟢 平台原生 |
| 相邻行平滑 | CSS 过渡 | 相邻行 `easeInOutQuad` 600ms（10ms 步）平滑 | 📱 移动独有 |
| 跨行跳转 | 无特殊处理 | 跨行即时 `scrollToIndex` `viewPosition:0.42` | 📱 移动独有 |
| 用户滚动暂停 | `USER_SCROLL_RESUME_DELAY_MS=3000` | `onScrollBeginDrag` + 3s 暂停自动滚动 | 🟢 共享 |
| 阅读延迟 | 无 | 相邻行 600ms 阅读延迟 | 📱 移动独有 |
| 捏合缩放 | 无 | 捏合缩放歌词字号 | 📱 移动独有 |
| 点击行跳转 | 无 | 点击行跳转 seek 到该行时间 | 📱 移动独有 |
| 简繁转换 | 无 | `opencc-js` 简繁转换 | 📱 移动独有 |
| 活跃行缩放 | 无 | 活跃行缩放强调 | 📱 移动独有 |

---

## 5. 可视化技术

| 维度 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 动画引擎 | 纯 CSS 变量 + transition/animation，无 canvas | `Animated` API + `useNativeDriver` 原生线程动画 | 🟢 平台原生 |
| 频谱分析 | 无 canvas、无 WebAudio analyser | 无 analyser | 🟢 双端均无 |
| 进度平滑 | `useInterpolatedPlaybackProgress` rAF 平滑 | `useImmersiveController` 0.25s tick 不重渲染全屏 | 🟢 平台原生 |
| 数据驱动方式 | CSS 变量（`--af-*`）由 JS 注入，CSS 消费 | Animated value 直接驱动 RN 组件 | 🟢 平台原生 |

---

## 6. 列表渲染

| 维度 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 渲染方式 | 普通滚动 / 虚拟列表 VirtualList | 增量挂载：初始 60 + 100/批 `InteractionManager.runAfterInteractions` | 🟢 平台原生 |
| 选型原因 | 浏览器原生滚动足够 | 非 FlatList，因嵌套在 ScrollView 中，用增量挂载替代虚拟列表 | 📱 移动独有策略 |
| 加载节流 | 无特殊节流 | `InteractionManager.runAfterInteractions` 等交互空闲后挂载下一批 | 📱 移动独有 |

---

## 7. 图片

| 维度 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 加载方式 | 普通 `<img>` + `imageReferrerPolicy` | `CachedImage`（`@d11/react-native-fast-image`）`cache:immutable` + `transition:fade` | 🟢 平台原生 |
| 原生缓存 | 浏览器 HTTP 缓存 | Glide 原生缓存 | 📱 移动独有 |
| 协议处理 | 无特殊处理 | http → https 转换 | 📱 移动独有 |
| 缩略图 | 无 | `resizeCoverUrl` 缩略图按需加载 | 📱 移动独有 |
| B 站封面 | 无特殊处理 | B 站 Referer-bypass，RNFS 预下载 + 2 重试 URL 变异 | 📱 移动独有 |

---

## 8. 设置 UI

| 维度 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 页面结构 | 单页 `sticky` 168px 导航 + 9 子视图，`useState` 切换，仅活动 section 挂载 | 9 路由 `NativeStack`，每子页面独立栈 | 🟢 平台原生 |
| 状态管理 | `useSettingsViewModel` 集中状态 | 各子页面独立 store / view model | 🟢 平台原生 |
| 导航修正 | 无 | 栈形态修正器 `fixup`（mount + 450ms 各跑一次 `CommonActions.reset`）修正"打开 B 后退回 A"残留页 bug | 📱 移动独有 |
| 挂载策略 | 仅活动 section 挂载（`useState` 切换时卸载非活动） | 栈式按需挂载，返回即卸载 | 🟢 平台原生 |

---

## 9. 主题系统

| 维度 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 变量体系 | `--af-*` CSS 变量 + `data-theme="dark"` | `theme/tokens`（spacing / radius / typography / touch / breakpoints）+ `controlTokens`（Button / Chip / IconButton 变体） | 🟢 平台原生 |
| 强调色应用 | `themeStore.applyAppearance` 运行时写 accent 变量 | `getThemePalette(getResolvedTheme(mode, systemTheme), accentColor)` 动态生成调色板 | 🟢 平台原生 |
| 玻璃效果 | `backdrop-filter` 玻璃模式 | 无玻璃模式（原生无 backdrop-filter） | 💻 桌面独有 |
| 主题状态 | `themeStore` 集中 | `useThemeStore` 单独读（无 Context provider） | 📱 移动独有 |
| 原语组件 | 无统一原语层 | 5 个 `ui/` 原语：Button / Chip / IconButton / ListItemButton / ModalActions | 📱 移动独有 |

---

## 10. 全屏

| 维度 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 实现方式 | `useNativeFullscreen` 所有权追踪 | 全屏 modal presentation（`fullScreenModal`） | 🟢 平台原生 |
| 所有权管理 | 追踪全屏所有权，退出时正确归还 | modal 栈式进出，无显式所有权 | 💻 桌面独有 |

---

## 11. 分享

| 维度 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 分享方式 | 剪贴板 `buildMusicShareText` 写入剪贴板 | `Share.share` 调系统分享面板 | 🟢 平台原生 |
| 分享面板 | 无系统面板，仅复制 | 原生系统分享面板 | 📱 移动独有 |

---

## 12. 键盘与手势

| 维度 | 桌面端 | 移动端 | 差异性质 |
|---|---|---|---|
| 键盘快捷键 | `useKeyboardShortcuts`：空格 / 方向键 ±5s / ↑↓ 音量 / M；`resolveImmersiveKeyboardAction` 沉浸式内分流 | 无键盘快捷键 | 💻 桌面独有 |
| 手势 | 无（鼠标交互） | `PanResponder` 下拉关闭 + `Keyboard` 监听隐藏迷你播放器 | 📱 移动独有 |
| 迷你播放器联动 | 无键盘相关 | `keyboardVisible` 时隐藏迷你播放器 | 📱 移动独有 |

---

## 汇总

| 维度 | 差异性质 | 说明 |
|---|---|---|
| 整体布局 | 🟢 平台原生 | 桌面三段式窗口 vs 移动 Tab + 抽屉 |
| 路由导航 | 🟢 平台原生 | react-router v6 12 路由 vs React Navigation v7 Drawer>Stack>Tabs+MaterialTopTabs；移动多栈形态修正器 |
| 沉浸式 | 🟢 + 📱 多 | 桌面 CSS/DOM overlay vs 移动 PagerView + useImmersiveController + 下拉关闭 + 旋转封面 |
| 歌词渲染 | 🟢 + 📱 多 | 桌面纯 CSS 渐变 vs 移动动态行高 + 累积偏移 + 相邻平滑/跨行即时 + 3s 暂停 + 捏合 |
| 可视化技术 | 🟢 双端均无 analyser | 桌面 CSS 变量驱动 vs 移动 Animated useNativeDriver |
| 列表渲染 | 🟢 + 📱 独有策略 | 普通 vs 增量挂载 60+100/批 |
| 图片 | 🟢 + 📱 多 | 普通 img vs CachedImage Glide + http→https + resizeCoverUrl + B站 Referer-bypass |
| 设置 UI | 🟢 + 📱 修正器 | 单页 sticky 168px + 9 子视图 vs 9 路由 NativeStack + 栈形态修正器 |
| 主题系统 | 🟢 + 💻 玻璃 | --af-* CSS 变量 + 玻璃 vs tokens + controlTokens + getThemePalette + 5 原语 |
| 全屏 | 🟢 + 💻 所有权 | useNativeFullscreen 所有权追踪 vs modal presentation |
| 分享 | 🟢 | 剪贴板 vs Share.share |
| 键盘手势 | 💻 + 📱 各有 | useKeyboardShortcuts vs PanResponder + Keyboard |
