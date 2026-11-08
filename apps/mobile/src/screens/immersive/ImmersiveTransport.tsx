import React, { useRef, useState } from "react";
import { ActivityIndicator, Animated, StyleSheet, Text, View } from "react-native";
import {
  ArrowRight,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from "lucide-react-native";
import type { ThemePalette } from "@/stores/themeStore";
import type { MobilePlayMode } from "@/services/mobilePlayModeModel";
import { IconButton } from "@/components/IconButton";
import { hapticLight } from "@/services/hapticService";
import { ProgressBar } from "@/components/ProgressBar";
import { formatTime } from "@/services/playerService";
import { usePlayerStore } from "@/stores/playerStore";
import { styles } from "@/screens/immersive/immersiveStyles";
import { getNextMobilePlayMode, getMobilePlayModeLabel } from "@/services/mobilePlayModeModel";
import { withAlpha } from "@/services/themePaletteModel";

export interface ImmersiveTransportProps {
  insetsBottom: number;
  compact: boolean;
  onSeek: (time: number) => void;
  playMode: MobilePlayMode;
  playModeControl: { label: string; active: boolean };
  onTogglePlayMode: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  isPlaying: boolean;
  loading: boolean;
  palette: ThemePalette;
  onOpenQueue: () => void;
  queueLabel: string;
}

/** 进度区叶子组件：只有这里随 0.25s 进度事件重渲染（对齐 PlayerBar MiniLyricStatus 的隔离模式）。 */
function ImmersivePlayInfo({
  onSeek,
  palette,
}: {
  onSeek: (time: number) => void;
  palette: ThemePalette;
}) {
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const buffered = usePlayerStore((s) => s.buffered);

  return (
    <View style={styles.playInfoWrap}>
      <ProgressBar position={position} duration={duration} buffered={buffered} onSeek={onSeek} palette={palette} />
      <View style={styles.timeRow}>
        <Text style={[styles.timeText, { color: palette.textMuted }]}>{formatTime(position)}</Text>
        <Text style={[styles.timeText, { color: palette.textMuted }]}>{formatTime(duration)}</Text>
      </View>
    </View>
  );
}

function PlayModeIcon({
  mode,
  color,
  size,
}: {
  mode: MobilePlayMode;
  color: string;
  size: number;
}) {
  if (mode === "shuffle") return <Shuffle size={size} color={color} />;
  if (mode === "single") return <Repeat1 size={size} color={color} />;
  if (mode === "sequence") return <ArrowRight size={size} color={color} />;
  return <Repeat size={size} color={color} />;
}

/**
 * 底部播放区：
 * - PlayInfo：进度条 + 当前时间/状态/总时间
 * - 单行五键：播放模式 / 上一首 / 播放暂停 / 下一首 / 队列
 * 控件常驻显示，不做桌面端风格的自动隐藏。
 */
export function ImmersiveTransport({
  insetsBottom,
  compact,
  onSeek,
  playMode,
  playModeControl,
  onTogglePlayMode,
  onPrevious,
  onNext,
  onTogglePlay,
  isPlaying,
  loading,
  palette,
  onOpenQueue,
  queueLabel,
}: ImmersiveTransportProps) {
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMode, setToastMode] = useState<MobilePlayMode>(playMode);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const handleToggleModeWithToast = () => {
    hapticLight();
    const nextMode = getNextMobilePlayMode(playMode);
    setToastMode(nextMode);
    setToastVisible(true);

    if (toastTimer.current) clearTimeout(toastTimer.current);

    Animated.timing(toastOpacity, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();

    onTogglePlayMode();

    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        setToastVisible(false);
      });
    }, 1100);
  };

  return (
    <View style={[styles.playerArea, compact && localStyles.compactArea, { paddingBottom: insetsBottom + (compact ? 8 : 12) }]}>
      {/* ── PlayInfo：进度 + 时间行（叶子组件，内部订阅 0.25s 进度，按钮区不随进度重渲染） ── */}
      <ImmersivePlayInfo onSeek={onSeek} palette={palette} />

      {/* 五键常驻同一行，进度更新仍只重渲染上方叶子组件。 */}
      <View style={[styles.mainControls, compact && localStyles.compactControls]}>
        <IconButton
          onPress={handleToggleModeWithToast}
          tone={playModeControl.active ? "accent" : "strong"}
          selected={playModeControl.active}
          accessibilityLabel={`播放模式：${playModeControl.label}`}
          render={({ size }) => (
            <PlayModeIcon mode={playMode} color={playModeControl.active ? palette.primaryInk : palette.text} size={size} />
          )}
        />

        <IconButton
          size="lg"
          tone="strong"
          style={localStyles.skipButton}
          onPress={() => {
            hapticLight();
            onPrevious();
          }}
          accessibilityLabel="上一首"
          render={({ size }) =>
            loading ? (
              <ActivityIndicator color={palette.text} size="small" />
            ) : (
              <SkipBack size={size} color={palette.text} fill={palette.text} />
            )
          }
        />

        <IconButton
          size="lg"
          tone="strong"
          onPress={onTogglePlay}
          accessibilityLabel={isPlaying ? "暂停" : "播放"}
          style={[
            localStyles.playButton,
            {
              backgroundColor: palette.actionFill,
              borderColor: withAlpha(palette.onActionFill, 0.12),
            },
          ]}
          render={({ size }) =>
            loading ? (
              <ActivityIndicator color={palette.onActionFill} size="large" />
            ) : isPlaying ? (
              <Pause size={size} color={palette.onActionFill} fill={palette.onActionFill} />
            ) : (
              <Play size={size} color={palette.onActionFill} fill={palette.onActionFill} />
            )
          }
        />

        <IconButton
          size="lg"
          tone="strong"
          style={localStyles.skipButton}
          onPress={() => {
            hapticLight();
            onNext();
          }}
          accessibilityLabel="下一首"
          render={({ size }) =>
            loading ? (
              <ActivityIndicator color={palette.text} size="small" />
            ) : (
              <SkipForward size={size} color={palette.text} fill={palette.text} />
            )
          }
        />
        <IconButton
          onPress={onOpenQueue}
          tone="strong"
          accessibilityLabel={queueLabel}
          render={({ size }) => <ListMusic size={size} color={palette.text} />}
        />

      </View>

      {/* ── 播放模式微型小胶囊提示（点击后左下角浮现1.1s后淡出，不占主屏幕） ── */}
      {toastVisible ? (
        <Animated.View
          style={[
            localStyles.modeToast,
            {
              bottom: insetsBottom + 54,
              opacity: toastOpacity,
            },
          ]}
          pointerEvents="none"
        >
          <PlayModeIcon mode={toastMode} color="#ffffff" size={12} />
          <Text style={localStyles.modeToastText}>
            {getMobilePlayModeLabel(toastMode)}
          </Text>
        </Animated.View>
      ) : null}

    </View>
  );
}

const localStyles = StyleSheet.create({
  skipButton: {
    width: 48,
    height: 48,
  },
  playButton: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 1,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius: 14,
    elevation: 6,
  },
  compactArea: { paddingTop: 4 },
  compactControls: { paddingVertical: 4 },
  modeToast: {
    position: "absolute",
    left: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(24, 24, 27, 0.88)",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
    zIndex: 20,
  },
  modeToastText: {
    color: "#ffffff",
    fontSize: 11.5,
    fontWeight: "600",
  },
});
