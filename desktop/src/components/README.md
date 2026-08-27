# components/

UI 组件层：负责桌面端全部可见界面与交互，自身不持业务逻辑，数据从 Zustand store 订阅、规则下沉到 services。

## 目录结构

```
components/
├── Layout/            # 路由布局 shell（4 文件）
└── playerVisualizers/ # 歌词可视化渲染（5 文件）
```

## Layout/（4 文件）

| 组件 | 文件 | 职责 |
| --- | --- | --- |
| Layout | `Layout.tsx` | 路由布局 shell：背景图 + 标题栏 + 侧边栏 + 内容区 + PlayerBar |
| Sidebar | `Sidebar.tsx` | 240px 导航 rail + 网易账号按钮 |
| Header | `Header.tsx` | 搜索框（220ms 防抖建议）+ 主题切换 |
| AppTitleBar | `AppTitleBar.tsx` | 无边框拖拽 `data-tauri-drag-region` + 最小化/最大化/关闭 |

## playerVisualizers/（5 文件）

| 组件 | 文件 | 职责 |
| --- | --- | --- |
| PlayerVisualizerRenderer | `PlayerVisualizerRenderer.tsx` | 6 行分派器 → ScrollingLyricsVisualizer |
| ScrollingLyricsVisualizer | `ScrollingLyricsVisualizer.tsx` | 纯 CSS 背景渐变填充 `background-clip:text` + `--af-scrolling-lyric-progress` + 逐词 `clip-path:inset()` |
| PosterLyricsVisualizer | `PosterLyricsVisualizer.tsx` | 备用海报式可视化 |

## 顶层主要组件（24 个 .tsx）

| 组件 | 文件 | 职责 |
| --- | --- | --- |
| PlayerBar | `PlayerBar.tsx` | 3 列网格（曲目\|传输\|音量）+ 全宽进度；`useInterpolatedPlaybackProgress` rAF 平滑；拖动状态机 `isScrubbing` 覆盖；`useArtworkAmbience` 在 early return 前调 hooks 规则；封面点击开 ImmersiveLyricsOverlay；桌面歌词按钮 `toggleDesktopLyricFromPlayer` |
| ImmersiveLyricsOverlay | `ImmersiveLyricsOverlay.tsx` | 24.5KB；`position:fixed` 全屏 + 大封面呼吸 + 滚动卡啦 OK + 3 组控件 + CSS 变量 `--af-immersive-progress/volume/artwork-rgb/anim-scale/lyric-font-family` + 队列 `scrollIntoView` + `useNativeFullscreen` + 分享剪贴板 + 键盘 `resolveImmersiveKeyboardAction` |
| MusicCard / SongList / PlaylistCard | — | 通用曲目/歌单卡片与列表 |
| WyCookieLoginModal | — | 网易登录弹窗 |
| PactModal | — | 用户协议确认 |
| CursorEffect | — | 唯一 canvas 光标特效 |
| DeepLinkHandler | — | 深链处理 |
| UpdateModal / CustomSourceUpdateModal | — | 应用更新 / 自定义源更新弹窗 |

其余顶层组件见目录内文件。

## 设计约定

- **类名前缀**：所有 CSS 类名使用 `af-` 前缀（`--af-*` 设计令牌见 `index.css`）。
- **零 DOM tooltip**：用 `data-tooltip` 属性实现，不额外插入 DOM 节点。
- **hooks 规则**：`useArtworkAmbience` 等副作用 hook 必须在组件 early return 之前无条件调用。
- **可访问性**：图标/装饰用 `aria-hidden`，导航用 `role=tablist` 等语义角色。
- **数据来源**：组件从 Zustand store 订阅数据，不持有业务逻辑；业务规则下沉到 services。
