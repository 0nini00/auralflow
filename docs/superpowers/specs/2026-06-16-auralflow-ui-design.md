# AuralFlow 桌面 UI 设计规格

日期：2026-06-16
方向：Apple Music / YouTube Music 风格（明亮、圆润、大封面、底部播放条）

---

## 1. 设计目标

把 AuralFlow 从当前原型界面升级为一个看起来像现代流媒体桌面客户端的播放器。保留已有的 Tauri v2 + React + Vite + Zustand 技术栈，仅改造 UI 层。

## 2. 整体布局

```
┌─────────────────────────────────────────────────────────┐
│  Sidebar │  Header (search + user + theme)              │
│          ├──────────────────────────────────────────────┤
│  220px   │  Main scrollable content                      │
│  fixed   │                                               │
│          │                                               │
└──────────┴──────────────────────────────────────────────┘
│              Bottom Player Bar (~80px)                  │
└─────────────────────────────────────────────────────────┘
```

* 左侧固定 Sidebar，宽度 220px，桌面端常驻不可折叠。
* 顶部 64px Header，放全局搜索框、主题切换、用户入口。
* 主内容区自由垂直滚动。
* 底部播放条固定在窗口底部。

## 3. 视觉基调

### 3.1 色彩 Token

| Token | 浅色模式 | 深色模式 | 用途 |
|---|---|---|---|
| `--bg-page` | `#ffffff` | `#0f0f12` | 页面背景 |
| `--bg-surface` | `#f5f5f7` | `#1a1a1e` | 卡片、输入框、Sidebar |
| `--text-primary` | `#1d1d1f` | `#f5f5f7` | 标题、主要文字 |
| `--text-secondary` | `#6e6e73` | `#a1a1a6` | 描述、艺术家名 |
| `--accent` | `linear-gradient(135deg, #c084fc, #6366f1)` | 同左，饱和度 +10% | 强调按钮、进度条、高亮项 |
| `--border` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.08)` | 分隔线 |
| `--shadow-card` | `0 4px 20px rgba(0,0,0,0.06)` | `0 4px 20px rgba(0,0,0,0.25)` | 悬浮卡片 |

### 3.2 字体与排版

* 字体栈：`system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
* 标题：600 weight；正文：400 weight
* 基础字号 16px，次文字 14px，小标签 12px

### 3.3 圆角与层级

* 按钮/输入框：8–999px（药丸形用于搜索框）
* 卡片/封面：12–16px
* z-index 层级：PlayerBar 100，Header 50，Sidebar 40，Modal/Overlay 200

## 4. 组件规格

### 4.1 Sidebar

* 宽度 220px，高度 100vh，不随主内容滚动。
* 顶部：AuralFlow Logo + 名称。
* 中部导航项：发现、搜索、我的歌单、每日推荐、私人 FM。
* 底部：设置。
* 当前项：左侧 4px 强调色竖条 + surface 背景高亮。
* 图标统一使用 lucide-react，stroke-width 1.5。

### 4.2 Header

* 高度 64px，背景与页面背景一致，底部一条极淡 border。
* 左侧：当前页面标题。
* 中间：全局搜索框（placeholder"搜索音乐、歌单、歌手…"）。
* 右侧：主题切换按钮、用户头像占位。

### 4.3 首页 / 发现（HomeView）

* **Hero Banner**
  * 高度 280px，圆角 16px，占主区域全宽。
  * 左侧渐变遮罩，文案："私人 FM" + "根据你的品味，发现下一首好歌" + "开始播放"按钮。
  * 背景使用一张模糊的氛围图或渐变（第一阶段暂不使用真实专辑取色）。
* **最近播放**
  * 横向滚动列表，卡片宽度 160px，封面 160×160，圆角 12px。
  * hover 显示播放按钮覆盖在封面右下角。
* **推荐歌单**
  * 网格布局，桌面 4 列，平板 3 列，窗口更窄时 2 列。
  * 每个卡片：封面 + 标题 + 描述。
  * hover 时 translateY(-2px) + 阴影加深。
* **空状态**
  * 当没有最近播放时显示"你还没有播放过歌曲" + "去搜索"按钮。

### 4.4 搜索页（SearchView）

* 顶部药丸形大搜索框，居中或靠左，宽度最大 640px。
* 分类标签：单曲 / 歌单 / 歌手（第一阶段只实现单曲）。
* 结果列表：
  * 每项高度 64px，左侧封面 48px，中间歌曲名/歌手，右侧播放/加入队列按钮。
  * hover 时背景变为 surface。
* 加载状态：骨架屏 shimmer。
* 无结果：提示文字 + 返回首页。

### 4.5 底部播放条（PlayerBar）

* 高度 80px，背景使用 surface + 顶部 border，始终位于窗口底部。
* 左侧：当前播放封面 56px + 歌曲名 + 歌手名。
* 中间：上一首 / 播放暂停 / 下一首 + 当前时间 / 进度条 / 总时长。
* 进度条高度 4px，hover 时高度 6px，thumb 显示。
* 右侧：收藏、音量滑块、播放队列按钮。
* 拖拽进度时显示时间 tooltip。

## 5. 动效规格

* 页面切换：淡入 200ms ease-out。
* 卡片 hover：translateY(-2px) + shadow 加深，200ms ease-out。
* 按钮 press：scale(0.97)，100ms ease-out。
* 进度条 thumb：opacity 0 → 1，200ms，hover/拖拽时显示。
* 锁骨屏 shimmer：背景位移动画，1.5s infinite。
* 所有动画遵守 `prefers-reduced-motion`，在该偏好下淡出或禁用。

## 6. 无障碍检查点

* 主文字对背景对比度 ≥ 7:1，次文字 ≥ 4.5:1。
* 图标按钮均有 aria-label。
* 焦点环保持可见（outline 2px accent）。
* 所有可点击元素最小 44×44px。
* 搜索框有 label（sr-only）。

## 7. 第一阶段范围

### 7.1 本期实现

1. 全局 CSS token + 深色/浅色主题切换。
2. `Layout` 组件：Sidebar + Header + PlayerBar + Main 滚动区。
3. `HomeView`：Hero + 最近播放 + 推荐歌单。
4. `SearchView`：搜索框 + 结果列表。
5. `PlayerBar`：按新视觉重写。
6. 路由切换：发现 / 搜索 / 我的歌单 / 每日推荐 / 私人 FM / 设置。

### 7.2 本期不实装（占位）

* 我的歌单、每日推荐、私人 FM、设置页面：点击后展示"即将上线"提示。
* 真实专辑取色动态主题：后续接入。
* 全屏播放页：保留入口，第一阶段先用底部播放条。

## 8. 技术约束

* 继续使用 `lucide-react` 作为图标库。
* 不引入 UI 组件库（如 shadcn/ui），以保持代码可控。
* 所有新组件用 TypeScript + CSS Modules（或一个全局样式文件），避免内联样式蔓延。
* store 接口保持不变：`usePlayerStore` + `playerEngine`。

## 9. 验收标准

* `npm run typecheck` 通过。
* `npm run build` 通过。
* 跑 `pnpm tauri:dev` 后能看到新界面，切换页面无白屏。
* 搜索、播放、暂停、切歌、调音量功能保持可用。
* 在浅色/深色模式下，所有文字对比度肉眼清晰可读。

---

批准人：delusion
批准状态：已批准
