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
import {
  ListMusic,
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react-native";

import { CachedImage } from "@/components/CachedImage";
import { MiniProgressBar } from "@/components/MiniProgressBar";
import { Touchable } from "@/components/Touchable";
import {
  hideLyricOverlay,
  setLyricOverlayLocked,
  updateLyricOverlay,
} from "@/services/lyricOverlayService";
import {
  getCurrentLyricIndex,
  playFromQueue,
  playNext,
  playPrevious,
} from "@/services/playerService";
import { buildImmersiveQueuePanelModel } from "@/services/playerQueueModel";
import { convertChineseText } from "@/services/chineseConversionService";
import { QueueModal } from "@/components/QueueModal";
import { useLyricOverlayStore } from "@/stores/lyricOverlayStore";
import { useLyricSettingsStore } from "@/stores/lyricSettingsStore";
import { usePlayerStore } from "@/stores/playerStore";
import { PLAYER_BAR_HEIGHT } from "@/navigation/tabLayout";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";
import { calculateLyricLineProgress } from "@lx/core";

export interface PlayerBarProps {
  onOpen: () => void;
  /** 底部安全区高度：push 页无 Tab 栏时贴屏底需避让手势条；Tab 页内嵌于 tabBar 时为 0。 */
  bottomInset?: number;
}

function showActionError(title: string, error: unknown) {
  Alert.alert(title, error instanceof Error ? error.message : String(error));
}

export function PlayerBar({ onOpen, bottomInset = 0 }: PlayerBarProps) {
  const currentSong = usePlayerStore((state) => state.currentSong);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const loading = usePlayerStore((state) => state.loading);
  const pause = usePlayerStore((state) => state.pause);
  const resume = usePlayerStore((state) => state.resume);
  const queue = usePlayerStore((state) => state.queue);
  const currentIndex = usePlayerStore((state) => state.currentIndex);
  const removeFromQueue = usePlayerStore((state) => state.removeFromQueue);
  const clearQueue = usePlayerStore((state) => state.clearQueue);

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

  const [queueModalOpen, setQueueModalOpen] = useState(false);

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

  const queueModel = useMemo(
    () => buildImmersiveQueuePanelModel(queue, currentIndex),
    [queue, currentIndex],
  );

  useEffect(() => {
    if (currentSong || !overlayVisible) return;
    void (async () => {
      try {
        await hideLyricOverlay();
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

  if (!currentSong || keyboardVisible) return null;

  const coverUrl = currentSong.picUrl || currentSong.img;

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

  const handlePlayerAction = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      showActionError("播放操作失败", error);
    }
  };

  const handleNext = () => void handlePlayerAction(playNext);

  const handlePrevious = () => void handlePlayerAction(playPrevious);

  const handlePlayQueueItem = async (index: number) => {
    try {
      await playFromQueue(index);
    } catch (error) {
      showActionError("播放队列歌曲失败", error);
    }
    setQueueModalOpen(false);
  };

  const handleRemoveQueueItem = (index: number) => {
    removeFromQueue(index);
  };

  const handleClearQueue = async () => {
    try {
      await clearQueue();
    } catch (error) {
      showActionError("清空播放队列失败", error);
    }
    setQueueModalOpen(false);
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

  return (
    <View
      {...panResponder.panHandlers}
      style={[
        styles.root,
        {
          // 固定高度 + 底部安全区延伸（push 页手势条区域同底色）
          height: PLAYER_BAR_HEIGHT + bottomInset,
          paddingBottom: bottomInset,
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
        },
      ]}
    >
      <MiniProgressBar />

      <View style={styles.content}>
        <Touchable
          onPress={onOpen}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          style={styles.trackSummary}
          accessibilityRole="button"
          accessibilityLabel="打开沉浸式播放器"
        >
          {coverUrl ? (
            <CachedImage
              uri={coverUrl}
              style={styles.cover}
              fallback={
                <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.surfaceStrong }]}>
                  <Music2 size={20} color={palette.primary} />
                </View>
              }
            />
          ) : (
            <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.surfaceStrong }]}>
              <Music2 size={20} color={palette.primary} />
            </View>
          )}
          <View style={styles.trackText}>
            {/* 对齐 lx Title：第一行“歌名 - 歌手”（formatMusicName 格式）。
                迷你栏空间有限，超长时自动缩小字号保整段可见，不再从尾部截掉歌手。 */}
            <Text
              style={[styles.trackName, { color: palette.text }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
            >
              {`${currentSong.name} - ${currentSong.singer?.trim() || "未知歌手"}`}
            </Text>
            {/* 对齐 lx Status：播放时滚动显示当前歌词行，未播放回退状态文案 */}
            <MiniLyricStatus overlayVisible={overlayVisible} color={palette.textMuted} />
          </View>
        </Touchable>

        <View style={styles.transportControls}>
          <Touchable
            onPress={handlePrevious}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="上一首"
          >
            <SkipBack size={18} color={palette.text} />
          </Touchable>
          {isPlaying ? (
            <Touchable
              disabled={loading}
              onPress={() => void handleTogglePlayback()}
              style={[styles.playButton, { backgroundColor: palette.primary }]}
              accessibilityRole="button"
              accessibilityLabel="暂停"
            >
              {loading ? (
                <ActivityIndicator color={palette.primaryText} size="small" />
              ) : (
                <Pause size={20} color={palette.primaryText} fill={palette.primaryText} />
              )}
            </Touchable>
          ) : (
            <Touchable
              disabled={loading}
              onPress={() => void handleTogglePlayback()}
              style={[styles.playButton, { backgroundColor: palette.primary }]}
              accessibilityRole="button"
              accessibilityLabel="播放"
            >
              {loading ? (
                <ActivityIndicator color={palette.primaryText} size="small" />
              ) : (
                <Play size={20} color={palette.primaryText} fill={palette.primaryText} />
              )}
            </Touchable>
          )}
          <Touchable
            onPress={handleNext}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="下一首"
          >
            <SkipForward size={18} color={palette.text} />
          </Touchable>
          <Touchable
            onPress={() => setQueueModalOpen(true)}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="播放列表"
          >
            <ListMusic size={18} color={palette.text} />
          </Touchable>
        </View>
      </View>

      <QueueModal
        visible={queueModalOpen}
        queueModel={queueModel}
        queue={queue}
        palette={palette}
        onClose={() => setQueueModalOpen(false)}
        onPlayItem={(index) => void handlePlayQueueItem(index)}
        onRemoveItem={handleRemoveQueueItem}
        onClear={() => void handleClearQueue()}
      />
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
 * 播放进度（position）0.25s 更新一次，这里把它隔离到叶子组件：
 * - 只有这一行 Text 随进度重渲染，整个 PlayerBar（封面、按钮、弹窗）不再随进度重建；
 * - 悬浮歌词原生桥调用做节流：仅当行号切换或行内进度跨档（10%）且距上次 ≥250ms 时才发送。
 */
function MiniLyricStatus({ overlayVisible, color }: MiniLyricStatusProps) {
  const position = usePlayerStore((state) => state.position);
  const lyrics = usePlayerStore((state) => state.lyrics);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const loading = usePlayerStore((state) => state.loading);
  // 与沉浸歌词保持一致：手动偏移校准 + 简繁转换（否则设置后迷你栏/悬浮歌词与其他歌词不一致）
  const manualOffsetMs = useLyricSettingsStore((s) => s.manualOffsetMs);
  const chineseConversion = useLyricSettingsStore((s) => s.chineseConversion);

  const offsetSec = manualOffsetMs / 1000;
  const currentIndex = getCurrentLyricIndex(lyrics, position + offsetSec);
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

  const lastSentRef = useRef({ index: -1, bucket: -1, ts: 0 });

  useEffect(() => {
    if (!overlayVisible) return;

    const now = Date.now();
    const last = lastSentRef.current;
    // 无逐字歌词时按 CJK 字符/拉丁词估算行内进度（与桌面 playbackSync 同一算法）
    const lineProgress = calculateLyricLineProgress(lyrics, currentIndex, position + offsetSec);
    const bucket = Math.floor(lineProgress * 10);
    const indexChanged = currentIndex !== last.index;
    const bucketChanged = bucket !== last.bucket;
    if (!indexChanged && !(bucketChanged && now - last.ts >= 250)) return;

    lastSentRef.current = { index: currentIndex, bucket, ts: now };
    const currentLine = lyrics[currentIndex];
    const nextLine = lyrics[currentIndex + 1];
    void updateLyricOverlay(
      currentLine ? convertText(currentLine.text) : "",
      nextLine ? convertText(nextLine.text) : "",
      lineProgress,
    ).catch((error: unknown) => {
    });
  }, [currentIndex, lyrics, overlayVisible, position, offsetSec, convertText]);

  return (
    <Text style={[styles.trackArtist, { color }]} numberOfLines={1}>
      {displayText}
    </Text>
  );
}

const styles = StyleSheet.create({
  root: {
    // 文档流布局：Tab 页作为自定义 tabBar 的上一行（导航键正上方），
    // push 页由 AppShell 贴底渲染。不做 absolute，导航键布局完全不变、零遮挡。
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "column",
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xxs,
  },
  trackSummary: {
    minHeight: touch.minTarget,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  cover: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
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
    fontSize: typography.body,
    fontWeight: "700",
  },
  trackArtist: {
    marginTop: 2,
    fontSize: typography.caption,
  },
  transportControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
  },
  iconButton: {
    minWidth: 36,
    minHeight: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  playButton: {
    minWidth: 40,
    minHeight: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
});
