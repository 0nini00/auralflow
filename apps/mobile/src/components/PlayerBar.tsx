import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Music2, Pause, Play, SkipForward } from "lucide-react-native";

import { CachedImage } from "@/components/CachedImage";
import { MiniProgressBar } from "@/components/MiniProgressBar";
import { IconButton } from "@/components/IconButton";
import { Touchable } from "@/components/Touchable";
import {
  clearLyricOverlayLyrics,
  hideLyricOverlay,
  isLyricOverlaySupported,
  setLyricOverlayLocked,
  setLyricOverlayLyrics,
} from "@/services/lyricOverlayService";
import { syncLyricOverlayPlaybackClock } from "@/services/lyricOverlayPlayback";
import { logger } from "@/services/logger";
import { shouldCalibrateClock } from "@lx/core";
import { playFromQueue, playNext } from "@/services/playerService";
import { convertChineseText } from "@/services/chineseConversionService";
import { useLyricOverlayStore } from "@/stores/lyricOverlayStore";
import { useLyricSettingsStore } from "@/stores/lyricSettingsStore";
import { useLyricLineIndex } from "@/hooks/useLyricLineIndex";
import { usePlayerStore } from "@/stores/playerStore";
import { selectPlaybackArtwork } from "@/services/localMediaPlaybackModel";
import { PLAYER_BAR_HEIGHT } from "@/navigation/tabLayout";
import { setImmersiveFlySource } from "@/screens/immersive/immersiveFlySource";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { hapticLight } from "@/services/hapticService";
import { radius, spacing, typography } from "@/theme/tokens";

export interface PlayerBarProps {
  onOpen: () => void;
  /** 底部安全区高度：作为卡片外边距把播放器抬离手势条；Tab 页内嵌于 tabBar 时为 0。 */
  bottomInset?: number;
}

function showActionError(title: string, error: unknown) {
  Alert.alert(title, error instanceof Error ? error.message : String(error));
}

/**
 * 迷你播放器（浮起卡片）。
 *
 * 设计要点：
 * - 64px 高、左右 12px 外边距、圆角 20，浮在标签栏上方 6px；
 * - 进度线在卡片顶部（2px），播放键 34px 实心品牌绿，右侧只留「下一首」；
 * - 队列入口收敛到播放页，避免 64px 内塞四个按钮。
 * - 保留长按/上滑打开播放页、歌词行、悬浮歌词同步与封面测量。
 */
export function PlayerBar({ onOpen, bottomInset = 0 }: PlayerBarProps) {
  const currentSong = usePlayerStore((state) => state.currentSong);
  const coverUrl = usePlayerStore(selectPlaybackArtwork);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const loading = usePlayerStore((state) => state.loading);
  const playbackNotice = usePlayerStore((state) => state.playbackNotice);
  const pause = usePlayerStore((state) => state.pause);
  const resume = usePlayerStore((state) => state.resume);

  const overlayVisible = useLyricOverlayStore((state) => state.visible);
  const overlayLocked = useLyricOverlayStore((state) => state.locked);
  const setOverlayVisible = useLyricOverlayStore((state) => state.setVisible);

  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor),
    [themeMode, systemTheme, accentColor],
  );

  // 键盘弹出时隐藏迷你栏（对齐 lx PlayerBar：搜索/输入时不遮挡键盘）
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (currentSong || !overlayVisible) return;
    void (async () => {
      try {
        // iOS / 原生模块缺失时没有悬浮歌词可关：不探测会把能力错误当操作失败弹给用户
        if (isLyricOverlaySupported()) await hideLyricOverlay();
        await setOverlayVisible(false);
      } catch (error) {
        showActionError("关闭悬浮歌词失败", error);
      }
    })();
  }, [currentSong, overlayVisible, setOverlayVisible]);

  useEffect(() => {
    if (!overlayVisible || !currentSong) return;
    void setLyricOverlayLocked(overlayLocked).catch((error: unknown) => {
    });
  }, [currentSong, overlayLocked, overlayVisible]);

  // 注意：useRef 必须在任何条件 return 之前声明，否则 currentSong 从空到有歌时
  // 会触发 “rendered fewer hooks than expected” 崩溃（hook 顺序违规）。
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return gestureState.dy < -10 && Math.abs(gestureState.dx) < Math.abs(gestureState.dy);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy < -50) {
          onOpen();
        }
      },
    }),
  ).current;

  // 长按定时器的卸载兜底清理：触摸被父级滑动 PanResponder 抢走时收到的是
  // touchCancel 而非 touchEnd（已单独处理），组件卸载时在此清理。
  useEffect(() => {
    return () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    };
  }, []);

  // 测量迷你栏封面在窗口中的位置，供播放页「封面飞入/飞回」转场取起点。
  const coverMeasureRef = useRef<View | null>(null);

  if (!currentSong || keyboardVisible) return null;

  const handleTogglePlayback = async () => {
    try {
      if (isPlaying) {
        await pause();
        return;
      }

      await resume();
      const state = usePlayerStore.getState();
      if (!state.isPlaying && state.currentIndex >= 0) {
        // 快照恢复后原生无曲：重新播放当前曲并续播上次保存的进度
        await playFromQueue(state.currentIndex, state.position);
      }
    } catch (error) {
      showActionError("播放操作失败", error);
    }
  };

  const handleNext = () => {
    hapticLight();
    void playNext().catch((error) => showActionError("播放操作失败", error));
  };

  const handleTouchStart = () => {
    longPressTimer.current = setTimeout(() => {
      onOpen();
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleCoverLayout = () => {
    const node = coverMeasureRef.current;
    if (!node) return;
    node.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        setImmersiveFlySource({ x, y, width, height });
      }
    });
  };

  return (
    <View
      {...panResponder.panHandlers}
      style={[
        styles.root,
        {
          height: PLAYER_BAR_HEIGHT,
          marginBottom: bottomInset,
          backgroundColor: palette.surface,
          borderColor: palette.border,
        },
      ]}
    >
      <MiniProgressBar />

      <View style={styles.content}>
        <Touchable
          onPress={onOpen}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          style={styles.trackSummary}
          accessibilityRole="button"
          accessibilityLabel="打开沉浸式播放器"
        >
          <View ref={coverMeasureRef} onLayout={handleCoverLayout}>
            {coverUrl ? (
              <CachedImage
                uri={coverUrl}
                style={styles.cover}
                fallback={
                  <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.surfaceStrong }]}>
                    <Music2 size={18} color={palette.textSubtle} />
                  </View>
                }
              />
            ) : (
              <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.surfaceStrong }]}>
                <Music2 size={18} color={palette.textSubtle} />
              </View>
            )}
          </View>
          <View style={styles.trackText}>
            {/* 迷你栏空间有限，超长时自动缩小字号保整段可见，不再从尾部截掉歌手。 */}
            <Text
              style={[styles.trackName, { color: palette.text }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
            >
              {`${currentSong.name} - ${currentSong.singer?.trim() || "未知歌手"}`}
            </Text>
            {/* 跨源降级注记（约 10s）优先占用此行，确保用户看到「实际在播哪一版」。 */}
            {playbackNotice ? (
              <Text style={[styles.trackNotice, { color: palette.primaryInk }]} numberOfLines={1}>
                {playbackNotice}
              </Text>
            ) : (
              <MiniLyricStatus overlayVisible={overlayVisible} color={palette.textMuted} />
            )}
          </View>
        </Touchable>

        <View style={styles.transportControls}>
          <Touchable
            onPress={() => void handleTogglePlayback()}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? "暂停" : "播放"}
            accessibilityState={{ disabled: loading, busy: loading }}
            activeScale={0.94}
            style={[styles.playButton, { backgroundColor: palette.actionFill }]}
          >
            {loading ? (
              <ActivityIndicator color={palette.onActionFill} size="small" />
            ) : isPlaying ? (
              <Pause size={15} color={palette.onActionFill} fill={palette.onActionFill} />
            ) : (
              <Play size={15} color={palette.onActionFill} fill={palette.onActionFill} />
            )}
          </Touchable>
          <IconButton
            size="sm"
            tone="strong"
            onPress={handleNext}
            accessibilityLabel="下一首"
            render={({ size, color }) => <SkipForward size={size} color={color} />}
          />
        </View>
      </View>
    </View>
  );
}

interface MiniLyricStatusProps {
  overlayVisible: boolean;
  /** 歌词行文字颜色（迷你栏第二行） */
  color: string;
}

/**
 * 迷你栏实时歌词行（对应 lx `Status`）。
 *
 * 行号统一走 useLyricLineIndex（与沉浸屏同源：锚点外推 + 行边界调度 + 单调钳制），
 * 不再随 0.25s 进度事件重算。组件隔离到叶子：
 * - 只有这一行 Text 随行切换重渲染，整个 PlayerBar（封面、按钮）不再随进度重建；
 * - 悬浮歌词原生桥按「显示签名」去重推送：内容不变不发送。
 */
function MiniLyricStatus({ overlayVisible, color }: MiniLyricStatusProps) {
  const lyrics = usePlayerStore((state) => state.lyrics);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const loading = usePlayerStore((state) => state.loading);
  const currentSong = usePlayerStore((state) => state.currentSong);
  // 与沉浸歌词保持一致：手动偏移校准 + 简繁转换（否则设置后迷你栏/悬浮歌词与其他歌词不一致）
  const manualOffsetMs = useLyricSettingsStore((s) => s.manualOffsetMs);
  const chineseConversion = useLyricSettingsStore((s) => s.chineseConversion);

  // 统一行号源：与沉浸屏共用同一钩子，避免两套行号在行边界附近不同步
  const currentIndex = useLyricLineIndex(lyrics, manualOffsetMs);
  const convertText = useCallback(
    (text: string) => convertChineseText(text, chineseConversion),
    [chineseConversion],
  );
  const displayText = !isPlaying
    ? loading
      ? "加载中…"
      : "已暂停"
    : currentIndex >= 0
      ? convertText(lyrics[currentIndex]?.text ?? "")
      : "";

  const songKey = currentSong ? `${currentSong.source}:${currentSong.id}` : "";

  // 歌词归属打标：只在歌词数组身份变化那一刻按 store 当时的 currentSong 归属。
  // 切歌在途窗口（currentSong 已是新歌、歌词还是上一首的）里旧歌词不归新歌所有，
  // 悬浮窗改推歌名——否则会拿上一首的歌词按新歌进度取行（音词错位）或退化为空窗。
  const lyricsOwnerRef = useRef({ array: lyrics, key: songKey });
  if (lyricsOwnerRef.current.array !== lyrics) {
    lyricsOwnerRef.current = { array: lyrics, key: songKey };
  }
  const lyricsOwned = songKey !== "" && lyricsOwnerRef.current.key === songKey;

  const position = usePlayerStore((s) => s.position);
  const lastSyncTimeRef = useRef(0);

  // 会话边界同步：当歌曲、歌词数组或悬浮窗开启状态发生改变时，向原生注入歌词全集与初始时钟
  useEffect(() => {
    if (!overlayVisible) return;

    const titleText = currentSong
      ? convertText(currentSong.singer ? `${currentSong.name} - ${currentSong.singer}` : currentSong.name)
      : "";

    if (currentSong && lyricsOwned && lyrics.length > 0) {
      const converted = lyrics.map((line) => ({
        time: line.time,
        text: convertText(line.text ?? ""),
        tr: line.tr ? convertText(line.tr) : undefined,
      }));
      // effect 已按实际数组/转换设置触发；行数相同不代表内容相同。
      void setLyricOverlayLyrics(converted, titleText)
        .then(() => syncLyricOverlayPlaybackClock())
        .catch((error) => logger.warn("悬浮歌词注入失败", error));
    } else if (currentSong) {
      void clearLyricOverlayLyrics(titleText).catch((error) => logger.warn("悬浮歌词清理失败", error));
    }
  }, [overlayVisible, currentSong, songKey, lyricsOwned, lyrics, convertText]);

  // 前台 5s 周期校准：避免累积时钟漂移
  useEffect(() => {
    if (!overlayVisible || !isPlaying) return;
    const now = Date.now();
    if (shouldCalibrateClock(now - lastSyncTimeRef.current, true)) {
      lastSyncTimeRef.current = now;
      void syncLyricOverlayPlaybackClock().catch((error) => logger.warn("悬浮歌词时钟校准失败", error));
    }
  }, [position, overlayVisible, isPlaying]);

  return (
    <Text style={[styles.trackArtist, { color }]} numberOfLines={1}>
      {displayText}
    </Text>
  );
}

const styles = StyleSheet.create({
  root: {
    // 浮起卡片：Tab 页在标签栏上方，push 页由 AppShell 贴底渲染
    marginHorizontal: spacing.s,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    flexDirection: "column",
    shadowColor: "#101614",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xs + 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  trackSummary: {
    minHeight: 44,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  cover: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
  },
  coverFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  trackText: {
    flex: 1,
    minWidth: 0,
  },
  trackName: {
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: "700",
    letterSpacing: -0.1,
  },
  trackArtist: {
    marginTop: 1,
    fontSize: typography.micro,
    lineHeight: 14,
  },
  trackNotice: {
    marginTop: 1,
    fontSize: typography.micro,
    lineHeight: 14,
    fontWeight: "600",
  },
  transportControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
  },
  playButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 3,
  },
});
