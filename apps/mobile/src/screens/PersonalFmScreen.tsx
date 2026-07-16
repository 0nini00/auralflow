import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MusicInfo } from "@lx/core";

import { CachedImage } from "@/components/CachedImage";
import { AddToLocalPlaylistModal } from "@/components/AddToLocalPlaylistModal";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/ScreenState";
import { LoginScreen } from "@/screens/LoginScreen";
import { useAccountStore } from "@/stores/accountStore";
import { usePlayerStore } from "@/stores/playerStore";
import { usePlaylistStore } from "@/stores/playlistStore";
import { buildPersonalFmSongActions } from "@/services/currentSongActions";
import { buildPersonalFmMeta } from "@/services/personalFmMetaModel";
import { shouldShowNestedBackButton } from "@/services/appNavigation";
import { buildScreenTheme } from "@/services/screenThemeModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import {
  dislikeCurrentPersonalFmSong,
  playNext,
  startPersonalFm,
} from "@/services/playerService";
import { getPersonalFmSongs } from "@/services/wyPlaylistService";
import { radius, touch, typography } from "@/theme/tokens";

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
  const screenTheme = buildScreenTheme(palette);

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
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [starting, setStarting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [disliking, setDisliking] = useState(false);
  const [liking, setLiking] = useState(false);
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);

  const isFmPlaying = playbackContext.type === "personalFm" && !!currentSong;
  const fmSongs = playbackContext.type === "personalFm"
    ? playbackContext.currentBatch.slice(playbackContext.currentBatchIndex)
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
            <Text style={[styles.backText, { color: screenTheme.primaryBackground }]}>返回</Text>
          </Pressable>
        ) : null}

        <SectionHeader title={personalFmMeta.title} description={personalFmMeta.subtitle} />

        {!isLoggedIn && !loading && (
          <View style={styles.stateWithAction}>
            <EmptyState title="未登录网易云账号" description="私人 FM 依赖网易云登录态。" />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="登录网易云账号"
              style={[styles.primaryButton, { backgroundColor: screenTheme.primaryBackground }]}
              onPress={() => setShowLoginModal(true)}
            >
              <Text style={[styles.primaryButtonText, { color: screenTheme.primaryText }]}>登录账号</Text>
            </Pressable>
          </View>
        )}

        <Modal
        visible={showLoginModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowLoginModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭登录窗口"
              style={styles.modalCloseButton}
              onPress={() => setShowLoginModal(false)}
            >
              <Text style={styles.modalClose}>关闭</Text>
            </Pressable>
          </View>
          <LoginScreen onSuccess={() => setShowLoginModal(false)} />
        </View>
        </Modal>

        {loading && <LoadingState label="正在加载私人 FM" />}

        {!!error && !loading && <ErrorState message={error} onRetry={handleRetry} />}

        {!loading && isLoggedIn && activeSong && (
        <View style={[styles.hero, { backgroundColor: screenTheme.cardBackground }]}>
          {artwork ? (
            <CachedImage
              uri={artwork}
              style={styles.artwork}
              fallback={
                <View style={[styles.artwork, styles.artworkFallback, { backgroundColor: screenTheme.strongBackground }]}>
                  <Text style={[styles.artworkFallbackText, { color: screenTheme.primaryBackground }]}>FM</Text>
                </View>
              }
            />
          ) : (
            <View style={[styles.artwork, styles.artworkFallback, { backgroundColor: screenTheme.strongBackground }]}>
              <Text style={[styles.artworkFallbackText, { color: screenTheme.primaryBackground }]}>FM</Text>
            </View>
          )}

          <View style={styles.songInfo}>
            <Text style={[styles.songName, { color: screenTheme.titleText }]} numberOfLines={1}>{activeSong.name}</Text>
            <Text style={[styles.artistName, { color: screenTheme.bodyText }]} numberOfLines={1}>{activeSong.singer || "未知艺术家"}</Text>
            <Text style={[styles.albumName, { color: screenTheme.subtleText }]} numberOfLines={1}>{activeSong.albumName || "未知专辑"}</Text>
          </View>

          <View style={styles.actions}>
            {fmSongActions.show && (
              <View style={styles.secondaryActionsRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={fmSongActions.likeLabel}
                  style={[
                    styles.secondaryActionButton,
                    { backgroundColor: screenTheme.mutedBackground, borderColor: screenTheme.cardBorder },
                    isLiked && { backgroundColor: screenTheme.strongBackground, borderColor: screenTheme.primaryBackground },
                  ]}
                  onPress={handleLike}
                  disabled={liking}
                >
                  {liking ? (
                    <ActivityIndicator color={screenTheme.primaryBackground} size="small" />
                  ) : (
                    <Text style={[styles.secondaryActionText, { color: isLiked ? screenTheme.primaryBackground : screenTheme.primaryBackground }]}>
                      {fmSongActions.likeLabel}
                    </Text>
                  )}
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={fmSongActions.addToPlaylistLabel}
                  style={[styles.secondaryActionButton, { backgroundColor: screenTheme.mutedBackground, borderColor: screenTheme.cardBorder }]}
                  onPress={() => setAddToPlaylistVisible(true)}
                >
                  <Text style={[styles.secondaryActionText, { color: screenTheme.primaryBackground }]}>{fmSongActions.addToPlaylistLabel}</Text>
                </Pressable>
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isFmPlaying ? (isPlaying ? "暂停私人 FM" : "继续私人 FM") : "开始私人 FM"}
              style={[styles.actionButton, { backgroundColor: screenTheme.primaryBackground, borderColor: screenTheme.primaryBackground }]}
              onPress={handleTogglePlay}
              disabled={starting || playerLoading}
            >
              {starting || playerLoading ? (
                <ActivityIndicator color={screenTheme.primaryText} size="small" />
              ) : (
                <Text style={[styles.primaryActionText, { color: screenTheme.primaryText }]}>{isFmPlaying ? (isPlaying ? "暂停" : "继续") : "开始 FM"}</Text>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="播放下一首私人 FM"
              style={[styles.actionButton, { backgroundColor: screenTheme.mutedBackground, borderColor: screenTheme.cardBorder }]}
              onPress={handleNext}
              disabled={starting || skipping || disliking || (!isFmPlaying && previewSongs.length === 0)}
            >
              {skipping ? (
                <ActivityIndicator color={screenTheme.primaryBackground} size="small" />
              ) : (
                <Text style={[styles.actionText, { color: screenTheme.titleText }]}>下一首</Text>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="不喜欢当前私人 FM 歌曲"
              style={[styles.actionButton, { backgroundColor: screenTheme.mutedBackground, borderColor: screenTheme.cardBorder }]}
              onPress={handleDislike}
              disabled={starting || skipping || disliking || (!isFmPlaying && previewSongs.length === 0)}
            >
              {disliking ? (
                <ActivityIndicator color={screenTheme.dangerText} size="small" />
              ) : (
                <Text style={[styles.dislikeText, { color: screenTheme.dangerText }]}>不喜欢</Text>
              )}
            </Pressable>
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
          <EmptyState title="暂无可用 FM" description="稍后重试。" />
        )}

        {!loading && isLoggedIn && fmSongs.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title={isFmPlaying ? "接下来" : "当前推荐"} />
            <View style={styles.list}>
              {fmSongs.slice(0, 6).map((song, index) => (
                <View key={`${song.source}-${song.id}-${index}`} style={[styles.songRow, { backgroundColor: screenTheme.cardBackground }]}>
                  <View style={styles.songMeta}>
                    <Text style={[styles.rowSongName, { color: screenTheme.titleText }]} numberOfLines={1}>{song.name}</Text>
                    <Text style={[styles.rowArtistName, { color: screenTheme.bodyText }]} numberOfLines={1}>
                      {song.singer || "未知艺术家"}
                    </Text>
                  </View>
                  {isFmPlaying && index === 0 ? <Text style={[styles.playingTag, { color: screenTheme.primaryBackground }]}>播放中</Text> : null}
                </View>
              ))}
            </View>
          </View>
        )}
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

function makeStyles(palette: ReturnType<typeof getThemePalette>) {
  return StyleSheet.create({
  container: {
    gap: 16,
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
    borderRadius: radius.sm,
    padding: 16,
    gap: 16,
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
    gap: 12,
  },
  secondaryActionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  secondaryActionButton: {
    flex: 1,
    minHeight: touch.minTarget,
    borderRadius: radius.pill,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.background,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 12,
  },
  secondaryActionText: {
    fontSize: typography.body,
    fontWeight: "700",
    color: palette.primary,
  },
  actionButton: {
    minHeight: 48,
    borderRadius: radius.pill,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.background,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 16,
  },
  actionText: {
    fontSize: typography.body,
    fontWeight: "600",
    color: palette.text,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.primary,
    paddingHorizontal: 20,
    alignSelf: "stretch",
  },
  primaryButtonText: {
    fontSize: typography.body,
    fontWeight: "700",
    color: palette.primaryText,
  },
  primaryActionText: {
    fontSize: typography.body,
    fontWeight: "700",
    color: palette.primaryText,
  },
  dislikeText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  stateWithAction: {
    gap: 8,
  },
  section: {
    gap: 12,
  },
  list: {
    gap: 8,
  },
  songRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: radius.sm,
    backgroundColor: palette.surface,
  },
  songMeta: {
    flex: 1,
    gap: 4,
  },
  rowSongName: {
    fontSize: typography.body,
    fontWeight: "600",
    color: palette.text,
  },
  rowArtistName: {
    fontSize: typography.meta,
    color: palette.textMuted,
  },
  playingTag: {
    fontSize: typography.caption,
    fontWeight: "600",
    color: palette.primary,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: palette.background,
  },
  modalHeader: {
    alignItems: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  modalCloseButton: {
    minHeight: touch.minTarget,
    minWidth: touch.minTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  modalClose: {
    fontSize: typography.body,
    fontWeight: "600",
    color: palette.text,
  },
  });
}
