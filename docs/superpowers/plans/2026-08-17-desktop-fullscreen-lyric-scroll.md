# Desktop Fullscreen Lyric Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** 为桌面沉浸播放页增加完整歌词滚动、键盘控制和可靠的原生全屏同步。

**Architecture:** 保留现有歌词时间轴与逐字高亮，新增纯滚动状态机、React Hook 和列表组件。Tauri 全屏与键盘映射分别封装。

**Tech Stack:** React 18、TypeScript、Vitest、Tauri v2、CSS。

## Global Constraints

- 不引入新的运行时依赖。
- 不把 DOM 节点写入 Zustand。
- 恢复时间 3000ms，相邻换行延迟与动画均为 600ms，视觉锚点为 42%。

### Task 1: 测试基础与滚动模型

**Files:** `desktop/package.json`、`desktop/src/services/lyrics/autoScrollModel.test.ts`、`autoScrollModel.ts`

- [x] 写相邻换行、seek、手动恢复、重定位、首尾钳制失败测试。
- [x] 确认测试因模块缺失失败。
- [x] 实现纯滚动控制器与锚点计算并确认测试通过。

### Task 2: 列表与滚动 Hook

**Files:** `desktop/src/hooks/useLyricAutoScroll.ts`、`desktop/src/components/playerVisualizers/ScrollingLyricsVisualizer.tsx`、`PlayerVisualizerRenderer.tsx`、`types.ts`、`ImmersiveLyricsOverlay.tsx`、`player.css`

- [x] 实现可取消的 requestAnimationFrame 滚动。
- [x] 渲染完整歌词、译文和逐字高亮。
- [x] 接入滚轮、指针拖动、3 秒恢复和 ResizeObserver 重定位。

### Task 3: 键盘控制

**Files:** `desktop/src/services/playback/immersiveKeyboard.test.ts`、`immersiveKeyboard.ts`、`ImmersiveLyricsOverlay.tsx`

- [x] 写失败测试并实现无副作用键盘动作解析。
- [x] 接入播放、seek、音量、切歌、静音和关闭动作。

### Task 4: Tauri 全屏同步

**Files:** `desktop/src/hooks/useNativeFullscreen.ts`、`ImmersiveLyricsOverlay.tsx`

- [x] 查询并监听真实全屏状态。
- [x] 记录沉浸页全屏所有权并在关闭时按所有权清理。

### Task 5: 验证

- [x] 桌面端单元测试。
- [x] `pnpm desktop:typecheck`。
- [x] `pnpm desktop:build`。
- [x] `git diff --check` 与任务文件 diff 审计。
