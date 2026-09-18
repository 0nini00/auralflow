import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MusicInfo } from "@lx/core";
import { COVER_SIZE_LARGE } from "@lx/core";
import {
  FolderPlus,
  Heart,
  Pause,
  Play,
  Radio,
  SkipForward,
  Trash2,
} from "lucide-react-native";

import { CachedImage } from "@/components/CachedImage";
import { AddToLocalPlaylistModal } from "@/components/AddToLocalPlaylistModal";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SectionHeader } from "@/components/SectionHeader";
import { SongList } from "@/components/SongList";
import { Touchable } from "@/components/Touchable";
import { EmptyState, ErrorState, LoadingState } from "@/components/ScreenState";
import { useAccountStore } from "@/stores/accountStore";
import { usePlayerStore } from "@/stores/playerStore";
import { useFavoritesStore } from "@/stores/favoritesStore";
import { buildPersonalFmMeta } from "@/services/personalFmMetaModel";
import { shouldShowNestedBackButton } from "@/services/appNavigation";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import {
  dislikeCurrentPersonalFmSong,
  playNext,
  startPersonalFm,
  startPersonalFmWithSongs,
} from "@/services/playerService";
import { getPersonalFmSongs } from "@/services/wyPlaylistService";
import { withAlpha } from "@/services/themePaletteModel";
import { hapticLight } from "@/services/hapticService";
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

  // 心形收藏（对齐桌面端本地收藏）
  const isLiked = useFavoritesStore((state) => state.isFavorite(currentSong));
  const toggleFavorite = useFavoritesStore((state) => state.toggleFavorite);

  const [previewSongs, setPreviewSongs] = useState<MusicInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [disliking, setDisliking] = useState(false);
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);

  const isFmPlaying = playbackContext.type === "personalFm" && !!currentSong;
  const fmSongs =
    playbackContext.type === "personalFm"
      ? [
          ...playbackContext.currentBatch.slice(playbackContext.currentBatchIndex),
          ...playbackContext.buffer,
        ]
      : previewSongs;

  const loadPreviewSongs = useCallback(
    async (isMounted: () => boolean = () => true) => {
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
    },
    [isLoggedIn],
  );

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
  const personalFmMeta = buildPersonalFmMeta(isLoggedIn, user);
  const showBackButton = shouldShowNestedBackButton(onBack);

  const startFmWithPreview = async (startIndex = 0) => {
    if (previewSongs.length > 0) {
      await startPersonalFmWithSongs(previewSongs, true, startIndex);
    } else {
      await startPersonalFm();
    }
  };

  const handleStart = async (startIndex = 0) => {
    setStarting(true);
    setError(null);
    try {
      await startFmWithPreview(startIndex);
      onNavigateToPlayer();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const handleTogglePlay = async () => {
    hapticLight();
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

  const handleFmSongPress = async (_song: MusicInfo, index: number) => {
    if (isFmPlaying) {
      if (index === 0) {
        await handleTogglePlay();
      }
      return;
    }
    await handleStart(index);
  };

  const handleNext = async () => {
    hapticLight();
    setSkipping(true);
    setError(null);
    try {
      if (!isFmPlaying) {
        await startFmWithPreview();
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
    hapticLight();
    setDisliking(true);
    setError(null);
    try {
      if (!isFmPlaying) {
        await startFmWithPreview();
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

  const handleLike = () => {
    if (!currentSong) return;
    hapticLight();
    toggleFavorite(currentSong);
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
              description="请在「设置 → 账号与服务」中登录网易云账号后使用私人 FM。"
            />
          </View>
        )}

        {loading && <LoadingState label="正在载入电台漫游..." />}

        {!!error && !loading && <ErrorState message={error} onRetry={handleRetry} />}

        {!loading && isLoggedIn && activeSong && (
          <View style={[styles.heroCard, { backgroundColor: palette.surface }]}>
            {/* 黑胶封面展示区 */}
            <View style={styles.coverHost}>
              {artwork ? (
                <CachedImage
                  uri={artwork}
                  size={COVER_SIZE_LARGE}
                  style={styles.artwork}
                  fallback={
                    <View
                      style={[
                        styles.artwork,
                        styles.artworkFallback,
                        { backgroundColor: palette.surfaceStrong },
                      ]}
                    >
                      <Radio size={48} color={palette.primary} />
                    </View>
                  }
                />
              ) : (
                <View
                  style={[
                    styles.artwork,
                    styles.artworkFallback,
                    { backgroundColor: palette.surfaceStrong },
                  ]}
                >
                  <Radio size={48} color={palette.primary} />
                </View>
              )}
            </View>

            {/* 歌曲主信息 */}
            <View style={styles.songInfo}>
              <Text
                style={[styles.songName, { color: palette.text }]}
                numberOfLines={1}
              >
                {activeSong.name}
              </Text>
              <Text
                style={[styles.artistName, { color: palette.textMuted }]}
                numberOfLines={1}
              >
                {activeSong.singer || "未知歌手"}
                {activeSong.albumName ? `  ·  ${activeSong.albumName}` : ""}
              </Text>
            </View>

            {/* 辅助操作栏（心形收藏 + 添加到歌单） */}
            <View style={styles.utilityRow}>
              <Touchable
                style={[
                  styles.utilityChip,
                  {
                    backgroundColor: isLiked
                      ? withAlpha(palette.danger, 0.12)
                      : palette.surfaceMuted,
                  },
                ]}
                onPress={handleLike}
                activeScale={0.95}
                accessibilityRole="button"
                accessibilityLabel={isLiked ? "取消喜欢" : "喜欢这首歌"}
              >
                <Heart
                  size={16}
                  color={isLiked ? palette.danger : palette.textMuted}
                  fill={isLiked ? palette.danger : "transparent"}
                />
                <Text
                  style={[
                    styles.utilityText,
                    { color: isLiked ? palette.danger : palette.textMuted },
                  ]}
                >
                  {isLiked ? "已喜欢" : "喜欢"}
                </Text>
              </Touchable>

              <Touchable
                style={[styles.utilityChip, { backgroundColor: palette.surfaceMuted }]}
                onPress={() => setAddToPlaylistVisible(true)}
                activeScale={0.95}
                accessibilityRole="button"
                accessibilityLabel="收藏到歌单"
              >
                <FolderPlus size={16} color={palette.textMuted} />
                <Text style={[styles.utilityText, { color: palette.textMuted }]}>歌单</Text>
              </Touchable>
            </View>

            {/* 极简圆形电台控制器（垃圾桶 + 播放圆钮 + 下一首） */}
            <View style={styles.radioControls}>
              {/* 不喜欢/垃圾桶 */}
              <Touchable
                style={[styles.sideBtn, { backgroundColor: palette.surfaceMuted }]}
                onPress={() => void handleDislike()}
                disabled={starting || skipping || (!isFmPlaying && previewSongs.length === 0)}
                activeScale={0.92}
                accessibilityRole="button"
                accessibilityLabel="不喜欢这首歌"
              >
                {disliking ? (
                  <ActivityIndicator size="small" color={palette.danger} />
                ) : (
                  <Trash2 size={20} color={palette.textMuted} />
                )}
              </Touchable>

              {/* 核心大播放圆钮 */}
              <Touchable
                style={[
                  styles.mainPlayBtn,
                  {
                    backgroundColor: palette.primary,
                    shadowColor: palette.primary,
                  },
                ]}
                onPress={() => void handleTogglePlay()}
                disabled={starting || playerLoading}
                activeScale={0.94}
                accessibilityRole="button"
                accessibilityLabel={
                  isFmPlaying ? (isPlaying ? "暂停" : "继续播放") : "开始电台"
                }
              >
                {starting || playerLoading ? (
                  <ActivityIndicator size="small" color={palette.primaryText} />
                ) : isFmPlaying && isPlaying ? (
                  <Pause size={28} color={palette.primaryText} fill={palette.primaryText} />
                ) : (
                  <Play size={28} color={palette.primaryText} fill={palette.primaryText} style={{ marginLeft: 3 }} />
                )}
              </Touchable>

              {/* 下一首 */}
              <Touchable
                style={[styles.sideBtn, { backgroundColor: palette.surfaceMuted }]}
                onPress={() => void handleNext()}
                disabled={starting || disliking || (!isFmPlaying && previewSongs.length === 0)}
                activeScale={0.92}
                accessibilityRole="button"
                accessibilityLabel="跳到下一首"
              >
                {skipping ? (
                  <ActivityIndicator size="small" color={palette.primary} />
                ) : (
                  <SkipForward size={22} color={palette.text} />
                )}
              </Touchable>
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
          <EmptyState
            icon={Radio}
            title="暂无推荐歌曲"
            description="暂时没有可播放的歌曲，稍后刷新再试。"
          />
        )}

        {!loading && isLoggedIn && fmSongs.length > 1 && (
          <View style={styles.section}>
            <SectionHeader title={isFmPlaying ? "接下来播放" : "备选推荐"} />
            <SongList
              songs={fmSongs.slice(isFmPlaying ? 1 : 0)}
              onPlay={handleFmSongPress}
              hideSourceTag
              showLikeAction={false}
              showMoreAction={false}
              isSongPressable={(_song, index) =>
                isFmPlaying ? true : previewSongs.length > 0
              }
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
      paddingHorizontal: spacing.l,
      paddingBottom: spacing.xl,
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
    stateWithAction: {
      paddingVertical: 40,
    },
    heroCard: {
      borderRadius: 20,
      padding: spacing.l,
      alignItems: "center",
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    coverHost: {
      width: "82%",
      maxWidth: 280,
      aspectRatio: 1,
      borderRadius: 16,
      overflow: "hidden",
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
      marginBottom: spacing.l,
    },
    artwork: {
      width: "100%",
      height: "100%",
    },
    artworkFallback: {
      justifyContent: "center",
      alignItems: "center",
    },
    songInfo: {
      alignItems: "center",
      gap: 6,
      width: "100%",
      paddingHorizontal: spacing.m,
      marginBottom: spacing.m,
    },
    songName: {
      fontSize: 20,
      fontWeight: "700",
      textAlign: "center",
    },
    artistName: {
      fontSize: 14,
      textAlign: "center",
    },
    utilityRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.m,
      marginBottom: spacing.l,
    },
    utilityChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: spacing.m,
      paddingVertical: 7,
      borderRadius: radius.pill,
    },
    utilityText: {
      fontSize: 12,
      fontWeight: "600",
    },
    radioControls: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 28,
      paddingVertical: spacing.xs,
      width: "100%",
    },
    sideBtn: {
      width: 48,
      height: 48,
      borderRadius: 24,
      justifyContent: "center",
      alignItems: "center",
    },
    mainPlayBtn: {
      width: 66,
      height: 66,
      borderRadius: 33,
      justifyContent: "center",
      alignItems: "center",
      shadowOpacity: 0.35,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    section: {
      gap: spacing.s,
    },
  });
}
