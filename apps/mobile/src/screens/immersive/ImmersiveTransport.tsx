import React, { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
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
import { IconButton } from "@/components/IconButton";
import { hapticLight } from "@/services/hapticService";
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
        <IconButton
          size="lg"
          tone="strong"
          onPress={() => {
            hapticLight();
            onPrevious();
          }}
          accessibilityLabel="上一首"
          render={({ size, color }) =>
            loading ? (
              <ActivityIndicator color={color} size="small" />
            ) : (
              <SkipBack size={size} color={color} fill={color} />
            )
          }
        />

        <IconButton
          size="xl"
          tone="strong"
          onPress={onTogglePlay}
          accessibilityLabel={isPlaying ? "暂停" : "播放"}
          render={({ size, color }) =>
            loading ? (
              <ActivityIndicator color={color} size="large" />
            ) : isPlaying ? (
              <Pause size={size} color={color} fill={color} />
            ) : (
              <Play size={size} color={color} fill={color} />
            )
          }
        />

        <IconButton
          size="lg"
          tone="strong"
          onPress={() => {
            hapticLight();
            onNext();
          }}
          accessibilityLabel="下一首"
          render={({ size, color }) =>
            loading ? (
              <ActivityIndicator color={color} size="small" />
            ) : (
              <SkipForward size={size} color={color} fill={color} />
            )
          }
        />
      </View>

      {/* ── MoreBtn：播放模式 / 喜欢 / 桌面歌词 / 评论 / 更多（对齐 lx 一排小按钮） ── */}
      <View style={styles.moreBtnRow}>
        <IconButton
          onPress={onTogglePlayMode}
          tone={playModeControl.active ? "primary" : "strong"}
          selected={playModeControl.active}
          accessibilityLabel={`播放模式：${playModeControl.label}`}
          render={({ size, color }) => (
            <PlayModeIcon mode={playMode} color={color} size={size} />
          )}
        />

        <IconButton
          onPress={onToggleLike}
          tone={isLiked ? "primary" : "strong"}
          selected={isLiked}
          accessibilityLabel={isLiked ? "取消喜欢" : "喜欢"}
          render={({ size, color }) => (
            <Heart size={size} color={color} fill={isLiked ? color : "transparent"} />
          )}
        />

        <IconButton
          onPress={() => void onToggleFloatingLyric()}
          tone={floatingLyricActive ? "primary" : "strong"}
          selected={floatingLyricActive}
          accessibilityLabel={floatingLyricActive ? "关闭悬浮歌词" : "打开悬浮歌词"}
          render={({ size, color }) => <Captions size={size} color={color} />}
        />

        {canShowComments ? (
          <IconButton
            onPress={onOpenComments}
            tone="strong"
            accessibilityLabel="评论"
            render={({ size, color }) => <MessageCircle size={size} color={color} />}
          />
        ) : null}

        <IconButton
          onPress={() => setMoreMenuVisible(true)}
          tone="strong"
          accessibilityLabel="更多选项"
          render={({ size, color }) => <MoreHorizontal size={size} color={color} />}
        />
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
