import React from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import type { ThemePalette } from "@/stores/themeStore";
import { styles } from "@/screens/immersive/immersiveStyles";

export interface ImmersiveTopBarProps {
  insetsTop: number;
  songName: string;
  artist: string;
  isTablet: boolean;
  posterMode: boolean;
  palette: ThemePalette;
  onClose: () => void;
  onOpenLyricSettings: () => void;
  onTogglePosterMode: () => void;
}

/** 顶部信息栏：关闭 / 歌名歌手 / 设置（平板还有海报切换） */
export function ImmersiveTopBar({
  insetsTop,
  songName,
  artist,
  isTablet,
  posterMode,
  palette,
  onClose,
  onOpenLyricSettings,
  onTogglePosterMode,
}: ImmersiveTopBarProps) {
  return (
    <View style={[styles.topBar, { paddingTop: insetsTop + 8 }]}>
      <Pressable
        onPress={onClose}
        style={styles.closeButton}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="关闭沉浸式播放器"
      >
        <ChevronDown size={26} color={palette.text} />
      </Pressable>

      <View style={styles.topInfo}>
        <Text style={[styles.songName, { color: palette.text }]} numberOfLines={1}>
          {songName}
        </Text>
        <Text style={[styles.artistName, { color: palette.textMuted }]} numberOfLines={1}>
          {artist}
        </Text>
      </View>

      {isTablet ? (
        <Pressable onPress={onTogglePosterMode} style={styles.topRightButton} hitSlop={12}>
          <Text style={[styles.topRightButtonText, { color: palette.text }]}>
            {posterMode ? "歌词" : "海报"}
          </Text>
        </Pressable>
      ) : null}

      <Pressable onPress={onOpenLyricSettings} style={styles.topRightButton} hitSlop={12}>
        <Text style={[styles.topRightButtonText, { color: palette.text }]}>设置</Text>
      </Pressable>
    </View>
  );
}
