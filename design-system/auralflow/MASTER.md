# AuralFlow 设计系统 · MASTER

> 跨端（桌面 / 移动）设计系统主文档。所有技术事实均取自当前代码库 `desktop/src` 与 `apps/mobile/src`，含表与最小代码示例。日期基准：2026-08-27。

---

## 1. 设计理念

AuralFlow 桌面端与移动端共享同一套视觉语言——强调色、深浅双主题、圆角卡片与沉浸式氛围来自同一组设计令牌；但各自按平台原生方式落地：

| 维度 | 桌面端 | 移动端 |
|---|---|---|
| 载体 | Tauri + Web，CSS 变量 + `af-` 类名 | React Native，TypeScript token + 内联样式 |
| 令牌介质 | `--af-*` CSS 变量（运行时可改写） | `theme/tokens.ts` 常量对象 + `getThemePalette()` 调色板 |
| 主题切换 | `data-theme="dark"` 选择器 + `themeStore.applyAppearance` 运行时写变量 | `useThemeStore` + `getThemePalette(resolvedTheme, accentColor)` 无 Context |
| 强调色 | 同一默认值 `#3bd877`，用户可自定义 | 同一默认值 `#3bd877`，用户可自定义 |
| 平台原生适配 | `@media(max-width:768px)`、`prefers-reduced-motion`、自定义滚动条 | 触摸目标 ≥44px、`hitSlop` 补足、`isAndroid` 分支 |

两端视觉基调一致：圆角面板（桌面 `--af-radius-xl: 20px`，移动 `radius.xl: 20`）、柔和阴影、强调色渐变 `linear-gradient(135deg, #3bd877 0%, #4fdc85 100%)`。差异在于渲染路径——桌面用 CSS 文件分层（`index.css` 711 行 + 10 个 `styles/*.css`），移动用 token 对象与 `StyleSheet.create`。

---

## 2. 色彩系统

### 2.1 桌面 `--af-*` 变量

| 变量族 | light | dark | 用途 |
|---|---|---|---|
| `--af-bg-base` | `#f8f9fa` | `#0a0a0a` | 应用根底色 |
| `--af-bg-page` | `#ffffff` | `#121212` | 主内容面板 |
| `--af-bg-elevated` | `#ffffff` | `#1a1a1a` | 侧边栏 / 播放条 |
| `--af-bg-surface` | `#f8f9fa` | `#1e1e1e` | 卡片表面 |
| `--af-text-primary` | `#0f172a` | `#f8fafc` | 主文字 |
| `--af-text-secondary` | `#475569` | `#cbd5e1` | 次文字 |
| `--af-accent-primary` | `#3bd877` | `#3bd877` | 强调主色 |
| `--af-accent-primary-rgb` | `59, 216, 119` | `59, 216, 119` | RGB 三元组，供 `rgba()` |
| `--af-accent-gradient` | `linear-gradient(135deg,#3bd877 0%,#4fdc85 100%)` | `linear-gradient(135deg,#3bd877 0%,#5edf8f 100%)` | 强调渐变 |
| `--af-border-focus` | `rgba(59,216,119,0.4)` | `rgba(59,216,119,0.5)` | 聚焦描边 |
| `--af-shadow-sm/md/lg/xl` | `0 1px 2px rgba(0,0,0,.05)` … | `0 1px 2px rgba(0,0,0,.3)` … | 阴影（暗色加深） |

`--af-accent-primary-rgb` 是关键设计：将主色拆成赤/绿/蓝三个数字字符串存于变量，用于 `rgba(var(--af-accent-primary-rgb), 0.10)` 这类半透明填充，避免在 CSS 中重复硬编码颜色。

```css
/* theme.css */
:root { --af-accent-primary: #3bd877; --af-accent-primary-rgb: 59, 216, 119; }
[data-theme="dark"] { --af-bg-base: #0a0a0a; --af-text-primary: #f8fafc; }
/* 消费方 */
.af-sidebar-link.active {
  background: rgba(var(--af-accent-primary-rgb), 0.10);
  color: var(--af-accent-primary);
}
```

### 2.2 移动 `getThemePalette`

| Palette 字段 | light | dark |
|---|---|---|
| `background` | `#f8f9fa` | `#121212` |
| `surface` | `#ffffff` | `#1a1a1a` |
| `surfaceMuted` | `#f1f3f5` | `#1e1e1e` |
| `surfaceStrong` | `#e9ecef` | `#2a2a2a` |
| `border` | `#e2e8f0` | `#334155` |
| `text` | `#0f172a` | `#f8fafc` |
| `textMuted` | `#475569` | `#cbd5e1` |
| `textSubtle` | `#94a3b8` | `#64748b` |
| `danger` | `#ef4444` | `#ef4444` |
| `primary` | 用户自定义 accent | 用户自定义 accent |
| `primaryText` | 由 `getReadableTextColor` 算出 | 同左 |
| `statusBar` | `dark-content` | `light-content` |

调色板由 `buildThemePalette(theme, accentColor)` 生成，`primaryText` 通过亮度公式 `(0.299r+0.587g+0.114b)/255 > 0.58` 决定深色或白色文字。移动端色值与桌面 `theme.css` 对齐（注释明确标注「对齐桌面 --af-bg-page / elevated / surface」）。

```ts
// services/themePaletteModel.ts
export function buildThemePalette(theme: ResolvedTheme, accentColor = DEFAULT_ACCENT_COLOR): ThemePalette {
  const base = theme === "light" ? lightBasePalette : darkBasePalette;
  return { ...base, primary: normalizeAccentColor(accentColor), primaryText: getReadableTextColor(primary) };
}
// stores/themeStore.ts
export function getThemePalette(theme: ResolvedTheme, accentColor = DEFAULT_ACCENT_COLOR): ThemePalette {
  return buildThemePalette(theme, accentColor);
}
```

---

## 3. 排版

### 3.1 桌面 CSS 字号 / 字重 / 行高

| Token | 值 | Token | 值 |
|---|---|---|---|
| `--af-font-size-xs` | 12px | `--af-font-size-2xl` | 24px |
| `--af-font-size-sm` | 13px | `--af-font-size-3xl` | 32px |
| `--af-font-size-base` | 14px | `--af-font-weight-normal` | 400 |
| `--af-font-size-lg` | 16px | `--af-font-weight-medium` | 500 |
| `--af-font-size-xl` | 18px | `--af-font-weight-semibold` | 600 |
| `--af-line-height-tight` | 1.25 | `--af-line-height-normal` | 1.5 |
| `--af-line-height-relaxed` | 1.75 | `--af-font-weight-bold` | 700 |

```css
.af-heading-1 { font-size: var(--af-font-size-3xl); font-weight: var(--af-font-weight-bold); letter-spacing: -0.02em; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", …, sans-serif; }
```

### 3.2 移动 `tokens.ts` typography

| 键 | 像素 | 语义 |
|---|---|---|
| `caption` | 12 | 辅助说明 |
| `meta` | 13 | 元信息 |
| `body` | 14 | 正文 |
| `title` | 16 | 标题 |
| `heading` | 18 | 区块标题 |
| `display` | 24 | 大标题 |
| `displayLg` | 32 | 沉浸式大标题 |

```ts
export const typography = { caption: 12, meta: 13, body: 14, title: 16, heading: 18, display: 24, displayLg: 32 } as const;
```

---

## 4. 间距与圆角

### 4.1 桌面

| 间距 Token | 值 | 圆角 Token | 值 |
|---|---|---|---|
| `--af-spacing-xs` | 4px | `--af-radius-sm` | 8px |
| `--af-spacing-sm` | 8px | `--af-radius-md` | 12px |
| `--af-spacing-md` / `--af-space-md` | 16px | `--af-radius-lg` | 16px |
| `--af-spacing-lg` | 24px | `--af-radius-xl` | 20px |
| `--af-spacing-xl` | 32px | `--af-radius-full` | 9999px |
| `--af-spacing-2xl` | 48px | `--af-button-radius` | 10px |

### 4.2 移动 `tokens.ts`

| 间距键 | 值 | 圆角键 | 值 |
|---|---|---|---|
| `spacing.xxs` | 4 | `radius.sm` | 8 |
| `spacing.xs` | 8 | `radius.md` | 12 |
| `spacing.s` | 12 | `radius.lg` | 16 |
| `spacing.m` | 16 | `radius.xl` | 20 |
| `spacing.l` | 20 | `radius.pill` | 999 |
| `spacing.xl` | 24 | | |

布局常量同样收敛于 `tokens.ts`：`layout.pagePadding: 16`、`layout.headerHeight: 56`、`layout.playerBarHeight: 56`、`layout.songRowMinHeight: 60`、`layout.artworkSize: 48`。

```ts
export const layout = {
  pagePadding: 16, tabletPagePadding: 20, songRowMinHeight: 60, songRowPadding: 8,
  artworkSize: 48, headerHeight: 56, compactControlHeight: 36, playerBarHeight: 56,
} as const;
export const breakpoints = { tablet: 768 } as const;
```

---

## 5. 组件设计

### 5.1 桌面 `af-` 前缀类名系统

所有组件类名带 `af-` 命名空间，CSS 按域拆分为 10 个文件：

| 文件 | 职责 |
|---|---|
| `theme.css` | 全量 `--af-*` 令牌定义（light/dark） |
| `layout.css` | 主容器 / 工作区栅格 |
| `player.css` | 播放条 + 沉浸式歌词（1561 行，最大） |
| `home.css` | 首页 / hero |
| `local-music.css` | 本地音乐页 |
| `search.css` | 搜索页 |
| `settings.css` | 设置页 |
| `playlists.css` | 歌单页 |
| `buttons.css` | 通用按钮变体 |
| `tooltip.css` | `data-tooltip` 浮层 |

`index.css`（711 行）放 reset、布局 shell、玻璃 / 沉浸规则、动画关键帧。

| 组件类 | 示例行为 |
|---|---|
| `.af-card` | surface 底 + `--af-radius-lg` + hover `translateY(-2px)` + `--af-shadow-lg` |
| `.af-heading-1/2/3` | 3xl/2xl/xl + bold/semibold/semibold |
| `.af-sidebar-link.active::before` | `width:3px;height:18px` 的 accent 竖条 |
| `.af-flex` / `.af-gap-4` / `.af-mb-4` | 原子工具类 |

```css
.af-card { background: var(--af-bg-surface); border-radius: var(--af-radius-lg);
           border: 1px solid var(--af-border-secondary); padding: 20px; transition: all var(--af-transition-slow); }
.af-card:hover { background: var(--af-bg-surface-hover); border-color: var(--af-border-primary);
                 transform: translateY(-2px); box-shadow: var(--af-shadow-lg); }
.af-sidebar-link.active::before { content:""; position:absolute; left:6px; top:50%;
           width:3px; height:18px; border-radius:999px; background: var(--af-accent-primary);
           transform: translateY(-50%); }
```

### 5.2 移动 5 个 `ui/` 原语 + `controlTokens` 变体

5 个原语均位于 `apps/mobile/src/components/ui/`，全部消费 `control.*` 尺寸 + `getThemePalette`，每个组件各自通过 `useThemeStore` 读取主题（无 Context provider，palette 便宜、`useMemo` 重计算）：

| 原语 | 消费的 control 字段 | 变体 / 尺寸 |
|---|---|---|
| `Button` | `control.button.{small,medium,large}` | variant: `primary/secondary/outline/danger/ghost` |
| `Chip` | `control.chip.{compact,standard}` | size: compact/standard |
| `IconButton` | `control.iconButton.{compact,standard,large}` | tone: `default/muted/inverse/danger/translucent` |
| `ListItemButton` | `control.listItem` | minHeight 56, padding 16/12 |
| `ModalActions` | `control.modalActions` | gap 8, topPadding 16 |

`controlTokens.ts` 变体尺寸：

| 组件 | 尺寸键 | height | minW/hPad | radius | labelSize |
|---|---|---|---|---|---|
| Button | small | 36 | 72 / 12 | 999 | 13 |
| Button | medium | 44 | 88 / 16 | 999 | 14 |
| Button | large | 52 | 112 / 20 | 999 | 16 |
| IconButton | compact | 36 / icon 18 | — | — | — |
| IconButton | standard | 44 / icon 20 | — | — | — |
| IconButton | large | 56 / icon 26 | — | — | — |
| Chip | compact | 32 / hPad 12 | — | — | 13 |
| Chip | standard | 36 / hPad 16 | — | — | 13 |

两个兼容包装器把旧属性名映射到新原语：

| 包装器 | 位置 | 行为 |
|---|---|---|
| `components/IconButton` | 旧 size `sm/md/lg/xl` + tone `default/strong/primary/danger/onImage` | `SIZE_MAP` → control `compact/standard/large`，`TONE_MAP` → `muted/default/inverse/danger/translucent` |
| `components/ActionButton` | 旧接口 | 映射到 `ui/Button` |

```ts
// components/ui/Button.tsx —— 每个原语独立读主题
const mode = useThemeStore((state) => state.mode);
const systemTheme = useThemeStore((state) => state.systemTheme);
const accentColor = useThemeStore((state) => state.accentColor);
const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
const spec = control.button[size];
// components/IconButton.tsx 兼容层
export function IconButton({ size = "md", tone = "default", ...props }: IconButtonProps) {
  return <SharedIconButton {...props} size={SIZE_MAP[size]} tone={TONE_MAP[tone]} />;
}
```

---

## 6. 玻璃模式（桌面）

`.af-app-has-background` 类（应用有自定义背景图时挂到根容器）触发毛玻璃系统。设计要点：遮罩做得很薄，可读性交给 `backdrop-filter` 的模糊 + 提饱和 + 调亮度，以及同色文字描边兜底——而不是靠加厚遮罩把背景盖掉。

| 表面 | light | dark |
|---|---|---|
| `sidebar/header/content/player-bar` 底 | `rgba(255,255,255,0.3)` | `rgba(15,23,42,0.26)` |
| `content` 内层 | `rgba(255,255,255,0.16)` | `rgba(15,23,42,0.16)` |
| 二级元素（search/user/card） | `rgba(255,255,255,0.18)` + `blur(8px)` | `rgba(15,23,42,0.16)` |
| `backdrop-filter` | `blur(16px) saturate(150%) brightness(1.2)` | `blur(16px) saturate(140%) brightness(0.88)` |
| `text-shadow` | `0 1px 2px rgba(255,255,255,0.55)` | `0 1px 3px rgba(0,0,0,0.65)` |

暗色下把 `brightness` 压到 `0.88`（而非上一版的 `0.72`）——压太狠会把背景图一起吃掉，放松后浅色文字仍可读。播放条额外用 `backdrop-filter: blur(20px)`。

```css
.af-app-has-background .af-sidebar, .af-app-has-background .af-content, .af-app-has-background .af-player-bar {
  border-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.3);
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.1);
  backdrop-filter: blur(16px) saturate(150%) brightness(1.2);
}
[data-theme="dark"] .af-app-has-background .af-sidebar, … {
  background: rgba(15, 23, 42, 0.26);
  backdrop-filter: blur(16px) saturate(140%) brightness(0.88);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.65);
}
```

---

## 7. 沉浸式视觉

### 7.1 桌面：CSS 变量数据驱动

沉浸式（`.af-immersive-lyrics`，`position:fixed; inset:0; z-index:1800`）由 JS 在根容器注入一组 `--af-immersive-*` 变量，CSS 只负责消费。完全用纯 CSS/DOM，无 `<canvas>` 或 WebAudio analyser。

| 变量 | 注入者 | 消费方 |
|---|---|---|
| `--af-immersive-progress` | `ImmersiveLyricsOverlay.tsx` (`${progressPercent}%`) | 进度条宽度 |
| `--af-immersive-volume` | 同上 (`${volumePercent}%`) | 音量条宽度 |
| `--af-immersive-lyric-font-family` | 同上 | 歌词字体 |
| `--af-immersive-artwork-rgb` | 同上 (`var(--af-artwork-rgb, var(--af-accent-primary-rgb))`) | 环境色 radial-gradient、噪点纹理、封面光晕 |
| `--af-immersive-anim-scale` | 同上 (`animationIntensityScale`) | 调制所有沉浸动画时长 |
| `--af-scrolling-lyric-progress` | `ScrollingLyricsVisualizer.tsx` | 当前歌词行渐变填充进度 |

```ts
// ImmersiveLyricsOverlay.tsx 注入
style={{
  '--af-immersive-progress': `${progressPercent}%`,
  '--af-immersive-volume': `${volumePercent}%`,
  '--af-immersive-lyric-font-family': immersiveLyricFontFamily,
  '--af-immersive-artwork-rgb': 'var(--af-artwork-rgb, var(--af-accent-primary-rgb))',
  '--af-immersive-anim-scale': animationIntensityScale,
}}
// ScrollingLyricsVisualizer.tsx 逐词驱动
style={{ '--af-scrolling-lyric-progress': lineProgressPercent } as CSSProperties}
style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}
```

### 7.2 动画强度三档

`--af-immersive-anim-scale` 取自 `getLyricAnimationIntensityScale`，三档调制所有沉浸动画时长（用 `calc()` 做除法）：

| 强度 | scale | 含义 |
|---|---|---|
| `reduced` | 0.55 | 动画更快 / 更克制 |
| `normal` | 1 | 基准 |
| `enhanced` | 1.25 | 动画更慢 / 更舒展 |

时长 = `基准时长 / scale`，因此 `enhanced` 让动画变慢、更夸张，`reduced` 让动画更快、更平。

```ts
// services/lyricSettingsModel.ts（移动端同源逻辑，桌面经 tauri-bridge 取同一字符串配置）
export function getLyricAnimationIntensityScale(value: unknown): number {
  switch (normalizeLyricAnimationIntensity(value)) {
    case "reduced": return 0.55;
    case "enhanced": return 1.25;
    case "normal": default: return 1;
  }
}
```

```css
/* 封面呼吸：4s / scale */
animation: afImmersiveCoverBreath calc(4s / var(--af-immersive-anim-scale, 1)) ease-in-out infinite;
/* 歌词行过渡：220ms / scale */
transition: color calc(220ms / var(--af-immersive-anim-scale, 1)) ease,
            opacity calc(220ms / var(--af-immersive-anim-scale, 1)) ease,
            transform calc(220ms / var(--af-immersive-anim-scale, 1)) ease;
/* 环境色换歌过渡：0.8s / scale */
transition: opacity calc(0.8s / var(--af-immersive-anim-scale, 1)) ease;
```

### 7.3 封面呼吸

`.af-immersive-cover-glow` 在 `afImmersiveCoverBreath` keyframes 下做缩放 + 光晕呼吸，`inset:-20%; filter:blur(78px) saturate(1.45) contrast(1.04); transform:scale(1.14)`，周期 `calc(4s / anim-scale)`。

### 7.4 卡拉 OK 歌词可视化（纯 CSS）

| 技法 | 实现 |
|---|---|
| 当前行整体渐变填充 | `background-image: linear-gradient(90deg, rgba(248,250,252,.98) 0%, rgba(248,250,252,.98) var(--af-scrolling-lyric-progress,0%), rgba(248,250,252,.46) var(--af-scrolling-lyric-progress,0%), rgba(248,250,252,.46) 100%)` + `background-clip:text; -webkit-text-fill-color:transparent` |
| 逐词卡拉 OK | `clipPath: inset(0 ${100 - percent}% 0 0)` 按词裁剪填充层 |
| 活跃行缩放 | `transform: scale(0.92)` → `.af-active { transform: scale(1.04) }` |
| 译词 | `margin-top:5px`，活跃行透明度从 0.48 → 0.78 |

```css
.af-scrolling-lyric-line.af-active .af-scrolling-lyric-primary {
  color: transparent;
  background-image: linear-gradient(90deg, rgba(248,250,252,.98) 0%,
    rgba(248,250,252,.98) var(--af-scrolling-lyric-progress,0%),
    rgba(248,250,252,.46) var(--af-scrolling-lyric-progress,0%),
    rgba(248,250,252,.46) 100%);
  background-clip: text; -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  font-size: clamp(25px, 2.65vw, 36px); font-weight: 800;
  filter: drop-shadow(0 8px 16px rgba(0,0,0,0.24));
}
```

### 7.5 沉浸式标题栏

`.af-app:has(.af-immersive-lyrics) .af-window-titlebar`：标题栏 `background: transparent`，应用图标和标题隐藏，控件文字变暗 `rgba(248,250,252,0.72)`，hover 用 `rgba(255,255,255,0.1)`。原生全屏 `.af-immersive-native-fullscreen` 时标题栏整条 `display:none`。

```css
.af-app:has(.af-immersive-lyrics) .af-window-titlebar { color: rgba(248,250,252,0.78); background: transparent; }
.af-app:has(.af-immersive-lyrics) .af-window-app-mark,
.af-app:has(.af-immersive-lyrics) .af-window-title { display: none; }
.af-app:has(.af-immersive-lyrics) .af-window-control { color: rgba(248,250,252,0.72); }
```

---

## 8. 主题系统

### 8.1 桌面：`data-theme` + `themeStore.applyAppearance` 运行时写变量

主题状态用 Zustand `persist` 存（key `af-theme`），三态 `light/dark/auto`。`auto` 监听 `prefers-color-scheme` 媒体查询。`applyAppearance(theme, accentColor)` 做两件事：

1. `document.documentElement.setAttribute("data-theme", theme)` —— 触发 `theme.css` 的 `[data-theme="dark"]` 选择器，切换整组表面色 / 阴影 / 边框变量。
2. 用 `root.style.setProperty(...)` 运行时写入 accent 相关变量——这是用户自定义强调色的落地点：

| 写入变量 | 计算方式 |
|---|---|
| `--af-accent-primary` | 归一化后的 hex |
| `--af-accent-primary-rgb` | `r, g, b` 三数字字符串 |
| `--af-accent-secondary` | 与白色混合（dark 0.18 / light 0.1） |
| `--af-accent-hover` | 与黑色混合（dark 0.14 / light 0.1） |
| `--af-accent-gradient` | `linear-gradient(135deg, accent 0%, secondary 100%)` |
| `--af-accent-gradient-hover` | `linear-gradient(135deg, hover 0%, accent 100%)` |
| `--af-border-focus` | `rgba(r,g,b, dark?0.5:0.4)` |

旧强调色 `#1db954` 与 `#d83b40` 由 `migrateAccentColor` 自动迁移到 `#3bd877`。

```ts
const applyAppearance = (theme, accentColor = DEFAULT_ACCENT_COLOR) => {
  document.documentElement.setAttribute("data-theme", theme);
  const [red, green, blue] = hexToRgb(normalizeHexColor(accentColor));
  root.style.setProperty("--af-accent-primary", normalizedAccent);
  root.style.setProperty("--af-accent-primary-rgb", `${red}, ${green}, ${blue}`);
  root.style.setProperty("--af-accent-gradient", `linear-gradient(135deg, ${normalizedAccent} 0%, ${secondary} 100%)`);
  root.style.setProperty("--af-border-focus", `rgba(${red}, ${green}, ${blue}, ${theme === "dark" ? 0.5 : 0.4})`);
};
```

### 8.2 移动：`useThemeStore` + `getThemePalette`，无 Context

主题状态同样用 Zustand，持久化到 `AsyncStorage`（key `auralflow.mobile.theme`），额外存 `backgroundImageUri` 与 `backgroundOpacity`。`getResolvedTheme(mode, systemTheme)` 把 `system` 解析成 `light/dark`。无 React Context provider——每个 `ui/` 原语各自订阅 `useThemeStore`，palette 在每次渲染重算（`buildThemePalette` 极轻，故无需 memo）。

夜间自定义背景图有遮罩下限 `DARK_BACKGROUND_OPACITY_FLOOR = 0.72`：夜间文字是浅色 `#f8fafc`，遮罩低于此值会被亮背景图压到对比度不足。

```ts
export function getResolvedTheme(mode: ThemeMode, systemTheme: ResolvedTheme): ResolvedTheme {
  return mode === "system" ? systemTheme : mode;
}
export function getThemePalette(theme: ResolvedTheme, accentColor = DEFAULT_ACCENT_COLOR): ThemePalette {
  return buildThemePalette(theme, accentColor);
}
// 组件内
const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
```

---

## 9. 响应式与无障碍

### 9.1 桌面

| 机制 | 实现 |
|---|---|
| 窄屏断点 | `@media (max-width: 768px)`：`.af-main-container` padding 8px、`.af-sidebar` 收到 64px、隐藏 `.af-logo-text` 与 `.af-sidebar-link span`（仅留图标） |
| 沉浸歌词窄屏 | `@media (max-width: 900px)`：歌词行 `padding-inline: 6px` |
| 减弱动效 | `@media (prefers-reduced-motion: reduce)`：`*` 与 `::before/::after` 的 `animation-duration` / `transition-duration` 全部 `0.01ms !important`；沉浸歌词行 `transition: none` |
| Tooltip | `data-tooltip` 属性驱动零 DOM 浮层（`::after` 渲染，零延迟、跟随主题），`data-tooltip-placement` 控制方向：默认 top / `bottom` / `bottom-end`；`[data-tooltip]:disabled` 隐藏 |
| 焦点 | `:focus-visible` 用 `outline: 2px solid var(--af-border-focus)` |
| 滚动条 | `scrollbar-width: thin` + `scrollbar-color: var(--af-border-primary) transparent`，webkit `::-webkit-scrollbar-thumb` 用 `--af-border-primary` |

```css
@media (max-width: 768px) {
  .af-main-container { padding: 8px; }
  .af-sidebar { width: 64px; padding: 16px 8px; }
  .af-logo-text, .af-sidebar-link span { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
[data-tooltip]::after { content: attr(data-tooltip); /* 零 DOM tooltip */ }
[data-tooltip]:disabled::after { display: none; }
```

### 9.2 移动

| 机制 | 实现 |
|---|---|
| 触摸目标 | `touch.minTarget: 44`；`iconButtonHitSlop(size)` / `controlHitSlop(size)` 在容器小于 44 时四边扩展 hitSlop 补足 |
| 图标按键规格 | `iconButton` 四档（sm/md/lg/xl），容器与图标字号成对定义，统一前全 app 有 5 种容器 + 13 种图标尺寸的混乱 |
| 触摸反馈 | `Touchable` 组件提供 `scale` / `opacity` 可见反馈，解决裸 `Pressable` 无反馈问题；原语内 `pressed && styles.pressed`（opacity 0.76） |
| a11y 角色 | 所有原语普遍设 `accessibilityRole`（`button` 等）+ `accessibilityLabel`（Button 缺省回退到 `label`）+ `accessibilityState`（`disabled`/`selected`/`busy`） |
| 加载态 | `accessibilityLiveRegion="polite"` 广播加载（`HomeScreen` 占位、`ScreenState`、`CacheSettings`） |
| 错误态 | `accessibilityRole="alert"`（`PlaybackErrorState`、`ScreenState`、`WebDavSyncScreen`） |
| 进度条 | `accessibilityValue={{ min, now, max, text }}`（`MiniProgressBar`、`LyricSettingsScreen` 滑块） |
| 平台分支 | `isAndroid = Platform.OS === "android"`（`tokens.ts` 导出，供组件按平台调样式） |

```ts
export const touch = { minTarget: 44, iconButton: 36 } as const;
export function iconButtonHitSlop(size: IconButtonSize) {
  const inset = Math.max(0, (touch.minTarget - iconButton[size].size) / 2);
  return { top: inset, bottom: inset, left: inset, right: inset };
}
// 原语内
<Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel}
           accessibilityState={{ ...accessibilityState, disabled: isDisabled, selected, busy: loading }}
           hitSlop={controlHitSlop(size)} />
```

---

## 10. 动效系统

### 10.1 桌面

| 动画 | 实现 |
|---|---|
| `slideIn` | `@keyframes slideIn`：`opacity 0 → 1`，`translateY(20px) → 0`；`.af-animate-slide-in` 用 `0.4s cubic-bezier(0.4,0,0.2,1)` |
| `af-spin` | `@keyframes af-spin`：`rotate(0deg → 360deg)`；`.af-spin` 用 `1s linear infinite` |
| 封面呼吸 | `afImmersiveCoverBreath`：周期 `calc(4s / var(--af-immersive-anim-scale,1)) ease-in-out infinite` |
| 歌词行 | 颜色 / 透明度 / 缩放过渡，时长 `calc(220ms / anim-scale)` |
| 环境色换歌 | `transition: opacity calc(0.8s / anim-scale) ease` |
| 统一减效 | `@media (prefers-reduced-motion: reduce)` 全局归零 + 沉浸歌词 `transition: none` |

```css
@keyframes slideIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
.af-animate-slide-in { animation: slideIn 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
@keyframes af-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.af-spin { animation: af-spin 1s linear infinite; }
```

### 10.2 移动

| 动画 | 实现 |
|---|---|
| 封面旋转 | `Animated.timing(spinValue, { duration: 25000 * (1 - value), useNativeDriver: true, easing: Easing.linear })`，每圈 25s；`isPlaying` 控制 start/stop；`coverSpin` 开关切换（关时 `coverSize/2` 圆角→8） |
| 旋转插值 | `spinValue.interpolate({ inputRange:[0,1], outputRange:["0deg","360deg"] })` → `transform:[{rotate:spin}]` |
| 跑马灯 | `Marquee` 组件：单份文本 + `translateX` 滚出后瞬移归位循环，用于沉浸式顶栏标题（长曲名） |
| 活跃行缩放 | `buildLyricAnimationModel` 给 `activeScale = 1 + 0.04 * scale`，`lineTransitionDurationMs = round(180 * scale)`；`reduced` 时 scale 0.55，`enhanced` 时 1.25 |
| PagerView | `react-native-pager-view`，2 页（封面 \| 歌词），`pagerViewRef` 控制翻页，`isLyricsPage` 状态 |

```ts
// ImmersiveCoverPage.tsx
const createAnimation = useCallback(() =>
  Animated.timing(spinValue, {
    duration: 25000 * (1 - value), // 25s per rotation
    useNativeDriver: true,
    easing: Easing.linear,
  }), [spinValue]);
const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
// lyricSettingsModel.ts
const scale = getLyricAnimationIntensityScale(input.intensity); // reduced 0.55 / normal 1 / enhanced 1.25
return { activeScale: Math.round((1 + 0.04 * scale) * 100) / 100,
         lineTransitionDurationMs: Math.round(180 * scale) };
```

---

## 11. 图标

两端均使用 lucide，版本锁定 `^0.460.0`。

| 端 | 包 | 位置 |
|---|---|---|
| 桌面 | `lucide-react` | `desktop/package.json` `^0.460.0` |
| 移动 | `lucide-react-native` | `apps/mobile/package.json` `^0.460.0` |

```json
// desktop/package.json
"lucide-react": "^0.460.0"
// apps/mobile/package.json
"lucide-react-native": "^0.460.0"
```

桌面通过 `af-sidebar-link svg`、`.af-control-btn` 等容器承载；移动通过 `IconButton` 的 `render({ size, color })` 渲染（如 `render={({ size, color }) => <Play size={size} color={color} />}`）。

---

## 附录 · 文件索引

| 类别 | 文件 |
|---|---|
| 桌面 CSS 入口 | `desktop/src/index.css`（711 行：reset + 布局 shell + 玻璃 / 沉浸规则 + 动画） |
| 桌面分域 CSS | `desktop/src/styles/{theme,layout,player,home,local-music,search,settings,playlists,buttons,tooltip}.css`（10 个） |
| 桌面主题注入 | `desktop/src/stores/themeStore.ts` |
| 桌面沉浸注入 | `desktop/src/components/ImmersiveLyricsOverlay.tsx`、`ScrollingLyricsVisualizer.tsx` |
| 移动 token | `apps/mobile/src/theme/tokens.ts`、`theme/controlTokens.ts` |
| 移动调色板 | `apps/mobile/src/services/themePaletteModel.ts` |
| 移动主题 store | `apps/mobile/src/stores/themeStore.ts` |
| 移动原语 | `apps/mobile/src/components/ui/{Button,Chip,IconButton,ListItemButton,ModalActions}.tsx` |
| 移动兼容层 | `apps/mobile/src/components/IconButton.tsx`、`components/ActionButton` |
| 移动动效模型 | `apps/mobile/src/services/lyricSettingsModel.ts`、`stores/lyricSettingsStore.ts` |
| 移动沉浸 | `apps/mobile/src/screens/ImmersiveLyricsScreen.tsx`、`screens/immersive/*` |
