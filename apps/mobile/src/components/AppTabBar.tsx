import React from "react";
import { View } from "react-native";
import { BottomTabBar, type BottomTabBarProps } from "@react-navigation/bottom-tabs";

import { PlayerBar } from "@/components/PlayerBar";
import { MINI_PLAYER_GAP } from "@/navigation/tabLayout";
import { openPlayerScreen } from "@/navigation/navigationRef";
import { usePlayerStore } from "@/stores/playerStore";

/**
 * 迷你播放器 + 四个导航键的自定义底部栏。
 *
 * 迷你播放器浮在标签栏上方（6px 间隙 + 左右 12px 外边距），
 * 有歌时才占位；无歌 / 键盘弹出时整块收起，内容区自动让位。
 * react-navigation 按 tabBar 元素的实际高度为内容区让位，零遮挡。
 */
export function AppTabBar({
  keyboardVisible,
  ...props
}: BottomTabBarProps & { keyboardVisible: boolean }) {
  const currentSong = usePlayerStore((state) => state.currentSong);
  const showMiniPlayer = Boolean(currentSong) && !keyboardVisible;

  return (
    <View>
      {showMiniPlayer ? (
        <View style={{ paddingBottom: MINI_PLAYER_GAP }}>
          <PlayerBar onOpen={openPlayerScreen} />
        </View>
      ) : null}
      <BottomTabBar {...props} />
    </View>
  );
}
