import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { radius, spacing, typography } from "@/theme/tokens";
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
import { BatchDownloadModal } from "@/components/BatchDownloadModal";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { EmptyState, ErrorState, LoadingState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { SectionHeader } from "@/components/SectionHeader";
import {
  fetchNeteaseAlbumDetail,
  type AlbumDetailResult,
  type SearchAlbumResult,
} from "@/services/musicApi";
import { SongList } from "@/components/SongList";
import { useDownloadStore, type DownloadQuality } from "@/stores/downloadStore";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import {
  buildContentDetailPlaybackActions,
  findContentDetailCurrentSongIndex,
  getContentDetailLocateScrollOffset,
  shuffleContentDetailSongs,
} from "@/services/contentDetailPlaybackActions";
import { buildContentDescriptionModel } from "@/services/contentDescriptionModel";
import {
  openAlbumArtistDetail,
  type SearchAlbumDetailRoute,
  type SearchDetailRoute,
} from "@/services/searchDetailNavigation";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { usePlayerStore } from "@/stores/playerStore";

// 稳定空数组：避免加载态下 `?? []` 每次渲染生成新引用，导致下方 useMemo 依赖失效
const EMPTY_SONGS: MusicInfo[] = [];

interface AlbumDetailScreenProps {
  album: SearchAlbumResult;
  parentAlbum: SearchAlbumDetailRoute;
  onBack: () => void;
  onNavigateToPlayer: () => void;
  onOpenArtist?: (route: Extract<SearchDetailRoute, { type: "artist" }>) => void;
}

type AlbumRemoteState =
  | { id: string; kind: "loading" }
  | { id: string; kind: "error"; message: string }
  | { id: string; kind: "success"; value: AlbumDetailResult };

export function AlbumDetailScreen({
  album,
  parentAlbum,
  onNavigateToPlayer,
  onOpenArtist,
}: AlbumDetailScreenProps) {
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const currentSong = usePlayerStore((state) => state.currentSong);

  const scrollRef = useRef<ScrollView>(null);
  const requestSequenceRef = useRef(0);
  const currentIdRef = useRef(album.id);
  currentIdRef.current = album.id;
  const [remoteState, setRemoteState] = useState<AlbumRemoteState>(() => ({
    id: album.id,
    kind: "loading",
  }));
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [pendingAction, setPendingAction] = useState<"play-all" | "shuffle" | null>(null);
  const [locatedSongIndex, setLocatedSongIndex] = useState<number | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [batchDownloadVisible, setBatchDownloadVisible] = useState(false);
  const downloadSong = useDownloadStore((state) => state.downloadSong);

  // 加载专辑详情，useEffect 与重试按钮共用同一逻辑
  const load = useCallback(async (isMounted: () => boolean = () => true) => {
    const requestedId = album.id;
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
      const nextDetail = await fetchNeteaseAlbumDetail(requestedId);
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
  }, [album.id]);

  useEffect(() => {
    let mounted = true;
    void load(() => mounted);

    return () => {
      mounted = false;
    };
  }, [load]);

  const currentState: AlbumRemoteState = remoteState.id === album.id
    ? remoteState
    : { id: album.id, kind: "loading" };
  const successfulDetail = currentState.kind === "success" ? currentState.value : null;
  const albumInfo = successfulDetail?.album ?? album;
  const songs = successfulDetail?.songs ?? EMPTY_SONGS;
  const albumDescription = successfulDetail?.album.description ?? "";
  const heroImageUrl = successfulDetail?.album.coverUrl ?? album.coverUrl;
  const heroTitle = successfulDetail?.album.name ?? album.name;
  const heroMetadata = successfulDetail
    ? [
        ...(albumInfo.publishTime ? [albumInfo.publishTime] : []),
        ...(albumInfo.trackCount || songs.length
          ? [`${albumInfo.trackCount || songs.length} 首歌曲`]
          : []),
      ]
    : [
        ...(album.publishTime ? [album.publishTime] : []),
        ...(album.trackCount ? [`${album.trackCount} 首歌曲`] : []),
      ];
  const descriptionModel = buildContentDescriptionModel(albumDescription, descriptionExpanded);
  const currentSongIndex = useMemo(
    () => findContentDetailCurrentSongIndex(songs, currentSong),
    [songs, currentSong],
  );
  const playbackActions = buildContentDetailPlaybackActions(songs.length, {
    currentSongIndex,
    songSectionTitle: "歌曲",
    emptySongsText: "暂无曲目",
  });
  const artistRoute = successfulDetail ? openAlbumArtistDetail(albumInfo, parentAlbum) : null;
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
    scrollRef.current?.scrollTo({
      y: getContentDetailLocateScrollOffset(currentSongIndex),
      animated: true,
    });
  };

  const handleOpenArtist = () => {
    if (artistRoute?.type !== "artist") return;
    onOpenArtist?.(artistRoute);
  };

  const heroActions = successfulDetail ? (
    <>
      {artistRoute ? (
        <Pressable
          onPress={handleOpenArtist}
          style={styles.artistLink}
          accessibilityRole="button"
          accessibilityLabel={`查看歌手 ${albumInfo.artistName}`}
        >
          <Text style={[styles.artistName, { color: palette.primary }]}>
            {albumInfo.artistName}
          </Text>
        </Pressable>
      ) : null}
      <PlaybackActionButtons
        show={playbackActions.show}
        playAllLabel={playbackActions.playAllLabel}
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
        extraActions={
          songs.length > 0
            ? [{ label: "下载全部", onPress: () => setBatchDownloadVisible(true) }]
            : undefined
        }
      />
    </>
  ) : undefined;

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
          subtitle={artistRoute ? undefined : albumInfo.artistName}
          metadata={heroMetadata}
          actions={heroActions}
        />

        {currentState.kind === "loading" ? (
          <LoadingState label="正在加载专辑详情" />
        ) : currentState.kind === "error" ? (
          <ErrorState message={currentState.message} onRetry={() => void load()} />
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
      <BatchDownloadModal
        visible={batchDownloadVisible}
        songs={songs}
        onClose={() => setBatchDownloadVisible(false)}
        onDownload={(song, quality: DownloadQuality) => {
          void downloadSong(song, quality);
        }}
      />
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  artistName: {
    fontSize: typography.body,
  },
  artistLink: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: radius.pill,
  },
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
