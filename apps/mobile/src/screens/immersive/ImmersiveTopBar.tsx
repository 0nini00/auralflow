import React, { useState } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { ChevronLeft, SlidersHorizontal, Timer } from "lucide-react-native";
import type { ThemePalette } from "@/stores/themeStore";
import { styles } from "@/screens/immersive/immersiveStyles";
import { Marquee } from "@/screens/immersive/Marquee";

export interface ImmersiveTopBarProps {
  insetsTop: number;
  songName: string;
  artist: string;
  palette: ThemePalette;
  onClose: () => void;
  onOpenPlaySetting: () => void;
  onPressArtist?: () => void;
  sleepLabel: string;
  sleepActive: boolean;
  onOpenSleep: () => void;
}

/** 顶部信息栏（对齐 lx 竖屏 Header）：关闭 / 歌名歌手 / 睡眠 / 设置 */
export function ImmersiveTopBar({
  insetsTop,
  songName,
  artist,
  palette,
  onClose,
  onOpenPlaySetting,
  onPressArtist,
  sleepLabel,
  sleepActive,
  onOpenSleep,
}: ImmersiveTopBarProps) {
  const [titleWidth, setTitleWidth] = useState(0);

  return (
    <View style={[styles.topBar, { paddingTop: insetsTop + 8 }]}>
      <Pressable
        onPress={onClose}
        style={styles.closeButton}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="关闭播放器"
      >
        <ChevronLeft size={26} color={palette.text} />
      </Pressable>

      <View
        style={styles.topInfo}
        onLayout={(e: LayoutChangeEvent) => setTitleWidth(e.nativeEvent.layout.width)}
      >
        {titleWidth > 0 ? (
          <Marquee
            text={songName}
            width={titleWidth}
            style={[styles.songName, { color: palette.text }]}
          />
        ) : (
          <Text style={[styles.songName, { color: palette.text }]} numberOfLines={1}>
            {songName}
          </Text>
        )}
        <Pressable
          onPress={onPressArtist}
          disabled={!onPressArtist}
          hitSlop={8}
          accessibilityRole={onPressArtist ? "button" : "text"}
          accessibilityLabel={onPressArtist ? `查看歌手 ${artist}` : undefined}
        >
          <Text style={[styles.artistName, { color: palette.textMuted }]} numberOfLines={1}>
            {artist}
          </Text>
        </Pressable>
      </View>

      <Pressable onPress={onOpenSleep} style={styles.topRightIconButton} hitSlop={12}>
        <Timer size={20} color={sleepActive ? palette.primary : palette.text} />
      </Pressable>

      <Pressable onPress={onOpenPlaySetting} style={styles.topRightIconButton} hitSlop={12}>
        <SlidersHorizontal size={20} color={palette.text} />
      </Pressable>
    </View>
  );
}