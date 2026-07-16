import React from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  Text,
  View,
} from "react-native";
import {
  ArrowRight,
  FolderPlus,
  Heart,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react-native";
import type { ThemePalette } from "@/stores/themeStore";
import type { MobilePlayMode } from "@/services/mobilePlayModeModel";
import { ProgressBar } from "@/components/ProgressBar";
import { formatTime } from "@/services/playerService";
import { styles } from "@/screens/immersive/immersiveStyles";

export interface ImmersiveTransportProps {
  insetsBottom: number;
  fadeAnim: Animated.Value;
  controlsVisible: boolean;
  position: number;
  duration: number;
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
  isTablet: boolean;
  posterMode: boolean;
  // aux row
  canLike: boolean;
  isLiked: boolean;
  liking: boolean;
  likeLabel: string;
  onLike: () => void;
  canAddToPlaylist: boolean;
  addToPlaylistLabel: string;
  onAddToPlaylist: () => void;
  canShare: boolean;
  shareLabel: string;
  onShare: () => void;
  volumeLabel: string;
  volumeMuted: boolean;
  rateLabel: string;
  onOpenVolume: () => void;
  onOpenRate: () => void;
  onOpenSoundEffect: () => void;
  onOpenSleep: () => void;
  sleepLabel: string;
  sleepActive: boolean;
  onOpenQueue: () => void;
  queueLabel: string;
  translationControl: { label: string; active: boolean };
  onToggleTranslation: () => void;
  onTogglePosterMode: () => void;
  controlsActionLabel: string;
  onToggleControlsVisibility: () => void;
}

function PlayModeIcon({ mode, color }: { mode: MobilePlayMode; color: string }) {
  if (mode === "shuffle") return <Shuffle size={22} color={color} />;
  if (mode === "single") return <Repeat1 size={22} color={color} />;
  if (mode === "sequence") return <ArrowRight size={22} color={color} />;
  return <Repeat size={22} color={color} />;
}

/** 底部控制栏：进度 + 传输键 + 辅助操作 */
export function ImmersiveTransport({
  insetsBottom,
  fadeAnim,
  controlsVisible,
  position,
  duration,
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
  isTablet,
  posterMode,
  canLike,
  isLiked,
  liking,
  likeLabel,
  onLike,
  canAddToPlaylist,
  addToPlaylistLabel,
  onAddToPlaylist,
  canShare,
  shareLabel,
  onShare,
  volumeLabel,
  volumeMuted,
  rateLabel,
  onOpenVolume,
  onOpenRate,
  onOpenSoundEffect,
  onOpenSleep,
  sleepLabel,
  sleepActive,
  onOpenQueue,
  queueLabel,
  translationControl,
  onToggleTranslation,
  onTogglePosterMode,
  controlsActionLabel,
  onToggleControlsVisibility,
}: ImmersiveTransportProps) {
  return (
    <Animated.View
      style={[
        styles.bottomBar,
        {
          paddingBottom: insetsBottom + 12,
          opacity: fadeAnim,
          transform: [
            {
              translateY: fadeAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [40, 0],
              }),
            },
          ],
        },
      ]}
      pointerEvents={controlsVisible ? "auto" : "none"}
    >
      <View style={styles.progressWrap}>
        <ProgressBar position={position} duration={duration} onSeek={onSeek} />
        <View style={styles.timeRow}>
          <Text style={[styles.timeText, { color: palette.textMuted }]}>{formatTime(position)}</Text>
          <Text style={[styles.timeText, { color: palette.textMuted }]}>{formatTime(duration)}</Text>
        </View>
      </View>

      <View style={styles.mainControls}>
        <Pressable
          onPress={onTogglePlayMode}
          style={styles.modeControlButton}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`播放模式：${playModeControl.label}`}
          accessibilityState={{ selected: playModeControl.active }}
        >
          <PlayModeIcon
            mode={playMode}
            color={playModeControl.active ? palette.primary : palette.text}
          />
        </Pressable>

        <Pressable
          onPress={onPrevious}
          style={styles.controlButton}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="上一首"
        >
          <SkipBack size={28} color={palette.text} fill={palette.text} />
        </Pressable>

        <Pressable
          onPress={onTogglePlay}
          style={[styles.playButton, { backgroundColor: palette.primary }]}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "暂停" : "播放"}
        >
          {loading ? (
            <ActivityIndicator color={palette.primaryText} size="large" />
          ) : (
            isPlaying
              ? <Pause size={30} color={palette.primaryText} fill={palette.primaryText} />
              : <Play size={30} color={palette.primaryText} fill={palette.primaryText} />
          )}
        </Pressable>

        <Pressable
          onPress={onNext}
          style={styles.controlButton}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="下一首"
        >
          <SkipForward size={28} color={palette.text} fill={palette.text} />
        </Pressable>

        <Pressable
          onPress={onOpenQueue}
          style={styles.modeControlButton}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="播放列表"
        >
          <ListMusic size={22} color={palette.text} />
        </Pressable>
      </View>

      <View style={styles.auxRow}>
        {canLike && (
          <Pressable
            onPress={onLike}
            disabled={liking}
            style={[
              styles.auxButton,
              styles.auxIconButton,
              liking && styles.auxButtonDisabled,
              { backgroundColor: palette.surface },
            ]}
            accessibilityRole="button"
            accessibilityLabel={likeLabel}
            accessibilityState={{ disabled: liking, selected: isLiked }}
          >
            <Heart
              size={20}
              color={isLiked ? palette.primary : palette.textMuted}
              fill={isLiked ? palette.primary : "none"}
            />
          </Pressable>
        )}

        {canAddToPlaylist && (
          <Pressable
            onPress={onAddToPlaylist}
            style={[styles.auxButton, styles.auxIconButton, { backgroundColor: palette.surface }]}
            accessibilityRole="button"
            accessibilityLabel={addToPlaylistLabel}
          >
            <FolderPlus size={20} color={palette.textMuted} />
          </Pressable>
        )}

        {canShare && (
          <Pressable
            onPress={onShare}
            style={[styles.auxButton, styles.auxIconButton, { backgroundColor: palette.surface }]}
            accessibilityRole="button"
            accessibilityLabel={shareLabel}
          >
            <Share2 size={20} color={palette.textMuted} />
          </Pressable>
        )}

        <Pressable
          onPress={onOpenVolume}
          style={[styles.auxButton, styles.auxIconButton, { backgroundColor: palette.surface }]}
          accessibilityRole="button"
          accessibilityLabel={volumeLabel}
        >
          {volumeMuted
            ? <VolumeX size={20} color={palette.textMuted} />
            : <Volume2 size={20} color={palette.textMuted} />}
        </Pressable>

        <Pressable onPress={onOpenRate} style={[styles.auxButton, { backgroundColor: palette.surface }]}>
          <Text style={[styles.auxText, { color: palette.textMuted }]}>{rateLabel}</Text>
        </Pressable>

        <Pressable
          onPress={onOpenSoundEffect}
          style={[styles.auxButton, { backgroundColor: palette.surface }]}
        >
          <Text style={[styles.auxText, { color: palette.textMuted }]}>音效</Text>
        </Pressable>

        <Pressable
          onPress={onOpenSleep}
          style={[
            styles.auxButton,
            { backgroundColor: sleepActive ? palette.primary : palette.surface },
          ]}
        >
          <Text
            style={[
              styles.auxText,
              { color: sleepActive ? palette.primaryText : palette.textMuted },
            ]}
          >
            {sleepLabel}
          </Text>
        </Pressable>

        <Pressable onPress={onOpenQueue} style={[styles.auxButton, { backgroundColor: palette.surface }]}>
          <Text style={[styles.auxText, { color: palette.textMuted }]}>{queueLabel}</Text>
        </Pressable>

        <Pressable
          onPress={onToggleTranslation}
          style={[
            styles.auxButton,
            { backgroundColor: translationControl.active ? palette.primary : palette.surface },
          ]}
        >
          <Text
            style={[
              styles.auxText,
              {
                color: translationControl.active ? palette.primaryText : palette.textMuted,
              },
            ]}
          >
            {translationControl.label}
          </Text>
        </Pressable>

        {isTablet && (
          <Pressable
            onPress={onTogglePosterMode}
            style={[
              styles.auxButton,
              { backgroundColor: posterMode ? palette.primary : palette.surface },
            ]}
          >
            <Text
              style={[
                styles.auxText,
                { color: posterMode ? palette.primaryText : palette.textMuted },
              ]}
            >
              海报 {posterMode ? "开" : "关"}
            </Text>
          </Pressable>
        )}

        <Pressable
          onPress={onToggleControlsVisibility}
          style={[styles.auxButton, { backgroundColor: palette.surface }]}
        >
          <Text style={[styles.auxText, { color: palette.textMuted }]}>{controlsActionLabel}</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}
