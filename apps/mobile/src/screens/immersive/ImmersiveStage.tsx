import React from "react";
import { Pressable, View } from "react-native";
import type { MusicInfo } from "@lx/core";
import { Music2 } from "lucide-react-native";
import type { ThemePalette } from "@/stores/themeStore";
import { CachedImage } from "@/components/CachedImage";
import { LyricView } from "@/components/LyricView";
import { PosterMode } from "@/screens/immersive/PosterMode";
import { styles } from "@/screens/immersive/immersiveStyles";

export interface ImmersiveStageProps {
  isTablet: boolean;
  posterMode: boolean;
  showCoverSection: boolean;
  coverSize: number;
  artwork?: string;
  currentSong: MusicInfo;
  palette: ThemePalette;
  lyrics: Array<{ time: number; text: string; tr?: string }>;
  currentLyricIndex: number;
  position: number;
  duration: number;
  isPlaying: boolean;
  showTranslation: boolean;
  phoneLyricsVisible: boolean;
  controlsVisible: boolean;
  insetsTop: number;
  onSeek: (time: number) => void;
  onTogglePhoneLyrics: () => void;
}

/**
 * 沉浸式舞台：
 * - 平板：封面 + 全屏歌词并排（或海报模式）
 * - 手机：封面默认，点一下展开两行歌词
 */
export function ImmersiveStage({
  isTablet,
  posterMode,
  showCoverSection,
  coverSize,
  artwork,
  currentSong,
  palette,
  lyrics,
  currentLyricIndex,
  position,
  duration,
  isPlaying,
  showTranslation,
  phoneLyricsVisible,
  controlsVisible,
  insetsTop,
  onSeek,
  onTogglePhoneLyrics,
}: ImmersiveStageProps) {
  if (isTablet) {
    if (posterMode) {
      return (
        <PosterMode
          artwork={artwork}
          songName={currentSong.name}
          artist={currentSong.singer || "未知艺术家"}
          lyrics={lyrics}
          currentLineIndex={currentLyricIndex}
          currentTime={position}
          duration={duration}
          isPlaying={isPlaying}
          showTranslation={showTranslation}
          controlsHidden={!controlsVisible}
          palette={palette}
          onSeek={onSeek}
          posterWidth={coverSize}
          showLyrics
        />
      );
    }

    return (
      <View
        style={[
          styles.stage,
          {
            paddingTop: insetsTop + 64,
            paddingBottom: controlsVisible ? 220 : 48,
            flexDirection: "row",
          },
        ]}
      >
        {showCoverSection ? (
          <View style={[styles.coverSection, styles.coverSectionTablet]}>
            <View style={[styles.coverFrame, { width: coverSize, height: coverSize }]}>
              {artwork ? (
                <CachedImage
                  uri={artwork}
                  style={styles.coverImage}
                  fallback={
                    <View
                      style={[
                        styles.coverImage,
                        styles.coverPlaceholder,
                        { backgroundColor: palette.surfaceStrong },
                      ]}
                    >
                      <Music2 size={48} color={palette.primary} />
                    </View>
                  }
                />
              ) : (
                <View
                  style={[
                    styles.coverImage,
                    styles.coverPlaceholder,
                    { backgroundColor: palette.primary },
                  ]}
                >
                  <Music2 size={48} color={palette.primaryText} />
                </View>
              )}
            </View>
          </View>
        ) : null}

        <View style={[styles.lyricSection, styles.lyricSectionTablet]}>
          <LyricView
            lyrics={lyrics}
            currentLineIndex={currentLyricIndex}
            showTranslation={showTranslation}
            palette={palette}
            onSeek={onSeek}
            style={styles.lyricList}
          />
        </View>
      </View>
    );
  }

  return (
    <Pressable
      style={styles.phoneStage}
      onPress={onTogglePhoneLyrics}
      accessibilityRole="button"
      accessibilityLabel={phoneLyricsVisible ? "隐藏歌词" : "显示歌词"}
    >
      <PosterMode
        artwork={artwork}
        songName={currentSong.name}
        artist={currentSong.singer || "未知艺术家"}
        lyrics={lyrics}
        currentLineIndex={currentLyricIndex}
        currentTime={position}
        duration={duration}
        isPlaying={isPlaying}
        showTranslation={showTranslation}
        controlsHidden={!controlsVisible}
        palette={palette}
        onSeek={onSeek}
        posterWidth={coverSize}
        showLyrics={phoneLyricsVisible}
      />
    </Pressable>
  );
}
