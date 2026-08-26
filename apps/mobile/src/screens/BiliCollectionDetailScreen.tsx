import React, { useCallback, useEffect, useRef, useState } from "react";
import { spacing } from "@/theme/tokens";
import {
  type ScrollView as ScrollViewType,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MusicInfo } from "@lx/core";
import type { BiliCollectionInfo } from "@/services/biliService";

import { useBiliAccountStore } from "@/stores/biliAccountStore";
import { usePlayerStore } from "@/stores/playerStore";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { ActionButton } from "@/components/ActionButton";
import { PlaybackActionButtons } from "@/components/PlaybackActionButtons";
import { SongList } from "@/components/SongList";
import { DetailHero } from "@/components/DetailHero";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { ListMusic } from "lucide-react-native";

import { EmptyState, ErrorState, LoadingState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { SectionHeader } from "@/components/SectionHeader";
import {
  buildContentDetailPlaybackActions,
  getContentDetailLocateScrollOffset,
  shuffleContentDetailSongs,
} from "@/services/contentDetailPlaybackActions";
import { findPlaylistCurrentSongIndex } from "@/services/playlistDetailActions";
import {
  getResolvedTheme,
  getThemePalette,
  useThemeStore,
} from "@/stores/themeStore";

interface BiliCollectionDetailScreenProps {
  collection: BiliCollectionInfo;
  onBack: () => void;
  onNavigateToPlayer: () => void;
}

type BiliRemoteState =
  | { id: string; kind: "loading" }
  | { id: string; kind: "error"; message: string }
  | { id: string; kind: "success"; songs: MusicInfo[] };

type CollectionSongRequest = (collectionId: string) => Promise<MusicInfo[]>;

export function BiliCollectionDetailScreen({
  collection,
  onNavigateToPlayer,
}: BiliCollectionDetailScreenProps) {
  const scrollRef = useRef<ScrollViewType>(null);
  const requestSequenceRef = useRef(0);
  const currentIdRef = useRef(collection.id);
  currentIdRef.current = collection.id;
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const getCollectionSongs = useBiliAccountStore((state) => state.getCollectionSongs);
  const refreshCollectionSongs = useBiliAccountStore((state) => state.refreshCollectionSongs);
  const currentSong = usePlayerStore((state) => state.currentSong);

  const [remoteState, setRemoteState] = useState<BiliRemoteState>(() => ({
    id: collection.id,
    kind: "loading",
  }));
  const [locatedSongIndex, setLocatedSongIndex] = useState<number | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const currentState: BiliRemoteState = remoteState.id === collection.id
    ? remoteState
    : { id: collection.id, kind: "loading" };
  const successfulSongs = currentState.kind === "success" ? currentState.songs : null;
  const songs = successfulSongs ?? [];
  const currentSongIndex = findPlaylistCurrentSongIndex(songs, currentSong);
  const playbackActions = buildContentDetailPlaybackActions(songs.length, { currentSongIndex });

  const runCollectionRequest = useCallback(
    async (
      request: CollectionSongRequest,
      isMounted: () => boolean = () => true,
    ) => {
      const requestedId = collection.id;
      const requestSequence = ++requestSequenceRef.current;
      const isCurrentRequest = () =>
        isMounted() &&
        requestSequenceRef.current === requestSequence &&
        currentIdRef.current === requestedId;

      try {
        if (isCurrentRequest()) {
          setRemoteState({ id: requestedId, kind: "loading" });
          setLocatedSongIndex(null);
        }
        const result = await request(requestedId);
        if (isCurrentRequest()) {
          setRemoteState({ id: requestedId, kind: "success", songs: result });
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
    [collection.id],
  );

  useEffect(() => {
    let mounted = true;
    void runCollectionRequest(getCollectionSongs, () => mounted);
    return () => {
      mounted = false;
    };
  }, [getCollectionSongs, runCollectionRequest]);

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
    if (songs.length === 0) return;
    await runPlayback(() => playQueue(songs, 0));
  };

  const handleShufflePlay = async () => {
    if (songs.length === 0) return;
    await runPlayback(() => playQueue(shuffleContentDetailSongs(songs), 0));
  };

  const handleLocateCurrentSong = () => {
    if (currentSongIndex < 0) return;
    setLocatedSongIndex(currentSongIndex);
    scrollRef.current?.scrollTo({
      y: getContentDetailLocateScrollOffset(currentSongIndex),
      animated: true,
    });
  };

  const handleRefresh = async () => {
    await runCollectionRequest(refreshCollectionSongs);
  };

  const coverUrl = collection.picUrl;
  const heroMetadata = successfulSongs
    ? [
        `${songs.length} 首歌曲`,
        ...(collection.author ? [collection.author] : []),
      ]
    : [
        ...(collection.trackCount ? [`${collection.trackCount} 首歌曲`] : []),
        ...(collection.author ? [collection.author] : []),
      ];
  const heroActions = successfulSongs ? (
    <>
      <PlaybackActionButtons
        show={playbackActions.show}
        playAllLabel={playbackActions.playAllLabel}
        playAllCount={`(${songs.length})`}
        shuffleLabel={playbackActions.shuffleLabel}
        locateLabel={playbackActions.locateLabel}
        canLocateCurrentSong={playbackActions.canLocateCurrentSong}
        onPlayAll={handlePlayAll}
        onShuffle={handleShufflePlay}
        onLocate={handleLocateCurrentSong}
      />
      <ActionButton small label="刷新" onPress={handleRefresh} />
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
          compact
          imageUrl={coverUrl}
          title={collection.name}
          subtitle={collection.desc}
          metadata={heroMetadata}
          actions={heroActions}
        />

        {currentState.kind === "loading" ? (
          <LoadingState label="正在加载 B站合集内容" />
        ) : currentState.kind === "error" ? (
          <ErrorState message={currentState.message} onRetry={() => void handleRefresh()} />
        ) : (
          <View style={styles.section}>
            <SectionHeader title="歌曲" description={`${songs.length} 首`} />
            {songs.length > 0 ? (
              <SongList
                songs={songs}
                onPlay={handlePlay}
                emptyText="该合集暂无歌曲"
                highlightedIndex={locatedSongIndex ?? currentSongIndex}
                hideSourceTag
              />
            ) : (
              <EmptyState icon={ListMusic} title="该合集暂无歌曲" description="合集为空或尚未同步完成。" />
            )}
          </View>
        )}
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.s,
  },
});
