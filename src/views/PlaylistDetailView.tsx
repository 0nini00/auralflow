import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useWyAccountStore } from '@/stores/wyAccountStore';
import { useBiliAccountStore } from '@/stores/biliAccountStore';
import { resolver } from '@/services/sources/sourceService';
import { SongAddMenuButton } from '@/components/SongAddMenuButton';
import { DownloadQualityButton } from '@/components/DownloadQualityButton';
import { VirtualList } from '@/components/VirtualList';
import { formatDuration } from '@/lib/utils';
import { formatPlaylistSearchMeta } from '@/services/neteasePlaylistUtils';
import { getImageReferrerPolicy, normalizeImageUrl } from '@/utils/imageReferrerPolicy';
import type { MusicInfo, PlaylistInfo, SourceTag } from '@lx/core';
import { ArrowLeft, Play, Shuffle, Trash2, Clock, Loader2, CornerDownRight, MoreHorizontal, Bookmark, BookmarkCheck, BookmarkX, RefreshCw, LocateFixed } from 'lucide-react';

/** Fisher-Yates 均匀洗牌 */
function fisherYatesShuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface PlaylistRouteState {
  playlist?: PlaylistInfo;
}

function buildImportedPlaylistMarker(playlist: PlaylistInfo): string {
  return `[af-imported-playlist:${playlist.source}:${playlist.id}]`;
}

export function PlaylistDetailView() {
  type PendingPlayAction = 'play-all' | 'shuffle' | `track:${number}` | null;
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const sourceParam = searchParams.get("source");
  const routePlaylist = (location.state as PlaylistRouteState | null)?.playlist;
  const routePlaylistSource = routePlaylist?.source === "wy" || routePlaylist?.source === "tx" || routePlaylist?.source === "bili"
    ? routePlaylist.source
    : null;
  const explicitRemoteSource: Extract<SourceTag, "wy" | "tx" | "bili"> | null =
    sourceParam === "wy" || sourceParam === "tx" || sourceParam === "bili" ? sourceParam : routePlaylistSource;

  const {
    playlists,
    removeSongFromPlaylist,
    importPlaylist,
    updatePlaylistCover,
  } = usePlaylistStore();

  const favorites = useFavoritesStore((s) => s.favorites);
  const removeFavorite = useFavoritesStore((s) => s.removeFavorite);

  // 网易云歌单支持
  const wyPlaylists = useWyAccountStore((s) => s.playlists);
  const wyGetSongs = useWyAccountStore((s) => s.getPlaylistSongs);
  const wyRefreshSongs = useWyAccountStore((s) => s.refreshPlaylistSongs);
  const wyRemoveTracks = useWyAccountStore((s) => s.removeTracks);
  const wySetSubscribed = useWyAccountStore((s) => s.setSubscribed);
  const wyLoad = useWyAccountStore((s) => s.load);
  const wyAccount = useWyAccountStore((s) => s.account);
  const biliPlaylists = useBiliAccountStore((s) => s.playlists);
  const biliGetSongs = useBiliAccountStore((s) => s.getCollectionSongs);
  const biliRefreshSongs = useBiliAccountStore((s) => s.refreshCollectionSongs);
  const [wySongs, setWySongs] = useState<MusicInfo[] | null>(null);
  const [wySongsLoading, setWySongsLoading] = useState(false);
  const [wySongsError, setWySongsError] = useState('');
  const [biliSongs, setBiliSongs] = useState<MusicInfo[] | null>(null);
  const [biliSongsLoading, setBiliSongsLoading] = useState(false);
  const [biliSongsError, setBiliSongsError] = useState('');
  const [biliRefreshing, setBiliRefreshing] = useState(false);
  const [wyActionPending, setWyActionPending] = useState(false);
  const [wyRefreshing, setWyRefreshing] = useState(false);
  const [remoteSongs, setRemoteSongs] = useState<MusicInfo[] | null>(null);
  const [remoteSongsLoading, setRemoteSongsLoading] = useState(false);
  const [remoteSongsError, setRemoteSongsError] = useState('');
  const [remoteRefreshing, setRemoteRefreshing] = useState(false);
  const [actionStatus, setActionStatus] = useState('');
  const [pendingPlayAction, setPendingPlayAction] = useState<PendingPlayAction>(null);
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [locateScrollIndex, setLocateScrollIndex] = useState<number | undefined>(undefined);
  const [locateScrollKey, setLocateScrollKey] = useState(0);
  const [locatedSongIndex, setLocatedSongIndex] = useState<number | null>(null);
  const locateHighlightTimerRef = useRef<number | null>(null);

  const { playQueue, playNext, current: currentTrack } = usePlayerStore();

  const isFavoritesPlaylist = !explicitRemoteSource && id === 'favorites';
  const localPlaylist = !explicitRemoteSource && isFavoritesPlaylist
    ? {
        id: 'favorites',
        name: '我喜欢的音乐',
        songs: favorites,
        createdAt: 0,
        updatedAt: 0,
        cover: favorites[0]?.img || favorites[0]?.picUrl,
      }
    : !explicitRemoteSource
      ? playlists.find((p) => p.id === id)
      : undefined;
  const importedPlaylistMarkers = new Set(
    playlists
      .map((playlist) => playlist.description?.match(/\[af-imported-playlist:[^\]]+\]/)?.[0])
      .filter((marker): marker is string => Boolean(marker)),
  );

  // 尝试匹配网易云歌单
  const wyPlaylist = !explicitRemoteSource && !localPlaylist && id ? wyPlaylists.find(p => p.id === id) : null;
  const biliPlaylist = explicitRemoteSource === "bili" && id
    ? biliPlaylists.find((p) => p.id === id) ?? (routePlaylist?.source === "bili" ? routePlaylist : null)
    : null;
  const fallbackRemoteSource: Extract<SourceTag, "wy"> | null =
    !explicitRemoteSource && !localPlaylist && !wyPlaylist && id && /^\d+$/.test(id) ? "wy" : null;
  const remoteSource: Extract<SourceTag, "wy" | "tx" | "bili"> | null = explicitRemoteSource ?? fallbackRemoteSource;

  const remotePlaylistInfo = useMemo<PlaylistInfo | null>(() => {
    if (!id || !remoteSource || remoteSource === "bili") return null;
    return {
      id,
      name: routePlaylist?.name || (remoteSource === "tx" ? "QQ 音乐歌单" : "网易云歌单"),
      author: routePlaylist?.author || "",
      picUrl: routePlaylist?.picUrl,
      desc: routePlaylist?.desc,
      playCount: routePlaylist?.playCount,
      trackCount: routePlaylist?.trackCount,
      source: remoteSource,
    };
  }, [id, remoteSource, routePlaylist]);

  // 异步加载网易云歌单歌曲
  useEffect(() => {
    if (!wyPlaylist) return;
    let cancelled = false;
    setWySongsLoading(true);
    setWySongsError('');
    wyGetSongs(wyPlaylist.id)
      .then(songs => { if (!cancelled) setWySongs(songs); })
      .catch(e => { if (!cancelled) setWySongsError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setWySongsLoading(false); });
    return () => { cancelled = true; };
  }, [wyPlaylist?.id]);

  useEffect(() => {
    if (!biliPlaylist?.id) return;
    let cancelled = false;
    setBiliSongsLoading(true);
    setBiliSongsError('');
    biliGetSongs(biliPlaylist.id)
      .then((songs) => { if (!cancelled) setBiliSongs(songs); })
      .catch((error) => { if (!cancelled) setBiliSongsError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setBiliSongsLoading(false); });
    return () => { cancelled = true; };
  }, [biliGetSongs, biliPlaylist?.id]);

  const loadRemotePlaylistSongs = (playlist: PlaylistInfo, refreshing = false) => {
    const provider = resolver.getSource(playlist.source);
    if (!provider) {
      setRemoteSongsError("未找到对应音源");
      return Promise.resolve();
    }
    if (refreshing) {
      setRemoteRefreshing(true);
    } else {
      setRemoteSongsLoading(true);
    }
    setRemoteSongsError('');
    return provider.getPlaylistDetail(playlist)
      .then((songs) => setRemoteSongs(songs))
      .catch((err) => {
        setRemoteSongsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (refreshing) {
          setRemoteRefreshing(false);
        } else {
          setRemoteSongsLoading(false);
        }
      });
  };

  useEffect(() => {
    if (!remotePlaylistInfo) return;
    let cancelled = false;
    const provider = resolver.getSource(remotePlaylistInfo.source);
    if (!provider) {
      setRemoteSongsError("未找到对应音源");
      setRemoteSongs([]);
      return;
    }
    setRemoteSongsLoading(true);
    setRemoteSongsError('');
    provider.getPlaylistDetail(remotePlaylistInfo)
      .then((songs) => { if (!cancelled) setRemoteSongs(songs); })
      .catch((err) => {
        if (!cancelled) setRemoteSongsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setRemoteSongsLoading(false); });
    return () => { cancelled = true; };
  }, [remotePlaylistInfo?.id, remotePlaylistInfo?.source]);

  // 最终展示的歌单数据
  const resolvedPlaylist = localPlaylist
    ? { ...localPlaylist, cover: (localPlaylist as any).cover ?? (localPlaylist as any).picUrl }
    : wyPlaylist
      ? { id: wyPlaylist.id, name: wyPlaylist.name, songs: wySongs ?? [], createdAt: 0, updatedAt: 0, description: wyPlaylist.author ? `by ${wyPlaylist.author}` : undefined, cover: wyPlaylist.picUrl }
      : biliPlaylist
        ? { id: biliPlaylist.id, name: biliPlaylist.name, songs: biliSongs ?? [], createdAt: 0, updatedAt: 0, description: biliPlaylist.author ? `by ${biliPlaylist.author}` : undefined, cover: biliPlaylist.picUrl }
        : remotePlaylistInfo
        ? {
            id: remotePlaylistInfo.id,
            name: remotePlaylistInfo.name,
            songs: remoteSongs ?? [],
            createdAt: 0,
            updatedAt: 0,
            description: remotePlaylistInfo.desc || (remotePlaylistInfo.author ? `by ${remotePlaylistInfo.author}` : undefined),
            cover: remotePlaylistInfo.picUrl,
          }
      : null;

  const resolvedSongs = resolvedPlaylist?.songs ?? [];
  const currentSongIndex = useMemo(() => {
    if (!currentTrack) return -1;
    return resolvedSongs.findIndex(
      (song) => song.source === currentTrack.source && String(song.id) === String(currentTrack.id),
    );
  }, [currentTrack, resolvedSongs]);

  useEffect(() => {
    return () => {
      if (locateHighlightTimerRef.current != null) {
        window.clearTimeout(locateHighlightTimerRef.current);
      }
    };
  }, []);

  if (wySongsLoading || biliSongsLoading || remoteSongsLoading) {
    return (
      <div className="af-playlist-detail-view">
        <div className="af-empty-state">
          <Loader2 size={32} className="af-spin" />
          <p>加载歌单中...</p>
        </div>
      </div>
    );
  }

  if (wySongsError || biliSongsError || remoteSongsError) {
    return (
      <div className="af-playlist-detail-view">
        <div className="af-empty-state">
          <p>加载失败</p>
          <span>{wySongsError || biliSongsError || remoteSongsError}</span>
          <button onClick={() => remoteSource ? navigate(-1) : navigate('/playlists')} style={{ marginTop: 16 }}>返回</button>
        </div>
      </div>
    );
  }

  if (!localPlaylist && !wyPlaylist && !biliPlaylist && !remotePlaylistInfo) {
    return (
      <div className="af-playlist-detail-view">
        <div className="af-empty-state">
          <p>歌单不存在</p>
          <button onClick={() => navigate('/playlists')}>返回歌单列表</button>
        </div>
      </div>
    );
  }

  const playlist = resolvedPlaylist!;
  const isWyPlaylist = !!wyPlaylist;
  const isBiliPlaylist = !!biliPlaylist;
  const isRemotePlaylist = !!remotePlaylistInfo;
  const playlistCoverUrl = normalizeImageUrl(playlist.cover);
  const isWyOwned = isWyPlaylist && wyPlaylist!.subscribed === false;
  const isWySubscribed = isWyPlaylist && wyPlaylist!.subscribed === true;
  const remotePlaylistCollectionMarker = remotePlaylistInfo ? buildImportedPlaylistMarker(remotePlaylistInfo) : null;
  const isRemoteWyCollected = remotePlaylistInfo?.source === "wy"
    ? wyPlaylists.some((item) => item.id === remotePlaylistInfo.id)
    : false;
  const isRemoteTxCollected = remotePlaylistInfo?.source === "tx" && remotePlaylistCollectionMarker
    ? importedPlaylistMarkers.has(remotePlaylistCollectionMarker)
    : false;
  const isRemoteCollected = isRemoteWyCollected || isRemoteTxCollected;
  const remoteCollectLabel = remotePlaylistInfo?.source === "wy" ? "收藏到网易云账号" : "收藏到本地歌单";
  const remotePlaylistMeta = remotePlaylistInfo ? formatPlaylistSearchMeta(remotePlaylistInfo) : "--";
  const songs = playlist.songs;
  const isPlayAllPending = pendingPlayAction === 'play-all';
  const isShufflePending = pendingPlayAction === 'shuffle';

  const runPlayQueueAction = async (action: Exclude<PendingPlayAction, null>, queueToPlay: MusicInfo[], startIndex = 0) => {
    if (pendingPlayAction) return;
    setPendingPlayAction(action);
    try {
      await playQueue(queueToPlay, startIndex);
    } finally {
      setPendingPlayAction(null);
    }
  };

  const handlePlayAll = () => {
    if (songs.length > 0) {
      void runPlayQueueAction('play-all', songs, 0);
    }
  };

  const handleShufflePlay = () => {
    if (songs.length > 0) {
      void runPlayQueueAction('shuffle', fisherYatesShuffle(songs), 0);
    }
  };

  const handlePlayTrack = (index: number) => {
    void runPlayQueueAction(`track:${index}`, songs, index);
  };

  const handleLocateCurrentSong = () => {
    setOpenMenuIndex(null);
    if (!currentTrack) {
      setActionStatus('当前没有正在播放的歌曲。');
      return;
    }
    if (currentSongIndex < 0) {
      setActionStatus('当前播放歌曲不在这个歌单里。');
      return;
    }
    setActionStatus('');
    setLocateScrollIndex(currentSongIndex);
    setLocateScrollKey((value) => value + 1);
    setLocatedSongIndex(currentSongIndex);
    if (locateHighlightTimerRef.current != null) {
      window.clearTimeout(locateHighlightTimerRef.current);
    }
    locateHighlightTimerRef.current = window.setTimeout(() => {
      setLocatedSongIndex((value) => (value === currentSongIndex ? null : value));
      locateHighlightTimerRef.current = null;
    }, 1600);
  };

  const handlePlayNext = (song: MusicInfo) => {
    playNext(song);
  };

  const handleRemoveSong = (index: number) => {
    setOpenMenuIndex(null);
    setActionStatus('');
    if (isFavoritesPlaylist) {
      const song = favorites[index];
      if (song) removeFavorite(song);
      return;
    }
    if (isWyOwned) {
      const song = songs[index];
      if (!song) return;
      setWyActionPending(true);
      wyRemoveTracks(playlist.id, [song])
        .then(() => {
          setWySongs((prev) => prev ? prev.filter((_, i) => i !== index) : prev);
          setActionStatus('已从网易云歌单移除');
        })
        .catch((err) => {
          setActionStatus(`移除失败：${err instanceof Error ? err.message : String(err)}`);
        })
        .finally(() => setWyActionPending(false));
      return;
    }
    if (!isWyPlaylist && !isRemotePlaylist) {
      removeSongFromPlaylist(playlist.id, index);
    }
  };

  const handleUnsubscribe = () => {
    if (!isWySubscribed) return;
    if (!confirm(`取消收藏歌单"${playlist.name}"？`)) return;
    setWyActionPending(true);
    setActionStatus('');
    wySetSubscribed(playlist.id, false)
      .then(() => navigate('/playlists'))
      .catch((err) => {
        setActionStatus(`取消收藏失败：${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => setWyActionPending(false));
  };

  const handleRefreshWy = () => {
    if (!isWyPlaylist) return;
    setWyRefreshing(true);
    setWySongsError('');
    wyRefreshSongs(playlist.id)
      .then((songs) => setWySongs(songs))
      .catch((err) => {
        setWySongsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setWyRefreshing(false));
  };

  const handleRefreshBili = () => {
    if (!isBiliPlaylist) return;
    setBiliRefreshing(true);
    setBiliSongsError('');
    biliRefreshSongs(playlist.id)
      .then((songs) => setBiliSongs(songs))
      .catch((error) => {
        setBiliSongsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setBiliRefreshing(false));
  };

  const handleRefreshRemote = () => {
    if (!remotePlaylistInfo) return;
    void loadRemotePlaylistSongs(remotePlaylistInfo, true);
  };

  const handleCollectRemotePlaylist = async () => {
    if (!remotePlaylistInfo || isRemoteCollected) return;
    setWyActionPending(true);
    setActionStatus('');
    try {
      if (remotePlaylistInfo.source === "wy") {
        if (!wyAccount) {
          await wyLoad();
        }
        await wySetSubscribed(remotePlaylistInfo.id, true);
        setActionStatus("已收藏到网易云账号");
        return;
      }

      if (remotePlaylistInfo.source === "tx") {
        const marker = buildImportedPlaylistMarker(remotePlaylistInfo);
        const existing = playlists.find((item) => item.description?.includes(marker));
        if (existing) {
          setActionStatus(`本地歌单已存在：${existing.name}`);
          return;
        }

        const provider = resolver.getSource("tx");
        if (!provider) throw new Error("未找到 QQ 音乐源");
        const detailSongs = remoteSongs ?? await provider.getPlaylistDetail(remotePlaylistInfo);
        const description = [remotePlaylistInfo.desc, marker].filter(Boolean).join('\n');
        const created = importPlaylist(remotePlaylistInfo.name, description || marker, detailSongs);
        if (remotePlaylistInfo.picUrl) {
          updatePlaylistCover(created.id, remotePlaylistInfo.picUrl);
        }
        setActionStatus(`已收藏到本地歌单：${created.name}`);
      }
    } catch (err) {
      setActionStatus(`收藏失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setWyActionPending(false);
    }
  };

  return (
    <div className="af-playlist-detail-view">
      <div className="af-playlist-detail-header">
        <button className="af-back-btn" onClick={() => remoteSource ? navigate(-1) : navigate('/playlists')}>
          <ArrowLeft size={20} />
        </button>

        <div className="af-playlist-detail-info">
          <div className="af-playlist-detail-cover">
            {playlistCoverUrl ? (
              <img src={playlistCoverUrl} alt={playlist.name} referrerPolicy={getImageReferrerPolicy(playlistCoverUrl)} />
            ) : (
              <div className="af-cover-placeholder">♪</div>
            )}
          </div>

          <div className="af-playlist-detail-meta">
            <h1>{playlist.name}</h1>
            {!isFavoritesPlaylist && !isWyPlaylist && playlist.description && (
              <p className="af-playlist-description">{playlist.description}</p>
            )}
            {isWyPlaylist && wyPlaylist && (
              <p className="af-playlist-description">by {wyPlaylist.author}{wyPlaylist.trackCount != null && ` · ${wyPlaylist.trackCount} 首`}</p>
            )}
            {isBiliPlaylist && biliPlaylist && (
              <p className="af-playlist-description">by {biliPlaylist.author || '哔哩哔哩'}{biliPlaylist.trackCount != null && ` · ${biliPlaylist.trackCount} 个视频`}</p>
            )}
            {isRemotePlaylist && remotePlaylistInfo && (
              <p className="af-playlist-description">
                {remotePlaylistInfo.author ? `by ${remotePlaylistInfo.author}` : remotePlaylistInfo.source.toUpperCase()}
                {remotePlaylistMeta !== "--" && ` · ${remotePlaylistMeta}`}
              </p>
            )}
            {!isWyPlaylist && !isBiliPlaylist && (
              <p className="af-playlist-stats">
                {songs.length} 首歌曲
                {!isFavoritesPlaylist && playlist.createdAt > 0 && (
                  <>
                    {' · '}
                    创建于 {new Date(playlist.createdAt).toLocaleDateString('zh-CN')}
                  </>
                )}
              </p>
            )}

            <div className="af-playlist-actions">
              <button
                className="af-btn-primary"
                onClick={handlePlayAll}
                disabled={songs.length === 0 || isPlayAllPending}
              >
                {isPlayAllPending ? <Loader2 size={16} className="af-spin" /> : <Play size={16} fill="currentColor" />}
                <span>{isPlayAllPending ? '加载中' : '播放全部'}</span>
              </button>
              <button
                className="af-btn-secondary"
                onClick={handleShufflePlay}
                disabled={songs.length === 0 || isShufflePending}
              >
                {isShufflePending ? <Loader2 size={16} className="af-spin" /> : <Shuffle size={16} />}
                <span>{isShufflePending ? '加载中' : '随机播放'}</span>
              </button>
              <button
                className="af-btn-secondary"
                onClick={handleLocateCurrentSong}
                disabled={songs.length === 0}
                title={currentSongIndex >= 0 ? '定位当前播放歌曲' : '定位当前播放'}
              >
                <LocateFixed size={16} />
                <span>定位当前播放</span>
              </button>
              {isWyPlaylist && (
                <button
                  className="af-btn-secondary"
                  onClick={handleRefreshWy}
                  disabled={wyRefreshing || wySongsLoading}
                  title="重新从网易云拉取最新歌单内容"
                >
                  <RefreshCw size={16} className={wyRefreshing ? 'af-spin' : ''} />
                  <span>{wyRefreshing ? '刷新中' : '刷新'}</span>
                </button>
              )}
              {isRemotePlaylist && (
                <button
                  className="af-btn-secondary"
                  onClick={handleRefreshRemote}
                  disabled={remoteRefreshing || remoteSongsLoading}
                  title="重新拉取最新歌单内容"
                >
                  <RefreshCw size={16} className={remoteRefreshing ? 'af-spin' : ''} />
                  <span>{remoteRefreshing ? '刷新中' : '刷新'}</span>
                </button>
              )}
              {isBiliPlaylist && (
                <button
                  className="af-btn-secondary"
                  onClick={handleRefreshBili}
                  disabled={biliRefreshing || biliSongsLoading}
                  title="重新从 B站拉取最新合集内容"
                >
                  <RefreshCw size={16} className={biliRefreshing ? 'af-spin' : ''} />
                  <span>{biliRefreshing ? '刷新中' : '刷新'}</span>
                </button>
              )}
              {isRemotePlaylist && remotePlaylistInfo && remotePlaylistInfo.source !== "bili" && (
                <button
                  className="af-btn-secondary"
                  onClick={() => { void handleCollectRemotePlaylist(); }}
                  disabled={wyActionPending || isRemoteCollected}
                  title={isRemoteCollected ? '已收藏' : remoteCollectLabel}
                >
                  {isRemoteCollected ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
                  <span>
                    {wyActionPending
                      ? '处理中'
                      : isRemoteCollected
                        ? '已收藏'
                        : remoteCollectLabel}
                  </span>
                </button>
              )}
              {isWySubscribed && (
                <button
                  className="af-btn-secondary"
                  onClick={handleUnsubscribe}
                  disabled={wyActionPending}
                  title="取消收藏该歌单"
                >
                  <BookmarkX size={16} />
                  <span>{wyActionPending ? '处理中' : '取消收藏'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {actionStatus && <p className="af-playlist-action-status">{actionStatus}</p>}

      <div className="af-playlist-songs">
        {songs.length === 0 ? (
          <div className="af-empty-state">
            <p>歌单是空的</p>
            <span>从搜索或其他地方添加歌曲</span>
          </div>
        ) : (
          <>
            <div className="af-song-list-header">
              <div className="af-col-index">#</div>
              <div className="af-col-title">标题</div>
              <div className="af-col-artist">艺术家</div>
              <div className="af-col-album">专辑</div>
              <div className="af-col-duration"><Clock size={16} /></div>
              <div className="af-col-actions"></div>
            </div>

            <VirtualList
              items={songs}
              rowHeight={60}
              className="af-song-list-virtual"
              scrollToIndex={locateScrollIndex}
              scrollToKey={locateScrollKey}
              scrollRootSelector=".af-content-scroll"
              onScroll={() => setOpenMenuIndex(null)}
              renderItem={(song, index) => {
                const isCurrentSong = currentSongIndex === index;
                const isLocatedSong = locatedSongIndex === index;

                return (
                  <div
                    className={`af-song-list-row ${openMenuIndex === index ? 'af-menu-open' : ''} ${isCurrentSong ? 'af-current-playing' : ''} ${isLocatedSong ? 'af-locate-hit' : ''}`}
                    onClick={() => handlePlayTrack(index)}
                    title="单击播放"
                  >
                    <div className="af-col-index">{index + 1}</div>

                    <div className="af-col-title">
                      <div className="af-song-cover">
                        {normalizeImageUrl(song.img) ? (
                          <img src={normalizeImageUrl(song.img)} alt={song.name} referrerPolicy={getImageReferrerPolicy(song.img)} />
                        ) : (
                          <div className="af-cover-placeholder">♪</div>
                        )}
                      </div>
                      <span>{song.name}</span>
                    </div>

                    <div className="af-col-artist">{song.singer}</div>
                    <div className="af-col-album">{song.albumName || '-'}</div>
                    <div className="af-col-duration">{formatDuration(song.interval || 0)}</div>

                    <div className="af-col-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="af-action-btn"
                        onClick={() => handlePlayTrack(index)}
                        title="播放"
                      >
                        <Play size={14} fill="currentColor" />
                      </button>
                      <SongAddMenuButton
                        song={song}
                        iconSize={14}
                        title="添加到我的喜欢或歌单"
                      />
                      <DownloadQualityButton
                        song={song}
                        iconSize={14}
                        title="下载"
                      />
                      <button
                        className="af-action-btn"
                        onClick={(e) => {
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setMenuPos({ top: r.bottom + 4, left: Math.max(8, r.right - 180) });
                          setOpenMenuIndex(openMenuIndex === index ? null : index);
                        }}
                        title="更多操作"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                  </div>
                );
              }}
            />
          </>
        )}
      </div>

      {openMenuIndex != null && menuPos && songs[openMenuIndex] && createPortal(
        <div
          className="af-dropdown-menu af-song-action-menu af-song-action-portal"
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 9999 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => handlePlayNext(songs[openMenuIndex!])}>
            <CornerDownRight size={14} />
            <span>下一首播放</span>
          </button>
          {((!isWyPlaylist && !isBiliPlaylist && !isRemotePlaylist) || isWyOwned) && (
            <button
              className="af-menu-danger"
              onClick={() => { handleRemoveSong(openMenuIndex!); setOpenMenuIndex(null); }}
              disabled={wyActionPending}
            >
              <Trash2 size={14} />
              <span>移除</span>
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
