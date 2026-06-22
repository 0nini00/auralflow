# AuralFlow UI 重构实现计划

> **For agentic workers:** Use inline execution task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 把 AuralFlow 从当前原型界面升级为 Apple Music / YouTube Music 风格的现代桌面音乐播放器 UI。

**Architecture:** 左侧固定 Sidebar + 顶部 Header + 可滚动主内容区 + 底部全局 PlayerBar。使用 CSS 变量做浅色/深色主题，React Router 做视图切换，所有新组件为纯展示层，不改动 playerEngine 与 playerStore 的核心接口。

**Tech Stack:** React 18 + TypeScript + Vite + React Router + Zustand + lucide-react

---

## 文件结构

新建/修改清单：

| 文件 | 责任 |
|---|---|
| `src/styles/theme.css` | 全局 CSS 变量、重置、工具类 |
| `src/main.tsx` | 引入 theme.css |
| `src/components/IconButton.tsx` | 统一图标按钮（带 aria-label、hover、press 反馈） |
| `src/components/MusicCard.tsx` | 歌曲/歌单卡片 |
| `src/components/SectionHeader.tsx` | 区段标题 + "查看全部" |
| `src/components/Layout/Layout.tsx` | 页面外壳 |
| `src/components/Layout/Sidebar.tsx` | 左侧导航栏 |
| `src/components/Layout/Header.tsx` | 顶部标题栏 + 搜索框 + 主题切换 |
| `src/views/HomeView.tsx` | 发现首页 |
| `src/views/SearchView.tsx` | 搜索结果页（从 App.tsx 迁移搜索逻辑） |
| `src/views/PlaceholderView.tsx` | 我的歌单/每日推荐/私人 FM/设置占位 |
| `src/components/PlayerBar.tsx` | 底部播放控制条重写 |
| `src/App.tsx` | 路由入口 |
| `src/stores/playerStore.ts` | 增加最近播放记录 |

---

## Task 1: 全局主题样式

**Files:**
- Create: `src/styles/theme.css`

- [ ] **Step 1: 写入 theme.css**

覆盖浅色/深色变量、body 重置、滚动条、减少动画媒体查询。

- [ ] **Step 2: 验证文件已创建**

命令：`ls auralflow/src/styles/theme.css`
Expected: file exists

---

## Task 2: 组件基础：IconButton、MusicCard、SectionHeader

**Files:**
- Create: `src/components/IconButton.tsx`
- Create: `src/components/MusicCard.tsx`
- Create: `src/components/SectionHeader.tsx`
- Modify: `src/main.tsx` 引入 theme.css

- [ ] **Step 1: 实现 IconButton**

Props: `icon: LucideIcon`, `ariaLabel: string`, `onClick?`, `active?`, `size?: "sm" | "md" | "lg"`, `className?`

- [ ] **Step 2: 实现 MusicCard**

Props: `title`, `subtitle`, `coverUrl?`, `onClick?`, `onPlay?`
尺寸：`size?: "sm" | "md" | "lg"`。

- [ ] **Step 3: 实现 SectionHeader**

Props: `title`, `action? { label, onClick }`。

- [ ] **Step 4: 更新 main.tsx**

在 `import App from "./App"` 前加入 `import "./styles/theme.css"`。

- [ ] **Step 5: 运行 typecheck**

命令：`cd auralflow && npm run typecheck`
Expected: pass

---

## Task 3: 布局外壳

**Files:**
- Create: `src/components/Layout/Layout.tsx`
- Create: `src/components/Layout/Sidebar.tsx`
- Create: `src/components/Layout/Header.tsx`

- [ ] **Step 1: 实现 Sidebar**

固定宽度 220px，包含 Logo、导航项（发现/搜索/我的歌单/每日推荐/私人 FM/设置）。当前项高亮。

- [ ] **Step 2: 实现 Header**

高度 64px，左侧页面标题，中间全局搜索入口（受控 input，回车触发搜索导航），右侧主题切换按钮、用户头像占位。

- [ ] **Step 3: 实现 Layout**

把 Sidebar、Header、`<Outlet />`、PlayerBar 组合成页面骨架。

- [ ] **Step 4: 运行 typecheck**

命令：`cd auralflow && npm run typecheck`
Expected: pass

---

## Task 4: 视图页面

**Files:**
- Create: `src/views/HomeView.tsx`
- Create: `src/views/PlaceholderView.tsx`
- Modify: `src/components/PlayerBar.tsx`（下一步重写，不影响本任务编译）

- [ ] **Step 1: 实现 HomeView**

包含：Hero Banner（私人 FM CTA）、最近播放横向列表、推荐歌单网格。使用 `MusicCard` 和 `SectionHeader`。

- [ ] **Step 2: 实现 PlaceholderView**

Props: `title`, `description?`。点击 Sidebar 中未实装页面时显示"即将上线"。

- [ ] **Step 3: 运行 typecheck**

命令：`cd auralflow && npm run typecheck`
Expected: pass

---

## Task 5: 搜索页迁移

**Files:**
- Create: `src/views/SearchView.tsx`
- Modify: `src/App.tsx`
- Delete: 不再需要的 `App.tsx` 内嵌搜索逻辑

- [ ] **Step 1: 把搜索逻辑从 App.tsx 迁移到 SearchView.tsx**

保留关键词输入、搜索按钮、结果列表、解析 URL 调试功能。UI 使用新设计：药丸搜索框 + 结果列表。

- [ ] **Step 2: 重写 App.tsx 为 Router 入口**

使用 `react-router-dom` 的 `BrowserRouter` + `Routes` + `Route`，Layout 包裹各视图。

- [ ] **Step 3: 运行 typecheck + build**

命令：`cd auralflow && npm run typecheck && npm run build`
Expected: both pass

---

## Task 6: PlayerBar 重写

**Files:**
- Modify: `src/components/PlayerBar.tsx`

- [ ] **Step 1: 按新视觉重写 PlayerBar**

左侧当前歌曲信息，中间播放控制 + 进度条，右侧音量 + 队列按钮。高度 80px，surface 背景，顶部 border。

- [ ] **Step 2: 运行 typecheck + build**

命令：`cd auralflow && npm run typecheck && npm run build`
Expected: both pass

---

## Task 7: 最近播放与主题切换

**Files:**
- Modify: `src/stores/playerStore.ts`
- Modify: `src/components/Layout/Header.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: 在 playerStore 中记录最近播放**

新增 `recent: MusicInfo[]`，`addRecent(music)` 在播放新歌曲时 push 到开头，最多 20 条。

- [ ] **Step 2: Header 主题切换**

通过 CSS class 切换 `data-theme="dark" | "light"`，默认跟随系统 `prefers-color-scheme`。

- [ ] **Step 3: HomeView 展示最近播放**

从 `usePlayerStore((s) => s.recent)` 读取并渲染横向列表。

- [ ] **Step 4: 运行 typecheck + build**

命令：`cd auralflow && npm run typecheck && npm run build`
Expected: both pass

---

## Task 8: 最终验证

- [ ] **Step 1: 类型检查**

命令：`cd auralflow && npm run typecheck`
Expected: pass

- [ ] **Step 2: 生产构建**

命令：`cd auralflow && npm run build`
Expected: pass

- [ ] **Step 3: 开发模式启动（可选，手动验证）**

命令：`cd auralflow && pnpm tauri:dev`
Expected: 窗口打开，Sidebar、搜索、播放条可见，切换页面正常。

---

## Self-Review Checklist

- [x] Spec coverage：所有设计区域（Sidebar/Header/Home/Search/PlayerBar/Theme）均有对应任务。
- [x] Placeholder scan：没有 TBD/TODO，每步都有具体文件和命令。
- [x] Type consistency：store 接口 `recent` 在 Task 7 添加，PlayerBar/HomeView 消费；PlayerStore 接口同步更新。
