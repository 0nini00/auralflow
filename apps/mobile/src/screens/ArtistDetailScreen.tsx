import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { spacing, typography } from "@/theme/tokens";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MusicInfo } from "@lx/core";

import { DetailHero } from "@/components/DetailHero";
import { PlaybackActionButtons } from "@/components/PlaybackActionButtons";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { Disc3 } from "lucide-react-native";

import { EmptyState, ErrorState, LoadingState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { SectionHeader } from "@/components/SectionHeader";
import { SongList } from "@/components/SongList";
import {
  AlbumResultList,
  type AlbumPressHandler,
} from "@/components/SearchResultSections";
import {
  fetchNeteaseArtistDetail,
  type ArtistDetailResult,
  type SearchArtistResult,
} from "@/services/musicApi";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import {
  buildContentDetailPlaybackActions,
  findContentDetailCurrentSongIndex,
  getContentDetailLocateScrollOffset,
  shuffleContentDetailSongs,
} from "@/services/contentDetailPlaybackActions";
import { buildContentDescriptionModel } from "@/services/contentDescriptionModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { usePlayerStore } from "@/stores/playerStore";

// 稳定空数组：避免加载态下 `?? []` 每次渲染生成新引用，导致下方 useMemo 依赖失效
const EMPTY_SONGS: MusicInfo[] = [];

interface ArtistDetailScreenProps {
  artist: SearchArtistResult;
  onBack: () => void;
  onNavigateToPlayer: () => void;
  onOpenAlbum: AlbumPressHandler;
}

type ArtistRemoteState =
  | { id: string; kind: "loading" }
  | { id: string; kind: "error"; message: string }
  | { id: string; kind: "success"; value: ArtistDetailResult };

export function ArtistDetailScreen({
  artist,
  onNavigateToPlayer,
  onOpenAlbum,
}: ArtistDetailScreenProps) {
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const currentSong = usePlayerStore((state) => state.currentSong);

  const scrollRef = useRef<ScrollView>(null);
  const requestSequenceRef = useRef(0);
  const currentIdRef = useRef(artist.id);
  currentIdRef.current = artist.id;
  const [remoteState, setRemoteState] = useState<ArtistRemoteState>(() => ({
    id: artist.id,
    kind: "loading",
  }));
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [pendingAction, setPendingAction] = useState<"play-all" | "shuffle" | null>(null);
  const [locatedSongIndex, setLocatedSongIndex] = useState<number | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // 加载歌手详情，抽取为可复用函数供 useEffect 与重试按钮共用
  const loadDetail = useCallback(
    async (isMounted: () => boolean = () => true) => {
      const requestedId = artist.id;
      const requestSequence = ++requestSequenceRef.current;
      const isCurrentRequest = () =>
        isMounted() &&
        requestSequenceRef.current === requestSequence &&
        currentIdRef.current === requestedId;

      if (isCurrentRequest()) {
        setRemoteState({ id: requestedId, kind: "loading" });
        setDescriptionExpanded(false);
        setPendingAction(null);
        setLocatedSongIndex(null);
      }

      try {
        const nextDetail = await fetchNeteaseArtistDetail(requestedId);
        if (isCurrentRequest()) {
          setRemoteState({ id: requestedId, kind: "success", value: nextDetail });
        }
      } catch (err) {
        if (isCurrentRequest()) {
          setRemoteState({
            id: requestedId,
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [artist.id],
  );

  useEffect(() => {
    let mounted = true;
    void loadDetail(() => mounted);

    return () => {
      mounted = false;
    };
  }, [loadDetail]);

  const handleRetry = () => {
    void loadDetail();
  };

  const currentState: ArtistRemoteState = remoteState.id === artist.id
    ? remoteState
    : { id: artist.id, kind: "loading" };
  const successfulDetail = currentState.kind === "success" ? currentState.value : null;
  const songs = successfulDetail?.songs ?? EMPTY_SONGS;
  const albums = successfulDetail?.albums ?? [];
  const artistInfo = successfulDetail?.artist ?? artist;
  const artistAlbumCount = successfulDetail?.artist.albumCount ?? albums.length;
  const artistBriefDesc = successfulDetail?.artist.briefDesc ?? "";
  const heroImageUrl = successfulDetail?.artist.avatarUrl ?? artist.avatarUrl;
  const heroTitle = successfulDetail?.artist.name ?? artist.name;
  const heroSubtitle = artistInfo.alias?.length ? artistInfo.alias.join(" / ") : undefined;
  const heroMetadata = successfulDetail
    ? [
        `${artistInfo.songCount || songs.length} 首热门歌曲`,
        `${artistAlbumCount} 张专辑`,
      ]
    : artist.songCount
      ? [`${artist.songCount} 首热门歌曲`]
      : [];
  const descriptionModel = buildContentDescriptionModel(artistBriefDesc, descriptionExpanded);
  const currentSongIndex = useMemo(
    () => findContentDetailCurrentSongIndex(songs, currentSong),
    [songs, currentSong],
  );
  const playbackActions = buildContentDetailPlaybackActions(songs.length, {
    currentSongIndex,
    playAllLabel: "播放热门",
    songSectionTitle: "热门歌曲",
    emptySongsText: "暂无热门歌曲",
  });
  const isPlayBusy = pendingAction !== null;

  const runPlayback = async (action: () => Promise<void>) => {
    setPlaybackError(null);
    const result = await runPlaybackUiAction(action);
    if (!result.ok) {
      setPlaybackError(result.message);
      return;
    }
  };

  const handlePlay = async (_song: MusicInfo, index: number) => {
    await runPlayback(() => playQueue(songs, index));
  };

  const handlePlayAll = async () => {
    if (songs.length === 0 || isPlayBusy) return;
    setPendingAction("play-all");
    try {
      await runPlayback(() => playQueue(songs, 0));
    } finally {
      setPendingAction(null);
    }
  };

  const handleShufflePlay = async () => {
    if (songs.length === 0 || isPlayBusy) return;
    setPendingAction("shuffle");
    try {
      await runPlayback(() => playQueue(shuffleContentDetailSongs(songs), 0));
    } finally {
      setPendingAction(null);
    }
  };

  const handleLocateCurrentSong = () => {
    if (!playbackActions.canLocateCurrentSong || currentSongIndex < 0) return;
    setLocatedSongIndex(currentSongIndex);
    // 歌手页上方还有专辑区，定位偏移略加大
    scrollRef.current?.scrollTo({
      y: getContentDetailLocateScrollOffset(currentSongIndex, {
        headerOffset: albums.length > 0 ? 420 : 280,
      }),
      animated: true,
    });
  };

  return (
    <ScreenScaffold>
      <ScreenScrollView innerRef={scrollRef}>
        <PlaybackErrorState
          message={playbackError}
          onDismiss={() => setPlaybackError(null)}
        />
        <DetailHero
          imageUrl={heroImageUrl}
          title={heroTitle}
          subtitle={heroSubtitle}
          metadata={heroMetadata}
          actions={
            successfulDetail ? (
              <PlaybackActionButtons
                show={playbackActions.show}
                playAllLabel={playbackActions.playAllLabel}
                playAllCount={songs.length > 0 ? `(${songs.length})` : undefined}
                shuffleLabel={playbackActions.shuffleLabel}
                locateLabel={playbackActions.locateLabel}
                canLocateCurrentSong={playbackActions.canLocateCurrentSong}
                playAllBusy={pendingAction === "play-all"}
                shuffleBusy={pendingAction === "shuffle"}
                onPlayAll={() => {
                  void handlePlayAll();
                }}
                onShuffle={() => {
                  void handleShufflePlay();
                }}
                onLocate={handleLocateCurrentSong}
              />
            ) : undefined
          }
        />

        {currentState.kind === "loading" ? (
          <LoadingState label="正在加载歌手详情" />
        ) : currentState.kind === "error" ? (
          <ErrorState message={currentState.message} onRetry={handleRetry} />
        ) : (
          <>
            {descriptionModel.show ? (
              <View style={styles.section}>
                <SectionHeader title="简介" />
                <Text
                  style={[styles.description, { color: palette.textMuted }]}
                  numberOfLines={descriptionModel.numberOfLines}
                >
                  {descriptionModel.text}
                </Text>
                <Pressable
                  style={styles.descriptionToggle}
                  onPress={() => setDescriptionExpanded((value) => !value)}
                  accessibilityRole="button"
                  accessibilityLabel={descriptionModel.toggleLabel}
                >
                  <Text style={[styles.descriptionToggleText, { color: palette.primary }]}>
                    {descriptionModel.toggleLabel}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.section}>
              <SectionHeader title="专辑" />
              {albums.length > 0 ? (
                <AlbumResultList albums={albums} onPress={onOpenAlbum} />
              ) : (
                <EmptyState icon={Disc3} title="暂无专辑" description="该歌手暂时没有可展示的专辑。" />
              )}
            </View>

            <View style={styles.section}>
              <SectionHeader title={playbackActions.songSectionTitle} />
              {songs.length > 0 ? (
                <SongList
                  songs={songs}
                  onPlay={handlePlay}
                  emptyText={playbackActions.emptySongsText}
                  highlightedIndex={
                    locatedSongIndex ?? (currentSongIndex >= 0 ? currentSongIndex : null)
                  }
                  hideSourceTag
                />
              ) : (
                <EmptyState title={playbackActions.emptySongsText} />
              )}
            </View>
          </>
        )}
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.xs,
    marginBottom: spacing.l,
    gap: spacing.s,
  },
  description: {
    fontSize: typography.body,
    lineHeight: 22,
  },
  descriptionToggle: {
    alignSelf: "flex-start",
    minHeight: 32,
    justifyContent: "center",
  },
  descriptionToggleText: {
    fontSize: typography.meta,
    fontWeight: "600",
  },
});
