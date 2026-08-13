import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
} from "react-native";
import {
  ArrowRight,
  Captions,
  FolderPlus,
  Heart,
  MessageCircle,
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
import { usePlayerStore } from "@/stores/playerStore";
import { ImmersiveMoreMenu } from "@/screens/immersive/ImmersiveMoreMenu";
import { styles } from "@/screens/immersive/immersiveStyles";

export interface ImmersiveTransportProps {
  insetsBottom: number;
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
  isLiked: boolean;
  onToggleLike: () => void;
  floatingLyricActive: boolean;
  onToggleFloatingLyric: () => void;
  canAddToPlaylist: boolean;
  onAddToPlaylist: () => void;
  canShare: boolean;
  shareLabel: string;
  onShare: () => void;
  onOpenDownload: () => void;
  onPlayMv?: () => void;
  canShowComments: boolean;
  onOpenComments: () => void;
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
      <ProgressBar position={position} duration={duration} buffered={buffered} onSeek={onSeek} />
      <View style={styles.timeRow}>
        <Text style={[styles.timeText, { color: palette.textMuted }]}>{formatTime(position)}</Text>
        <Text style={[styles.timeText, { color: palette.textMuted }]}>{formatTime(duration)}</Text>
      </View>
    </View>
  );
}

function PlayModeIcon({ mode, color }: { mode: MobilePlayMode; color: string }) {
  if (mode === "shuffle") return <Shuffle size={22} color={color} />;
  if (mode === "single") return <Repeat1 size={22} color={color} />;
  if (mode === "sequence") return <ArrowRight size={22} color={color} />;
  return <Repeat size={22} color={color} />;
}

/**
 * 底部播放区（对齐 lx 竖屏 Player）：
 * - PlayInfo：进度条 + 当前时间/状态/总时间
 * - ControlBtn：上一首 / 播放暂停 / 下一首
 * - MoreBtn：播放模式 / 喜欢 / 桌面歌词 / 评论 / 更多
 * 控件常驻显示，不做桌面端风格的自动隐藏。
 */
export function ImmersiveTransport({
  insetsBottom,
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
  isLiked,
  onToggleLike,
  floatingLyricActive,
  onToggleFloatingLyric,
  canAddToPlaylist,
  onAddToPlaylist,
  canShare,
  onShare,
  onOpenDownload,
  onPlayMv,
  canShowComments,
  onOpenComments,
  onOpenQueue,
  queueLabel,
}: ImmersiveTransportProps) {
  const [moreMenuVisible, setMoreMenuVisible] = useState(false);

  return (
    <View style={[styles.playerArea, { paddingBottom: insetsBottom + 12 }]}>
      {/* ── PlayInfo：进度 + 时间行（叶子组件，内部订阅 0.25s 进度，按钮区不随进度重渲染） ── */}
      <ImmersivePlayInfo onSeek={onSeek} palette={palette} />

      {/* ── ControlBtn：上一首 / 播放暂停 / 下一首（大按钮，space-evenly） ── */}
      <View style={styles.mainControls}>
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
          style={styles.playButton}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "暂停" : "播放"}
        >
          {loading ? (
            <ActivityIndicator color={palette.text} size="large" />
          ) : (
            isPlaying
              ? <Pause size={32} color={palette.text} fill={palette.text} />
              : <Play size={32} color={palette.text} fill={palette.text} />
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
      </View>

      {/* ── MoreBtn：播放模式 / 喜欢 / 桌面歌词 / 评论 / 更多（对齐 lx 一排小按钮） ── */}
      <View style={styles.moreBtnRow}>
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
          onPress={onToggleLike}
          style={styles.modeControlButton}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={isLiked ? "取消喜欢" : "喜欢"}
          accessibilityState={{ selected: isLiked }}
        >
          <Heart size={22} color={isLiked ? palette.primary : palette.text} fill={isLiked ? palette.primary : "transparent"} />
        </Pressable>

        <Pressable
          onPress={() => void onToggleFloatingLyric()}
          style={styles.modeControlButton}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={floatingLyricActive ? "关闭桌面歌词" : "打开桌面歌词"}
          accessibilityState={{ selected: floatingLyricActive }}
        >
          <Captions
            size={22}
            color={floatingLyricActive ? palette.primary : palette.text}
          />
        </Pressable>

        {canShowComments ? (
          <Pressable
            onPress={onOpenComments}
            style={styles.modeControlButton}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="评论"
          >
            <MessageCircle size={22} color={palette.text} />
          </Pressable>
        ) : null}

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
        canAddToPlaylist={canAddToPlaylist}
        onAddToPlaylist={onAddToPlaylist}
        onOpenDownload={onOpenDownload}
        onPlayMv={onPlayMv}
        canShare={canShare}
        onShare={onShare}
        onOpenQueue={onOpenQueue}
        queueLabel={queueLabel}
      />
    </View>
  );
}
