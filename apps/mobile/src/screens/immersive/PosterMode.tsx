import React from "react";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { Music2 } from "lucide-react-native";
import type { ThemePalette } from "@/stores/themeStore";
import { CachedImage } from "@/components/CachedImage";
import { KaraokeLyricLine } from "@/components/KaraokeLyricLine";
import { PosterWaveVisualizer } from "@/components/PosterWaveVisualizer";
import { getPosterWaveSeekTime } from "@/services/immersiveControlsModel";
import { styles } from "./immersiveStyles";

export interface PosterModeProps {
  artwork?: string;
  songName: string;
  artist: string;
  lyrics: Array<{ time: number; text: string; tr?: string }>;
  currentLineIndex: number;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  showTranslation: boolean;

  controlsHidden: boolean;

  palette: ThemePalette;

  onSeek: (time: number) => void;

  posterWidth: number;

  // 手机折叠态：false=只出封面，true=封面+两行歌词

  showLyrics?: boolean;

}

const posterKaraokeFontSize = 22;

export function PosterMode({
  artwork,
  songName,
  artist,
  lyrics,
  currentLineIndex,
  currentTime,
  duration,
  isPlaying,
  showTranslation,
  controlsHidden,

  palette,

  onSeek,

  posterWidth,

  showLyrics = true,

}: PosterModeProps) {
  const waveWidthRef = React.useRef(0);
  const currentLine = currentLineIndex >= 0 ? lyrics[currentLineIndex] : null;
  const secondaryLine = React.useMemo(() => {
    if (!currentLine) return null;
    if (showTranslation && currentLine.tr && currentLine.tr.trim().length > 0) return currentLine.tr;
    const nextIndex = currentLineIndex + 1;
    if (nextIndex >= 0 && nextIndex < lyrics.length) return lyrics[nextIndex]?.text ?? null;
    return null;
  }, [currentLine, currentLineIndex, lyrics, showTranslation]);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrentTime = Number.isFinite(currentTime)
    ? Math.min(safeDuration, Math.max(0, currentTime))
    : 0;
  const progressPercent = safeDuration > 0 ? (safeCurrentTime / safeDuration) * 100 : 0;

  const karaokeProgress = (() => {
    if (!currentLine) return 0;
    const next = lyrics[currentLineIndex + 1];
    if (next && next.time > currentLine.time) {
      return Math.min(1, Math.max(0, (currentTime - currentLine.time) / (next.time - currentLine.time)));
    }
    return 0;
  })();

  const handleWaveLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    waveWidthRef.current = Number.isFinite(width) && width > 0 ? width : 0;
  };

  const handleWavePress = (event: GestureResponderEvent) => {
    event.stopPropagation();
    const seekTime = getPosterWaveSeekTime(
      event.nativeEvent.locationX,
      waveWidthRef.current,
      duration,
    );
    if (seekTime == null) return;
    onSeek(seekTime);
  };

  return (
    <View style={styles.posterRoot} pointerEvents="box-none">
      <View style={[styles.posterArtWrap, { width: posterWidth, height: posterWidth }]}>
        {artwork ? (
          <CachedImage
            uri={artwork}
            style={styles.posterArt}
            fallback={
              <View style={[styles.posterArt, styles.posterArtPlaceholder, { backgroundColor: palette.surface }]}>
                <Music2 size={56} color={palette.textMuted} />
              </View>
            }
          />
        ) : (
          <View style={[styles.posterArt, styles.posterArtPlaceholder, { backgroundColor: palette.surface }]}>
            <Music2 size={56} color={palette.textMuted} />
          </View>
        )}
      </View>

      {showLyrics ? (

        <View style={styles.posterInfo}>

          <Text style={[styles.posterSongName, { color: palette.text }]} numberOfLines={1}>

            {songName}

          </Text>

          <Text style={[styles.posterArtist, { color: palette.textMuted }]} numberOfLines={1}>

            {artist}

          </Text>

        </View>

      ) : null}



      {/* 当前歌词叠加（含 karaoke 逐字进度）；手机折叠态下 showLyrics=false 时隐藏 */}

      {showLyrics ? (

      <View style={styles.posterLyricWrap}>
        {currentLine ? (
          <>
            <KaraokeLyricLine
              text={currentLine?.text ?? ""}
              progress={karaokeProgress}
              baseColor={palette.text}
              activeColor={palette.primary}
              fontSize={posterKaraokeFontSize}
              textAlign="center"
            />
            {secondaryLine ? (
              <Text
                style={[styles.posterTranslation, { color: palette.textMuted }]}
                numberOfLines={1}
              >
                {secondaryLine}
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={[styles.posterLyric, { color: palette.textMuted }]}>
            {lyrics.length === 0 ? "暂无歌词" : "音乐"}
          </Text>
        )}
      </View>

      ) : null}



      {/* 隐藏控制栏时，底部渲染桌面同款律动波 */}
      {controlsHidden ? (
        <Pressable
          style={styles.posterWaveArea}
          onLayout={handleWaveLayout}
          onPress={handleWavePress}
          accessibilityRole="adjustable"
          accessibilityLabel="播放进度"
          accessibilityValue={{
            min: 0,
            max: safeDuration,
            now: safeCurrentTime,
          }}
        >
          <PosterWaveVisualizer
            progressPercent={progressPercent}
            isPlaying={isPlaying}
            accentColor={palette.primary}
            baselineColor={palette.textMuted}
          />
        </Pressable>
      ) : null}
    </View>
  );
}
