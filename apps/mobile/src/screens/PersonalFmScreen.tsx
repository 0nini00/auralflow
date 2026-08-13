import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MusicInfo } from "@lx/core";

import { ActionButton } from "@/components/ActionButton";
import { CachedImage } from "@/components/CachedImage";
import { AddToLocalPlaylistModal } from "@/components/AddToLocalPlaylistModal";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SectionHeader } from "@/components/SectionHeader";
import { SongList } from "@/components/SongList";
import { Radio } from "lucide-react-native";

import { EmptyState, ErrorState, LoadingState } from "@/components/ScreenState";
import { useAccountStore } from "@/stores/accountStore";
import { usePlayerStore } from "@/stores/playerStore";
import { usePlaylistStore } from "@/stores/playlistStore";
import { buildPersonalFmSongActions } from "@/services/currentSongActions";
import { buildPersonalFmMeta } from "@/services/personalFmMetaModel";
import { shouldShowNestedBackButton } from "@/services/appNavigation";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import {
  dislikeCurrentPersonalFmSong,
  playNext,
  startPersonalFm,
} from "@/services/playerService";
import { getPersonalFmSongs } from "@/services/wyPlaylistService";
import { radius, spacing, touch, typography } from "@/theme/tokens";

interface PersonalFmScreenProps {
  onNavigateToPlayer: () => void;
  onBack?: () => void;
}

export function PersonalFmScreen({ onNavigateToPlayer, onBack }: PersonalFmScreenProps) {
  const isLoggedIn = useAccountStore((state) => state.isLoggedIn);
  const user = useAccountStore((state) => state.user);
  const checkStatus = useAccountStore((state) => state.checkStatus);
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const styles = makeStyles(palette);

  const currentSong = usePlayerStore((state) => state.currentSong);
  const playbackContext = usePlayerStore((state) => state.playbackContext);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const playerLoading = usePlayerStore((state) => state.loading);
  const pause = usePlayerStore((state) => state.pause);
  const resume = usePlayerStore((state) => state.resume);
  const isLiked = usePlaylistStore((state) => state.isLiked(currentSong));
  const likeSong = usePlaylistStore((state) => state.likeSong);
  const unlikeSong = usePlaylistStore((state) => state.unlikeSong);

  const [previewSongs, setPreviewSongs] = useState<MusicInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [disliking, setDisliking] = useState(false);
  const [liking, setLiking] = useState(false);
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);

  const isFmPlaying = playbackContext.type === "personalFm" && !!currentSong;
  const fmSongs = playbackContext.type === "personalFm"
    ? [
        ...playbackContext.currentBatch.slice(playbackContext.currentBatchIndex),
        ...playbackContext.buffer,
      ]
    : previewSongs;

  const loadPreviewSongs = useCallback(async (isMounted: () => boolean = () => true) => {
    if (!isLoggedIn) {
      if (isMounted()) {
        setPreviewSongs([]);
        setError(null);
        setLoading(false);
      }
      return;
    }

    if (isMounted()) {
      setLoading(true);
      setError(null);
    }

    try {
      const result = await getPersonalFmSongs();
      if (isMounted()) {
        setPreviewSongs(result.songs);
      }
    } catch (err) {
      if (isMounted()) {
        setPreviewSongs([]);
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (isMounted()) {
        setLoading(false);
      }
    }
  }, [isLoggedIn]);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    let mounted = true;
    void loadPreviewSongs(() => mounted);

    return () => {
      mounted = false;
    };
  }, [loadPreviewSongs]);

  const activeSong = isFmPlaying ? currentSong : previewSongs[0] || null;
  const artwork = activeSong?.picUrl || activeSong?.img;
  const fmSongActions = buildPersonalFmSongActions(isFmPlaying ? currentSong : null, isLiked);
  const personalFmMeta = buildPersonalFmMeta(isLoggedIn, user);
  const showBackButton = shouldShowNestedBackButton(onBack);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      await startPersonalFm();
      onNavigateToPlayer();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const handleTogglePlay = async () => {
    if (!isFmPlaying) {
      await handleStart();
      return;
    }

    if (isPlaying) {
      await pause();
    } else {
      await resume();
    }
  };

  const handleRetry = () => {
    void loadPreviewSongs();
  };

  const handleFmSongPress = (_song: MusicInfo, index: number) => {
    if (isFmPlaying && index === 0) {
      void handleTogglePlay();
    }
  };

  const handleNext = async () => {
    setSkipping(true);
    setError(null);
    try {
      if (!isFmPlaying) {
        await startPersonalFm();
      } else {
        await playNext();
      }
      onNavigateToPlayer();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSkipping(false);
    }
  };

  const handleDislike = async () => {
    setDisliking(true);
    setError(null);
    try {
      if (!isFmPlaying) {
        await startPersonalFm();
      } else {
        await dislikeCurrentPersonalFmSong();
      }
      onNavigateToPlayer();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDisliking(false);
    }
  };

  const handleLike = async () => {
    if (!currentSong || liking) return;

    setLiking(true);
    setError(null);
    try {
      if (isLiked) {
        await unlikeSong(currentSong);
      } else {
        await likeSong(currentSong);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLiking(false);
    }
  };

  return (
    <ScreenScaffold>
      <ScreenScrollView contentContainerStyle={styles.container}>
        {showBackButton && onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回"
            style={styles.backButton}
            onPress={onBack}
          >
            <Text style={[styles.backText, { color: palette.primary }]}>返回</Text>
          </Pressable>
        ) : null}

        <SectionHeader title={personalFmMeta.title} description={personalFmMeta.subtitle} />

        {!isLoggedIn && !loading && (
          <View style={styles.stateWithAction}>
            <EmptyState
              title="未登录网易云账号"
              description="请在 设置 → 账号与服务 登录网易云账号后使用私人 FM。"
            />
          </View>
        )}

        {loading && <LoadingState label="正在加载私人 FM" />}

        {!!error && !loading && <ErrorState message={error} onRetry={handleRetry} />}

        {!loading && isLoggedIn && activeSong && (
        <View style={[styles.hero, { backgroundColor: palette.surface }]}>
          {artwork ? (
            <CachedImage
              uri={artwork}
              style={styles.artwork}
              fallback={
                <View style={[styles.artwork, styles.artworkFallback, { backgroundColor: palette.surfaceStrong }]}>
                  <Text style={[styles.artworkFallbackText, { color: palette.primary }]}>FM</Text>
                </View>
              }
            />
          ) : (
            <View style={[styles.artwork, styles.artworkFallback, { backgroundColor: palette.surfaceStrong }]}>
              <Text style={[styles.artworkFallbackText, { color: palette.primary }]}>FM</Text>
            </View>
          )}

          <View style={styles.songInfo}>
            <Text style={[styles.songName, { color: palette.text }]} numberOfLines={1}>{activeSong.name}</Text>
            <Text style={[styles.artistName, { color: palette.textMuted }]} numberOfLines={1}>{activeSong.singer || "未知艺术家"}</Text>
            <Text style={[styles.albumName, { color: palette.textSubtle }]} numberOfLines={1}>{activeSong.albumName || "未知专辑"}</Text>
          </View>

          <View style={styles.actions}>
            {fmSongActions.show && (
              <View style={styles.secondaryActionsRow}>
                <ActionButton
                  shrink
                  small
                  variant={isLiked ? "primary" : "secondary"}
                  label={fmSongActions.likeLabel}
                  loading={liking}
                  onPress={() => void handleLike()}
                  accessibilityLabel={fmSongActions.likeLabel}
                />

                <ActionButton
                  shrink
                  small
                  variant="secondary"
                  label={fmSongActions.addToPlaylistLabel}
                  onPress={() => setAddToPlaylistVisible(true)}
                  accessibilityLabel={fmSongActions.addToPlaylistLabel}
                />
              </View>
            )}

            <ActionButton
              grow
              variant="primary"
              label={isFmPlaying ? (isPlaying ? "暂停" : "继续") : "开始 FM"}
              loading={starting || playerLoading}
              onPress={() => void handleTogglePlay()}
              accessibilityLabel={isFmPlaying ? (isPlaying ? "暂停私人 FM" : "继续私人 FM") : "开始私人 FM"}
            />

            <ActionButton
              grow
              variant="secondary"
              label="下一首"
              loading={skipping}
              disabled={starting || disliking || (!isFmPlaying && previewSongs.length === 0)}
              onPress={() => void handleNext()}
              accessibilityLabel="播放下一首私人 FM"
            />

            <ActionButton
              grow
              variant="danger"
              label="不喜欢"
              loading={disliking}
              disabled={starting || skipping || (!isFmPlaying && previewSongs.length === 0)}
              onPress={() => void handleDislike()}
              accessibilityLabel="不喜欢当前私人 FM 歌曲"
            />
          </View>
        </View>
        )}

        {currentSong && (
        <AddToLocalPlaylistModal
          visible={addToPlaylistVisible}
          song={currentSong}
          onClose={() => setAddToPlaylistVisible(false)}
        />
        )}

        {!loading && isLoggedIn && !error && fmSongs.length === 0 && (
          <EmptyState icon={Radio} title="暂无可用 FM" description="暂时没有可播放的歌曲，稍后刷新再试。" />
        )}

        {!loading && isLoggedIn && fmSongs.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title={isFmPlaying ? "接下来" : "当前推荐"} />
            <SongList
              songs={fmSongs}
              onPlay={handleFmSongPress}
              highlightedIndex={isFmPlaying ? 0 : null}
              hideSourceTag
              showLikeAction={false}
              showMoreAction={false}
              isSongPressable={(_song, index) => isFmPlaying && index === 0}
            />
          </View>
        )}
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

function makeStyles(palette: ReturnType<typeof getThemePalette>) {
  return StyleSheet.create({
  container: {
    gap: spacing.l,
  },
  backButton: {
    minHeight: touch.minTarget,
    minWidth: touch.minTarget,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  backText: {
    fontSize: typography.title,
    color: palette.primary,
    fontWeight: "600",
  },
  hero: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    padding: spacing.m,
    gap: spacing.m,
  },
  artwork: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radius.sm,
  },
  artworkFallback: {
    backgroundColor: palette.surfaceStrong,
    justifyContent: "center",
    alignItems: "center",
  },
  artworkFallbackText: {
    fontSize: typography.displayLg,
    fontWeight: "700",
    color: palette.primary,
  },
  songInfo: {
    gap: 6,
  },
  songName: {
    fontSize: typography.display,
    fontWeight: "700",
    color: palette.text,
  },
  artistName: {
    fontSize: typography.body,
    color: palette.textMuted,
  },
  albumName: {
    fontSize: typography.meta,
    color: palette.textSubtle,
  },
  actions: {
    gap: spacing.s,
  },
  secondaryActionsRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  stateWithAction: {
    gap: 8,
  },
  section: {
    gap: spacing.s,
  },
  });
}
