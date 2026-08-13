import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { ActionButton } from "@/components/ActionButton";
import { spacing } from "@/theme/tokens";

/** 额外行动按钮（如「下载全部」） */
export interface PlaybackExtraAction {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}

export interface PlaybackActionButtonsProps {
  /**
   * 三键组是否可见（歌曲数为 0 时隐藏）。也兼容 playlist 场景的 detailActions.show。
   */
  show: boolean;
  playAllLabel: string;
  /** 主按钮行尾计数，如 `(30)`；不传则不显示 */
  playAllCount?: string;
  shuffleLabel: string;
  locateLabel: string;
  /** 定位按钮是否可用（当前歌曲在该列表中） */
  canLocateCurrentSong: boolean;
  /** 播放全部 loading（防重复触发） */
  playAllBusy?: boolean;
  /** 随机播放 loading */
  shuffleBusy?: boolean;
  onPlayAll?: () => void;
  onShuffle?: () => void;
  onLocate?: () => void;
  /** 额外的行动按钮（如「下载全部」），渲染在行尾 */
  extraActions?: PlaybackExtraAction[];
  /** 行级样式（独立渲染时控制外边距等） */
  style?: StyleProp<ViewStyle>;
}

/**
 * 详情页 Hero 的「播放全部 / 随机播放 / 定位当前播放」三键组。
 * 统一 Album / Artist / Bili / Playlist / Local / Liked 六处原本各自实现的按钮样式，
 * 消除尺寸与颜色漂移。布局为可换行的 pill 按钮行，主行动撑满剩余空间。
 */
export function PlaybackActionButtons({
  show,
  playAllLabel,
  playAllCount,
  shuffleLabel,
  locateLabel,
  canLocateCurrentSong,
  playAllBusy = false,
  shuffleBusy = false,
  onPlayAll,
  onShuffle,
  onLocate,
  extraActions = [],
  style,
}: PlaybackActionButtonsProps) {
  if (!show) return null;

  return (
    <View style={[styles.row, style]}>
      <ActionButton
        label={playAllLabel}
        count={playAllCount}
        variant="primary"
        shrink
        small
        loading={playAllBusy}
        onPress={onPlayAll}
        accessibilityLabel={playAllLabel}
      />
      <ActionButton
        label={shuffleLabel}
        shrink
        small
        loading={shuffleBusy}
        onPress={onShuffle}
        accessibilityLabel={shuffleLabel}
      />
      <ActionButton
        label={locateLabel}
        shrink
        small
        disabled={!canLocateCurrentSong}
        onPress={onLocate}
        accessibilityLabel={locateLabel}
      />
      {extraActions.map((action) => (
        <ActionButton
          key={action.label}
          label={action.label}
          shrink
          small
          variant="secondary"
          loading={action.loading}
          disabled={action.disabled}
          onPress={action.onPress}
          accessibilityLabel={action.label}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minWidth: 0,
    flexGrow: 1,
    flexDirection: "row",
    // 对齐 lx：主操作按钮单行等宽排布，不再换行堆叠
    flexWrap: "nowrap",
    alignItems: "center",
    gap: spacing.xs,
  },
});
