import React, { useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  Text,
  View,
} from "react-native";
import {
  ArrowRight,
  MoreHorizontal,
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
import { ProgressBar } from "@/components/ProgressBar";
import { formatTime } from "@/services/playerService";
import { ImmersiveMoreMenu } from "@/screens/immersive/ImmersiveMoreMenu";
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
  posterMode: boolean;
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
  chineseConversionActive: boolean;
  chineseConversionLabel: string;
  onToggleChineseConversion: () => void;
  onTogglePosterMode: () => void;
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
  chineseConversionActive,
  chineseConversionLabel,
  onToggleChineseConversion,
  onTogglePosterMode,
}: ImmersiveTransportProps) {
  const [moreMenuVisible, setMoreMenuVisible] = useState(false);
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
          onPress={() => setMoreMenuVisible(true)}
          style={styles.modeControlButton}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="更多选项"
        >
          <MoreHorizontal size={22} color={palette.text} />
        </Pressable>
      </View>

      <ImmersiveMoreMenu
        visible={moreMenuVisible}
        onClose={() => setMoreMenuVisible(false)}
        palette={palette}
        canLike={canLike}
        isLiked={isLiked}
        onLike={onLike}
        canAddToPlaylist={canAddToPlaylist}
        onAddToPlaylist={onAddToPlaylist}
        canShare={canShare}
        onShare={onShare}
        onOpenVolume={onOpenVolume}
        volumeMuted={volumeMuted}
        onOpenSleep={onOpenSleep}
        sleepLabel={sleepLabel}
        sleepActive={sleepActive}
        onOpenQueue={onOpenQueue}
        queueLabel={queueLabel}
        onToggleTranslation={onToggleTranslation}
        translationActive={translationControl.active}
        onToggleChineseConversion={onToggleChineseConversion}
        chineseConversionActive={chineseConversionActive}
        chineseConversionLabel={chineseConversionLabel}
        onTogglePosterMode={onTogglePosterMode}
        posterMode={posterMode}
        onOpenSoundEffect={onOpenSoundEffect}
        rateLabel={rateLabel}
        onOpenRate={onOpenRate}
      />
    </Animated.View>
  );
}
