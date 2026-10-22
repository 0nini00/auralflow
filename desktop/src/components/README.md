# components/

UI 组件层：负责桌面端全部可见界面与交互，自身不持业务逻辑，数据从 Zustand store 订阅、规则下沉到 services。

## 目录结构

```
components/
├── Layout/            # 路由布局 shell（3 文件）
├── playerVisualizers/ # 歌词可视化渲染（6 文件）
└── ui/                # 无状态 UI 原语（3 文件）
```

## Layout/（3 文件）

| 组件 | 文件 | 职责 |
| --- | --- | --- |
| Layout | `Layout.tsx` | 路由布局 shell：背景图 + 侧边栏 + Topbar + 内容区 + 现在播放右栏 + PlayerBar |
| Sidebar | `Sidebar.tsx` | 236px 可拖拽导航 rail（分组：发现 / 为你 / 我的音乐）+ 网易账号按钮 |
| Topbar | `Topbar.tsx` | 合并了原 `AppTitleBar` 与 `Header`：窗口拖拽区 + 面包屑 + 搜索框（Ctrl K / 220ms 防抖建议）+ 主题切换 + 最小化/最大化/关闭 |

> 重设计（A 方向）后 `AppTitleBar.tsx` 与 `Header.tsx` 已删除，窗口按钮与搜索框并入 `Topbar`。

## playerVisualizers/（6 文件）

| 组件 | 文件 | 职责 |
| --- | --- | --- |
| PlayerVisualizerRenderer | `PlayerVisualizerRenderer.tsx` | 6 行分派器 → ScrollingLyricsVisualizer |
| ScrollingLyricsVisualizer | `ScrollingLyricsVisualizer.tsx` | 纯 CSS 背景渐变填充 `background-clip:text` + `--af-scrolling-lyric-progress` + 逐词 `clip-path:inset()` |
| PosterLyricsVisualizer | `PosterLyricsVisualizer.tsx` | 备用海报式可视化（当前无调用点，仅测试引用） |
| LyricText / LyricRomanization | `LyricAnnotations.tsx` | 注音 ruby 与罗马音渲染（白名单元素，源文本始终是文本节点） |
| getLyricDisplayText / getSecondaryLyricText | `lyricDisplay.ts` | 歌词显示文本派生 |
| PlayerVisualizerProps | `types.ts` | 可视化组件的属性契约 |

## ui/（3 文件）

| 组件 | 文件 | 职责 |
| --- | --- | --- |
| Button | `Button.tsx` | 变体（primary / secondary / ghost / danger）× 尺寸（sm / md / lg），样式仍由 `buttons.css` 承担 |
| EmptyState | `EmptyState.tsx` | 空态 / 错误态唯一形态：图标 + 标题 + 说明 + 可选主行动 |
| — | `index.ts` | barrel：`export { Button, EmptyState }` |

## 顶层主要组件（22 个 .tsx）

| 组件 | 文件 | 职责 |
| --- | --- | --- |
| PlayerBar | `PlayerBar.tsx` | 3 列网格（曲目\|传输\|音量）+ 全宽进度；`useInterpolatedPlaybackProgress` rAF 平滑；拖动状态机 `isScrubbing` 覆盖；`useArtworkAmbience` 在 early return 前调 hooks 规则；封面点击开 ImmersiveLyricsOverlay；桌面歌词按钮 `toggleDesktopLyricFromPlayer` |
| ImmersiveLyricsOverlay | `ImmersiveLyricsOverlay.tsx` | `position:fixed` 全窗沉浸层 + 封面与滚动歌词 + `ImmersivePlayerControls` 三列底栏 + CSS 变量 `--af-immersive-progress/volume/artwork-rgb/anim-scale/lyric-font-family` + 分享剪贴板 + 更多菜单“退出沉浸式播放” + 键盘 `resolveImmersiveKeyboardAction`；Esc 优先关闭菜单，关闭后恢复焦点；不控制原生全屏（窗口级按钮在 `Topbar`，沉浸页内无窗口操作） |
| MusicCard / VirtualList / SongAddMenuButton | — | 通用曲目卡片、虚拟化列表与歌曲操作菜单 |
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
