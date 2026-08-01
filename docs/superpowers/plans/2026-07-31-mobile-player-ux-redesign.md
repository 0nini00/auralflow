# AuralFlow Android 播放体验移动端优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 参考 lx-netease-music-mobile，将播放引擎、沉浸式播放、播放控制从桌面端移植风格改造为移动端原生体验：滑动切换封面/歌词 + 控制区极简 + 播放引擎弱化音效 + 手势化交互。

**Architecture:** ImmersiveLyricsScreen 重构为 PagerView 滑动切换封面/歌词；ImmersiveTransport 精简控制区（auxRow 收进 MoreBtn）；PlayerBar 添加顶部细进度条和上滑手势；音效功能 UI 入口收进菜单。

**Tech Stack:** React Native 0.86, React 19, react-native-pager-view, Reanimated, Zustand, lucide-react-native

## Global Constraints

- React Native 0.86, React 19, react-native-pager-view
- 不影响桌面端代码
- 不改变后端 API/data models
- 保持深链接格式兼容
- All UI text in Chinese (matching existing codebase)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `apps/mobile/src/screens/ImmersiveLyricsScreen.tsx` | Modify | 重构为 PagerView 滑动切换封面/歌词 |
| `apps/mobile/src/screens/immersive/ImmersiveStage.tsx` | Modify | 简化为封面页（移除点击切换逻辑） |
| `apps/mobile/src/screens/immersive/ImmersiveCoverPage.tsx` | Create | 新建独立封面页组件（参考 lx Pic.tsx） |
| `apps/mobile/src/screens/immersive/ImmersiveTransport.tsx` | Modify | 精简控制区，auxRow 收进 MoreBtn |
| `apps/mobile/src/screens/immersive/ImmersiveMoreMenu.tsx` | Create | 新建 MoreBtn 菜单组件 |
| `apps/mobile/src/components/PlayerBar.tsx` | Modify | 添加顶部细进度条和上滑手势 |
| `apps/mobile/src/components/MiniProgressBar.tsx` | Create | 新建细进度条组件 |
| `apps/mobile/src/components/LyricView.tsx` | Modify | 添加双指缩放字号和逐行滚动动画 |
| `apps/mobile/src/screens/immersive/useImmersiveController.ts` | Modify | 添加 PagerView 状态管理 |
| `apps/mobile/src/theme/tokens.ts` | Modify | 添加更多相关 token |

---

### Task 1: 安装依赖（如果需要）

**Files:**
- Modify: `apps/mobile/package.json`

检查 `react-native-pager-view` 是否已安装（之前 UI/UX 重构时已安装）。如未安装则执行：

- [ ] **Step 1: 检查依赖**

```bash
cd apps/mobile && pnpm ls react-native-pager-view
```

- [ ] **Step 2: 如果未安装则添加**

```bash
cd apps/mobile && pnpm add react-native-pager-view
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/package.json apps/mobile/pnpm-lock.yaml
git commit -m "chore(mobile): ensure pager-view dependency installed"
```

---

### Task 2: 创建 MiniProgressBar 组件

**Files:**
- Create: `apps/mobile/src/components/MiniProgressBar.tsx`

参考 lx 的 `src/components/player/PlayerBar/components/MiniProgressBar.tsx`，创建顶部细进度条。

- [ ] **Step 1: 创建 MiniProgressBar 组件**

```typescript
// apps/mobile/src/components/MiniProgressBar.tsx
import React from "react";
import { View, StyleSheet } from "react-native";
import { usePlayerStore } from "@/stores/playerStore";
import { useThemeStore, getResolvedTheme, getThemePalette } from "@/stores/themeStore";

export function MiniProgressBar() {
  const position = usePlayerStore((state) => state.position);
  const duration = usePlayerStore((state) => state.duration);
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);

  const progress = duration > 0 ? position / duration : 0;

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.progress,
          {
            width: `${progress * 100}%`,
            backgroundColor: palette.primary,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 2,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  progress: {
    height: "100%",
  },
});
```

- [ ] **Step 2: 测试组件渲染**

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/MiniProgressBar.tsx
git commit -m "feat(mobile): add MiniProgressBar component"
```

---

### Task 3: 重构 PlayerBar 布局

**Files:**
- Modify: `apps/mobile/src/components/PlayerBar.tsx`

将进度条移到顶部细线，简化控制按钮，添加上滑手势。

- [ ] **Step 1: 导入 MiniProgressBar**

- [ ] **Step 2: 替换原有 ProgressBar 为 MiniProgressBar 在顶部**

- [ ] **Step 3: 简化控制按钮（移除 utilityControls 中的播放模式和上一首/下一首，只保留播放/暂停和更多）**

- [ ] **Step 4: 添加上滑手势（PanResponder）打开播放列表**

- [ ] **Step 5: 添加长按手势跳转列表位置**

- [ ] **Step 6: 添加顶部圆角样式**

- [ ] **Step 7: 测试手势响应**

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/components/PlayerBar.tsx
git commit -m "refactor(mobile): simplify PlayerBar with mini progress and gestures"
```

---

### Task 4: 创建 ImmersiveCoverPage 组件

**Files:**
- Create: `apps/mobile/src/screens/immersive/ImmersiveCoverPage.tsx`

参考 lx 的 `src/screens/PlayDetail/Vertical/Pic.tsx`，创建独立封面页组件。

- [ ] **Step 1: 创建 ImmersiveCoverPage 组件**

```typescript
// apps/mobile/src/screens/immersive/ImmersiveCoverPage.tsx
import React, { useEffect, useRef, useCallback } from "react";
import { View, Animated, Easing, Pressable } from "react-native";
import { Music2 } from "lucide-react-native";
import type { ThemePalette } from "@/stores/themeStore";
import { CachedImage } from "@/components/CachedImage";
import { styles } from "@/screens/immersive/immersiveStyles";

export interface ImmersiveCoverPageProps {
  artwork?: string;
  coverSize: number;
  isPlaying: boolean;
  palette: ThemePalette;
  onLongPress?: () => void;
}

export function ImmersiveCoverPage({
  artwork,
  coverSize,
  isPlaying,
  palette,
  onLongPress,
}: ImmersiveCoverPageProps) {
  const spinValue = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const isAnimating = useRef(false);

  const createAnimation = useCallback((value: number) => {
    return Animated.timing(spinValue, {
      toValue: 1,
      duration: 25000 * (1 - value), // 25s per rotation
      easing: Easing.linear,
      useNativeDriver: true,
    });
  }, [spinValue]);

  const startAnimation = useCallback(() => {
    if (isAnimating.current || !isPlaying) return;
    isAnimating.current = true;
    spinValue.stopAnimation(value => {
      animationRef.current = createAnimation(value);
      animationRef.current.start(({ finished }) => {
        if (finished && isAnimating.current) {
          spinValue.setValue(0);
          isAnimating.current = false;
          startAnimation();
        }
      });
    });
  }, [spinValue, createAnimation, isPlaying]);

  const stopAnimation = useCallback(() => {
    if (!isAnimating.current) return;
    isAnimating.current = false;
    animationRef.current?.stop();
    animationRef.current = null;
    spinValue.stopAnimation();
  }, [spinValue]);

  useEffect(() => {
    if (isPlaying) {
      startAnimation();
    } else {
      stopAnimation();
    }
  }, [isPlaying, startAnimation, stopAnimation]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <View style={styles.coverPageContainer}>
      <Pressable onLongPress={onLongPress}>
        <View
          style={[
            styles.coverFrame,
            {
              width: coverSize,
              height: coverSize,
              borderRadius: coverSize / 2,
            },
          ]}
        >
          <Animated.View
            style={{ width: "100%", height: "100%", transform: [{ rotate: spin }] }}
          >
            {artwork ? (
              <CachedImage
                uri={artwork}
                style={[
                  styles.coverImage,
                  { borderRadius: coverSize / 2 },
                ]}
                fallback={
                  <View
                    style={[
                      styles.coverImage,
                      styles.coverPlaceholder,
                      { backgroundColor: palette.surfaceStrong },
                    ]}
                  >
                    <Music2 size={48} color={palette.primary} />
                  </View>
                }
              />
            ) : (
              <View
                style={[
                  styles.coverImage,
                  styles.coverPlaceholder,
                  { backgroundColor: palette.primary },
                ]}
              >
                <Music2 size={48} color={palette.primaryText} />
              </View>
            )}
          </Animated.View>
        </View>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 2: 测试封面旋转动画**

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/screens/immersive/ImmersiveCoverPage.tsx
git commit -m "feat(mobile): add ImmersiveCoverPage with rotation animation"
```

---

### Task 5: 创建 ImmersiveMoreMenu 组件

**Files:**
- Create: `apps/mobile/src/screens/immersive/ImmersiveMoreMenu.tsx`

创建 MoreBtn 菜单组件，收进 auxRow 的辅助功能。

- [ ] **Step 1: 创建 ImmersiveMoreMenu 组件**

```typescript
// apps/mobile/src/screens/immersive/ImmersiveMoreMenu.tsx
import React from "react";
import { View, Text, Pressable, Modal, StyleSheet } from "react-native";
import {
  Heart,
  FolderPlus,
  Share2,
  Volume2,
  VolumeX,
  Timer,
  ListMusic,
  Languages,
  Image,
  Sliders,
} from "lucide-react-native";
import type { ThemePalette } from "@/stores/themeStore";

export interface ImmersiveMoreMenuProps {
  visible: boolean;
  onClose: () => void;
  palette: ThemePalette;
  // 功能按钮
  canLike?: boolean;
  isLiked?: boolean;
  onLike?: () => void;
  canAddToPlaylist?: boolean;
  onAddToPlaylist?: () => void;
  canShare?: boolean;
  onShare?: () => void;
  onOpenVolume?: () => void;
  volumeMuted?: boolean;
  onOpenSleep?: () => void;
  sleepLabel?: string;
  sleepActive?: boolean;
  onOpenQueue?: () => void;
  queueLabel?: string;
  onToggleTranslation?: () => void;
  translationActive?: boolean;
  onTogglePosterMode?: () => void;
  posterMode?: boolean;
  onOpenSoundEffect?: () => void;
}

export function ImmersiveMoreMenu({
  visible,
  onClose,
  palette,
  canLike,
  isLiked,
  onLike,
  canAddToPlaylist,
  onAddToPlaylist,
  canShare,
  onShare,
  onOpenVolume,
  volumeMuted,
  onOpenSleep,
  sleepLabel,
  sleepActive,
  onOpenQueue,
  queueLabel,
  onToggleTranslation,
  translationActive,
  onTogglePosterMode,
  posterMode,
  onOpenSoundEffect,
}: ImmersiveMoreMenuProps) {
  const menuItems = [
    canLike && {
      icon: Heart,
      label: isLiked ? "取消喜欢" : "喜欢",
      onPress: onLike,
      active: isLiked,
    },
    canAddToPlaylist && {
      icon: FolderPlus,
      label: "加入歌单",
      onPress: onAddToPlaylist,
    },
    canShare && {
      icon: Share2,
      label: "分享",
      onPress: onShare,
    },
    {
      icon: volumeMuted ? VolumeX : Volume2,
      label: "音量",
      onPress: onOpenVolume,
    },
    {
      icon: Timer,
      label: sleepLabel || "睡眠定时",
      onPress: onOpenSleep,
      active: sleepActive,
    },
    {
      icon: ListMusic,
      label: queueLabel || "播放列表",
      onPress: onOpenQueue,
    },
    {
      icon: Languages,
      label: "翻译",
      onPress: onToggleTranslation,
      active: translationActive,
    },
    {
      icon: Image,
      label: posterMode ? "关闭海报" : "海报模式",
      onPress: onTogglePosterMode,
      active: posterMode,
    },
    {
      icon: Sliders,
      label: "音效",
      onPress: onOpenSoundEffect,
    },
  ].filter(Boolean);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <View
          style={[
            styles.menu,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          {menuItems.map((item, index) => (
            <Pressable
              key={index}
              style={[
                styles.menuItem,
                item.active && { backgroundColor: palette.surfaceStrong },
              ]}
              onPress={() => {
                item.onPress?.();
                onClose();
              }}
            >
              <item.icon size={20} color={item.active ? palette.primary : palette.text} />
              <Text
                style={[
                  styles.menuItemText,
                  { color: item.active ? palette.primary : palette.text },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  menu: {
    width: "80%",
    maxWidth: 300,
    borderRadius: 12,
    borderWidth: 1,
    padding: 8,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
  },
  menuItemText: {
    marginLeft: 12,
    fontSize: 16,
  },
});
```

- [ ] **Step 2: 测试菜单显示/隐藏**

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/screens/immersive/ImmersiveMoreMenu.tsx
git commit -m "feat(mobile): add ImmersiveMoreMenu component"
```

---

### Task 6: 精简 ImmersiveTransport 控制区

**Files:**
- Modify: `apps/mobile/src/screens/immersive/ImmersiveTransport.tsx`

将 auxRow 收进 MoreBtn 菜单，只保留主控制行。

- [ ] **Step 1: 导入 ImmersiveMoreMenu**

- [ ] **Step 2: 添加 moreMenuVisible 状态**

- [ ] **Step 3: 移除 auxRow，添加 MoreBtn 按钮**

- [ ] **Step 4: 渲染 ImmersiveMoreMenu**

- [ ] **Step 5: 传递 MoreBtn 需要的 props**

- [ ] **Step 6: 测试控制区精简效果**

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/screens/immersive/ImmersiveTransport.tsx
git commit -m "refactor(mobile): simplify ImmersiveTransport with MoreBtn menu"
```

---

### Task 7: 重构 ImmersiveLyricsScreen 使用 PagerView

**Files:**
- Modify: `apps/mobile/src/screens/ImmersiveLyricsScreen.tsx`
- Modify: `apps/mobile/src/screens/immersive/ImmersiveStage.tsx`
- Modify: `apps/mobile/src/screens/immersive/useImmersiveController.ts`

使用 PagerView 实现封面/歌词左右滑动切换。

- [ ] **Step 1: 在 ImmersiveLyricsScreen 中导入 PagerView**

- [ ] **Step 2: 创建封面页和歌词页组件**

- [ ] **Step 3: 使用 PagerView 包装封面/歌词**

- [ ] **Step 4: 添加页面切换状态管理**

- [ ] **Step 5: 简化 ImmersiveStage（移除点击切换逻辑）**

- [ ] **Step 6: 添加屏幕常亮管理（切到歌词页时 keepAwake）**

- [ ] **Step 7: 测试滑动切换**

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/screens/ImmersiveLyricsScreen.tsx
git add apps/mobile/src/screens/immersive/ImmersiveStage.tsx
git add apps/mobile/src/screens/immersive/useImmersiveController.ts
git commit -m "feat(mobile): add PagerView swipe for cover/lyrics in immersive player"
```

---

### Task 8: 重构 LyricView 支持双指缩放

**Files:**
- Modify: `apps/mobile/src/components/LyricView.tsx`

添加双指捏合缩放歌词字号，改进逐行滚动动画。

- [ ] **Step 1: 添加 PanResponder 处理双指捏合**

- [ ] **Step 2: 添加字号状态管理（持久化到 AsyncStorage）**

- [ ] **Step 3: 改进 scrollToIndex 为逐行平滑滚动**

- [ ] **Step 4: 添加手动滚动后 3 秒恢复自动滚动**

- [ ] **Step 5: 测试双指缩放和滚动动画**

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/LyricView.tsx
git commit -m "feat(mobile): add pinch-to-zoom and smooth scroll to LyricView"
```

---

### Task 9: 弱化音效功能 UI

**Files:**
- Modify: `apps/mobile/src/screens/immersive/ImmersiveMoreMenu.tsx`
- Modify: `apps/mobile/src/components/PlayerBar.tsx`

将音效功能 UI 入口收进 MoreBtn 菜单，隐藏 pitch 控件。

- [ ] **Step 1: 在 ImmersiveMoreMenu 中添加音效按钮**

- [ ] **Step 2: 在 PlayerBar 的更多菜单中添加音效入口**

- [ ] **Step 3: 隐藏 pitch 相关 UI 控件**

- [ ] **Step 4: 测试音效功能入口**

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/immersive/ImmersiveMoreMenu.tsx
git add apps/mobile/src/components/PlayerBar.tsx
git commit -m "refactor(mobile): move sound effect controls to MoreBtn menu"
```

---

### Task 10: 集成和测试

**Files:**
- Modify: 多个文件（集成测试）

集成所有改动，进行端到端测试。

- [ ] **Step 1: 运行 TypeScript 检查**

```bash
cd apps/mobile && npx tsc --noEmit
```

- [ ] **Step 2: 运行 ESLint 检查**

```bash
cd apps/mobile && npx eslint .
```

- [ ] **Step 3: 运行测试**

```bash
cd apps/mobile && npx jest
```

- [ ] **Step 4: 手动测试关键功能**
- 沉浸式播放页滑动切换
- 歌词页双指缩放
- PlayerBar 上滑手势
- 锁屏控制

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "feat(mobile): complete player UX redesign for mobile"
```

---

## 验证标准

### 功能验证
- [ ] 沉浸式播放页：左右滑动切换封面/歌词页
- [ ] 歌词页：双指捏合缩放字号，字号变化持久化
- [ ] 歌词页：点击歌词行 seek，手动滚动后 3 秒恢复自动滚动
- [ ] 控制区：主控制行只有 5 个按钮（模式/上一/播放/下一/更多）
- [ ] MoreBtn：点击弹出菜单，包含所有辅助功能
- [ ] PlayerBar：顶部细进度条，上滑打开播放列表
- [ ] 播放引擎：音效入口收进 MoreBtn 菜单

### 交互验证
- [ ] 手势响应流畅，无卡顿
- [ ] 封面旋转动画平滑（25s/圈）
- [ ] 歌词滚动动画平滑，无跳跃
- [ ] 键盘弹出时 PlayerBar 自动隐藏
- [ ] 锁屏控制正常工作

### 兼容性验证
- [ ] 不影响桌面端代码
- [ ] 不改变后端 API
- [ ] 保持深链接格式兼容
- [ ] Android 8.0+ 设备正常运行

---

**计划结束**