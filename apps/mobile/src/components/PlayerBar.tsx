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
import { IconButton } from "@/components/IconButton";
import { Touchable } from "@/components/Touchable";
import {
  hideLyricOverlay,
  setLyricOverlayLocked,
  updateLyricOverlay,
} from "@/services/lyricOverlayService";
import {
  playFromQueue,
  playNext,
  playPrevious,
} from "@/services/playerService";
import { buildImmersiveQueuePanelModel } from "@/services/playerQueueModel";
import { convertChineseText } from "@/services/chineseConversionService";
import { QueueModal } from "@/components/QueueModal";
import { useLyricOverlayStore } from "@/stores/lyricOverlayStore";
import { useLyricSettingsStore } from "@/stores/lyricSettingsStore";
import { useLyricLineIndex } from "@/hooks/useLyricLineIndex";
import { usePlayerStore } from "@/stores/playerStore";
import { PLAYER_BAR_HEIGHT } from "@/navigation/tabLayout";
import { setImmersiveFlySource } from "@/screens/immersive/immersiveFlySource";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

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

  // 长按定时器的卸载兜底清理：触摸被父级滑动 PanResponder 抢走时收到的是
  // touchCancel 而非 touchEnd（已单独处理），组件卸载（如清空队列）时在此清理，
  // 避免 500ms 后误开播放器。
  useEffect(() => {
    return () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    };
  }, []);

  // 测量迷你栏封面在窗口中的位置，供播放页「封面飞入/飞回」转场取起点。
  // onLayout 在布局变化（键盘弹出/隐藏、底栏挂载）时会重新触发，坐标保持新鲜。
  const coverMeasureRef = useRef<View | null>(null);

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
                    <Music2 size={20} color={palette.primary} />
                  </View>
                }
              />
            ) : (
              <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.surfaceStrong }]}>
                <Music2 size={20} color={palette.primary} />
              </View>
            )}
          </View>
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
          <IconButton
            size="sm"
            tone="strong"
            onPress={handlePrevious}
            accessibilityLabel="上一首"
            render={({ size, color }) =>
              loading ? (
                <ActivityIndicator color={color} size="small" />
              ) : (
                <SkipBack size={size} color={color} />
              )
            }
          />
          <IconButton
            variant="accent"
            disabled={loading}
            onPress={() => void handleTogglePlayback()}
            accessibilityLabel={isPlaying ? "暂停" : "播放"}
            render={({ size, color }) =>
              loading ? (
                <ActivityIndicator color={color} size="small" />
              ) : isPlaying ? (
                <Pause size={size} color={color} fill={color} />
              ) : (
                <Play size={size} color={color} fill={color} />
              )
            }
          />
          <IconButton
            size="sm"
            tone="strong"
            onPress={handleNext}
            accessibilityLabel="下一首"
            render={({ size, color }) =>
              loading ? (
                <ActivityIndicator color={color} size="small" />
              ) : (
                <SkipForward size={size} color={color} />
              )
            }
          />
          <IconButton
            size="sm"
            tone="strong"
            onPress={() => setQueueModalOpen(true)}
            accessibilityLabel="播放列表"
            render={({ size, color }) => <ListMusic size={size} color={color} />}
          />
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
 * 行号统一走 useLyricLineIndex（与沉浸屏同源：锚点外推 + 行边界调度 + 单调钳制），
 * 不再随 0.25s 进度事件重算。组件隔离到叶子：
 * - 只有这一行 Text 随行切换重渲染，整个 PlayerBar（封面、按钮、弹窗）不再随进度重建；
 * - 悬浮歌词原生桥按「显示签名」去重推送：内容不变不发送。
 *
 * 悬浮窗推送语义（对齐 lx 桌面歌词）：
 * - 有归属当前曲的歌词且行号有效 → 推当前行 + 下一行；
 * - 切歌在途（新歌已入 store、歌词未加载）/ 前奏 / 无词 → 推「歌名 - 歌手」，
 *   保证上一首一结束悬浮窗就切换到新歌，而不是挂着旧歌词等新歌唱起来；
 * - 队列清空 → 推空串清窗。
 */
function MiniLyricStatus({ overlayVisible, color }: MiniLyricStatusProps) {
  const lyrics = usePlayerStore((state) => state.lyrics);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const loading = usePlayerStore((state) => state.loading);
  const currentSong = usePlayerStore((state) => state.currentSong);
  // 与沉浸歌词保持一致：手动偏移校准 + 简繁转换（否则设置后迷你栏/悬浮歌词与其他歌词不一致）
  const manualOffsetMs = useLyricSettingsStore((s) => s.manualOffsetMs);
  const chineseConversion = useLyricSettingsStore((s) => s.chineseConversion);

  const offsetSec = manualOffsetMs / 1000;
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
  // currentSong 在 play() 内先于 loadLyrics 落库（playerStore.ts play → playSongCore 第 3 步），
  // 歌词到达时打到的必是新歌的标；同曲重播（切音质）数组虽换但 key 不变，不会闪歌名。
  const lyricsOwnerRef = useRef({ array: lyrics, key: songKey });
  if (lyricsOwnerRef.current.array !== lyrics) {
    lyricsOwnerRef.current = { array: lyrics, key: songKey };
  }
  const lyricsOwned = songKey !== "" && lyricsOwnerRef.current.key === songKey;

  // 原生悬浮窗当前显示内容的签名：只在显示会变化时才发桥调用
  const lastSentRef = useRef("");

  useEffect(() => {
    if (!overlayVisible) return;

    const titleText = currentSong
      ? convertText(currentSong.singer ? `${currentSong.name} - ${currentSong.singer}` : currentSong.name)
      : "";
    let currentText = titleText;
    let nextText = "";
    if (currentSong && lyricsOwned && currentIndex >= 0) {
      const line = convertText(lyrics[currentIndex]?.text ?? "");
      if (line) {
        currentText = line;
        const next = lyrics[currentIndex + 1];
        nextText = next ? convertText(next.text) : "";
      }
    }

    const signature = `${currentText}\u0000${nextText}`;
    if (signature === lastSentRef.current) return;
    lastSentRef.current = signature;
    void updateLyricOverlay(currentText, nextText).catch((error: unknown) => {
    });
  }, [currentSong, songKey, lyricsOwned, currentIndex, lyrics, overlayVisible, offsetSec, convertText]);

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
});
