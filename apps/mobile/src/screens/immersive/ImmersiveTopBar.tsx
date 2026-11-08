import React, { useState } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { ChevronDown, MoreHorizontal } from "lucide-react-native";
import type { ThemePalette } from "@/stores/themeStore";
import { IconButton } from "@/components/ui/IconButton";
import { styles } from "@/screens/immersive/immersiveStyles";
import { Marquee } from "@/screens/immersive/Marquee";

export interface ImmersiveTopBarProps {
  insetsTop: number;
  songName: string;
  artist: string;
  palette: ThemePalette;
  onClose: () => void;
  onOpenMore: () => void;
  moreMenuVisible?: boolean;
  onPressArtist?: () => void;
}

/** 顶部信息栏：关闭 / 歌名歌手 / 更多 */
export function ImmersiveTopBar({
  insetsTop,
  songName,
  artist,
  palette,
  onClose,
  onOpenMore,
  moreMenuVisible = false,
  onPressArtist,
}: ImmersiveTopBarProps) {
  const [titleWidth, setTitleWidth] = useState(0);

  return (
    <View style={[styles.topBar, { paddingTop: insetsTop + 8 }]}>
      <IconButton
        onPress={onClose}
        tone="default"
        accessibilityLabel="关闭播放器"
        render={({ size }) => <ChevronDown size={size} color={palette.text} />}
      />

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

      <IconButton
        onPress={onOpenMore}
        tone="default"
        accessibilityLabel="更多选项"
        accessibilityState={{ expanded: moreMenuVisible }}
        render={({ size }) => <MoreHorizontal size={size} color={palette.text} />}
      />
    </View>
  );
}
